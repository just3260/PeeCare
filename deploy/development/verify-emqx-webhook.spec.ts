import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  createEmqxWebhookVerificationAdapter,
  runEmqxWebhookVerification,
  runEmqxWebhookVerificationCli,
} from './verify-emqx-webhook.mjs'

const previousReference =
  'projects/petcare-c7483/secrets/emqx-webhook-current/versions/6'
const currentReference =
  'projects/petcare-c7483/secrets/emqx-webhook-current/versions/7'

function environment(): NodeJS.ProcessEnv {
  return {
    PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF: previousReference,
    PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF: currentReference,
    PEECARE_DEVELOPMENT_DEVICE_ID: 'PC-000001',
    PEECARE_DEVELOPMENT_PRODUCT_MODEL: 'pc-mini',
  }
}

function adapter(overrides: Record<string, unknown> = {}) {
  let success = 10
  let failed = 2
  const counters = () => ({
    matched: success + failed,
    success,
    failed,
    dropped: 0,
    lateReply: 0,
  })
  return {
    inspectConfiguration: vi.fn(async () => ({
      rule: 'enabled',
      action: 'connected',
      counters: counters(),
    })),
    switchSecret: vi.fn(async () => undefined),
    probe: vi.fn(async ({ name }) => {
      if (name === 'previous-urination') {
        success += 1
        return { webhookStatus: 201, counters: counters() }
      }
      if (name === 'current-battery') {
        success += 1
        return { webhookStatus: 201, counters: counters() }
      }
      if (name === 'legacy-non-delivery') {
        return { webhookStatus: null, counters: counters() }
      }
      if (name === 'retained-rejection') {
        failed += 1
        return {
          webhookStatus: 422,
          errorCode: 'retained_event',
          counters: counters(),
        }
      }
      if (name === 'array-payload') {
        return {
          webhookStatus: null,
          contractError: 'invalid_payload',
          counters: counters(),
        }
      }
      throw new Error(`unexpected probe ${name}`)
    }),
    ...overrides,
  }
}

