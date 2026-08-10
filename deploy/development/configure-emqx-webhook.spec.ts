import { describe, expect, it, vi } from 'vitest'

import {
  buildWebhookRequest,
  createEmqxWebhookManagementAdapter,
  loadWebhookTemplate,
  matchesCanonicalTopic,
  runEmqxWebhookConfiguration,
  validateWebhookTemplate,
} from './configure-emqx-webhook.mjs'

const currentSecretReference =
  'projects/petcare-c7483/secrets/emqx-webhook-current/versions/7'

function approvedApiSpec() {
  return {
    paths: {
      '/api/v5/actions': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/http_action' },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        http_action: {
          properties: {
            resource_opts: {
              properties: {
                query_mode: {},
                worker_pool_size: {},
                inflight_window: {},
                max_buffer_bytes: {},
                request_ttl: {},
                health_check_interval: {},
              },
            },
          },
        },
      },
    },
  }
}

function configurationAdapter(apiSpec = approvedApiSpec()) {
  return {
    readApiSpec: vi.fn(async () => apiSpec),
    planConfiguration: vi.fn(async () => ({
      connector: 'create',
      action: 'create',
      rule: 'create',
    })),
    accessSecret: vi.fn(async () => 'sentinel-current-secret'),
    applyConfiguration: vi.fn(async () => ({
      connector: 'connected',
      action: 'connected',
      rule: 'enabled',
    })),
  }
}

function configurationEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_INGESTION_ORIGIN:
      'https://peecare-ingestion-development-example.a.run.app',
    PEECARE_INGESTION_SECRET_CURRENT_REF: currentSecretReference,
  }
}

