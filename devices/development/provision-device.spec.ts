import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'

import {
  ProvisioningError,
  createEmqxManagementAdapter,
  emitProvisionSummary,
  parseProvisionArguments,
  provisionDevice,
  validateRuntimeEndpoints,
} from './provision-device.mjs'

const device = {
  deviceId: 'PC-000001',
  productModel: 'pc-mini',
  mqttPrincipal: 'device-PC-000001',
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    emqx: {
      createCredential: vi.fn().mockResolvedValue(undefined),
      replaceCredential: vi.fn().mockResolvedValue(undefined),
      putAcl: vi.fn().mockResolvedValue(undefined),
      deleteAcl: vi.fn().mockResolvedValue(undefined),
      deleteCredential: vi.fn().mockResolvedValue(undefined),
    },
    openSecretTty: vi.fn().mockResolvedValue({
      writeSecret: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    randomBytes: vi.fn(() => Buffer.alloc(32, 0xab)),
    preflight: vi.fn().mockResolvedValue(['inventory', 'firmware', 'emqx-access-control']),
    lifecycle: {
      readCurrentPassword: vi.fn().mockResolvedValue('current-password'),
      expectConnected: vi.fn().mockResolvedValue(undefined),
      expectRejected: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

const runtime = {
  managementUrl: 'https://emqx.development.example',
  mqttUrl: 'mqtts://mqtt.development.example:8883',
}

const aclRules = [
  {
    permission: 'allow',
    action: 'publish',
    topic: 'products/pc-mini/devices/PC-000001/events/urination',
    qos: [1],
    retain: false,
  },
  {
    permission: 'allow',
    action: 'publish',
    topic: 'products/pc-mini/devices/PC-000001/status/battery',
    qos: [1],
    retain: false,
  },
  { permission: 'deny', action: 'all', topic: '#' },
]

describe('provision-device', () => {
  it('returns unsafe_handoff and performs zero EMQX mutations when /dev/tty cannot be opened', async () => {
    const deps = dependencies({ openSecretTty: vi.fn().mockRejectedValue(new Error('no controlling tty')) })

    const summary = await provisionDevice({
      mode: 'apply',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: deps,
    })

    expect(summary).toEqual({
      mode: 'apply',
      deviceId: 'PC-000001',
      principal: 'device-PC-000001',
      status: 'unsafe_handoff',
      verifications: ['inventory', 'firmware', 'emqx-access-control', 'acl-policy'],
    })
    expect(deps.emqx.createCredential).not.toHaveBeenCalled()
    expect(deps.emqx.replaceCredential).not.toHaveBeenCalled()
    expect(deps.emqx.putAcl).not.toHaveBeenCalled()
  })

  it.each(['apply', 'rotate'] as const)(
    'generates a 32-byte base64url non-superuser password and writes it to the pre-opened TTY once for %s',
    async (mode) => {
      const deps = dependencies()

      const summary = await provisionDevice({
        mode,
        secretOutputTty: true,
        device,
        runtime,
        aclRules,
        dependencies: deps,
      })

      const mutation = mode === 'apply' ? deps.emqx.createCredential : deps.emqx.replaceCredential
      const generatedPassword = mutation.mock.calls[0][0].password
      expect(deps.randomBytes).toHaveBeenCalledWith(32)
      expect(generatedPassword).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(mutation).toHaveBeenCalledWith({
        username: 'device-PC-000001',
        password: generatedPassword,
        isSuperuser: false,
      })
      expect(deps.openSecretTty.mock.invocationCallOrder[0]).toBeLessThan(
        mutation.mock.invocationCallOrder[0],
      )
      const tty = await deps.openSecretTty.mock.results[0].value
      expect(tty.writeSecret).toHaveBeenCalledOnce()
      expect(tty.writeSecret).toHaveBeenCalledWith(`${generatedPassword}\n`)
      expect(JSON.stringify(summary)).not.toContain(generatedPassword)
      expect(Object.keys(summary)).toEqual(['mode', 'deviceId', 'principal', 'status', 'verifications'])
    },
  )

  it('deletes a newly created principal when ACL mutation fails', async () => {
    const emqx = dependencies().emqx
    emqx.putAcl.mockRejectedValue(new Error('ACL rejected'))
    const deps = dependencies({ emqx })

    const summary = await provisionDevice({
      mode: 'apply',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: deps,
    })

    expect(emqx.deleteCredential).toHaveBeenCalledWith('device-PC-000001')
    expect(summary.status).toBe('mutation_failed_rolled_back')
    const tty = await deps.openSecretTty.mock.results[0].value
    expect(tty.writeSecret).not.toHaveBeenCalled()
  })

  it('deletes the principal when the one-time handoff write fails', async () => {
    const tty = {
      writeSecret: vi.fn().mockRejectedValue(new Error('tty disconnected')),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const deps = dependencies({ openSecretTty: vi.fn().mockResolvedValue(tty) })

    const summary = await provisionDevice({
      mode: 'apply',
      secretOutputTty: true,
      device,
      runtime,
      aclRules,
      dependencies: deps,
    })

    expect(deps.emqx.deleteCredential).toHaveBeenCalledWith('device-PC-000001')
    expect(deps.emqx.deleteAcl).toHaveBeenCalledWith('device-PC-000001')
    expect(summary.status).toBe('handoff_failed_rolled_back')
    expect(tty.writeSecret).toHaveBeenCalledOnce()
  })

  it('rejects non-HTTPS management and non-strict MQTTS endpoints before mutation', () => {
    expect(() =>
      validateRuntimeEndpoints({
        managementUrl: 'http://emqx.development.example',
        mqttUrl: 'mqtt://mqtt.development.example:1883',
      }),
    ).toThrowError(expect.objectContaining({ code: 'unsafe_runtime_endpoint' }))
    expect(() =>
      validateRuntimeEndpoints({
        managementUrl: 'https://emqx.development.example',
        mqttUrl: 'mqtts://mqtt.development.example:8884',
      }),
    ).toThrowError(expect.objectContaining({ code: 'unsafe_runtime_endpoint' }))
  })

  it('does not accept a device password from arguments or environment', () => {
    expect(() => parseProvisionArguments(['--apply', '--password', 'sentinel-secret'])).toThrowError(
      expect.objectContaining({ code: 'device_password_input_forbidden' }),
    )
    expect(() =>
      parseProvisionArguments(['--apply', '--secret-output-tty'], {
        PEECARE_DEVICE_PASSWORD: 'sentinel-secret',
      }),
    ).toThrowError(expect.objectContaining({ code: 'device_password_input_forbidden' }))
  })

  it('uses only the HTTPS /api/v5 built-in database access-control endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) })
    const adapter = createEmqxManagementAdapter({
      managementUrl: 'https://emqx.development.example',
      apiKey: 'management-key',
      apiSecret: 'management-secret',
      fetchImpl,
    })

    await adapter.createCredential({
      username: 'device-PC-000001',
      password: 'generated-device-password',
      isSuperuser: false,
    })
    await adapter.putAcl('device-PC-000001', [{ permission: 'deny', action: 'all', topic: '#' }])
    await adapter.deleteAcl('device-PC-000001')

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://emqx.development.example/api/v5/authentication/password_based%3Abuilt_in_database/users',
      'https://emqx.development.example/api/v5/authorization/sources/built_in_database/rules/users/device-PC-000001',
      'https://emqx.development.example/api/v5/authorization/sources/built_in_database/rules/users/device-PC-000001',
    ])
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      user_id: 'device-PC-000001',
      password: 'generated-device-password',
      is_superuser: false,
    })
  })

  it('turns a management API timeout into a typed failure', async () => {
    let receivedSignal: AbortSignal | undefined
    const fetchImpl = vi.fn((_url, options) => {
      receivedSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        if (!options.signal) reject(new Error('missing signal'))
      })
    })
    const adapter = createEmqxManagementAdapter({
      managementUrl: 'https://emqx.development.example',
      apiKey: 'management-key',
      apiSecret: 'management-secret',
      fetchImpl,
      requestTimeoutMs: 1,
    })

    await expect(adapter.readAuthenticator()).rejects.toMatchObject({
      code: 'emqx_network_failure',
    })
    expect(receivedSignal).toBeDefined()
    expect(receivedSignal?.aborted).toBe(true)
  })

  it('uses typed failures for unsafe interfaces', () => {
    expect(() => parseProvisionArguments(['--apply'])).toThrow(ProvisioningError)
  })

  it('emits fixed-shape sanitized JSON even if a caller supplies extra secret-bearing fields', () => {
    const output = { write: vi.fn() }

    emitProvisionSummary(output, {
      mode: 'apply',
      deviceId: 'PC-000001',
      principal: 'device-PC-000001',
      status: 'applied',
      verifications: ['inventory'],
      password: 'sentinel-secret',
      error: new Error('sentinel-secret'),
    })

    expect(output.write).toHaveBeenCalledWith(
      '{"mode":"apply","deviceId":"PC-000001","principal":"device-PC-000001","status":"applied","verifications":["inventory"]}\n',
    )
    expect(output.write.mock.calls.flat().join('')).not.toContain('sentinel-secret')
  })
})
