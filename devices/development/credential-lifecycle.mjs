import { Buffer } from 'node:buffer'
import { closeSync, constants, openSync } from 'node:fs'
import { connect as nodeTlsConnect } from 'node:tls'
import { ReadStream, WriteStream } from 'node:tty'

export class CredentialLifecycleError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'CredentialLifecycleError'
    this.code = code
  }
}

function fail(code, message) {
  throw new CredentialLifecycleError(code, message)
}

function encodeVariableInteger(value) {
  const encoded = []
  do {
    let byte = value % 128
    value = Math.floor(value / 128)
    if (value > 0) byte |= 0x80
    encoded.push(byte)
  } while (value > 0)
  return Buffer.from(encoded)
}

function decodeVariableInteger(buffer, offset) {
  let value = 0
  let multiplier = 1
  for (let index = 0; index < 4; index += 1) {
    const byte = buffer[offset + index]
    if (byte === undefined) return null
    value += (byte & 0x7f) * multiplier
    if ((byte & 0x80) === 0) return { value, bytes: index + 1 }
    multiplier *= 128
  }
  fail('mqtt_connection_packet_invalid', 'Malformed MQTT packet length')
}

function encodeUtf8(value) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length > 65_535) fail('credential_input_invalid', 'MQTT credential field is too long')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function mqttConnectPacket({ deviceId, username, password }) {
  const passwordBytes = Buffer.from(password, 'utf8')
  if (passwordBytes.length > 65_535) fail('credential_input_invalid', 'Device password is too long')
  const passwordLength = Buffer.alloc(2)
  passwordLength.writeUInt16BE(passwordBytes.length)
  const body = Buffer.concat([
    encodeUtf8('MQTT'),
    Buffer.from([0x05, 0xc2, 0x00, 0x3c, 0x00]),
    encodeUtf8(deviceId),
    encodeUtf8(username),
    passwordLength,
    passwordBytes,
  ])
  return Buffer.concat([Buffer.from([0x10]), encodeVariableInteger(body.length), body])
}

function strictMqttEndpoint(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail('unsafe_mqtt_endpoint', 'MQTT endpoint is invalid')
  }
  if (
    url.protocol !== 'mqtts:' ||
    url.port !== '8883' ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    fail('unsafe_mqtt_endpoint', 'Lifecycle verification requires mqtts:// on port 8883')
  }
  return { host: url.hostname, port: 8883 }
}

export async function readHiddenPassword({ input, output, prompt = 'Current device password: ' }) {
  if (
    input?.isTTY !== true ||
    output?.isTTY !== true ||
    typeof input.setRawMode !== 'function' ||
    typeof input.resume !== 'function' ||
    typeof input.pause !== 'function' ||
    typeof output.write !== 'function'
  ) {
    fail('unsafe_credential_input', 'Current credential input requires an interactive TTY')
  }

  return await new Promise((resolve, reject) => {
    let password = ''
    let settled = false
    const cleanup = () => {
      input.off('data', onData)
      input.off('error', onError)
      input.off('close', onClose)
      input.setRawMode(false)
      input.pause()
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      output.write('\n')
      if (error) reject(error)
      else if (password.length === 0) reject(new CredentialLifecycleError('empty_device_password'))
      else resolve(password)
    }
    const onError = () => finish(new CredentialLifecycleError('credential_input_failed'))
    const onClose = () => finish(new CredentialLifecycleError('credential_input_closed'))
    const onData = (chunk) => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 0x03) {
          finish(new CredentialLifecycleError('credential_input_cancelled'))
          return
        }
        if (byte === 0x0a || byte === 0x0d) {
          finish()
          return
        }
        if (byte === 0x08 || byte === 0x7f) password = password.slice(0, -1)
        else if (byte >= 0x20) password += String.fromCharCode(byte)
      }
    }

    try {
      input.on('data', onData)
      input.on('error', onError)
      input.on('close', onClose)
      input.setRawMode(true)
      output.write(prompt)
      input.resume()
    } catch {
      finish(new CredentialLifecycleError('unsafe_credential_input'))
    }
  })
}

