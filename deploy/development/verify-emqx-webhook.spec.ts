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

const compatibilityStartedAt = 1_786_982_400_000
const compatibilityBrokerReceivedAtMs = 1_786_982_400_123

function enabledCompatibility(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    approvedClientId: 'approved-legacy-client',
    approvedUsername: 'approved-legacy-device',
    expectedPumpSecondsToday: 10.4,
    expectedBatteryV: 7.74,
    expectedQos: 0,
    ...overrides,
  }
}

function compatibilityEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'compat:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e',
    eventType: 'urination',
    deviceId: '68E274BD2A58',
    productModel: 'pc-mini',
    schemaVersion: 1,
    sequence: 1,
    recordedAtMs: compatibilityBrokerReceivedAtMs,
    brokerReceivedAtMs: compatibilityBrokerReceivedAtMs,
    receivedAtMs: compatibilityBrokerReceivedAtMs + 10,
    firmwareVersion: '1.0.0',
    flushDurationMs: 0,
    pumpDurationMs: 10_400,
    createdAtMs: compatibilityBrokerReceivedAtMs + 10,
    transport: {
      topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
      clientId: '68E274BD2A58',
      username: 'approved-legacy-device',
      qos: 0,
    },
    ...overrides,
  }
}

function compatibilityBatteryEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'compatbattery:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e',
    eventType: 'battery',
    deviceId: '68E274BD2A58',
    productModel: 'pc-mini',
    schemaVersion: 1,
    sequence: 1,
    recordedAtMs: compatibilityBrokerReceivedAtMs,
    brokerReceivedAtMs: compatibilityBrokerReceivedAtMs,
    receivedAtMs: compatibilityBrokerReceivedAtMs + 10,
    firmwareVersion: '1.0.0',
    batteryLevelPercent: 50,
    batteryVoltageMv: 7_740,
    createdAtMs: compatibilityBrokerReceivedAtMs + 10,
    transport: {
      topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
      clientId: '68E274BD2A58',
      username: 'Peecare',
      qos: 0,
    },
    ...overrides,
  }
}

function modeAwareAdapter(overrides: Record<string, unknown> = {}) {
  return deliveryAdapter({
    readDeviceRegistry: vi.fn(async () => ({
      deviceId: '68E274BD2A58',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
    })),
    readCompatibilityEvents: vi.fn(async () => [compatibilityEvent()]),
    ...overrides,
  })
}

function pairedModeAwareAdapter(overrides: Record<string, unknown> = {}) {
  return modeAwareAdapter({
    // Battery first proves verification does not depend on Firestore result order.
    readCompatibilityEvents: vi.fn(async () => [
      compatibilityBatteryEvent(),
      compatibilityEvent(),
    ]),
    ...overrides,
  })
}