describe('development EMQX webhook verification', () => {
  it('uses live EMQX state, rotates only the action header, and observes canonical delivery counters', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    let metricsReads = 0
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (url.endsWith('/api/v5/rules/peecare_development_telemetry')) {
        return Response.json({ enable: true })
      }
      if (url.endsWith('/api/v5/actions/http%3Apeecare_development_ingestion/metrics')) {
        metricsReads += 1
        return Response.json({
          metrics: {
            matched: metricsReads === 1 ? 12 : 13,
            success: metricsReads === 1 ? 10 : 11,
            failed: 2,
            dropped: 0,
            late_reply: 0,
          },
        })
      }
      if (url.endsWith('/api/v5/actions/http%3Apeecare_development_ingestion')) {
        if (init?.method === 'PUT') return new Response(null, { status: 204 })
        return Response.json({
          name: 'peecare_development_ingestion',
          type: 'http',
          status: 'connected',
          parameters: {
            headers: {
              Authorization: 'Bearer ******',
              'content-type': 'application/json',
            },
          },
          node_status: [{ node: 'emqx@127.0.0.1', status: 'connected' }],
        })
      }
      if (url.endsWith('/api/v5/publish')) {
        return Response.json({ id: '018f-webhook-legacy-probe' })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const publishMqtt = vi.fn(async () => 'allowed')
    const adapter = createEmqxWebhookVerificationAdapter({
      managementUrl: 'https://emqx.example.test',
      apiKey: 'scoped-key',
      apiSecret: 'scoped-secret',
      ingestionOrigin: 'https://ingestion.example.test',
      mqttUrl: 'mqtts://mqtt.example.test:8883',
      mqttPassword: 'device-password',
      fetchImpl,
      execute: vi.fn(() => ({ status: 0, stdout: 'sentinel-previous-secret\n' })),
      publishMqtt,
      wait: vi.fn(async () => undefined),
    })

    await expect(adapter.inspectConfiguration()).resolves.toEqual({
      rule: 'enabled',
      action: 'connected',
      counters: { matched: 12, success: 10, failed: 2, dropped: 0, lateReply: 0 },
    })
    await expect(adapter.switchSecret(previousReference)).resolves.toBeUndefined()
    await expect(
      adapter.probe({
        name: 'previous-urination',
        topic: 'products/pc-mini/devices/PC-000001/events/urination',
        qos: 1,
        retained: false,
        payload: {
          schemaVersion: 1,
          eventId: 'PC-000001:webhook-verify:1',
          eventType: 'urination',
          deviceId: 'PC-000001',
          sequence: 1,
          recordedAtMs: 1_786_358_599_000,
          firmwareVersion: '1.0.0',
          flushDurationMs: 3_000,
          pumpDurationMs: 5_000,
        },
      }),
    ).resolves.toMatchObject({
      webhookStatus: 200,
      counters: { success: 11, failed: 2 },
    })
    await expect(
      adapter.probe({
        name: 'legacy-non-delivery',
        topic: 'devices/PC-000001/events/urination',
        qos: 1,
        retained: false,
        payload: { deviceId: 'PC-000001', eventType: 'urination' },
      }),
    ).resolves.toMatchObject({
      webhookStatus: null,
      counters: { success: 11, failed: 2 },
    })

    expect(publishMqtt).toHaveBeenCalledWith(
      expect.objectContaining({
        mqttUrl: 'mqtts://mqtt.example.test:8883',
        deviceId: 'PC-000001',
        username: 'device-PC-000001',
        password: 'device-password',
        topic: 'products/pc-mini/devices/PC-000001/events/urination',
        payload: expect.objectContaining({ eventType: 'urination' }),
      }),
    )
    expect(publishMqtt).toHaveBeenCalledTimes(1)
    expect(requests).toContainEqual(
      expect.objectContaining({ url: 'https://emqx.example.test/api/v5/publish' }),
    )
    const update = requests.find(({ init }) => init?.method === 'PUT')
    expect(JSON.parse(String(update?.init?.body))).toEqual({
      name: 'peecare_development_ingestion',
      type: 'http',
      parameters: {
        headers: {
          authorization: 'Bearer sentinel-previous-secret',
          'content-type': 'application/json',
        },
      },
    })
    expect(JSON.stringify(await adapter.inspectConfiguration())).not.toContain(
      'sentinel-previous-secret',
    )
  })

  it('verifies delivery, non-delivery, rejection, payload boundary, and rotation with a sanitized summary', async () => {
    const verificationAdapter = adapter()
    const output: string[] = []

    const result = await runEmqxWebhookVerification({
      environment: environment(),
      adapter: verificationAdapter,
      now: () => 1_786_358_600_000,
      write: (line) => output.push(line),
    })

    expect(verificationAdapter.switchSecret.mock.calls).toEqual([
      [previousReference],
      [currentReference],
    ])
    expect(verificationAdapter.probe.mock.calls.map(([probe]) => probe.name)).toEqual([
      'previous-urination',
      'current-battery',
      'legacy-non-delivery',
      'retained-rejection',
      'array-payload',
    ])
    expect(result).toEqual({
      status: 'healthy',
      rule: 'enabled',
      action: 'connected',
      rotation: { previous: 'verified', current: 'verified' },
      deliveries: {
        urination: 1,
        battery: 1,
        legacy: 0,
        retainedRejected: 1,
        invalidPayload: 1,
      },
      counterDelta: { success: 2, failed: 1, dropped: 0, lateReply: 0 },
    })
    expect(output).toEqual([JSON.stringify(result)])
    expect(output[0]).not.toContain('versions/6')
    expect(output[0]).not.toContain('versions/7')
    expect(output[0]).not.toContain('device-PC-000001')
    expect(output[0]).not.toContain('payload')
  })

  it('fails when the legacy topic produces a webhook delivery', async () => {
    const verificationAdapter = adapter({
      probe: vi.fn(async ({ name }) => {
        if (name === 'previous-urination') {
          return {
            webhookStatus: 201,
            counters: { matched: 13, success: 11, failed: 2, dropped: 0, lateReply: 0 },
          }
        }
        if (name === 'current-battery') {
          return {
            webhookStatus: 201,
            counters: { matched: 14, success: 12, failed: 2, dropped: 0, lateReply: 0 },
          }
        }
        return {
          webhookStatus: 201,
          counters: { matched: 15, success: 13, failed: 2, dropped: 0, lateReply: 0 },
        }
      }),
    })

    await expect(
      runEmqxWebhookVerification({
        environment: environment(),
        adapter: verificationAdapter,
        now: () => 1_786_358_600_000,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'legacy_delivery_detected' })
  })

  it('fails when a successful probe does not increment the action success counter', async () => {
    const verificationAdapter = adapter({
      probe: vi.fn(async () => ({
        webhookStatus: 201,
        counters: { matched: 12, success: 10, failed: 2, dropped: 0, lateReply: 0 },
      })),
    })

    await expect(
      runEmqxWebhookVerification({
        environment: environment(),
        adapter: verificationAdapter,
        now: () => 1_786_358_600_000,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'delivery_counter_stalled' })
  })

  it('fails when a probe increments dropped or late-reply counters', async () => {
    let success = 10
    const verificationAdapter = adapter({
      probe: vi.fn(async ({ name }) => {
        if (name === 'previous-urination') success += 1
        return {
          webhookStatus: name === 'previous-urination' ? 201 : null,
          counters: {
            matched: 13,
            success,
            failed: 2,
            dropped: 1,
            lateReply: 0,
          },
        }
      }),
    })

    await expect(
      runEmqxWebhookVerification({
        environment: environment(),
        adapter: verificationAdapter,
        now: () => 1_786_358_600_000,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'delivery_health_degraded' })
  })

  it('runs the live CLI with a hidden MQTT password and emits only a sanitized summary', async () => {
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const readPassword = vi.fn(async () => 'sentinel-device-password')
    const createAdapter = vi.fn(() => adapter())

    await expect(
      runEmqxWebhookVerificationCli({
        argv: [],
        environment: {
          ...environment(),
          PEECARE_EMQX_API_URL: 'https://emqx.example.test',
          PEECARE_EMQX_API_KEY: 'scoped-key',
          PEECARE_EMQX_API_SECRET: 'scoped-secret',
          PEECARE_DEVELOPMENT_INGESTION_ORIGIN: 'https://ingestion.example.test',
          PEECARE_DEVICE_MQTT_URL: 'mqtts://mqtt.example.test:8883',
        },
        stdout,
        stderr,
        readPassword,
        createAdapter,
        publishMqtt: vi.fn(),
      }),
    ).resolves.toBe(0)

    expect(readPassword).toHaveBeenCalledOnce()
    expect(createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ mqttPassword: 'sentinel-device-password' }),
    )
    expect(stderr.write).not.toHaveBeenCalled()
    const output = stdout.write.mock.calls.flat().join('')
    expect(output).toContain('"status":"healthy"')
    expect(output).not.toContain('sentinel-device-password')
    expect(output).not.toContain('scoped-secret')
    expect(output).not.toContain('versions/6')
    expect(output).not.toContain('versions/7')
  })

  it('documents the executable verification and rollback-safe rotation sequence', () => {
    const packageJson = JSON.parse(
      readFileSync('package.json', 'utf8'),
    )
    const runbook = readFileSync('deploy/development/EMQX_RUNBOOK.md', 'utf8')

    expect(packageJson.scripts['emqx:development:verify']).toBe(
      'node deploy/development/verify-emqx-webhook.mjs',
    )
    expect(runbook).toContain('npm run emqx:development:dry-run')
    expect(runbook).toContain('npm run emqx:development:apply')
    expect(runbook).toContain('npm run emqx:development:verify')
    expect(runbook.indexOf('Cloud Run 同時接受 current 與 previous')).toBeLessThan(
      runbook.indexOf('將 EMQX Action 切換到新 current'),
    )
    expect(runbook.indexOf('npm run emqx:development:verify')).toBeLessThan(
      runbook.indexOf('移除 previous'),
    )
    const rollback = runbook.split('### Rotation rollback')[1]
    expect(rollback).toContain('PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF')
    expect(rollback).toContain('PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF')
    expect(runbook).not.toContain('sentinel-previous-secret')
  })
})
