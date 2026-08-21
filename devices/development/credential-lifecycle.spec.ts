import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  CredentialLifecycleError,
  createCredentialLifecycleVerifier,
  createMqtt5ConnectionProbe,
  readHiddenPassword,
} from './credential-lifecycle.mjs'
import { provisionDevice, runProvisionCli } from './provision-device.mjs'

const device = {
  deviceId: '68E274BD2A58',
  productModel: 'pc-mini',
  mqttPrincipal: 'device-68E274BD2A58',
}
const runtime = {
  managementUrl: 'https://emqx.development.example',
  mqttUrl: 'mqtts://mqtt.development.example:8883',
}
const aclRules = [
  {
    permission: 'allow',
    action: 'publish',
    topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
    qos: [1],
    retain: false,
  },
  {
    permission: 'allow',
    action: 'publish',
    topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
    qos: [1],
    retain: false,
  },
  { permission: 'deny', action: 'all', topic: '#' },
]

function harness() {
  const passwordB = Buffer.alloc(32, 0xcd).toString('base64url')
  const tty = {
    writeSecret: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const emqx = {
    createCredential: vi.fn().mockResolvedValue(undefined),
    replaceCredential: vi.fn().mockResolvedValue(undefined),
    putAcl: vi.fn().mockResolvedValue(undefined),
    deleteAcl: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
  }
  const lifecycle = {
    readCurrentPassword: vi.fn().mockResolvedValue('password-A'),
    expectConnected: vi.fn().mockResolvedValue(undefined),
    expectRejected: vi.fn().mockResolvedValue(undefined),
  }
  return {
    passwordB,
    tty,
    emqx,
    lifecycle,
    dependencies: {
      emqx,
      lifecycle,
      openSecretTty: vi.fn().mockResolvedValue(tty),
      randomBytes: vi.fn(() => Buffer.alloc(32, 0xcd)),
      preflight: vi.fn().mockResolvedValue(['inventory', 'firmware', 'emqx-access-control', 'registry']),
    },
  }
}

describe('credential lifecycle command sequence', () => {
  it('verifies initial strict-TLS connection before handing off a new credential', async () => {
    const test = harness()

    const summary = await provisionDevice({
      mode: 'apply',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(test.lifecycle.expectConnected).toHaveBeenCalledWith({
      deviceId: '68E274BD2A58',
      username: 'device-68E274BD2A58',
      mqttUrl: runtime.mqttUrl,
      password: test.passwordB,
    })
    expect(test.tty.writeSecret).toHaveBeenCalledWith(`${test.passwordB}\n`)
    expect(summary.verifications).toContain('initial-connect')
  })

  it('removes both the new ACL and credential when initial connection verification fails', async () => {
    const test = harness()
    test.lifecycle.expectConnected.mockRejectedValue(
      new CredentialLifecycleError('credential_connection_failed'),
    )

    const summary = await provisionDevice({
      mode: 'apply',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(test.emqx.deleteAcl).toHaveBeenCalledWith('device-68E274BD2A58')
    expect(test.emqx.deleteCredential).toHaveBeenCalledWith('device-68E274BD2A58')
    expect(summary.status).toBe('lifecycle_failed_rolled_back')
  })

  it('implements the password A to password B example for the same username', async () => {
    const test = harness()

    const summary = await provisionDevice({
      mode: 'rotate',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(test.emqx.replaceCredential).toHaveBeenNthCalledWith(1, {
      username: 'device-68E274BD2A58',
      password: test.passwordB,
      isSuperuser: false,
    })
    expect(test.lifecycle.expectRejected).toHaveBeenCalledWith({
      deviceId: '68E274BD2A58',
      username: 'device-68E274BD2A58',
      mqttUrl: runtime.mqttUrl,
      password: 'password-A',
    })
    expect(test.lifecycle.expectConnected).toHaveBeenCalledWith({
      deviceId: '68E274BD2A58',
      username: 'device-68E274BD2A58',
      mqttUrl: runtime.mqttUrl,
      password: test.passwordB,
    })
    expect(summary).toEqual({
      mode: 'rotate',
      deviceId: '68E274BD2A58',
      principal: 'device-68E274BD2A58',
      status: 'rotated',
      verifications: [
        'inventory',
        'firmware',
        'emqx-access-control',
        'registry',
        'acl-policy',
        'old-password-rejected',
        'new-password-connect',
      ],
    })
    expect(JSON.stringify(summary)).not.toContain('password-A')
    expect(JSON.stringify(summary)).not.toContain(test.passwordB)
  })

  it('restores password A when rotation verification fails and does not hand off password B', async () => {
    const test = harness()
    test.lifecycle.expectConnected.mockRejectedValue(
      new CredentialLifecycleError('credential_connection_failed'),
    )

    const summary = await provisionDevice({
      mode: 'rotate',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(test.emqx.replaceCredential).toHaveBeenNthCalledWith(2, {
      username: 'device-68E274BD2A58',
      password: 'password-A',
      isSuperuser: false,
    })
    expect(test.emqx.putAcl).toHaveBeenCalledTimes(2)
    expect(test.tty.writeSecret).not.toHaveBeenCalled()
    expect(summary.status).toBe('lifecycle_failed_rolled_back')
  })

  it('verifies rejection after revoke', async () => {
    const test = harness()

    const summary = await provisionDevice({
      mode: 'revoke',
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(test.emqx.deleteCredential).toHaveBeenCalledWith('device-68E274BD2A58')
    expect(test.lifecycle.expectRejected).toHaveBeenCalledWith({
      deviceId: '68E274BD2A58',
      username: 'device-68E274BD2A58',
      mqttUrl: runtime.mqttUrl,
      password: 'password-A',
    })
    expect(summary.status).toBe('revoked')
    expect(summary.verifications).toContain('revoked-password-rejected')
  })

  it('recreates the old credential and ACL when revoke verification fails', async () => {
    const test = harness()
    test.lifecycle.expectRejected.mockRejectedValue(
      new CredentialLifecycleError('credential_rejection_not_proven'),
    )

    const summary = await provisionDevice({
      mode: 'revoke',
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(test.emqx.createCredential).toHaveBeenCalledWith({
      username: 'device-68E274BD2A58',
      password: 'password-A',
      isSuperuser: false,
    })
    expect(test.emqx.putAcl).toHaveBeenCalledWith('device-68E274BD2A58', aclRules)
    expect(summary.status).toBe('lifecycle_failed_rolled_back')
  })

  it('rejects an empty prior credential before rotate mutation', async () => {
    const test = harness()
    test.lifecycle.readCurrentPassword.mockResolvedValue('')

    const summary = await provisionDevice({
      mode: 'rotate',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: test.dependencies,
    })

    expect(summary.status).toBe('unsafe_credential_input')
    expect(test.emqx.replaceCredential).not.toHaveBeenCalled()
  })

  it('rejects an empty ACL before opening a secret channel or mutating', async () => {
    const test = harness()

    await expect(
      provisionDevice({
        mode: 'apply',
        secretOutputTty: true,
        device,
        runtime,
        aclRules: [],
        dependencies: test.dependencies,
      }),
    ).rejects.toMatchObject({ code: 'invalid_acl_rule_count' })
    expect(test.dependencies.openSecretTty).not.toHaveBeenCalled()
    expect(test.emqx.createCredential).not.toHaveBeenCalled()
  })
})

describe('hidden lifecycle credential input', () => {
  it('reads the current password from an interactive raw TTY without echoing it', async () => {
    const input = new EventEmitter() as EventEmitter & {
      isTTY: boolean
      setRawMode: ReturnType<typeof vi.fn>
      resume: ReturnType<typeof vi.fn>
      pause: ReturnType<typeof vi.fn>
    }
    input.isTTY = true
    input.setRawMode = vi.fn()
    input.resume = vi.fn()
    input.pause = vi.fn()
    const output = { isTTY: true, write: vi.fn() }

    const passwordPromise = readHiddenPassword({ input, output, prompt: 'Current device password: ' })
    input.emit('data', Buffer.from('password-A\n'))

    await expect(passwordPromise).resolves.toBe('password-A')
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(output.write.mock.calls.flat().join('')).toBe('Current device password: \n')
    expect(output.write.mock.calls.flat().join('')).not.toContain('password-A')
  })

  it('rejects non-interactive input', async () => {
    await expect(
      readHiddenPassword({
        input: { isTTY: false },
        output: { isTTY: true, write: vi.fn() },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_credential_input' })
  })
})

class ConnectionSocket extends EventEmitter {
  writes: Buffer[] = []
  reasonCode: number

  constructor(reasonCode: number) {
    super()
    this.reasonCode = reasonCode
  }

  write(packet: Buffer) {
    this.writes.push(packet)
    queueMicrotask(() => this.emit('data', Buffer.from([0x20, 0x03, 0x00, this.reasonCode, 0x00])))
    return true
  }

  destroy() {}
}

describe('strict TLS lifecycle verifier', () => {
  it.each([
    [0x00, 'connected'],
    [0x86, 'rejected'],
    [0x87, 'rejected'],
  ] as const)('classifies MQTT 5 CONNACK 0x%s as %s', async (reasonCode, expected) => {
    const socket = new ConnectionSocket(reasonCode)
    const connectTls = vi.fn((options, connected) => {
      queueMicrotask(connected)
      return socket
    })
    const probe = createMqtt5ConnectionProbe({ connectTls, timeoutMs: 100 })

    await expect(
      probe({
        deviceId: '68E274BD2A58',
        username: 'device-68E274BD2A58',
        mqttUrl: runtime.mqttUrl,
        password: 'tty-supplied-password',
      }),
    ).resolves.toBe(expected)
    expect(connectTls).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8883, rejectUnauthorized: true }),
      expect.any(Function),
    )
  })

  it('maps only definitive outcomes in the lifecycle API', async () => {
    const verifier = createCredentialLifecycleVerifier({
      connectionProbe: vi.fn().mockResolvedValue('closed'),
      readCurrentPassword: vi.fn(),
    })

    await expect(
      verifier.expectRejected({
        deviceId: '68E274BD2A58',
        username: 'device-68E274BD2A58',
        mqttUrl: runtime.mqttUrl,
        password: 'password-A',
      }),
    ).rejects.toMatchObject({ code: 'credential_rejection_not_proven' })
  })
})

describe('development device runbook', () => {
  it('documents the explicit initial, rotate, old/new verification, and revoke sequence', async () => {
    const runbook = await readFile(resolve(process.cwd(), 'devices/development/README.md'), 'utf8')

    expect(runbook).toContain('npm run device:development:apply')
    expect(runbook).toContain('npm run device:development:rotate')
    expect(runbook).toContain('old-password-rejected')
    expect(runbook).toContain('new-password-connect')
    expect(runbook).toContain('npm run device:development:revoke')
    expect(runbook).toContain('revoked-password-rejected')
    expect(runbook).toContain('Stop the device publisher before rotation')
  })

  it('wires explicit package commands without embedding runtime values', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))

    expect(packageJson.scripts).toMatchObject({
      'device:development:dry-run': 'node devices/development/provision-device.mjs --dry-run',
      'device:development:apply':
        'node devices/development/provision-device.mjs --apply --secret-output-tty',
      'device:development:rotate':
        'node devices/development/provision-device.mjs --rotate --secret-output-tty',
      'device:development:revoke': 'node devices/development/provision-device.mjs --revoke',
      'device:development:verify-acl': 'node devices/development/verify-device-acl.mjs',
    })
  })

  it('runs dry-run as read-only preflight and emits one sanitized fixed-shape summary', async () => {
    const artifacts = {
      inventory: {
        schemaVersion: 1,
        devices: [
          {
            hardwareLabel: 'PeeCare development unit 1',
            deviceId: '68E274BD2A58',
            productModel: 'pc-mini',
            mqttPrincipal: 'device-68E274BD2A58',
            firestore: {
              projectId: 'petcare-c7483',
              documentPath: 'devices/68E274BD2A58',
              ingestionStatus: 'enabled',
            },
          },
        ],
      },
      firmware: await loadJsonForCli('firmware-config.template.json'),
      aclPolicy: { username: 'device-68E274BD2A58', rules: aclRules },
      retryFixture: await loadJsonForCli('fixtures/retry-after-disconnect.json'),
    }
    const test = harness()
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const registryReader = {
      readDevice: vi.fn().mockResolvedValue({
        exists: true,
        id: '68E274BD2A58',
        data: { deviceId: '68E274BD2A58', productModel: 'pc-mini', ingestionStatus: 'enabled' },
      }),
    }
    test.emqx.readAuthenticator = vi.fn().mockResolvedValue({
      mechanism: 'password_based',
      backend: 'built_in_database',
      enable: true,
      user_id_type: 'username',
    })
    test.emqx.readAuthorizationSource = vi.fn().mockResolvedValue({
      type: 'built_in_database',
      enable: true,
    })

    const exitCode = await runProvisionCli({
      argv: ['--dry-run'],
      environment: {},
      stdout,
      stderr,
      artifacts,
      runtime,
      emqx: test.emqx,
      registryReader,
      lifecycle: test.lifecycle,
      openSecretTty: test.dependencies.openSecretTty,
      randomBytes: test.dependencies.randomBytes,
    })

    expect(exitCode).toBe(0)
    expect(test.emqx.createCredential).not.toHaveBeenCalled()
    expect(test.emqx.putAcl).not.toHaveBeenCalled()
    expect(test.dependencies.openSecretTty).not.toHaveBeenCalled()
    expect(test.lifecycle.readCurrentPassword).not.toHaveBeenCalled()
    expect(stderr.write).not.toHaveBeenCalled()
    const summary = JSON.parse(stdout.write.mock.calls[0][0])
    expect(Object.keys(summary)).toEqual(['mode', 'deviceId', 'principal', 'status', 'verifications'])
    expect(summary).toMatchObject({ mode: 'dry-run', status: 'ready' })
    expect(summary.verifications).toEqual([
      'inventory',
      'firmware',
      'emqx-access-control',
      'registry',
      'firmware-retry',
      'acl-policy',
    ])
  })
})

async function loadJsonForCli(relativePath: string) {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'devices/development', relativePath), 'utf8'),
  )
}
