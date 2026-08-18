import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  AclVerificationError,
  buildAclProbeMatrix,
  createMqtt5TlsProbe,
  runAclVerificationCli,
  validateAclPolicy,
  verifyDeviceAcl,
} from './verify-device-acl.mjs'

const canonical = {
  deviceId: 'PC-DEV-000001',
  productModel: 'pc-mini',
  username: 'device-PC-DEV-000001',
  mqttUrl: 'mqtts://mqtt.development.example:8883',
}

const expectedRules = [
  {
    permission: 'allow',
    action: 'publish',
    topic: 'products/pc-mini/devices/PC-DEV-000001/events/urination',
    qos: [1],
    retain: false,
  },
  {
    permission: 'allow',
    action: 'publish',
    topic: 'products/pc-mini/devices/PC-DEV-000001/status/battery',
    qos: [1],
    retain: false,
  },
  { permission: 'deny', action: 'all', topic: '#' },
]

describe('device ACL policy', () => {
  it('stores exactly two constrained allows followed by deny-all for the username', async () => {
    const policy = JSON.parse(
      await readFile(resolve(process.cwd(), 'devices/development/acl-policy.json'), 'utf8'),
    )

    expect(policy).toEqual({ username: 'device-PC-DEV-000001', rules: expectedRules })
    expect(validateAclPolicy(policy, canonical)).toEqual(expectedRules)
  })

  it.each([
    ['deny_rule_not_last', [expectedRules[2], expectedRules[0], expectedRules[1]]],
    [
      'invalid_acl_publish_policy',
      [{ ...expectedRules[0], qos: [0, 1] }, expectedRules[1], expectedRules[2]],
    ],
    [
      'invalid_acl_publish_policy',
      [{ ...expectedRules[0], retain: 'all' }, expectedRules[1], expectedRules[2]],
    ],
    [
      'overbroad_acl_rule',
      [{ ...expectedRules[0], topic: 'products/pc-mini/devices/PC-DEV-000001/#' }, expectedRules[1], expectedRules[2]],
    ],
  ])('fails closed with %s', (code, rules) => {
    expect(() => validateAclPolicy({ username: canonical.username, rules }, canonical)).toThrowError(
      expect.objectContaining({ code }),
    )
  })

  it('defines the complete positive and negative probe matrix', () => {
    expect(buildAclProbeMatrix(canonical)).toEqual([
      {
        name: 'publish-urination',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/events/urination',
        qos: 1,
        retained: false,
        expected: 'allowed',
      },
      {
        name: 'publish-battery-status',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/status/battery',
        qos: 1,
        retained: false,
        expected: 'allowed',
      },
      {
        name: 'deny-events-battery',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/events/battery',
        qos: 1,
        retained: false,
        expected: 'denied',
      },
      {
        name: 'deny-cross-device',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-000002/events/urination',
        qos: 1,
        retained: false,
        expected: 'denied',
      },
      {
        name: 'deny-legacy-topic',
        operation: 'publish',
        topic: 'devices/PC-DEV-000001/events/urination',
        qos: 1,
        retained: false,
        expected: 'denied',
      },
      {
        name: 'deny-command-publish',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/commands/restart',
        qos: 1,
        retained: false,
        expected: 'denied',
      },
      {
        name: 'deny-command-subscribe',
        operation: 'subscribe',
        topic: 'products/pc-mini/devices/PC-DEV-000001/commands/#',
        qos: 1,
        expected: 'denied',
      },
      {
        name: 'deny-retained-urination',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/events/urination',
        qos: 1,
        retained: true,
        expected: 'denied',
      },
    ])
  })
})

class FakeTlsSocket extends EventEmitter {
  writes: Buffer[] = []
  destroyed = false
  responseReasonCode: number

  constructor(reasonCode: number) {
    super()
    this.responseReasonCode = reasonCode
  }

  write(packet: Buffer) {
    this.writes.push(packet)
    if (this.writes.length === 1) {
      queueMicrotask(() => this.emit('data', Buffer.from([0x20, 0x03, 0x00, 0x00, 0x00])))
    } else {
      queueMicrotask(() =>
        this.emit('data', Buffer.from([0x40, 0x04, 0x00, 0x01, this.responseReasonCode, 0x00])),
      )
    }
    return true
  }

  destroy() {
    this.destroyed = true
  }
}