export async function readCurrentPasswordFromInteractiveTty() {
  let inputDescriptor
  let outputDescriptor
  try {
    inputDescriptor = openSync('/dev/tty', constants.O_RDONLY | constants.O_NOCTTY)
    outputDescriptor = openSync('/dev/tty', constants.O_WRONLY | constants.O_NOCTTY)
  } catch {
    if (inputDescriptor !== undefined) closeSync(inputDescriptor)
    if (outputDescriptor !== undefined) closeSync(outputDescriptor)
    fail('unsafe_credential_input', 'Unable to open an interactive credential TTY')
  }

  const input = new ReadStream(inputDescriptor)
  const output = new WriteStream(outputDescriptor)
  try {
    return await readHiddenPassword({ input, output })
  } finally {
    input.destroy()
    output.end()
  }
}

export function createMqtt5ConnectionProbe({ connectTls = nodeTlsConnect, timeoutMs = 5_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    fail('mqtt_connection_timeout_invalid', 'Connection timeout must be a positive integer')
  }

  return async function connectionProbe(connection) {
    if (
      typeof connection.password !== 'string' ||
      connection.password.length === 0 ||
      connection.username !== `device-${connection.deviceId}`
    ) {
      fail('credential_input_invalid', 'Lifecycle connection identity is invalid')
    }
    const endpoint = strictMqttEndpoint(connection.mqttUrl)

    return await new Promise((resolve, reject) => {
      let settled = false
      let buffered = Buffer.alloc(0)
      let socket
      const finish = (error, outcome) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket?.destroy()
        if (error) reject(error)
        else resolve(outcome)
      }
      const timer = setTimeout(
        () => finish(new CredentialLifecycleError('mqtt_connection_timeout')),
        timeoutMs,
      )

      try {
        socket = connectTls(
          {
            host: endpoint.host,
            port: endpoint.port,
            servername: endpoint.host,
            rejectUnauthorized: true,
          },
          () => socket.write(mqttConnectPacket(connection)),
        )
      } catch {
        finish(new CredentialLifecycleError('mqtt_tls_connection_failed'))
        return
      }
      if (!socket || typeof socket.on !== 'function' || typeof socket.write !== 'function') {
        finish(new CredentialLifecycleError('mqtt_tls_connection_failed'))
        return
      }

      socket.on('data', (chunk) => {
        try {
          buffered = Buffer.concat([buffered, chunk])
          const length = decodeVariableInteger(buffered, 1)
          if (!length) return
          const bodyOffset = 1 + length.bytes
          if (buffered.length < bodyOffset + length.value) return
          if ((buffered[0] >> 4) !== 2 || length.value < 3) {
            fail('mqtt_connection_ack_ambiguous', 'Expected an MQTT 5 CONNACK')
          }
          const reasonCode = buffered[bodyOffset + 1]
          if (reasonCode === 0) finish(undefined, 'connected')
          else if (reasonCode >= 0x80) finish(undefined, 'rejected')
          else fail('mqtt_connection_ack_ambiguous', 'Unexpected MQTT 5 CONNACK reason code')
        } catch (error) {
          finish(
            error instanceof CredentialLifecycleError
              ? error
              : new CredentialLifecycleError('mqtt_connection_ack_ambiguous'),
          )
        }
      })
      socket.on('error', () => finish(new CredentialLifecycleError('mqtt_tls_connection_failed')))
      socket.on('close', () => finish(new CredentialLifecycleError('mqtt_connection_closed')))
    })
  }
}

export function createCredentialLifecycleVerifier({
  connectionProbe = createMqtt5ConnectionProbe(),
  readCurrentPassword,
}) {
  if (typeof readCurrentPassword !== 'function') {
    fail('credential_reader_required', 'Lifecycle verifier requires a hidden TTY credential reader')
  }
  return {
    readCurrentPassword,
    async expectConnected(connection) {
      const outcome = await connectionProbe(connection)
      if (outcome !== 'connected') fail('credential_connection_failed', 'Credential did not connect')
    },
    async expectRejected(connection) {
      const outcome = await connectionProbe(connection)
      if (outcome !== 'rejected') {
        fail('credential_rejection_not_proven', 'Credential rejection was not definitive')
      }
    },
  }
}