describe('development EMQX webhook configuration', () => {
  it.each([
    'products/pc-mini/devices/PC-000001/events/urination',
    'products/pc-mini/devices/PC-000001/status/battery',
  ])('matches the canonical topic %s', (topic) => {
    expect(matchesCanonicalTopic(topic)).toBe(true)
  })

  it.each([
    'products/pc-mini/devices/PC-000001/events/battery',
    'products/pc-mini/devices/PC-000001/commands/flush',
    'products/pc-mini/devices/PC-000001/status/firmware',
    'devices/PC-000001/events/urination',
    'products/pc-mini/devices/PC-000001/events/urination/extra',
  ])('excludes the non-canonical topic %s', (topic) => {
    expect(matchesCanonicalTopic(topic)).toBe(false)
  })

  it('uses only the two exact structural topic filters in the rule SQL', () => {
    const template = loadWebhookTemplate()

    expect(() => validateWebhookTemplate(template)).not.toThrow()
    expect(template.rule.sql.match(/"[^"]+"/g)).toEqual([
      '"products/+/devices/+/events/urination"',
      '"products/+/devices/+/status/battery"',
    ])
  })

  it('renders the golden urination request with exactly the contract fields', () => {
    const payload = {
      schemaVersion: 1,
      eventId: 'PC-000001:boot-1:1',
      eventType: 'urination',
      deviceId: 'PC-000001',
      sequence: 1,
      recordedAtMs: 1_786_358_599_000,
      firmwareVersion: '1.0.0',
      flushDurationMs: 3_000,
      pumpDurationMs: 5_000,
    }

    expect(
      buildWebhookRequest({
        topic: 'products/pc-mini/devices/PC-000001/events/urination',
        clientid: 'PC-000001',
        username: 'device-PC-000001',
        qos: 1,
        flags: { retain: false },
        publish_received_at: 1_786_358_600_000,
        payload,
      }),
    ).toEqual({
      method: 'POST',
      path: '/v1/emqx/events',
      headers: { 'content-type': 'application/json' },
      body: {
        topic: 'products/pc-mini/devices/PC-000001/events/urination',
        clientId: 'PC-000001',
        username: 'device-PC-000001',
        qos: 1,
        retained: false,
        brokerReceivedAtMs: 1_786_358_600_000,
        payload,
      },
    })
  })

  it.each([0, 1, 2] as const)('preserves qos %s in the rendered envelope', (qos) => {
    const request = buildWebhookRequest({
      topic: 'products/pc-mini/devices/PC-000001/events/urination',
      clientid: 'PC-000001',
      username: 'device-PC-000001',
      qos,
      flags: { retain: false },
      publish_received_at: 1_786_358_600_000,
      payload: { deviceId: 'PC-000001' },
    })

    expect(request.body.qos).toBe(qos)
  })

  it('preserves retained true, distinct publisher fields, and broker receive time', () => {
    const request = buildWebhookRequest({
      topic: 'products/pc-mini/devices/PC-000001/events/urination',
      clientid: 'PC-000001',
      username: 'device-PC-000001',
      qos: 1,
      flags: { retain: true },
      publish_received_at: 1_786_358_600_000,
      payload: { deviceId: 'PC-000001' },
    })

    expect(request.body).toMatchObject({
      clientId: 'PC-000001',
      username: 'device-PC-000001',
      qos: 1,
      retained: true,
      brokerReceivedAtMs: 1_786_358_600_000,
    })
  })

  it('rejects a decoded array before it can be counted as a successful delivery', () => {
    expect(() =>
      buildWebhookRequest({
        topic: 'products/pc-mini/devices/PC-000001/events/urination',
        clientid: 'PC-000001',
        username: 'device-PC-000001',
        qos: 1,
        flags: { retain: false },
        publish_received_at: 1_786_358_600_000,
        payload: [{ deviceId: 'PC-000001' }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_payload' }))
  })

  it('defines the HTTP action as a JSON POST of the complete selected row', () => {
    const template = loadWebhookTemplate()

    expect(template.action).toMatchObject({
      type: 'http',
      connector: 'peecare_development_ingestion',
      parameters: {
        method: 'post',
        path: '/v1/emqx/events',
        headers: { 'content-type': 'application/json' },
        body: '${.}',
      },
    })
  })

  it('stores only the current-secret token and the exact approved bounded delivery policy', () => {
    const template = loadWebhookTemplate()
    const serialized = JSON.stringify(template)

    expect(template.action.parameters.headers).toEqual({
      authorization: 'Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}',
      'content-type': 'application/json',
    })
    expect(template.action.resource_opts).toEqual({
      query_mode: 'async',
      worker_pool_size: 2,
      inflight_window: 10,
      max_buffer_bytes: '8MB',
      request_ttl: '30s',
      health_check_interval: '15s',
    })
    expect(template.alertThresholds).toEqual({
      warning: { retried: 1, queuingSeconds: 60 },
      critical: { failedInFiveMinutes: 3, dropped: 1, lateReply: 1 },
    })
    expect(serialized).not.toContain('retry_interval')
    expect(serialized).not.toContain('sentinel-current-secret')
  })

  it('emits a sanitized dry-run summary without resolving or mutating the secret', async () => {
    const adapter = configurationAdapter()
    const output: string[] = []

    const result = await runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: configurationEnvironment(),
      template: loadWebhookTemplate(),
      adapter,
      write: (line) => output.push(line),
    })

    expect(result).toMatchObject({
      status: 'ready',
      mode: 'dry-run',
      secretReference: currentSecretReference,
      secretToken: '{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}',
      plan: { connector: 'create', action: 'create', rule: 'create' },
    })
    expect(adapter.accessSecret).not.toHaveBeenCalled()
    expect(adapter.applyConfiguration).not.toHaveBeenCalled()
    expect(output).toEqual([JSON.stringify(result)])
    expect(output[0]).not.toContain('sentinel-current-secret')
  })

  it('rejects an oversized queue before secret access or any EMQX mutation', async () => {
    const template = structuredClone(loadWebhookTemplate())
    template.action.resource_opts.max_buffer_bytes = '256MB'
    const adapter = configurationAdapter()

    await expect(
      runEmqxWebhookConfiguration({
        mode: 'apply',
        environment: configurationEnvironment(),
        template,
        adapter,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'unapproved_delivery_policy' })
    expect(adapter.accessSecret).not.toHaveBeenCalled()
    expect(adapter.applyConfiguration).not.toHaveBeenCalled()
  })

  it('requires the live EMQX API schema before secret access or mutation', async () => {
    const apiSpec = approvedApiSpec()
    delete apiSpec.components.schemas.http_action.properties.resource_opts.properties.request_ttl
    const adapter = configurationAdapter(apiSpec)

    await expect(
      runEmqxWebhookConfiguration({
        mode: 'apply',
        environment: configurationEnvironment(),
        template: loadWebhookTemplate(),
        adapter,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_emqx_schema' })
    expect(adapter.accessSecret).not.toHaveBeenCalled()
    expect(adapter.applyConfiguration).not.toHaveBeenCalled()
  })

  it('resolves the current secret only in memory for apply and keeps the result sanitized', async () => {
    const adapter = configurationAdapter()
    const output: string[] = []

    const result = await runEmqxWebhookConfiguration({
      mode: 'apply',
      environment: configurationEnvironment(),
      template: loadWebhookTemplate(),
      adapter,
      write: (line) => output.push(line),
    })

    expect(adapter.applyConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          parameters: expect.objectContaining({
            headers: expect.objectContaining({
              authorization: 'Bearer sentinel-current-secret',
            }),
          }),
        }),
      }),
    )
    expect(result).toMatchObject({ status: 'applied', secretReference: currentSecretReference })
    expect(JSON.stringify(result)).not.toContain('sentinel-current-secret')
    expect(output.join('')).not.toContain('sentinel-current-secret')
  })

  it('creates connector, action, then rule through the scoped EMQX management API', async () => {
    const fetchImpl = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'GET') {
        return { status: 404, json: async () => ({ code: 'NOT_FOUND' }) }
      }
      return { status: 201, json: async () => ({}) }
    })
    const adapter = createEmqxWebhookManagementAdapter({
      managementUrl: 'https://emqx.development.example',
      apiKey: 'data-integration-key',
      apiSecret: 'management-secret',
      fetchImpl,
      execute: vi.fn(() => ({ status: 0, stdout: 'sentinel-current-secret\n' })),
    })
    const configuration = structuredClone(loadWebhookTemplate())
    configuration.connector.url =
      'https://peecare-ingestion-development-example.a.run.app'
    configuration.action.parameters.headers.authorization =
      'Bearer sentinel-current-secret'

    await adapter.applyConfiguration(configuration)

    const mutations = fetchImpl.mock.calls
      .filter(([, options]) => options?.method !== 'GET')
      .map(([url, options]) => [url, options?.method])
    expect(mutations).toEqual([
      ['https://emqx.development.example/api/v5/connectors', 'POST'],
      ['https://emqx.development.example/api/v5/actions', 'POST'],
      ['https://emqx.development.example/api/v5/rules', 'POST'],
    ])
  })
})
