import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { connect as nodeTlsConnect } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { readCurrentPasswordFromInteractiveTty } from './credential-lifecycle.mjs'
import { validateDeviceInventory } from './device-configuration.mjs'

export class AclVerificationError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'AclVerificationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new AclVerificationError(code, message)
}

function canonicalTopics(identity) {
  const prefix = `products/${identity.productModel}/devices/${identity.deviceId}`
  return {
    urination: `${prefix}/events/urination`,
    battery: `${prefix}/status/battery`,
  }
}

export function validateAclPolicy(policy, identity) {
  if (policy?.username !== identity.username) {
    fail('acl_username_mismatch', 'ACL username must match the canonical device principal')
  }
  if (!Array.isArray(policy.rules) || policy.rules.length !== 3) {
    fail('invalid_acl_rule_count', 'ACL must contain exactly two allows and one deny')
  }

  const [urination, battery, deny] = policy.rules
  if (deny?.permission !== 'deny' || deny?.action !== 'all' || deny?.topic !== '#') {
    fail('deny_rule_not_last', 'ACL must end with an all-action deny on #')
  }
  for (const rule of [urination, battery]) {
    if (typeof rule?.topic === 'string' && /[+#]/.test(rule.topic)) {
      fail('overbroad_acl_rule', 'Allow rules cannot contain topic wildcards')
    }
    if (
      rule?.permission !== 'allow' ||
      rule?.action !== 'publish' ||
      rule?.retain !== false ||
      !Array.isArray(rule?.qos) ||
      rule.qos.length !== 1 ||
      rule.qos[0] !== 1
    ) {
      fail('invalid_acl_publish_policy', 'Allow rules require publish, QoS 1, and retain false')
    }
  }

  const topics = canonicalTopics(identity)
  if (urination.topic !== topics.urination || battery.topic !== topics.battery) {
    fail('acl_topic_mismatch', 'ACL allows must use the two canonical telemetry topics in order')
  }
  return policy.rules
}

export function buildAclProbeMatrix(identity) {
  const topics = canonicalTopics(identity)
  const commandTopic = `products/${identity.productModel}/devices/${identity.deviceId}/commands`
  return [
    {
      name: 'publish-urination',
      operation: 'publish',
      topic: topics.urination,
      qos: 1,
      retained: false,
      expected: 'allowed',
    },
    {
      name: 'publish-battery-status',
      operation: 'publish',
      topic: topics.battery,
      qos: 1,
      retained: false,
      expected: 'allowed',
    },
    {
      name: 'deny-events-battery',
      operation: 'publish',
      topic: `products/${identity.productModel}/devices/${identity.deviceId}/events/battery`,
      qos: 1,
      retained: false,
      expected: 'denied',
    },
    {
      name: 'deny-cross-device',
      operation: 'publish',
      topic: `products/${identity.productModel}/devices/PC-000002/events/urination`,
      qos: 1,
      retained: false,
      expected: 'denied',
    },
    {
      name: 'deny-legacy-topic',
      operation: 'publish',
      topic: `devices/${identity.deviceId}/events/urination`,
      qos: 1,
      retained: false,
      expected: 'denied',
    },
    {
      name: 'deny-command-publish',
      operation: 'publish',
      topic: `${commandTopic}/restart`,
      qos: 1,
      retained: false,
      expected: 'denied',
    },
    {
      name: 'deny-command-subscribe',
      operation: 'subscribe',
      topic: `${commandTopic}/#`,
      qos: 1,
      expected: 'denied',
    },
    {
      name: 'deny-retained-urination',
      operation: 'publish',
      topic: topics.urination,
      qos: 1,
      retained: true,
      expected: 'denied',
    },
  ]
}

function encodeVariableInteger(value) {
  if (!Number.isInteger(value) || value < 0 || value > 268_435_455) {
    fail('mqtt_packet_invalid', 'MQTT variable integer is out of range')
  }
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
  fail('mqtt_packet_invalid', 'Malformed MQTT variable integer')
}

function encodeUtf8(value) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length > 65_535) fail('mqtt_packet_invalid', 'MQTT string is too long')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function packet(header, body) {
  return Buffer.concat([Buffer.from([header]), encodeVariableInteger(body.length), body])
}

function connectPacket({ deviceId, username, password }) {
  const passwordBytes = Buffer.from(password, 'utf8')
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
  return packet(0x10, body)
}

function publishPacket({ topic, qos, retained }) {
  if (qos !== 1) fail('mqtt_probe_policy_invalid', 'ACL publish probes require QoS 1')
  const packetId = Buffer.from([0x00, 0x01])
  const body = Buffer.concat([encodeUtf8(topic), packetId, Buffer.from([0x00]), Buffer.from('{}')])
  return packet(0x30 | 0x02 | (retained ? 0x01 : 0x00), body)
}