describe('MQTT 5 TLS ACL probe', () => {
  it.each([
    [0x00, 'allowed'],
    [0x10, 'allowed'],
    [0x87, 'denied'],
  ] as const)('classifies PUBACK reason code 0x%s as %s over strict TLS', async (reasonCode, outcome) => {
    const socket = new FakeTlsSocket(reasonCode)
    const connectTls = vi.fn((options, connected) => {
      queueMicrotask(connected)
      return socket
    })
    const probe = createMqtt5TlsProbe({ connectTls, timeoutMs: 100 })

    await expect(
      probe({
        ...canonical,
        password: 'tty-supplied-password',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/events/urination',
        qos: 1,
        retained: false,
        payload: { eventType: 'urination', sequence: 1 },
      }),
    ).resolves.toBe(outcome)
    expect(connectTls).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mqtt.development.example',
        port: 8883,
        servername: 'mqtt.development.example',
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    )
    expect(socket.writes[0][0]).toBe(0x10)
    expect(socket.writes[0]).toContain(0x05)
    expect(socket.writes[1][0] & 0xf0).toBe(0x30)
    expect(socket.writes[1].subarray(-40).toString('utf8')).toContain(
      '"eventType":"urination"',
    )
  })

  it('classifies a command SUBACK not-authorized reason as denied', async () => {
    const socket = new FakeTlsSocket(0x87)
    socket.write = vi.fn(function write(packet: Buffer) {
      socket.writes.push(packet)
      if (socket.writes.length === 1) {
        queueMicrotask(() => socket.emit('data', Buffer.from([0x20, 0x03, 0x00, 0x00, 0x00])))
      } else {
        queueMicrotask(() => socket.emit('data', Buffer.from([0x90, 0x04, 0x00, 0x01, 0x00, 0x87])))
      }
      return true
    })
    const probe = createMqtt5TlsProbe({
      connectTls: vi.fn((_options, connected) => {
        queueMicrotask(connected)
        return socket
      }),
      timeoutMs: 100,
    })

    await expect(
      probe({
        ...canonical,
        password: 'tty-supplied-password',
        operation: 'subscribe',
        topic: 'products/pc-mini/devices/PC-DEV-000001/commands/#',
        qos: 1,
      }),
    ).resolves.toBe('denied')
    expect(socket.writes[1][0]).toBe(0x82)
  })

  it('returns closed only when the Broker closes after receiving the ACL operation', async () => {
    const socket = new FakeTlsSocket(0x87)
    socket.write = vi.fn(function write(packet: Buffer) {
      socket.writes.push(packet)
      if (socket.writes.length === 1) {
        queueMicrotask(() => socket.emit('data', Buffer.from([0x20, 0x03, 0x00, 0x00, 0x00])))
      } else {
        queueMicrotask(() => socket.emit('close'))
      }
      return true
    })
    const probe = createMqtt5TlsProbe({
      connectTls: vi.fn((_options, connected) => {
        queueMicrotask(connected)
        return socket
      }),
      timeoutMs: 100,
    })

    await expect(
      probe({
        ...canonical,
        password: 'tty-supplied-password',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-000002/events/urination',
        qos: 1,
        retained: false,
      }),
    ).resolves.toBe('closed')
  })

  it('treats timeout as failure rather than authorization success', async () => {
    const socket = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
    socket.write = vi.fn()
    socket.destroy = vi.fn()
    const probe = createMqtt5TlsProbe({
      connectTls: vi.fn(() => socket),
      timeoutMs: 1,
    })

    await expect(
      probe({
        ...canonical,
        password: 'tty-supplied-password',
        operation: 'publish',
        topic: 'products/pc-mini/devices/PC-DEV-000001/events/urination',
        qos: 1,
        retained: false,
      }),
    ).rejects.toMatchObject({ code: 'mqtt_probe_timeout' })
  })

  it('rejects confused or incomplete probe inputs before opening TLS', async () => {
    const connectTls = vi.fn()
    const probe = createMqtt5TlsProbe({ connectTls, timeoutMs: 100 })

    await expect(
      probe({
        ...canonical,
        password: 'tty-supplied-password',
        operation: 'publsih',
        topic: 'products/pc-mini/devices/PC-DEV-000001/events/urination',
        qos: 1,
        retained: false,
      }),
    ).rejects.toMatchObject({ code: 'mqtt_probe_policy_invalid' })
    expect(connectTls).not.toHaveBeenCalled()
  })

  it('requires every matrix result to be definitive', async () => {
    const matrix = buildAclProbeMatrix(canonical)
    const probe = vi.fn(async (testCase) => {
      if (testCase.name === 'deny-cross-device') return 'ambiguous'
      return testCase.expected
    })

    await expect(
      verifyDeviceAcl({ ...canonical, password: 'tty-supplied-password', probe }),
    ).rejects.toMatchObject({ code: 'ambiguous_acl_result' })
    expect(probe).toHaveBeenCalledTimes(matrix.length)
  })

  it('uses typed ACL verification failures', () => {
    expect(() => validateAclPolicy({ username: 'wrong', rules: expectedRules }, canonical)).toThrow(
      AclVerificationError,
    )
  })
})

describe('ACL verification CLI', () => {
  it('reads the password only from the injected hidden prompt and emits a sanitized summary', async () => {
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const readPassword = vi.fn().mockResolvedValue('sentinel-device-password')
    const probe = vi.fn(async (testCase) => testCase.expected)

    const exitCode = await runAclVerificationCli({
      environment: { PEECARE_DEVICE_MQTT_URL: canonical.mqttUrl },
      stdout,
      stderr,
      artifacts: {
        inventory: {
          schemaVersion: 1,
          devices: [
            {
              hardwareLabel: 'PeeCare development unit 1',
              deviceId: canonical.deviceId,
              productModel: canonical.productModel,
              mqttPrincipal: canonical.username,
              firestore: {
                projectId: 'petcare-c7483',
                documentPath: 'devices/PC-DEV-000001',
                ingestionStatus: 'enabled',
              },
            },
          ],
        },
        aclPolicy: { username: canonical.username, rules: expectedRules },
      },
      readPassword,
      probe,
    })

    expect(exitCode).toBe(0)
    expect(readPassword).toHaveBeenCalledOnce()
    expect(stderr.write).not.toHaveBeenCalled()
    const output = stdout.write.mock.calls.flat().join('')
    expect(output).not.toContain('sentinel-device-password')
    const summary = JSON.parse(output)
    expect(Object.keys(summary)).toEqual(['mode', 'deviceId', 'principal', 'status', 'verifications'])
    expect(summary).toMatchObject({ mode: 'verify-acl', status: 'verified' })
    expect(summary.verifications).toHaveLength(buildAclProbeMatrix(canonical).length)
  })
})
