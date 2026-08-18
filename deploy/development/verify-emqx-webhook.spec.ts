import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  createEmqxWebhookVerificationAdapter,
  runEmqxWebhookVerification,
  runEmqxWebhookVerificationCli,
} from './verify-emqx-webhook.mjs'

const currentReference =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/1'
const previousReference =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/2'

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_INGESTION_SECRET_CURRENT_REF: currentReference,
    PEECARE_DEVELOPMENT_DEVICE_ID: 'PC-DEV-0001',
    PEECARE_DEVELOPMENT_PRODUCT_MODEL: 'pc-mini',
    ...overrides,
  }
}

function deliveryAdapter(overrides: Record<string, unknown> = {}) {
  const topicsByEventId = new Map<string, string>()
  return {
    publishProbe: vi.fn(async ({ topic, payload }) => {
      topicsByEventId.set(payload.eventId, topic)
      return 'accepted'
    }),
    readEventDocument: vi.fn(async ({ eventId }) => ({
      count: topicsByEventId.get(eventId) === 'peecare/device/1/status' ? 0 : 1,
    })),
    ...overrides,
  }
}

describe('development EMQX webhook verification', () => {
  it('verifies two canonical deliveries and legacy non-delivery through injected adapters only', async () => {
    const adapter = deliveryAdapter()
    const output: string[] = []

    const result = await runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-1',
      wait: vi.fn(async () => undefined),
      write: (line) => output.push(line),
    })

    expect(adapter.publishProbe.mock.calls.map(([probe]) => probe.topic)).toEqual([
      'products/pc-mini/devices/PC-DEV-0001/events/urination',
      'products/pc-mini/devices/PC-DEV-0001/status/battery',
      'peecare/device/1/status',
    ])
    expect(adapter.readEventDocument).toHaveBeenCalled()
    expect(result).toEqual({
      status: 'healthy',
      deliveries: {
        urination: 'delivered',
        battery: 'delivered',
        legacy: 'not_delivered',
      },
      rotation: {
        status: 'precondition_unmet',
        code: 'previous_secret_not_deployed',
      },
    })
    expect(output).toEqual([JSON.stringify(result)])
    expect(output[0]).not.toContain('payload')
    expect(output[0]).not.toContain('versions/1')
  })

  it('reports a satisfied dual-secret precondition without claiming rotation was verified', async () => {
    const result = await runEmqxWebhookVerification({
      environment: environment({ PEECARE_INGESTION_SECRET_PREVIOUS_REF: previousReference }),
      adapter: deliveryAdapter(),
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-2',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })

    expect(result.rotation).toEqual({ status: 'precondition_satisfied' })
    expect(JSON.stringify(result.rotation)).not.toContain('verified')
  })

  it('rejects project aliases that reference the same numeric secret version', async () => {
    await expect(runEmqxWebhookVerification({
      environment: environment({
        PEECARE_INGESTION_SECRET_PREVIOUS_REF:
          'projects/348528459946/secrets/peecare-emqx-webhook-current/versions/1',
      }),
      adapter: deliveryAdapter(),
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-alias',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'invalid_rotation_references' })
  })

  it('keeps probe event IDs within the contract for a maximum-length device ID', async () => {
    const adapter = deliveryAdapter()
    const deviceId = `P${'C'.repeat(63)}`

    await runEmqxWebhookVerification({
      environment: environment({ PEECARE_DEVELOPMENT_DEVICE_ID: deviceId }),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => '99bfc343-ed23-416d-9b6a-d92a4cddded2',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })

    const probes = adapter.publishProbe.mock.calls.map(([probe]) => probe)
    expect(probes).toHaveLength(3)
    expect(probes.map(({ payload }) => payload.deviceId)).toEqual([
      deviceId,
      deviceId,
      deviceId,
    ])
    expect(probes.every(({ payload }) => payload.eventId.length <= 128)).toBe(true)
    expect(new Set(probes.map(({ payload }) => payload.eventId)).size).toBe(3)
  })

  it('fails when a canonical event does not land after bounded polling', async () => {
    const adapter = deliveryAdapter({
      readEventDocument: vi.fn(async () => ({ count: 0 })),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-3',
      pollAttempts: 3,
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'canonical_delivery_failed' })
    expect(adapter.readEventDocument).toHaveBeenCalledTimes(3)
  })

  it('fails when the legacy topic creates a Firestore document', async () => {
    const adapter = deliveryAdapter({
      readEventDocument: vi.fn(async () => ({ count: 1 })),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-4',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'legacy_delivery_detected' })
  })

  it('accepts an ACL-rejected legacy publish as end-to-end non-delivery', async () => {
    const adapter = deliveryAdapter()
    adapter.publishProbe.mockImplementation(async ({ topic, payload }) => {
      if (topic === 'peecare/device/1/status') return 'rejected'
      return deliveryAdapter().publishProbe({ topic, payload })
    })
    adapter.readEventDocument.mockResolvedValue({ count: 1 })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-legacy-acl',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).resolves.toMatchObject({ deliveries: { legacy: 'not_delivered' } })
  })

  it('polls Firestore when a legacy PUBACK is ambiguous after connection close', async () => {
    const adapter = deliveryAdapter()
    adapter.publishProbe
      .mockResolvedValueOnce('accepted')
      .mockResolvedValueOnce('accepted')
      .mockResolvedValueOnce('ambiguous')
    adapter.readEventDocument.mockImplementation(async ({ eventId }) => ({
      count: eventId.includes('emqx-e2e-legacy') ? 0 : 1,
    }))

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-legacy-close',
      pollAttempts: 3,
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).resolves.toMatchObject({ deliveries: { legacy: 'not_delivered' } })

    expect(adapter.readEventDocument).toHaveBeenCalledTimes(5)
  })

  it('fails with a safe code when a canonical MQTT publish is rejected', async () => {
    const adapter = deliveryAdapter({
      publishProbe: vi.fn(async () => 'rejected'),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-5',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'mqtt_publish_failed' })
  })

  it('uses a registered MQTT identity and Firestore in the live adapter', async () => {
    const mqttProbe = vi.fn(async () => 'allowed')
    const get = vi.fn(async () => ({ exists: true }))
    const doc = vi.fn(() => ({ get }))
    const adapter = createEmqxWebhookVerificationAdapter({
      mqttUrl: 'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
      deviceId: 'PC-DEV-0001',
      username: 'device-PC-DEV-0001',
      password: 'sentinel-device-password',
      projectId: 'petcare-c7483',
      mqttProbe,
      firestore: { doc },
    })

    await expect(adapter.publishProbe({
      topic: 'products/pc-mini/devices/PC-DEV-0001/events/urination',
      qos: 1,
      payload: { eventId: 'PC-DEV-0001:probe-1', deviceId: 'PC-DEV-0001' },
    })).resolves.toBe('accepted')
    await expect(adapter.readEventDocument({
      deviceId: 'PC-DEV-0001',
      eventId: 'PC-DEV-0001:probe-1',
    })).resolves.toEqual({ count: 1 })

    expect(mqttProbe).toHaveBeenCalledWith({
      operation: 'publish',
      mqttUrl: 'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
      deviceId: 'PC-DEV-0001',
      username: 'device-PC-DEV-0001',
      password: 'sentinel-device-password',
      topic: 'products/pc-mini/devices/PC-DEV-0001/events/urination',
      qos: 1,
      retained: false,
      payload: { eventId: 'PC-DEV-0001:probe-1', deviceId: 'PC-DEV-0001' },
    })
    expect(doc).toHaveBeenCalledWith(
      'devices/PC-DEV-0001/events/PC-DEV-0001:probe-1',
    )
  })

  it('preserves an ACK-before-close ambiguity instead of reporting an ACL rejection', async () => {
    const adapter = createEmqxWebhookVerificationAdapter({
      mqttUrl: 'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
      deviceId: 'PC-DEV-0001',
      username: 'device-PC-DEV-0001',
      password: 'sentinel-device-password',
      projectId: 'petcare-c7483',
      mqttProbe: vi.fn(async () => 'closed'),
      firestore: { doc: vi.fn() },
    })

    await expect(adapter.publishProbe({
      topic: 'peecare/device/1/status',
      qos: 1,
      payload: { eventId: 'legacy-probe-1', deviceId: 'PC-DEV-0001' },
    })).resolves.toBe('ambiguous')
  })

  it('reads the device password from hidden TTY and emits only a sanitized summary', async () => {
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const createAdapter = vi.fn(() => deliveryAdapter())
    const readPassword = vi.fn(async () => 'sentinel-device-password')

    await expect(runEmqxWebhookVerificationCli({
      argv: [],
      environment: {
        ...environment(),
        PEECARE_DEVICE_MQTT_URL:
          'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
      },
      stdout,
      stderr,
      createAdapter,
      readPassword,
      artifacts: {
        inventory: {
          schemaVersion: 1,
          devices: [{
            hardwareLabel: 'PeeCare development unit 1',
            deviceId: 'PC-000001',
            productModel: 'pc-mini',
            mqttPrincipal: 'device-PC-000001',
            firestore: {
              projectId: 'petcare-c7483',
              documentPath: 'devices/PC-000001',
              ingestionStatus: 'enabled',
            },
          }],
        },
      },
      now: () => 1_786_989_800_000,
      createRunId: () => 'run-cli',
      wait: vi.fn(async () => undefined),
    })).resolves.toBe(0)

    expect(readPassword).toHaveBeenCalledOnce()
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      mqttUrl: 'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
      deviceId: 'PC-000001',
      username: 'device-PC-000001',
      password: 'sentinel-device-password',
      projectId: 'petcare-c7483',
    }))
    expect(stderr.write).not.toHaveBeenCalled()
    const output = stdout.write.mock.calls.flat().join('')
    expect(output).toContain('"status":"healthy"')
    expect(output).not.toContain('sentinel-device-password')
    expect(output).not.toContain('payload')
  })

  it('rejects device password environment variables before reading or publishing', async () => {
    const createAdapter = vi.fn()
    const readPassword = vi.fn()
    const stderr = { write: vi.fn() }

    await expect(runEmqxWebhookVerificationCli({
      environment: {
        ...environment(),
        PEECARE_DEVICE_MQTT_URL:
          'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
        PEECARE_DEVICE_PASSWORD: 'forbidden',
      },
      stderr,
      stdout: { write: vi.fn() },
      createAdapter,
      readPassword,
      artifacts: { inventory: { schemaVersion: 1, devices: [] } },
    })).resolves.toBe(1)

    expect(readPassword).not.toHaveBeenCalled()
    expect(createAdapter).not.toHaveBeenCalled()
    expect(stderr.write).toHaveBeenCalledWith(
      '{"status":"error","code":"device_password_input_forbidden"}\n',
    )
  })

  it('rejects an unapproved MQTT host before reading the device password', async () => {
    const createAdapter = vi.fn()
    const readPassword = vi.fn()
    const stderr = { write: vi.fn() }

    await expect(runEmqxWebhookVerificationCli({
      environment: {
        ...environment(),
        PEECARE_DEVICE_MQTT_URL: 'mqtts://attacker.example:8883',
      },
      stderr,
      stdout: { write: vi.fn() },
      createAdapter,
      readPassword,
      artifacts: {
        inventory: {
          schemaVersion: 1,
          devices: [{
            hardwareLabel: 'PeeCare development unit 1',
            deviceId: 'PC-000001',
            productModel: 'pc-mini',
            mqttPrincipal: 'device-PC-000001',
            firestore: {
              projectId: 'petcare-c7483',
              documentPath: 'devices/PC-000001',
              ingestionStatus: 'enabled',
            },
          }],
        },
      },
    })).resolves.toBe(1)

    expect(readPassword).not.toHaveBeenCalled()
    expect(createAdapter).not.toHaveBeenCalled()
    expect(stderr.write).toHaveBeenCalledWith(
      '{"status":"error","code":"unsafe_mqtt_endpoint"}\n',
    )
  })

  it('documents the Serverless checklist, body transport, observability loss, and script entrypoints', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    const runbook = readFileSync('deploy/development/EMQX_RUNBOOK.md', 'utf8')
    const integration = readFileSync('docs/mqtt-server-integration.md', 'utf8')

    expect(packageJson.scripts['emqx:development:checklist']).toBe(
      'node deploy/development/configure-emqx-webhook.mjs --dry-run',
    )
    expect(packageJson.scripts['emqx:development:verify']).toBe(
      'node deploy/development/verify-emqx-webhook.mjs',
    )
    expect(packageJson.scripts['emqx:development:dry-run']).toBeUndefined()
    expect(packageJson.scripts['emqx:development:apply']).toBeUndefined()

    expect(runbook).toContain('peecare-emqx-webhook-current')
    expect(runbook).toContain('{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}')
    expect(runbook).toContain('custom headers are not persisted')
    expect(runbook).toContain('`TLS Verify`: `disabled`')
    expect(runbook).toContain('previous: not deployed')
    expect(runbook).toContain('broker-side queue depth and drops are not observable')
    expect(runbook).toContain('Cloud Run structured logs')
    expect(runbook).toContain('end-to-end probe')
    expect(runbook).toContain('PEECARE_DEVICE_MQTT_URL')
    expect(runbook).toContain('hidden interactive TTY')
    expect(runbook).toContain('兩次 canonical probe')
    expect(runbook).toContain('HTTP 422')
    expect(runbook).toContain('publisher binding')
    expect(runbook).not.toMatch(/PC-[A-Za-z0-9_-]+:emqx-[A-Za-z0-9:-]+/)
    expect(runbook).not.toContain('PEECARE_EMQX_API_KEY')
    expect(runbook).not.toContain('PEECARE_EMQX_API_SECRET')
    expect(runbook).not.toContain('/api-spec.json')
    expect(runbook).not.toContain('npm run emqx:development:apply')
    expect(runbook).not.toContain('`retried > 0`')
    expect(runbook).not.toContain('`failed >= 3`')

    expect(integration).toContain('Dashboard')
    expect(integration).toContain('peecare-emqx-webhook-current')
    expect(integration).toContain('{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}')
    expect(integration).toContain('`TLS Verify` disabled')
    expect(integration).toContain('PEECARE_DEVICE_MQTT_URL')
    expect(integration).toContain('hidden interactive TTY')
    expect(integration).not.toContain('/api/v5/connectors')
    expect(integration).not.toContain('/api/v5/actions')
    expect(integration).not.toContain('/api/v5/rules')
    expect(integration).not.toContain('verify_peer')
    expect(integration).not.toContain('headers.authorization')
    expect(integration).not.toContain('npm run emqx:development:apply')
  })
})