function subscribePacket({ topic, qos }) {
  if (qos !== 1) fail('mqtt_probe_policy_invalid', 'ACL subscribe probes require QoS 1')
  const body = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00]),
    encodeUtf8(topic),
    Buffer.from([0x01]),
  ])
  return packet(0x82, body)
}

function extractPackets(buffer) {
  const packets = []
  let offset = 0
  while (offset < buffer.length) {
    const remaining = decodeVariableInteger(buffer, offset + 1)
    if (!remaining) break
    const bodyOffset = offset + 1 + remaining.bytes
    const packetEnd = bodyOffset + remaining.value
    if (packetEnd > buffer.length) break
    packets.push({ header: buffer[offset], body: buffer.subarray(bodyOffset, packetEnd) })
    offset = packetEnd
  }
  return { packets, remaining: buffer.subarray(offset) }
}

function acknowledgmentOutcome(packetRecord, operation) {
  if (operation === 'publish') {
    if ((packetRecord.header >> 4) !== 4 || packetRecord.body.length < 2) {
      fail('ambiguous_mqtt_ack', 'Expected an MQTT 5 PUBACK')
    }
    if (packetRecord.body.readUInt16BE(0) !== 1) fail('ambiguous_mqtt_ack', 'PUBACK packet ID mismatch')
    const reasonCode = packetRecord.body.length === 2 ? 0 : packetRecord.body[2]
    return reasonCode < 0x80 ? 'allowed' : 'denied'
  }

  if ((packetRecord.header >> 4) !== 9 || packetRecord.body.length < 4) {
    fail('ambiguous_mqtt_ack', 'Expected an MQTT 5 SUBACK')
  }
  if (packetRecord.body.readUInt16BE(0) !== 1) fail('ambiguous_mqtt_ack', 'SUBACK packet ID mismatch')
  const propertyLength = decodeVariableInteger(packetRecord.body, 2)
  if (!propertyLength) fail('ambiguous_mqtt_ack', 'SUBACK property length is incomplete')
  const reasonOffset = 2 + propertyLength.bytes + propertyLength.value
  const reasonCode = packetRecord.body[reasonOffset]
  if (reasonCode === undefined) fail('ambiguous_mqtt_ack', 'SUBACK reason code is missing')
  return reasonCode < 0x80 ? 'allowed' : 'denied'
}

function mqttEndpoint(rawUrl) {
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
    fail('unsafe_mqtt_endpoint', 'MQTT probe requires a credential-free mqtts:// endpoint on port 8883')
  }
  return { host: url.hostname, port: 8883 }
}

export function createMqtt5TlsProbe({ connectTls = nodeTlsConnect, timeoutMs = 5_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    fail('mqtt_probe_timeout_invalid', 'MQTT probe timeout must be a positive integer')
  }

  return async function probe(testCase) {
    if (
      (testCase.operation !== 'publish' && testCase.operation !== 'subscribe') ||
      typeof testCase.topic !== 'string' ||
      testCase.topic.length === 0 ||
      typeof testCase.password !== 'string' ||
      testCase.password.length === 0 ||
      testCase.username !== `device-${testCase.deviceId}` ||
      testCase.qos !== 1 ||
      (testCase.operation === 'publish' && typeof testCase.retained !== 'boolean') ||
      (testCase.operation === 'subscribe' && testCase.retained !== undefined)
    ) {
      fail('mqtt_probe_policy_invalid', 'MQTT probe input is incomplete or unsafe')
    }
    const endpoint = mqttEndpoint(testCase.mqttUrl)
    return await new Promise((resolve, reject) => {
      let settled = false
      let connected = false
      let actionSent = false
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
        () => finish(new AclVerificationError('mqtt_probe_timeout', 'MQTT probe timed out')),
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
          () => {
            connected = true
            socket.write(connectPacket(testCase))
          },
        )
      } catch {
        finish(new AclVerificationError('mqtt_tls_connection_failed', 'MQTT TLS connection failed'))
        return
      }

      if (!socket || typeof socket.on !== 'function' || typeof socket.write !== 'function') {
        finish(new AclVerificationError('mqtt_tls_connection_failed', 'MQTT TLS connection failed'))
        return
      }

      socket.on('data', (chunk) => {
        try {
          buffered = Buffer.concat([buffered, chunk])
          const extracted = extractPackets(buffered)
          buffered = extracted.remaining
          for (const mqttPacket of extracted.packets) {
            if (!actionSent) {
              if ((mqttPacket.header >> 4) !== 2 || mqttPacket.body.length < 3) {
                fail('ambiguous_mqtt_ack', 'Expected an MQTT 5 CONNACK')
              }
              if (mqttPacket.body[1] >= 0x80) {
                fail('mqtt_connect_rejected', 'Device credential was rejected before ACL verification')
              }
              actionSent = true
              socket.write(
                testCase.operation === 'publish'
                  ? publishPacket(testCase)
                  : subscribePacket(testCase),
              )
            } else {
              finish(undefined, acknowledgmentOutcome(mqttPacket, testCase.operation))
            }
          }
        } catch (error) {
          finish(
            error instanceof AclVerificationError
              ? error
              : new AclVerificationError('ambiguous_mqtt_ack', 'MQTT acknowledgment was invalid'),
          )
        }
      })
      socket.on('error', () => {
        finish(new AclVerificationError('mqtt_tls_connection_failed', 'MQTT TLS connection failed'))
      })
      socket.on('close', () => {
        if (connected && actionSent) finish(undefined, 'closed')
        else finish(new AclVerificationError('mqtt_connection_closed', 'MQTT connection closed before probe'))
      })
    })
  }
}

