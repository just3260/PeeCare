import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  buildWebhookRequest,
  loadWebhookTemplate,
  matchesCanonicalTopic,
  runEmqxWebhookConfiguration,
  validateWebhookTemplate,
} from './configure-emqx-webhook.mjs'

const currentSecretReference =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/7'

function forbiddenAdapter() {
  return {
    readApiSpec: vi.fn(async () => { throw new Error('forbidden') }),
    planConfiguration: vi.fn(async () => { throw new Error('forbidden') }),
    accessSecret: vi.fn(async () => { throw new Error('forbidden') }),
    applyConfiguration: vi.fn(async () => { throw new Error('forbidden') }),
  }
}

function configurationEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_INGESTION_ORIGIN:
      'https://peecare-ingestion-development-example.a.run.app',
    PEECARE_INGESTION_SECRET_CURRENT_REF: currentSecretReference,
    PEECARE_EMQX_CONNECTOR_NAME: 'c-d1f775fd-ae8109',
    PEECARE_EMQX_ACTION_NAME: 'a-d1f775fd-1a0b6a',
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

  it('defines the Serverless action with only the fixed two-field body wrapper', () => {
    const template = loadWebhookTemplate()
    const serialized = JSON.stringify(template)

    expect(template.action).toMatchObject({
      type: 'http',
      connector: '{{PEECARE_EMQX_CONNECTOR_NAME}}',
      parameters: {
        method: 'post',
        path: '/v1/emqx/events',
        headers: { 'content-type': 'application/json' },
        body: '{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":${.}}',
      },
    })
    expect(serialized.toLowerCase()).not.toContain('authorization"')
    expect(serialized).not.toContain('sentinel-current-secret')
  })

  it('constrains exactly the four connector delivery fields and records the TLS exception', () => {
    const template = loadWebhookTemplate()

    expect(template.connector).toMatchObject({
      connect_timeout: '10s',
      pool_size: 2,
      enable_pipelining: 1,
      health_check_interval: '15s',
      ssl: { enable: true, verify: 'disabled' },
    })
    expect(template.action.resource_opts).toBeUndefined()
    expect(template.unconstrainedActionFields).toEqual([
      'query_mode',
      'worker_pool_size',
      'inflight_window',
      'max_buffer_bytes',
      'request_ttl',
    ])
    expect(JSON.stringify(template)).not.toContain('retry_interval')
  })

  it('performs zero API-spec, connector, action, or rule requests while emitting the checklist', async () => {
    const adapter = forbiddenAdapter()
    const output: string[] = []

    const result = await runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: configurationEnvironment(),
      template: loadWebhookTemplate(),
      adapter,
      write: (line) => output.push(line),
    })

    expect(adapter.readApiSpec).not.toHaveBeenCalled()
    expect(adapter.planConfiguration).not.toHaveBeenCalled()
    expect(adapter.accessSecret).not.toHaveBeenCalled()
    expect(adapter.applyConfiguration).not.toHaveBeenCalled()
    expect(output).toEqual([JSON.stringify(result)])
  })

  it.each([
    ['c-d1f775fd-efa39d', 'a-d1f775fd-1a0b6a'],
    ['peecare_development_ingestion', 'operator_action_1'],
  ])('accepts bounded platform or operator identities %s / %s', async (connectorName, actionName) => {
    const result = await runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: {
        ...configurationEnvironment(),
        PEECARE_EMQX_CONNECTOR_NAME: connectorName,
        PEECARE_EMQX_ACTION_NAME: actionName,
      },
      template: loadWebhookTemplate(),
      adapter: forbiddenAdapter(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({ connectorName, actionName })
  })

  it.each([
    ['empty', ''],
    ['line feed', 'name\ninjected'],
    ['whitespace', 'name with space'],
    ['null', 'name\0injected'],
  ])('rejects an unsafe %s identity before any request', async (_case, connectorName) => {
    const adapter = forbiddenAdapter()
    await expect(runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: { ...configurationEnvironment(), PEECARE_EMQX_CONNECTOR_NAME: connectorName },
      template: loadWebhookTemplate(),
      adapter,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'invalid_integration_identity' })
    expect(adapter.readApiSpec).not.toHaveBeenCalled()
    expect(adapter.planConfiguration).not.toHaveBeenCalled()
  })

  it('rejects an unapproved connector policy before any request', async () => {
    const template = structuredClone(loadWebhookTemplate())
    template.connector.pool_size = 16
    const adapter = forbiddenAdapter()

    await expect(runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: configurationEnvironment(),
      template,
      adapter,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'unapproved_delivery_policy' })
    expect(adapter.readApiSpec).not.toHaveBeenCalled()
    expect(adapter.planConfiguration).not.toHaveBeenCalled()
  })

  it('does not require action buffering fields that the Serverless console omits', () => {
    const template = structuredClone(loadWebhookTemplate())
    delete template.action.resource_opts
    expect(() => validateWebhookTemplate(template)).not.toThrow()
  })

  it('rejects an independent retry interval', () => {
    const template = structuredClone(loadWebhookTemplate())
    template.connector.retry_interval = '5s'
    expect(() => validateWebhookTemplate(template)).toThrowError(
      expect.objectContaining({ code: 'unapproved_delivery_policy' }),
    )
  })

  it('emits a sanitized expected-value checklist with no resolved secret', async () => {
    const output: string[] = []
    const result = await runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: configurationEnvironment(),
      template: loadWebhookTemplate(),
      adapter: forbiddenAdapter(),
      write: (line) => output.push(line),
    })

    expect(result).toMatchObject({
      status: 'ready',
      mode: 'checklist',
      connectorName: 'c-d1f775fd-ae8109',
      actionName: 'a-d1f775fd-1a0b6a',
      secretReference: currentSecretReference,
      deliveryPolicy: {
        pool_size: 2,
        enable_pipelining: 1,
        connect_timeout: '10s',
        health_check_interval: '15s',
      },
      checklist: {
        connector: { tlsEnabled: true, tlsVerify: 'disabled' },
        action: {
          customHeaders: 'unsupported',
          body: '{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":${.}}',
        },
      },
    })
    expect(output).toEqual([JSON.stringify(result)])
    expect(output[0]).not.toContain('sentinel-current-secret')
  })

  it('rejects apply mode explicitly without secret access or API mutation', async () => {
    const adapter = forbiddenAdapter()
    await expect(runEmqxWebhookConfiguration({
      mode: 'apply',
      environment: configurationEnvironment(),
      template: loadWebhookTemplate(),
      adapter,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'serverless_api_write_unsupported' })
    expect(adapter.accessSecret).not.toHaveBeenCalled()
    expect(adapter.applyConfiguration).not.toHaveBeenCalled()
  })

  it('provides a standalone Dashboard checklist with no secret value or custom-header instruction', () => {
    const checklist = readFileSync('deploy/development/emqx-serverless-console-checklist.md', 'utf8')
    expect(checklist).toContain('| Connection Pool Size | `2` |')
    expect(checklist).toContain('| HTTP Pipelining | `1` |')
    expect(checklist).toContain('| Connect Timeout | `10s` |')
    expect(checklist).toContain('| Health Check Interval | `15s` |')
    expect(checklist).toContain('`TLS Verify` | `disabled`')
    expect(checklist).toContain('{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}')
    expect(checklist).toContain('custom headers are not persisted')
    expect(checklist).not.toContain('sentinel-current-secret')
    expect(checklist).not.toContain('credential in the URL')
  })
})
