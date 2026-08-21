import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as webhookConfiguration from './configure-emqx-webhook.mjs'

import {
  buildWebhookRequest,
  loadWebhookTemplate,
  matchesCanonicalTopic,
  runEmqxWebhookConfiguration,
  validateWebhookTemplate,
} from './configure-emqx-webhook.mjs'

type LegacyCompatibilityDelivery = {
  topic: string
  clientid: string
  username: string
  qos: 0 | 1 | 2
  flags: { retain: boolean }
  publish_received_at: number
  payload: unknown
}

type ApprovedLegacyPublisher = {
  clientId: string
  username: string
}

const compatibilityApi = webhookConfiguration as typeof webhookConfiguration & {
  matchesLegacyCompatibilityDelivery: (
    delivery: LegacyCompatibilityDelivery,
    approvedPublisher: ApprovedLegacyPublisher,
  ) => boolean
  buildLegacyCompatibilityWebhookRequest: (
    delivery: LegacyCompatibilityDelivery,
    approvedPublisher: ApprovedLegacyPublisher,
    uuid: string,
  ) => {
    method: string
    path: string
    headers: Record<string, string>
    body: Record<string, unknown> & { payload: Record<string, unknown> }
  }
  matchesLegacyBatteryCompatibilityDelivery: (
    delivery: LegacyCompatibilityDelivery,
  ) => boolean
  buildLegacyBatteryCompatibilityWebhookRequest: (
    delivery: LegacyCompatibilityDelivery,
    uuid: string,
  ) => {
    method: string
    path: string
    headers: Record<string, string>
    body: Record<string, unknown> & { payload: Record<string, unknown> }
  }
}

const currentSecretReference =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/7'

const approvedLegacyPublisher = {
  clientId: 'approved-legacy-client',
  username: 'approved-legacy-device',
}

function legacyCompatibilityDelivery(
  overrides: Partial<LegacyCompatibilityDelivery> = {},
): LegacyCompatibilityDelivery {
  return {
    topic: 'peecare/device/1/status',
    clientid: approvedLegacyPublisher.clientId,
    username: approvedLegacyPublisher.username,
    qos: 0,
    flags: { retain: false },
    publish_received_at: 1_786_982_400_123,
    payload: {
      online: true,
      pumpSecondsToday: 10.4,
      wet: true,
      state: 'done',
      count: 7,
      batteryV: 7.74,
    },
    ...overrides,
  }
}

function compatibilityPredicate() {
  expect(compatibilityApi.matchesLegacyCompatibilityDelivery).toBeTypeOf('function')
  return compatibilityApi.matchesLegacyCompatibilityDelivery
}

function compatibilityTransformer() {
  expect(compatibilityApi.buildLegacyCompatibilityWebhookRequest).toBeTypeOf(
    'function',
  )
  return compatibilityApi.buildLegacyCompatibilityWebhookRequest
}

function batteryCompatibilityPredicate() {
  expect(compatibilityApi.matchesLegacyBatteryCompatibilityDelivery).toBeTypeOf(
    'function',
  )
  return compatibilityApi.matchesLegacyBatteryCompatibilityDelivery
}

function batteryCompatibilityTransformer() {
  expect(
    compatibilityApi.buildLegacyBatteryCompatibilityWebhookRequest,
  ).toBeTypeOf('function')
  return compatibilityApi.buildLegacyBatteryCompatibilityWebhookRequest
}

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

function compatibilityEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...configurationEnvironment(),
    PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE: 'enabled',
    PEECARE_EMQX_COMPATIBILITY_ACTION_NAME: 'a-d1f775fd-compatibility',
    PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME:
      'a-d1f775fd-battery-compatibility',
    PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID: 'sentinel-approved-client',
    PEECARE_APPROVED_LEGACY_MQTT_USERNAME: 'sentinel-approved-username',
    ...overrides,
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
    'peecare/device/1/status',
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

  it('defines a disabled independent compatibility rule and action without changing the canonical route', () => {
    const template = loadWebhookTemplate() as ReturnType<typeof loadWebhookTemplate> & {
      compatibilityRule: {
        id: string
        enable: boolean
        sql: string
        actions: string[]
      }
      compatibilityAction: {
        name: string
        connector: string
        parameters: { body: string }
      }
    }

    expect(template.compatibilityRule).toBeDefined()
    expect(template.compatibilityAction).toBeDefined()
    expect(template.compatibilityRule).toMatchObject({
      enable: false,
      actions: [`http:${template.compatibilityAction.name}`],
    })
    expect(template.compatibilityRule.id).not.toBe(template.rule.id)
    expect(template.compatibilityAction.name).not.toBe(template.action.name)
    expect(template.compatibilityAction.connector).toBe(template.connector.name)
    expect(template.rule.sql.match(/"[^\"]+"/g)).toEqual([
      '"products/+/devices/+/events/urination"',
      '"products/+/devices/+/status/battery"',
    ])
    expect(template.rule.sql).not.toContain('peecare/device/1/status')
  })

  it('defines the opt-in legacy topology as two exact event-specific pairs on one shared connector', () => {
    const template = loadWebhookTemplate() as ReturnType<typeof loadWebhookTemplate> & {
      compatibilityRule: {
        id: string
        enable: boolean
        sql: string
        actions: string[]
      }
      compatibilityAction: { name: string; connector: string }
      batteryCompatibilityRule: {
        id: string
        enable: boolean
        sql: string
        actions: string[]
      }
      batteryCompatibilityAction: {
        name: string
        connector: string
        parameters: { body: string }
      }
    }

    expect(template.batteryCompatibilityRule).toBeDefined()
    expect(template.batteryCompatibilityAction).toBeDefined()
    expect([
      template.compatibilityRule.sql,
      template.batteryCompatibilityRule.sql,
    ].map((sql) => sql.match(/FROM "([^"]+)"/)?.[1])).toEqual([
      'peecare/device/1/status',
      'peecare/device/1/status',
    ])
    expect(template.compatibilityRule).toMatchObject({
      enable: false,
      actions: [`http:${template.compatibilityAction.name}`],
    })
    expect(template.batteryCompatibilityRule).toMatchObject({
      enable: false,
      actions: [`http:${template.batteryCompatibilityAction.name}`],
    })
    expect(new Set([
      template.compatibilityRule.id,
      template.batteryCompatibilityRule.id,
    ]).size).toBe(2)
    expect(new Set([
      template.compatibilityAction.name,
      template.batteryCompatibilityAction.name,
    ]).size).toBe(2)
    expect([
      template.compatibilityAction.connector,
      template.batteryCompatibilityAction.connector,
    ]).toEqual([template.connector.name, template.connector.name])
    expect(template.batteryCompatibilityAction.parameters.body).toMatch(
      /^\{"webhookAuthorization":"Bearer \{\{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT\}\}","event":\{.*\}\}$/,
    )
    expect(template.batteryCompatibilityAction.parameters.body).toContain(
      '"topic":"products/pc-mini/devices/68E274BD2A58/status/battery"',
    )
    expect(template.batteryCompatibilityAction.parameters.body).toContain(
      '"username":"Peecare"',
    )
    expect(template.batteryCompatibilityAction.parameters.body).toContain(
      '"eventId":"compatbattery:68E274BD2A58:${compatibilityUuid}"',
    )
    expect(template.batteryCompatibilityAction.parameters.body).toContain(
      '"batteryLevelPercent":${batteryLevelPercent}',
    )
    expect(template.batteryCompatibilityAction.parameters.body).toContain(
      '"batteryVoltageMv":${batteryVoltageMv}',
    )
  })

  it('locks the compatibility SQL to the exact legacy topic, publisher allowlist, and payload boundaries', () => {
    const template = loadWebhookTemplate() as ReturnType<typeof loadWebhookTemplate> & {
      compatibilityRule: { sql: string }
    }
    expect(template.compatibilityRule).toBeDefined()
    const sql = template.compatibilityRule.sql

    expect(sql).toContain('FROM "peecare/device/1/status"')
    expect(sql).toContain('{{PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID}}')
    expect(sql).toContain('{{PEECARE_APPROVED_LEGACY_MQTT_USERNAME}}')
    expect(sql).toContain('flags.retain = false')
    expect(sql).toContain('online = true')
    expect(sql).toContain('pumpSecondsToday >= 0')
    expect(sql).toContain('pumpSecondsToday <= 4294967.295')
  })

  it('decodes the legacy payload before guarded duration arithmetic', () => {
    const template = loadWebhookTemplate() as ReturnType<typeof loadWebhookTemplate> & {
      compatibilityRule: { sql: string }
    }
    const sql = template.compatibilityRule.sql
    const payloadAlias = 'json_decode(payload) AS legacyPayload'
    const guardedDuration =
      'CASE\n    WHEN is_num(legacyPayload.pumpSecondsToday)\n    THEN round(legacyPayload.pumpSecondsToday * 1000)\n    ELSE 0\n  END AS pumpDurationMs'

    expect(sql).toContain(guardedDuration)
    expect(sql.indexOf(payloadAlias)).toBeLessThan(sql.indexOf(guardedDuration))
  })

  it('locks the Battery SQL to its exact topic, guarded 0-20V boundary, rounded mV, and five tiers', () => {
    const template = loadWebhookTemplate() as ReturnType<typeof loadWebhookTemplate> & {
      batteryCompatibilityRule: { sql: string }
    }
    expect(template.batteryCompatibilityRule).toBeDefined()
    const sql = template.batteryCompatibilityRule.sql
    const payloadAlias = 'json_decode(payload) AS legacyPayload'
    const guardedVoltage =
      'CASE\n    WHEN is_num(legacyPayload.batteryV)\n    THEN legacyPayload.batteryV\n    ELSE -1\n  END AS batteryVolts'

    expect(sql).toContain('FROM "peecare/device/1/status"')
    expect(sql).toContain(guardedVoltage)
    expect(sql.indexOf(payloadAlias)).toBeLessThan(sql.indexOf(guardedVoltage))
    expect(sql).toContain('batteryVolts >= 0')
    expect(sql).toContain('batteryVolts <= 20')
    expect(sql).toContain('round(batteryVolts * 1000) AS batteryVoltageMv')
    expect(sql).toContain('WHEN batteryVolts >= 8.5 THEN 100')
    expect(sql).toContain('WHEN batteryVolts >= 8.0 THEN 75')
    expect(sql).toContain('WHEN batteryVolts >= 7.5 THEN 50')
    expect(sql).toContain('WHEN batteryVolts >= 7.0 THEN 25')
    expect(sql).toContain('ELSE 0')
    expect(sql).not.toContain('{{PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID}}')
    expect(sql).not.toContain('{{PEECARE_APPROVED_LEGACY_MQTT_USERNAME}}')
    expect(sql).not.toContain('flags.retain')
    expect(sql).not.toContain('pumpSecondsToday')
    expect(sql).not.toContain('online')
  })

  it('preserves the two-field Serverless credential wrapper in the compatibility action', () => {
    const template = loadWebhookTemplate() as ReturnType<typeof loadWebhookTemplate> & {
      compatibilityAction: { parameters: { body: string } }
    }
    expect(template.compatibilityAction).toBeDefined()
    const actionBody = template.compatibilityAction.parameters.body

    expect(actionBody).toMatch(/^\{"webhookAuthorization":"Bearer \{\{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT\}\}","event":\{.*\}\}$/)
    expect(actionBody).not.toContain('sentinel-current-secret')
  })

  it.each([
    [
      'zero seconds',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: 0 },
      }),
      true,
    ],
    [
      'the inclusive uint32-safe maximum',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: 4_294_967.295 },
      }),
      true,
    ],
    [
      'a value above the uint32-safe maximum',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: 4_294_967.296 },
      }),
      false,
    ],
    [
      'an offline payload',
      legacyCompatibilityDelivery({
        payload: { online: false, pumpSecondsToday: 10.4 },
      }),
      false,
    ],
    [
      'a missing pumpSecondsToday value',
      legacyCompatibilityDelivery({ payload: { online: true } }),
      false,
    ],
    [
      'an unapproved username',
      legacyCompatibilityDelivery({ username: 'unapproved-legacy-device' }),
      false,
    ],
    [
      'a retained delivery',
      legacyCompatibilityDelivery({ flags: { retain: true } }),
      false,
    ],
  ])('maps the spec eligibility example for %s', (_case, delivery, expected) => {
    expect(
      compatibilityPredicate()(
        delivery,
        approvedLegacyPublisher,
      ),
    ).toBe(expected)
  })

  it.each([
    [
      'non-exact topic',
      legacyCompatibilityDelivery({ topic: 'peecare/device/1/status/extra' }),
    ],
    [
      'unapproved client ID',
      legacyCompatibilityDelivery({ clientid: 'unapproved-legacy-client' }),
    ],
    ['array payload', legacyCompatibilityDelivery({ payload: [] })],
    [
      'numeric online flag',
      legacyCompatibilityDelivery({
        payload: { online: 1, pumpSecondsToday: 10.4 },
      }),
    ],
    [
      'string pump value',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: '10.4' },
      }),
    ],
    [
      'negative pump value',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: -0.001 },
      }),
    ],
    [
      'NaN pump value',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: Number.NaN },
      }),
    ],
    [
      'infinite pump value',
      legacyCompatibilityDelivery({
        payload: { online: true, pumpSecondsToday: Number.POSITIVE_INFINITY },
      }),
    ],
  ])('produces zero compatibility eligibility for a %s', (_case, delivery) => {
    expect(
      compatibilityPredicate()(
        delivery,
        approvedLegacyPublisher,
      ),
    ).toBe(false)
  })

  it.each([
    [0, true],
    [7.74, true],
    [20, true],
    [-0.001, false],
    [20.001, false],
    ['7.74', false],
    [undefined, false],
  ])('maps the Battery eligibility example for batteryV %s', (batteryV, expected) => {
    expect(
      batteryCompatibilityPredicate()(
        legacyCompatibilityDelivery({ payload: { batteryV } }),
      ),
    ).toBe(expected)
  })

  it.each([
    ['non-exact topic', legacyCompatibilityDelivery({ topic: 'peecare/device/1/status/extra' })],
    ['array payload', legacyCompatibilityDelivery({ payload: [] })],
  ])('produces zero Battery eligibility for a %s', (_case, delivery) => {
    expect(batteryCompatibilityPredicate()(delivery)).toBe(false)
  })

  it('keeps Battery eligibility independent from Urination-only source and payload predicates', () => {
    expect(
      batteryCompatibilityPredicate()(
        legacyCompatibilityDelivery({
          clientid: 'different-legacy-client',
          username: 'different-legacy-username',
          flags: { retain: true },
          payload: { online: false, batteryV: 7.74 },
        }),
      ),
    ).toBe(true)
  })

  it('transforms the golden legacy delivery into the exact canonical urination request', () => {
    const request = compatibilityTransformer()(
      legacyCompatibilityDelivery(),
      approvedLegacyPublisher,
      'd7a39aa4195a42068b962eb9a665503e',
    )

    expect(Object.keys(request).sort()).toEqual(['body', 'headers', 'method', 'path'])
    expect(Object.keys(request.body).sort()).toEqual([
      'brokerReceivedAtMs',
      'clientId',
      'payload',
      'qos',
      'retained',
      'topic',
      'username',
    ])
    expect(Object.keys(request.body.payload).sort()).toEqual([
      'deviceId',
      'eventId',
      'eventType',
      'firmwareVersion',
      'flushDurationMs',
      'pumpDurationMs',
      'recordedAtMs',
      'schemaVersion',
      'sequence',
    ])
    expect(request).toEqual({
      method: 'POST',
      path: '/v1/emqx/events',
      headers: { 'content-type': 'application/json' },
      body: {
        topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
        clientId: '68E274BD2A58',
        username: 'approved-legacy-device',
        qos: 0,
        retained: false,
        brokerReceivedAtMs: 1_786_982_400_123,
        payload: {
          schemaVersion: 1,
          eventId:
            'compat:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e',
          eventType: 'urination',
          deviceId: '68E274BD2A58',
          sequence: 1,
          recordedAtMs: 1_786_982_400_123,
          firmwareVersion: '1.0.0',
          flushDurationMs: 0,
          pumpDurationMs: 10_400,
        },
      },
    })
  })

  it('refuses to transform a delivery that fails compatibility eligibility', () => {
    expect(() =>
      compatibilityTransformer()(
        legacyCompatibilityDelivery({ flags: { retain: true } }),
        approvedLegacyPublisher,
        'd7a39aa4195a42068b962eb9a665503e',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'ineligible_legacy_delivery' }),
    )
  })

  it.each([
    [6.9, 6_900, 0],
    [7.0, 7_000, 25],
    [7.5, 7_500, 50],
    [8.0, 8_000, 75],
    [8.5, 8_500, 100],
    [20, 20_000, 100],
  ])(
    'maps batteryV %s to %s mV and the %s percent tier',
    (batteryV, batteryVoltageMv, batteryLevelPercent) => {
      const request = batteryCompatibilityTransformer()(
        legacyCompatibilityDelivery({ payload: { batteryV } }),
        'd7a39aa4195a42068b962eb9a665503e',
      )

      expect(request.body.payload).toMatchObject({
        batteryVoltageMv,
        batteryLevelPercent,
      })
    },
  )

  it('transforms the golden Battery delivery into the exact canonical battery request', () => {
    const request = batteryCompatibilityTransformer()(
      legacyCompatibilityDelivery({ payload: { batteryV: 7.74 } }),
      'd7a39aa4195a42068b962eb9a665503e',
    )

    expect(Object.keys(request).sort()).toEqual(['body', 'headers', 'method', 'path'])
    expect(Object.keys(request.body).sort()).toEqual([
      'brokerReceivedAtMs',
      'clientId',
      'payload',
      'qos',
      'retained',
      'topic',
      'username',
    ])
    expect(Object.keys(request.body.payload).sort()).toEqual([
      'batteryLevelPercent',
      'batteryVoltageMv',
      'deviceId',
      'eventId',
      'eventType',
      'firmwareVersion',
      'recordedAtMs',
      'schemaVersion',
      'sequence',
    ])
    expect(request).toEqual({
      method: 'POST',
      path: '/v1/emqx/events',
      headers: { 'content-type': 'application/json' },
      body: {
        topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
        clientId: '68E274BD2A58',
        username: 'Peecare',
        qos: 0,
        retained: false,
        brokerReceivedAtMs: 1_786_982_400_123,
        payload: {
          schemaVersion: 1,
          eventId:
            'compatbattery:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e',
          eventType: 'battery',
          deviceId: '68E274BD2A58',
          sequence: 1,
          recordedAtMs: 1_786_982_400_123,
          firmwareVersion: '1.0.0',
          batteryLevelPercent: 50,
          batteryVoltageMv: 7_740,
        },
      },
    })
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

  it('defaults to a canonical-only checklist with compatibility disabled', async () => {
    const result = await runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: configurationEnvironment(),
      template: loadWebhookTemplate(),
      adapter: forbiddenAdapter(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      compatibilityMode: 'disabled',
      checklist: {
        compatibility: {
          rule: {
            id: 'peecare_development_legacy_status_compatibility',
            enabled: false,
            topicFilter: 'peecare/device/1/status',
          },
        },
      },
    })
  })

  it('emits an enable-ready sanitized compatibility checklist with test-only warnings and zero mutation', async () => {
    const adapter = forbiddenAdapter()
    const output: string[] = []
    const result = await runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: compatibilityEnvironment(),
      template: loadWebhookTemplate(),
      adapter,
      write: (line) => output.push(line),
    })

    expect(result).toMatchObject({
      compatibilityMode: 'enabled',
      checklist: {
        rule: { enabled: false },
        selectedTopology: {
          mode: 'paired_compatibility',
          ruleCount: 2,
          actionCount: 2,
        },
        compatibility: {
          rule: {
            id: 'peecare_development_legacy_status_compatibility',
            enabled: true,
            topicFilter: 'peecare/device/1/status',
          },
          action: {
            name: 'a-d1f775fd-compatibility',
            connectorName: 'c-d1f775fd-ae8109',
          },
          fixedTarget: {
            productModel: 'pc-mini',
            deviceId: '68E274BD2A58',
            eventType: 'urination',
          },
          warnings: [
            'daily_stats_will_be_modified',
            'pump_seconds_today_is_cumulative_test_data',
            'retries_create_distinct_events',
          ],
        },
      },
    })
    expect(adapter.readApiSpec).not.toHaveBeenCalled()
    expect(adapter.planConfiguration).not.toHaveBeenCalled()
    expect(adapter.applyConfiguration).not.toHaveBeenCalled()
    expect(output).toEqual([JSON.stringify(result)])
    expect(output[0]).toContain('a-d1f775fd-battery-compatibility')
    expect(output[0]).toContain('"eventType":"battery"')
    expect(output[0]).not.toContain('sentinel-approved-client')
    expect(output[0]).not.toContain('sentinel-approved-username')
    expect(output[0]).not.toContain('sentinel-current-secret')
  })

  it.each([
    ['missing Battery action', { PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME: undefined }],
    ['duplicate paired action', { PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME: 'a-d1f775fd-compatibility' }],
    ['canonical action collision', { PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME: 'a-d1f775fd-1a0b6a' }],
    ['missing client ID', { PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID: undefined }],
    ['missing username', { PEECARE_APPROVED_LEGACY_MQTT_USERNAME: undefined }],
    ['line-feed client ID', { PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID: 'bad\nclient' }],
    ['carriage-return username', { PEECARE_APPROVED_LEGACY_MQTT_USERNAME: 'bad\rusername' }],
    ['null username', { PEECARE_APPROVED_LEGACY_MQTT_USERNAME: 'bad\0username' }],
    ['SQL quote in client ID', { PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID: "bad'client" }],
    ['JSON escape in username', { PEECARE_APPROVED_LEGACY_MQTT_USERNAME: 'bad\\username' }],
    ['template marker in username', { PEECARE_APPROVED_LEGACY_MQTT_USERNAME: 'bad${username}' }],
    ['oversized client ID', { PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID: 'x'.repeat(129) }],
  ])('fails closed for enabled compatibility with %s', async (_case, overrides) => {
    const adapter = forbiddenAdapter()
    await expect(runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: compatibilityEnvironment(overrides),
      template: loadWebhookTemplate(),
      adapter,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_precondition_unmet' })
    expect(adapter.readApiSpec).not.toHaveBeenCalled()
    expect(adapter.planConfiguration).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized compatibility mode instead of silently disabling the route', async () => {
    await expect(runEmqxWebhookConfiguration({
      mode: 'dry-run',
      environment: {
        ...configurationEnvironment(),
        PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE: 'enable',
      },
      template: loadWebhookTemplate(),
      adapter: forbiddenAdapter(),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'invalid_compatibility_mode' })
  })

  it.each([
    ['enabled template default', (template: any) => { template.compatibilityRule.enable = true }],
    ['changed topic', (template: any) => { template.compatibilityRule.sql = template.compatibilityRule.sql.replace('peecare/device/1/status', 'peecare/device/+/status') }],
    ['changed connector', (template: any) => { template.compatibilityAction.connector = 'attacker-connector' }],
    ['changed body', (template: any) => { template.compatibilityAction.parameters.body = '{}' }],
  ])('rejects a compatibility template with %s', (_case, mutate) => {
    const template = structuredClone(loadWebhookTemplate())
    mutate(template)
    expect(() => validateWebhookTemplate(template)).toThrowError(
      expect.objectContaining({ code: 'invalid_compatibility_template' }),
    )
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