export async function verifyDeviceAcl({ probe = createMqtt5TlsProbe(), ...identity }) {
  const matrix = buildAclProbeMatrix(identity)
  const outcomes = await Promise.all(
    matrix.map(async (testCase) => ({ testCase, outcome: await probe({ ...identity, ...testCase }) })),
  )

  for (const { testCase, outcome } of outcomes) {
    if (!['allowed', 'denied', 'closed'].includes(outcome)) {
      fail('ambiguous_acl_result', `ACL probe ${testCase.name} did not return a definitive result`)
    }
    const passed =
      testCase.expected === 'allowed' ? outcome === 'allowed' : outcome === 'denied' || outcome === 'closed'
    if (!passed) fail('acl_verification_failed', `ACL probe ${testCase.name} returned ${outcome}`)
  }

  return matrix.map(({ name }) => name)
}

function writeAclSummary(output, result) {
  output.write(
    `${JSON.stringify({
      mode: result.mode,
      deviceId: result.deviceId,
      principal: result.principal,
      status: result.status,
      verifications: [...result.verifications],
    })}\n`,
  )
}

function safeFailureCode(error) {
  return typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'unexpected_failure'
}

async function loadAclArtifacts() {
  const directory = resolve(process.cwd(), 'devices/development')
  const [inventory, aclPolicy] = await Promise.all([
    readFile(resolve(directory, 'device-inventory.json'), 'utf8').then(JSON.parse),
    readFile(resolve(directory, 'acl-policy.json'), 'utf8').then(JSON.parse),
  ])
  return { inventory, aclPolicy }
}

export async function runAclVerificationCli({
  argv = process.argv.slice(2),
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  artifacts,
  readPassword = readCurrentPasswordFromInteractiveTty,
  probe,
} = {}) {
  let device = { deviceId: 'unknown', mqttPrincipal: 'unknown', productModel: 'unknown' }
  try {
    if (argv.length !== 0) fail('invalid_arguments', 'ACL verifier accepts no command arguments')
    if (Object.keys(environment).some((key) => /(?:DEVICE.*PASSWORD|PASSWORD.*DEVICE)/i.test(key))) {
      fail('device_password_input_forbidden', 'Device password must come from the hidden TTY prompt')
    }
    const loadedArtifacts = artifacts ?? (await loadAclArtifacts())
    const devices = validateDeviceInventory(loadedArtifacts.inventory)
    if (devices.length !== 1) fail('invalid_device_inventory', 'ACL verifier requires one device')
    device = devices[0]
    const identity = {
      deviceId: device.deviceId,
      productModel: device.productModel,
      username: device.mqttPrincipal,
      mqttUrl: environment.PEECARE_DEVICE_MQTT_URL,
    }
    mqttEndpoint(identity.mqttUrl)
    validateAclPolicy(loadedArtifacts.aclPolicy, identity)
    const password = await readPassword()
    if (typeof password !== 'string' || password.length === 0) {
      fail('unsafe_credential_input', 'Device password is empty')
    }
    const verifications = await verifyDeviceAcl({
      ...identity,
      password,
      ...(probe ? { probe } : {}),
    })
    writeAclSummary(stdout, {
      mode: 'verify-acl',
      deviceId: device.deviceId,
      principal: device.mqttPrincipal,
      status: 'verified',
      verifications,
    })
    return 0
  } catch (error) {
    writeAclSummary(stderr, {
      mode: 'verify-acl',
      deviceId: device.deviceId,
      principal: device.mqttPrincipal,
      status: safeFailureCode(error),
      verifications: [],
    })
    return 1
  }
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runAclVerificationCli()
}