describe('development EMQX webhook verification', () => {
  it('verifies two canonical deliveries and legacy non-delivery through injected adapters only', async () => {
    const adapter = deliveryAdapter()
    const output: string[] = []

    const result = await runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: { enabled: false },
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
      mode: 'canonical_only',
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

  it('keeps disabled mode on the legacy non-delivery path without compatibility reads', async () => {
    const adapter = modeAwareAdapter({
      readDeviceRegistry: vi.fn(async () => {
        throw new Error('disabled mode must not read the compatibility registry')
      }),
      readCompatibilityEvents: vi.fn(async () => {
        throw new Error('disabled mode must not query compatibility events')
      }),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: { enabled: false },
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-disabled-mode',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).resolves.toMatchObject({
      deliveries: { legacy: 'not_delivered' },
    })

    expect(adapter.readDeviceRegistry).not.toHaveBeenCalled()
    expect(adapter.readCompatibilityEvents).not.toHaveBeenCalled()
  })

  it('reports paired shape observation without claiming Arduino provenance', async () => {
    const adapter = pairedModeAwareAdapter()
    const output: string[] = []

    const result = await runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-enabled-mode',
      wait: vi.fn(async () => undefined),
      write: (line) => output.push(line),
    })

    expect(adapter.publishProbe).not.toHaveBeenCalled()
    expect(adapter.readEventDocument).not.toHaveBeenCalled()
    expect(adapter.readDeviceRegistry).toHaveBeenCalledWith({
      deviceId: '68E274BD2A58',
    })
    expect(adapter.readCompatibilityEvents).toHaveBeenCalledWith({
      deviceId: '68E274BD2A58',
      createdAfterMs: compatibilityStartedAt,
    })
    expect(result).toMatchObject({
      mode: 'paired_compatibility',
      verification: {
        urinationCompatibility: 'shape_observed',
        batteryCompatibility: 'shape_observed',
        sourceProvenance: 'human_attestation_required',
      },
      deliveries: {
        urination: 'delivered',
        battery: 'delivered',
        legacy: 'paired_shape_observed',
      },
    })
    expect(output).toEqual([JSON.stringify(result)])
  })

  it('ignores unrelated recent device events when matching the paired prefixes', async () => {
    const adapter = pairedModeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => [
        {
          ...compatibilityEvent(),
          eventId: 'ordinary-canonical-event',
          sequence: 1,
        },
        compatibilityBatteryEvent(),
        compatibilityEvent(),
      ]),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-with-noise',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).resolves.toMatchObject({
      deliveries: { legacy: 'paired_shape_observed' },
    })
  })

  it('fails enabled mode when the fixed target registry does not match', async () => {
    const adapter = modeAwareAdapter({
      readDeviceRegistry: vi.fn(async () => ({
        deviceId: '68E274BD2A58',
        productModel: 'wrong-model',
        ingestionStatus: 'enabled',
      })),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-registry-mismatch',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_registry_mismatch' })
    expect(adapter.readCompatibilityEvents).not.toHaveBeenCalled()
  })

  it('returns a typed precondition error when the compatibility adapter is missing', async () => {
    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter: undefined,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-missing-adapter',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_precondition_unmet' })
  })

  it('returns a typed timeout after bounded paired compatibility polling finds no event', async () => {
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => []),
    })
    const wait = vi.fn(async () => undefined)

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-compatibility-timeout',
      pollAttempts: 3,
      pollIntervalMs: 25,
      wait,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_delivery_timeout' })
    expect(adapter.readCompatibilityEvents).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      'Urination',
      [compatibilityBatteryEvent()],
      'compatibility_urination_delivery_timeout',
    ],
    [
      'Battery',
      [compatibilityEvent()],
      'compatibility_battery_delivery_timeout',
    ],
  ])('rejects partial paired evidence when the %s event times out', async (
    _missingType,
    events,
    expectedCode,
  ) => {
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => events),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-partial-compatibility-evidence',
      pollAttempts: 2,
      pollIntervalMs: 25,
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: expectedCode })
    expect(adapter.readCompatibilityEvents).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      'Urination',
      [
        compatibilityBatteryEvent(),
        compatibilityEvent(),
        compatibilityEvent({
          eventId: 'compat:68E274BD2A58:4d07199e23224ff89455c8da4dc42162',
          createdAtMs: compatibilityBrokerReceivedAtMs + 20,
        }),
      ],
      'compatibility_urination_multiple_matches',
    ],
    [
      'Battery',
      [
        compatibilityEvent(),
        compatibilityBatteryEvent(),
        compatibilityBatteryEvent({
          eventId:
            'compatbattery:68E274BD2A58:8fd6198c3e404b18a5ce8f7c9a3b2d10',
          createdAtMs: compatibilityBrokerReceivedAtMs + 20,
        }),
      ],
      'compatibility_battery_multiple_matches',
    ],
  ])('rejects multiple %s events as type-specific ambiguous evidence', async (
    _eventType,
    events,
    expectedCode,
  ) => {
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => events),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-multiple-compatibility-events',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: expectedCode })
  })

  it('rejects a duplicate that appears during the remaining observation window', async () => {
    const readCompatibilityEvents = vi
      .fn()
      .mockResolvedValueOnce([compatibilityEvent(), compatibilityBatteryEvent()])
      .mockResolvedValue([
        compatibilityEvent(),
        compatibilityBatteryEvent(),
        compatibilityBatteryEvent({
          eventId:
            'compatbattery:68E274BD2A58:8fd6198c3e404b18a5ce8f7c9a3b2d10',
        }),
      ])
    const adapter = pairedModeAwareAdapter({ readCompatibilityEvents })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-late-duplicate',
      pollAttempts: 2,
      pollIntervalMs: 25,
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({
      code: 'compatibility_battery_multiple_matches',
    })
    expect(readCompatibilityEvents).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['event identity', { eventId: 'compat:68E274BD2A58:not-a-uuid' }],
    ['fixed target', { deviceId: 'PC-DEV-000004' }],
    ['fixed product model', { productModel: 'other-model' }],
    ['fixed event type', { eventType: 'battery' }],
    ['fixed schema version', { schemaVersion: 2 }],
    ['fixed sequence', { sequence: 2 }],
    ['fixed firmware version', { firmwareVersion: '2.0.0' }],
    ['rounded duration', { pumpDurationMs: 10_399 }],
    ['fixed flush duration', { flushDurationMs: 1 }],
    ['broker timestamp equality', { recordedAtMs: compatibilityBrokerReceivedAtMs + 1 }],
    ['transport username', {
      transport: {
        topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
        clientId: '68E274BD2A58',
        username: 'other-publisher',
        qos: 0,
      },
    }],
    ['transport topic', {
      transport: {
        topic: 'peecare/device/1/status',
        clientId: '68E274BD2A58',
        username: 'approved-legacy-device',
        qos: 0,
      },
    }],
    ['transport client ID', {
      transport: {
        topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
        clientId: 'approved-legacy-client',
        username: 'approved-legacy-device',
        qos: 0,
      },
    }],
    ['transport qos', {
      transport: {
        topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
        clientId: '68E274BD2A58',
        username: 'approved-legacy-device',
        qos: 1,
      },
    }],
  ])('returns a typed Urination field mismatch for an unexpected %s', async (
    _name,
    eventOverrides,
  ) => {
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => [
        compatibilityBatteryEvent(),
        compatibilityEvent(eventOverrides),
      ]),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-compatibility-field-mismatch',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_urination_field_mismatch' })
  })

  it.each([
    ['event identity', { eventId: 'compatbattery:68E274BD2A58:not-a-uuid' }],
    ['fixed target', { deviceId: 'PC-DEV-000004' }],
    ['fixed product model', { productModel: 'other-model' }],
    ['fixed event type', { eventType: 'urination' }],
    ['fixed schema version', { schemaVersion: 2 }],
    ['fixed sequence', { sequence: 2 }],
    ['fixed firmware version', { firmwareVersion: '2.0.0' }],
    ['rounded voltage', { batteryVoltageMv: 7_739 }],
    ['voltage tier', { batteryLevelPercent: 75 }],
    ['broker timestamp equality', {
      recordedAtMs: compatibilityBrokerReceivedAtMs + 1,
    }],
    ['fixed transport username', {
      transport: {
        topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
        clientId: '68E274BD2A58',
        username: 'approved-legacy-device',
        qos: 0,
      },
    }],
    ['transport topic', {
      transport: {
        topic: 'peecare/device/1/status',
        clientId: '68E274BD2A58',
        username: 'Peecare',
        qos: 0,
      },
    }],
    ['transport client ID', {
      transport: {
        topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
        clientId: 'approved-legacy-client',
        username: 'Peecare',
        qos: 0,
      },
    }],
    ['transport qos', {
      transport: {
        topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
        clientId: '68E274BD2A58',
        username: 'Peecare',
        qos: 1,
      },
    }],
  ])('returns a typed Battery field mismatch for an unexpected %s', async (
    _name,
    eventOverrides,
  ) => {
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => [
        compatibilityEvent(),
        compatibilityBatteryEvent(eventOverrides),
      ]),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-compatibility-battery-field-mismatch',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_battery_field_mismatch' })
  })

  it('normalizes a compatibility Firestore read failure to a typed outcome', async () => {
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => {
        throw new Error('raw firestore error with sentinel-webhook-secret')
      }),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-compatibility-read-failure',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_firestore_read_failed' })
  })

  it('rejects events from different broker deliveries as a mismatched pair', async () => {
    const adapter = pairedModeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => [
        compatibilityEvent(),
        compatibilityBatteryEvent({
          brokerReceivedAtMs: compatibilityBrokerReceivedAtMs + 1,
          recordedAtMs: compatibilityBrokerReceivedAtMs + 1,
        }),
      ]),
    })

    await expect(runEmqxWebhookVerification({
      environment: environment(),
      adapter,
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-pair-timestamp-mismatch',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'compatibility_pair_mismatch' })
  })

  it('reports exactly one mode-appropriate legacy result in enabled mode', async () => {
    const result = await runEmqxWebhookVerification({
      environment: environment(),
      adapter: pairedModeAwareAdapter(),
      compatibility: enabledCompatibility(),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-exclusive-legacy-result',
      wait: vi.fn(async () => undefined),
      write: vi.fn(),
    })

    expect(result.deliveries.legacy).toBe('paired_shape_observed')
    expect(result.verification.sourceProvenance).toBe(
      'human_attestation_required',
    )
    expect(JSON.stringify(result.deliveries)).not.toContain('not_delivered')
  })

  it('redacts compatibility event identity, source identity, payload, and credentials', async () => {
    const output: string[] = []
    const urinationEventId =
      'compat:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e'
    const batteryEventId =
      'compatbattery:68E274BD2A58:8fd6198c3e404b18a5ce8f7c9a3b2d10'
    const adapter = modeAwareAdapter({
      readCompatibilityEvents: vi.fn(async () => [
        compatibilityEvent({
          eventId: urinationEventId,
          legacyPayload: {
            online: true,
            pumpSecondsToday: 10.4,
            mqttPassword: 'sentinel-mqtt-password',
          },
        }),
        compatibilityBatteryEvent({
          eventId: batteryEventId,
          legacyPayload: {
            batteryV: 7.74,
            webhookAuthorization: 'sentinel-webhook-secret',
          },
        }),
      ]),
    })

    await runEmqxWebhookVerification({
      environment: environment({
        PEECARE_INGESTION_SECRET_CURRENT_REF:
          'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/77',
      }),
      adapter,
      compatibility: enabledCompatibility({
        approvedClientId: 'sentinel-approved-client',
      }),
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-compatibility-redaction',
      wait: vi.fn(async () => undefined),
      write: (line) => output.push(line),
    })

    expect(output).toHaveLength(1)
    expect(adapter.readCompatibilityEvents).toHaveBeenCalled()
    expect(output[0]).not.toContain(urinationEventId)
    expect(output[0]).not.toContain(batteryEventId)
    expect(output[0]).not.toContain('sentinel-approved-client')
    expect(output[0]).not.toContain('approved-legacy-device')
    expect(output[0]).not.toContain('sentinel-mqtt-password')
    expect(output[0]).not.toContain('sentinel-webhook-secret')
    expect(output[0]).not.toContain('pumpSecondsToday')
    expect(output[0]).not.toContain('batteryV')
    expect(output[0]).not.toContain('versions/77')
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
      argv: ['--canonical-only'],
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
            deviceId: '68E274BD2A58',
            productModel: 'pc-mini',
            mqttPrincipal: 'device-68E274BD2A58',
            firestore: {
              projectId: 'petcare-c7483',
              documentPath: 'devices/68E274BD2A58',
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
      deviceId: '68E274BD2A58',
      username: 'device-68E274BD2A58',
      password: 'sentinel-device-password',
      projectId: 'petcare-c7483',
    }))
    expect(stderr.write).not.toHaveBeenCalled()
    const output = stdout.write.mock.calls.flat().join('')
    expect(output).toContain('"status":"healthy"')
    expect(output).not.toContain('sentinel-device-password')
    expect(output).not.toContain('payload')
  })

  it('requires an explicit canonical-only or compatibility CLI mode before reading credentials', async () => {
    const readPassword = vi.fn()
    const stderr = { write: vi.fn() }

    await expect(runEmqxWebhookVerificationCli({
      argv: [],
      environment: environment(),
      stderr,
      stdout: { write: vi.fn() },
      createAdapter: vi.fn(),
      readPassword,
      artifacts: { inventory: { schemaVersion: 1, devices: [] } },
    })).resolves.toBe(1)

    expect(readPassword).not.toHaveBeenCalled()
    expect(stderr.write).toHaveBeenCalledWith(
      '{"status":"error","code":"invalid_arguments"}\n',
    )
  })

  it('runs explicit compatibility verification with sanitized environment inputs', async () => {
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const adapter = pairedModeAwareAdapter()
    const createAdapter = vi.fn(() => adapter)
    const readPassword = vi.fn(async () => 'sentinel-device-password')

    await expect(runEmqxWebhookVerificationCli({
      argv: ['--compatibility'],
      environment: {
        ...environment(),
        PEECARE_DEVICE_MQTT_URL:
          'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
        PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID: 'approved-legacy-client',
        PEECARE_APPROVED_LEGACY_MQTT_USERNAME: 'approved-legacy-device',
        PEECARE_EXPECTED_LEGACY_PUMP_SECONDS_TODAY: '10.4',
        PEECARE_EXPECTED_LEGACY_BATTERY_V: '7.74',
        PEECARE_EXPECTED_LEGACY_QOS: '0',
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
            deviceId: '68E274BD2A58',
            productModel: 'pc-mini',
            mqttPrincipal: 'device-68E274BD2A58',
            firestore: {
              projectId: 'petcare-c7483',
              documentPath: 'devices/68E274BD2A58',
              ingestionStatus: 'enabled',
            },
          }],
        },
      },
      now: () => compatibilityStartedAt,
      createRunId: () => 'run-cli-compatibility',
      wait: vi.fn(async () => undefined),
    })).resolves.toBe(0)

    expect(stderr.write).not.toHaveBeenCalled()
    expect(adapter.publishProbe).not.toHaveBeenCalled()
    expect(readPassword).not.toHaveBeenCalled()
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      compatibilityOnly: true,
    }))
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"legacy":"paired_shape_observed"'),
    )
    const output = stdout.write.mock.calls.flat().join('')
    expect(output).not.toContain('approved-legacy-client')
    expect(output).not.toContain('approved-legacy-device')
    expect(output).not.toContain('sentinel-device-password')
  })

  it('rejects incomplete compatibility inputs before reading the hidden password', async () => {
    const readPassword = vi.fn()
    const stderr = { write: vi.fn() }

    await expect(runEmqxWebhookVerificationCli({
      argv: ['--compatibility'],
      environment: {
        ...environment(),
        PEECARE_DEVICE_MQTT_URL:
          'mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883',
      },
      stderr,
      stdout: { write: vi.fn() },
      createAdapter: vi.fn(),
      readPassword,
      artifacts: { inventory: { schemaVersion: 1, devices: [] } },
    })).resolves.toBe(1)

    expect(readPassword).not.toHaveBeenCalled()
    expect(stderr.write).toHaveBeenCalledWith(
      '{"status":"error","code":"compatibility_precondition_unmet"}\n',
    )
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
      argv: ['--canonical-only'],
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
            deviceId: '68E274BD2A58',
            productModel: 'pc-mini',
            mqttPrincipal: 'device-68E274BD2A58',
            firestore: {
              projectId: 'petcare-c7483',
              documentPath: 'devices/68E274BD2A58',
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
    expect(packageJson.scripts['emqx:development:verify']).toBeUndefined()
    expect(packageJson.scripts['emqx:development:verify:canonical']).toBe(
      'node deploy/development/verify-emqx-webhook.mjs --canonical-only',
    )
    expect(packageJson.scripts['emqx:development:verify:compatibility']).toBe(
      'node deploy/development/verify-emqx-webhook.mjs --compatibility',
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

  it('documents the reversible development-only compatibility lifecycle and SQL test matrix', () => {
    const runbook = readFileSync('deploy/development/EMQX_RUNBOOK.md', 'utf8')
    const integration = readFileSync('docs/mqtt-server-integration.md', 'utf8')

    for (const document of [runbook, integration]) {
      expect(document).toContain('development-only compatibility route')
      expect(document).toContain('PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE')
      expect(document).toContain('PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID')
      expect(document).toContain('PEECARE_APPROVED_LEGACY_MQTT_USERNAME')
      expect(document).toContain('Dashboard SQL Test')
      expect(document).toContain('approved Arduino publisher')
      expect(document).toContain('paired_shape_observed')
      expect(document).toContain('human_attestation_required')
      expect(document).toContain('不能證明 source provenance')
      expect(document).toContain('pumpSecondsToday is cumulative test data')
      expect(document).toContain('daily stats will be modified')
      expect(document).toContain('retries create distinct events')
      expect(document).toContain('disable the compatibility rule first')
      expect(document).toContain('remove the compatibility action, then the rule')
      expect(document).toContain('does not automatically delete Firestore data')
      expect(document).toContain('4294967.295')
      expect(document).toContain('4294967.296')
      expect(document).toContain('68E274BD2A58')
      expect(document).toContain('devices/68E274BD2A58')
      expect(document).toContain('compat:68E274BD2A58:')
      expect(document).toContain('PC-DEV-######')
      expect(document).toContain('developmentTestTool')
      expect(document).not.toContain('PC-DEV-000003')
    }

    expect(runbook).not.toContain('sentinel-approved-client')
    expect(runbook).not.toContain('sentinel-approved-username')
    expect(integration).not.toContain('sentinel-approved-client')
    expect(integration).not.toContain('sentinel-approved-username')
  })
})
