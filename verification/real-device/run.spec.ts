import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  RealDeviceVerificationError,
  createSanitizedEvidenceBundle,
  freezeDevelopmentPreflight,
  observeBatteryFlow,
  observeUrinationCorrelation,
  runDryRunFixture,
  runVerificationWithEvidence,
  validateEvidenceBundle,
  verifyDuplicateAndAcl,
  verifyExactEventSideEffects,
  verifyRequestCorrelation,
  verifyWebOwnerAccess,
} from './run.mjs'

const approvedRevisions = Object.freeze({
  deviceInventoryVersion: 'inventory-2026-08-11',
  emqxRuleVersion: 'rule-42',
  emqxActionVersion: 'action-17',
  cloudRunImageDigest: `sha256:${'a'.repeat(64)}`,
  firebaseProjectId: 'petcare-c7483',
  hostingVersion: 'sites/peecare-development/versions/123',
})

describe('real-device frozen development preflight', () => {
  it('records an immutable snapshot when every live component matches the approval', async () => {
    const inspectRevisions = vi.fn(async () => ({ ...approvedRevisions }))

    const snapshot = await freezeDevelopmentPreflight({
      approvedRevisions,
      inspectRevisions,
      capturedAt: () => '2026-08-11T08:00:00.000Z',
    })

    expect(snapshot).toEqual({
      capturedAt: '2026-08-11T08:00:00.000Z',
      ...approvedRevisions,
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(inspectRevisions).toHaveBeenCalledOnce()
  })

  it.each([
    ['device inventory', { deviceInventoryVersion: 'inventory-drifted' }],
    ['EMQX rule', { emqxRuleVersion: 'rule-drifted' }],
    ['EMQX action', { emqxActionVersion: 'action-drifted' }],
    ['Cloud Run image', { cloudRunImageDigest: `sha256:${'b'.repeat(64)}` }],
    ['Firebase project', { firebaseProjectId: 'another-project' }],
    ['Hosting version', { hostingVersion: 'sites/peecare-development/versions/999' }],
  ])('stops before the physical trigger when the %s drifts', async (_label, drift) => {
    const physicalTrigger = vi.fn()
    const inspectRevisions = vi
      .fn()
      .mockResolvedValueOnce({ ...approvedRevisions })
      .mockResolvedValueOnce({ ...approvedRevisions, ...drift })

    const snapshot = await freezeDevelopmentPreflight({
      approvedRevisions,
      inspectRevisions,
      capturedAt: () => '2026-08-11T08:00:00.000Z',
    })

    await expect(
      freezeDevelopmentPreflight({
        approvedRevisions: snapshot,
        inspectRevisions,
        capturedAt: () => '2026-08-11T08:01:00.000Z',
        next: physicalTrigger,
      }),
    ).rejects.toBeInstanceOf(RealDeviceVerificationError)
    await expect(
      freezeDevelopmentPreflight({
        approvedRevisions: snapshot,
        inspectRevisions: async () => ({ ...approvedRevisions, ...drift }),
        capturedAt: () => '2026-08-11T08:01:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'revision_drift' })
    expect(physicalTrigger).not.toHaveBeenCalled()
  })
})

describe('sanitized real-device evidence', () => {
  const input = {
    status: 'passed',
    startedAt: '2026-08-11T08:00:00.000Z',
    completedAt: '2026-08-11T08:02:00.000Z',
    deviceId: 'PC-DEV-0001',
    eventId: 'PC-DEV-0001:physical-42',
    preflight: { capturedAt: '2026-08-11T08:00:01.000Z', ...approvedRevisions },
    observations: [
      {
        layer: 'cloud-run',
        observedAt: '2026-08-11T08:01:00.000Z',
        statusCode: 201,
        requestId: 'request-1',
        path: 'devices/PC-DEV-0001/events/PC-DEV-0001:physical-42',
        hash: `sha256:${'c'.repeat(64)}`,
        canonicalPayload: { firmwareVersion: 'secret-payload-must-not-appear' },
        authorization: 'Bearer must-not-appear',
      },
    ],
    assertions: [{ name: 'event-cardinality', passed: true }],
    operatorEmail: 'owner@example.com',
    memberUid: 'raw-member-uid',
    accessToken: 'header.payload.signature',
  }

  it('creates an immutable schema-valid bundle from allowlisted metadata only', () => {
    const bundle = createSanitizedEvidenceBundle(input)

    expect(validateEvidenceBundle(bundle)).toBe(true)
    expect(Object.isFrozen(bundle)).toBe(true)
    expect(Object.isFrozen(bundle.observations)).toBe(true)
    expect(bundle).toEqual({
      schemaVersion: 1,
      status: 'passed',
      startedAt: '2026-08-11T08:00:00.000Z',
      completedAt: '2026-08-11T08:02:00.000Z',
      domain: { deviceId: 'PC-DEV-0001', eventId: 'PC-DEV-0001:physical-42' },
      preflight: input.preflight,
      observations: [
        {
          layer: 'cloud-run',
          observedAt: '2026-08-11T08:01:00.000Z',
          statusCode: 201,
          requestId: 'request-1',
          path: 'devices/PC-DEV-0001/events/PC-DEV-0001:physical-42',
          hash: `sha256:${'c'.repeat(64)}`,
        },
      ],
      assertions: [{ name: 'event-cardinality', passed: true }],
    })
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('canonicalPayload')
    expect(serialized).not.toContain('secret-payload-must-not-appear')
    expect(serialized).not.toContain('authorization')
    expect(serialized).not.toContain('Bearer')
    expect(serialized).not.toContain('owner@example.com')
    expect(serialized).not.toContain('raw-member-uid')
    expect(serialized).not.toContain('header.payload.signature')
  })

  it.each([
    ['credential', { ...input, observations: [{ layer: 'broker', observedAt: input.startedAt, requestId: 'Bearer leaked-token' }] }],
    ['email', { ...input, assertions: [{ name: 'owner@example.com', passed: true }] }],
    ['raw UID', { ...input, observations: [{ layer: 'web', observedAt: input.startedAt, path: 'members/raw-member-uid' }] }],
  ])('fails closed when allowlisted evidence values contain %s data', (_label, unsafeInput) => {
    expect(() => createSanitizedEvidenceBundle(unsafeInput)).toThrowError(
      expect.objectContaining({ code: 'evidence_sanitization_failed' }),
    )
  })

  it('ships a strict JSON schema with no top-level extension point', () => {
    const schema = JSON.parse(
      readFileSync(resolve(process.cwd(), 'verification/real-device/evidence.schema.json'), 'utf8'),
    )

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual([
      'schemaVersion',
      'status',
      'startedAt',
      'completedAt',
      'domain',
      'preflight',
      'observations',
      'assertions',
    ])
  })
})

describe('urination event ID end-to-end correlation', () => {
  const deviceId = 'PC-DEV-0001'
  const eventId = 'PC-DEV-0001:physical-42'
  const observedAt = '2026-08-11T08:01:00.000Z'

  function completeSnapshot() {
    return {
      broker: { eventId, deliveryCount: 1, observedAt },
      cloudRun: { eventId, statusCode: 201, requestId: 'request-1', observedAt },
      events: [
        {
          eventId,
          path: `devices/${deviceId}/events/${eventId}`,
          hash: `sha256:${'d'.repeat(64)}`,
          observedAt,
        },
      ],
      projection: {
        eventId,
        path: `devices/${deviceId}`,
        hash: `sha256:${'e'.repeat(64)}`,
        observedAt,
      },
      daily: {
        urinationCount: 5,
        path: `devices/${deviceId}/dailyStats/2026-08-11`,
        hash: `sha256:${'f'.repeat(64)}`,
        observedAt,
      },
      web: {
        eventId,
        dailyCount: 5,
        path: `/devices/${deviceId}/history`,
        observedAt,
      },
    }
  }

  it('polls until broker, Cloud Run, Firestore, daily count, and Web resolve one event', async () => {
    const readCorrelation = vi
      .fn()
      .mockResolvedValueOnce({ broker: null })
      .mockResolvedValueOnce(completeSnapshot())
    const wait = vi.fn(async () => undefined)
    let clock = 0

    const result = await observeUrinationCorrelation({
      deviceId,
      eventId,
      observationWindowMs: 1_000,
      adapter: { readCorrelation },
      now: () => (clock += 100),
      wait,
    })

    expect(readCorrelation).toHaveBeenCalledTimes(2)
    expect(readCorrelation).toHaveBeenCalledWith({ deviceId, eventId })
    expect(wait).toHaveBeenCalledOnce()
    expect(result.assertions).toEqual([
      { name: 'broker-event-correlation', passed: true },
      { name: 'cloud-run-event-correlation', passed: true },
      { name: 'single-firestore-event', passed: true },
      { name: 'latest-urination-projection', passed: true },
      { name: 'daily-count-observed', passed: true },
      { name: 'web-event-and-count-observed', passed: true },
    ])
    expect(result.observations.map(({ layer }) => layer)).toEqual([
      'broker',
      'cloud-run',
      'firestore-event',
      'firestore-projection',
      'firestore-daily',
      'web-history',
    ])
    expect(JSON.stringify(result)).not.toContain('canonicalPayload')
  })

  it('rejects multiple Firestore event documents instead of accepting ambiguous evidence', async () => {
    const snapshot = completeSnapshot()
    snapshot.events.push({
      ...snapshot.events[0],
      path: `devices/${deviceId}/events/duplicate-copy`,
    })

    await expect(
      observeUrinationCorrelation({
        deviceId,
        eventId,
        observationWindowMs: 1_000,
        adapter: { readCorrelation: async () => snapshot },
        now: () => 0,
        wait: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'multiple_events' })
  })

  it('times out with no successful evidence when a required layer never appears', async () => {
    let clock = 0

    await expect(
      observeUrinationCorrelation({
        deviceId,
        eventId,
        observationWindowMs: 200,
        adapter: { readCorrelation: async () => ({ broker: null }) },
        now: () => (clock += 100),
        wait: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'observation_timeout' })
  })
})

describe('real battery flow', () => {
  const deviceId = 'PC-DEV-0001'
  const eventId = 'PC-DEV-0001:battery-42'
  const observedAt = '2026-08-11T08:03:00.000Z'

  function batterySnapshot() {
    return {
      events: [
        {
          eventId,
          eventType: 'battery',
          levelPercent: 75,
          voltageMv: 3_975,
          path: `devices/${deviceId}/events/${eventId}`,
          hash: `sha256:${'1'.repeat(64)}`,
          observedAt,
        },
      ],
      projection: {
        eventId,
        levelPercent: 75,
        voltageMv: 3_975,
        path: `devices/${deviceId}`,
        hash: `sha256:${'2'.repeat(64)}`,
        observedAt,
      },
      web: {
        eventId,
        levelPercent: 75,
        path: `/devices/${deviceId}`,
        observedAt,
      },
    }
  }

  it('polls until the immutable event, coherent latest tuple, and Web overview agree', async () => {
    const readBatteryFlow = vi
      .fn()
      .mockResolvedValueOnce({ events: [] })
      .mockResolvedValueOnce(batterySnapshot())
    let clock = 0

    const result = await observeBatteryFlow({
      deviceId,
      eventId,
      observationWindowMs: 1_000,
      adapter: { readBatteryFlow },
      now: () => (clock += 100),
      wait: async () => undefined,
    })

    expect(readBatteryFlow).toHaveBeenCalledWith({ deviceId, eventId })
    expect(result.assertions).toEqual([
      { name: 'single-immutable-battery-event', passed: true },
      { name: 'coherent-latest-battery-projection', passed: true },
      { name: 'web-battery-overview', passed: true },
    ])
    expect(result.observations.map(({ layer }) => layer)).toEqual([
      'firestore-event',
      'firestore-projection',
      'web-overview',
    ])
  })

  it.each([
    ['event ID', { projection: { eventId: 'another-event' } }],
    ['level', { projection: { levelPercent: 50 } }],
    ['voltage', { projection: { voltageMv: 3_900 } }],
    ['Web level', { web: { levelPercent: 50 } }],
  ])('rejects a battery %s mismatch', async (_label, patch) => {
    const snapshot = batterySnapshot()
    if (patch.projection) Object.assign(snapshot.projection, patch.projection)
    if (patch.web) Object.assign(snapshot.web, patch.web)

    await expect(
      observeBatteryFlow({
        deviceId,
        eventId,
        observationWindowMs: 1_000,
        adapter: { readBatteryFlow: async () => snapshot },
        now: () => 0,
        wait: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'battery_mismatch' })
  })
})

describe('duplicate replay and ACL verification', () => {
  const deviceId = 'PC-DEV-0001'
  const eventId = 'PC-DEV-0001:physical-42'
  const state = {
    eventCount: 1,
    eventHash: `sha256:${'3'.repeat(64)}`,
    projectionHash: `sha256:${'4'.repeat(64)}`,
    dailyHash: `sha256:${'5'.repeat(64)}`,
    dailyCount: 5,
  }

  function duplicateAdapter(afterState = state, aclResult = 'denied') {
    const readState = vi
      .fn()
      .mockResolvedValueOnce(structuredClone(state))
      .mockResolvedValueOnce(structuredClone(afterState))
    return {
      readState,
      replayCanonicalEvent: vi.fn(async () => ({
        statusCode: 200,
        eventId,
        requestId: 'request-replay',
        observedAt: '2026-08-11T08:04:00.000Z',
      })),
      publishUnauthorized: vi.fn(async () => ({
        result: aclResult,
        observedAt: '2026-08-11T08:04:01.000Z',
      })),
    }
  }

  it('accepts a 200 replay with byte-identical state and an explicitly denied publish', async () => {
    const adapter = duplicateAdapter()

    const result = await verifyDuplicateAndAcl({ deviceId, eventId, adapter })

    expect(adapter.readState).toHaveBeenCalledTimes(2)
    expect(adapter.replayCanonicalEvent).toHaveBeenCalledWith({ deviceId, eventId })
    expect(adapter.publishUnauthorized).toHaveBeenCalledWith({ deviceId })
    expect(result).toEqual({
      observations: [
        {
          layer: 'cloud-run',
          observedAt: '2026-08-11T08:04:00.000Z',
          statusCode: 200,
          requestId: 'request-replay',
        },
        { layer: 'acl', observedAt: '2026-08-11T08:04:01.000Z' },
      ],
      assertions: [
        { name: 'duplicate-response', passed: true },
        { name: 'duplicate-zero-writes', passed: true },
        { name: 'unauthorized-publish-denied', passed: true },
      ],
    })
  })

  it('rejects replay when any event, projection, or daily metadata changes', async () => {
    await expect(
      verifyDuplicateAndAcl({
        deviceId,
        eventId,
        adapter: duplicateAdapter({ ...state, dailyCount: 6 }),
      }),
    ).rejects.toMatchObject({ code: 'duplicate_changed_state' })
  })

  it('fails closed unless the negative publish is explicitly denied', async () => {
    await expect(
      verifyDuplicateAndAcl({
        deviceId,
        eventId,
        adapter: duplicateAdapter(state, 'allowed'),
      }),
    ).rejects.toMatchObject({ code: 'acl_not_denied' })
  })
})

describe('explicit cleanup and failed evidence', () => {
  const baseEvidence = {
    startedAt: '2026-08-11T08:00:00.000Z',
    deviceId: 'PC-DEV-0001',
    eventId: 'PC-DEV-0001:physical-42',
    preflight: { capturedAt: '2026-08-11T08:00:01.000Z', ...approvedRevisions },
  }

  it('persists failed evidence and performs marker-only cleanup after timeout', async () => {
    const marker = 'rdv-20260811-001'
    const cleanup = vi.fn(async () => ({
      paths: [`verificationMarkers/${marker}`, `devices/PC-DEV-0001/testRuns/${marker}`],
      completed: true,
    }))
    const persistEvidence = vi.fn(async () => undefined)

    const result = await runVerificationWithEvidence({
      baseEvidence,
      marker,
      execute: async () => {
        throw new RealDeviceVerificationError('observation_timeout', 'Timed out')
      },
      cleanup,
      persistEvidence,
      completedAt: () => '2026-08-11T08:05:00.000Z',
    })

    expect(cleanup).toHaveBeenCalledWith({ marker })
    expect(result.status).toBe('failed')
    expect(result.failure).toEqual({ code: 'observation_timeout' })
    expect(result.cleanup).toEqual({
      marker,
      paths: [`verificationMarkers/${marker}`, `devices/PC-DEV-0001/testRuns/${marker}`],
      completed: true,
    })
    expect(result.assertions).toContainEqual({
      name: 'verification-completed',
      passed: false,
      code: 'observation_timeout',
    })
    expect(validateEvidenceBundle(result)).toBe(true)
    expect(persistEvidence).toHaveBeenCalledWith(result)
  })

  it.each([
    ['broad collection', ['devices']],
    ['path traversal', ['verificationMarkers/rdv-20260811-001/../another-run']],
    ['different marker', ['verificationMarkers/rdv-20260811-999']],
  ])('rejects %s cleanup output', async (_label, paths) => {
    await expect(
      runVerificationWithEvidence({
        baseEvidence,
        marker: 'rdv-20260811-001',
        execute: async () => ({ observations: [], assertions: [] }),
        cleanup: async () => ({ paths, completed: true }),
        persistEvidence: async () => undefined,
        completedAt: () => '2026-08-11T08:05:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'unsafe_cleanup_scope' })
  })
})

describe('exact urination and battery side effects', () => {
  const deviceId = 'PC-DEV-0001'
  const urinationEventId = 'PC-DEV-0001:physical-42'
  const batteryEventId = 'PC-DEV-0001:battery-42'
  const urinationEvent = {
    eventId: urinationEventId,
    path: `devices/${deviceId}/events/${urinationEventId}`,
    hash: `sha256:${'6'.repeat(64)}`,
    effectiveAtMs: 1_786_435_200_000,
    receivedAtMs: 1_786_435_200_100,
    observedAt: '2026-08-11T08:06:00.000Z',
  }
  const batteryEvent = {
    eventId: batteryEventId,
    path: `devices/${deviceId}/events/${batteryEventId}`,
    hash: `sha256:${'7'.repeat(64)}`,
    effectiveAtMs: 1_786_435_300_000,
    receivedAtMs: 1_786_435_300_100,
    levelPercent: 75,
    voltageMv: 3_975,
    observedAt: '2026-08-11T08:07:00.000Z',
  }
  const baseline = {
    urinationEventCount: 0,
    batteryEventCount: 0,
    urinationEvent: null,
    batteryEvent: null,
    latestUrination: null,
    latestBattery: null,
    dailyDocuments: [
      {
        path: `devices/${deviceId}/dailyStats/2026-08-11`,
        hash: `sha256:${'8'.repeat(64)}`,
        urinationCount: 4,
      },
    ],
  }
  const afterUrination = {
    ...baseline,
    urinationEventCount: 1,
    urinationEvent,
    latestUrination: {
      eventId: urinationEventId,
      atMs: urinationEvent.effectiveAtMs,
      receivedAtMs: urinationEvent.receivedAtMs,
      path: `devices/${deviceId}`,
      hash: `sha256:${'9'.repeat(64)}`,
      observedAt: '2026-08-11T08:06:01.000Z',
    },
    dailyDocuments: [
      {
        path: `devices/${deviceId}/dailyStats/2026-08-11`,
        hash: `sha256:${'a'.repeat(64)}`,
        urinationCount: 5,
        observedAt: '2026-08-11T08:06:01.000Z',
      },
    ],
  }
  const afterBattery = {
    ...afterUrination,
    batteryEventCount: 1,
    batteryEvent,
    latestBattery: {
      eventId: batteryEventId,
      atMs: batteryEvent.effectiveAtMs,
      receivedAtMs: batteryEvent.receivedAtMs,
      levelPercent: 75,
      voltageMv: 3_975,
      path: `devices/${deviceId}`,
      hash: `sha256:${'b'.repeat(64)}`,
      observedAt: '2026-08-11T08:07:01.000Z',
    },
  }

  function exactAdapter(states = [baseline, afterUrination, afterUrination, afterBattery]) {
    let read = 0
    return {
      readExactState: vi.fn(async () => structuredClone(states[Math.min(read++, states.length - 1)])),
      deliverUrination: vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 201,
          eventId: urinationEventId,
          requestId: 'request-urination-first',
          observedAt: '2026-08-11T08:06:00.000Z',
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          eventId: urinationEventId,
          requestId: 'request-urination-replay',
          observedAt: '2026-08-11T08:06:02.000Z',
        }),
      deliverBattery: vi.fn(async ({ topic }) => ({
        statusCode: 201,
        eventId: batteryEventId,
        requestId: 'request-battery-first',
        topic,
        observedAt: '2026-08-11T08:07:00.000Z',
      })),
    }
  }

  it('verifies exact first delivery, replay, battery tuple, and daily transitions', async () => {
    const adapter = exactAdapter()

    const result = await verifyExactEventSideEffects({
      productModel: 'pc-mini',
      deviceId,
      urinationEventId,
      batteryEventId,
      adapter,
    })

    expect(adapter.deliverUrination).toHaveBeenNthCalledWith(1, { deviceId, eventId: urinationEventId })
    expect(adapter.deliverUrination).toHaveBeenNthCalledWith(2, { deviceId, eventId: urinationEventId })
    expect(adapter.deliverBattery).toHaveBeenCalledWith({
      productModel: 'pc-mini',
      deviceId,
      eventId: batteryEventId,
      topic: `products/pc-mini/devices/${deviceId}/status/battery`,
    })
    expect(result.assertions).toEqual([
      { name: 'urination-first-201', passed: true },
      { name: 'urination-event-and-latest-tuple', passed: true },
      { name: 'urination-daily-plus-one', passed: true },
      { name: 'urination-replay-200-zero-writes', passed: true },
      { name: 'battery-first-201-canonical-topic', passed: true },
      { name: 'battery-event-and-coherent-snapshot', passed: true },
      { name: 'battery-daily-byte-unchanged', passed: true },
    ])
  })

  it.each([
    ['daily increment', { ...afterUrination, dailyDocuments: [{ ...afterUrination.dailyDocuments[0], urinationCount: 6 }] }, 'urination_side_effect_mismatch'],
    ['replay write', { ...afterUrination, latestUrination: { ...afterUrination.latestUrination, hash: `sha256:${'c'.repeat(64)}` } }, 'duplicate_changed_state'],
    ['battery daily write', { ...afterBattery, dailyDocuments: [{ ...afterBattery.dailyDocuments[0], hash: `sha256:${'d'.repeat(64)}` }] }, 'battery_daily_changed'],
  ])('rejects an exact-side-effect %s mismatch', async (_label, changedState, code) => {
    const states =
      code === 'urination_side_effect_mismatch'
        ? [baseline, changedState, changedState, afterBattery]
        : code === 'duplicate_changed_state'
          ? [baseline, afterUrination, changedState, afterBattery]
          : [baseline, afterUrination, afterUrination, changedState]

    await expect(
      verifyExactEventSideEffects({
        productModel: 'pc-mini',
        deviceId,
        urinationEventId,
        batteryEventId,
        adapter: exactAdapter(states),
      }),
    ).rejects.toMatchObject({ code })
  })
})

describe('owner-visible and non-owner-denied Web result', () => {
  const deviceId = 'PC-DEV-0001'
  const eventId = 'PC-DEV-0001:physical-42'
  const observedAt = '2026-08-11T08:08:00.000Z'
  const ownerResult = {
    overview: { status: 'visible', eventId, path: `/devices/${deviceId}`, observedAt },
    history: { status: 'visible', eventIds: [eventId], path: `/devices/${deviceId}/history`, observedAt },
    stats: { status: 'visible', dailyCount: 5, path: `/devices/${deviceId}/stats`, observedAt },
  }
  const deniedResult = {
    overview: { status: 'permission-denied', path: `/devices/${deviceId}`, observedAt },
    history: { status: 'permission-denied', path: `/devices/${deviceId}/history`, observedAt },
    stats: { status: 'permission-denied', path: `/devices/${deviceId}/stats`, observedAt },
    visibleDeviceData: false,
  }

  it('uses distinct Auth members and emits only route-level owner/denial evidence', async () => {
    const observeWeb = vi
      .fn()
      .mockResolvedValueOnce(ownerResult)
      .mockResolvedValueOnce(deniedResult)

    const result = await verifyWebOwnerAccess({
      deviceId,
      eventId,
      expectedDailyCount: 5,
      ownerMemberRef: 'auth-test-owner',
      nonOwnerMemberRef: 'auth-test-non-owner',
      adapter: { observeWeb },
    })

    expect(observeWeb).toHaveBeenCalledWith({ authMemberRef: 'auth-test-owner', deviceId })
    expect(observeWeb).toHaveBeenCalledWith({ authMemberRef: 'auth-test-non-owner', deviceId })
    expect(result.assertions).toEqual([
      { name: 'owner-overview-visible', passed: true },
      { name: 'owner-history-visible', passed: true },
      { name: 'owner-stats-visible', passed: true },
      { name: 'non-owner-overview-denied', passed: true },
      { name: 'non-owner-history-denied', passed: true },
      { name: 'non-owner-stats-denied', passed: true },
    ])
    expect(JSON.stringify(result)).not.toContain('auth-test-owner')
    expect(JSON.stringify(result)).not.toContain('auth-test-non-owner')
  })

  it('rejects an empty non-owner view when permission denial was not observed', async () => {
    const observeWeb = vi
      .fn()
      .mockResolvedValueOnce(ownerResult)
      .mockResolvedValueOnce({
        overview: { status: 'empty', path: `/devices/${deviceId}`, observedAt },
        history: { status: 'empty', path: `/devices/${deviceId}/history`, observedAt },
        stats: { status: 'empty', path: `/devices/${deviceId}/stats`, observedAt },
        visibleDeviceData: false,
      })

    await expect(
      verifyWebOwnerAccess({
        deviceId,
        eventId,
        expectedDailyCount: 5,
        ownerMemberRef: 'auth-test-owner',
        nonOwnerMemberRef: 'auth-test-non-owner',
        adapter: { observeWeb },
      }),
    ).rejects.toMatchObject({ code: 'non_owner_not_denied' })
  })

  it('rejects reused Auth identity references before opening hosted routes', async () => {
    const observeWeb = vi.fn()

    await expect(
      verifyWebOwnerAccess({
        deviceId,
        eventId,
        expectedDailyCount: 5,
        ownerMemberRef: 'auth-test-owner',
        nonOwnerMemberRef: 'auth-test-owner',
        adapter: { observeWeb },
      }),
    ).rejects.toMatchObject({ code: 'invalid_web_members' })
    expect(observeWeb).not.toHaveBeenCalled()
  })
})

describe('domain and request correlation separation', () => {
  const deviceId = 'PC-DEV-0001'
  const eventId = 'PC-DEV-0001:physical-42'

  it('keeps two transport requests under one domain identity and stored event', () => {
    const result = verifyRequestCorrelation({
      deviceId,
      eventId,
      eventCount: 1,
      eventPath: `devices/${deviceId}/events/${eventId}`,
      canonicalHash: `sha256:${'e'.repeat(64)}`,
      deliveries: [
        {
          statusCode: 201,
          eventId,
          requestId: 'request-first',
          observedAt: '2026-08-11T08:09:00.000Z',
          canonicalPayload: { mustNotAppear: true },
        },
        {
          statusCode: 200,
          eventId,
          requestId: 'request-replay',
          observedAt: '2026-08-11T08:09:01.000Z',
          canonicalPayload: { mustNotAppear: true },
        },
      ],
    })

    expect(result.domain).toEqual({ deviceId, eventId })
    expect(result.observations).toEqual([
      {
        layer: 'cloud-run',
        observedAt: '2026-08-11T08:09:00.000Z',
        statusCode: 201,
        requestId: 'request-first',
      },
      {
        layer: 'cloud-run',
        observedAt: '2026-08-11T08:09:01.000Z',
        statusCode: 200,
        requestId: 'request-replay',
      },
      {
        layer: 'firestore-event',
        observedAt: '2026-08-11T08:09:01.000Z',
        path: `devices/${deviceId}/events/${eventId}`,
        hash: `sha256:${'e'.repeat(64)}`,
      },
    ])
    expect(result.assertions).toEqual([
      { name: 'distinct-transport-request-ids', passed: true },
      { name: 'single-domain-event-identity', passed: true },
      { name: 'single-stored-event', passed: true },
    ])
    expect(JSON.stringify(result)).not.toContain('canonicalPayload')
    expect(JSON.stringify(result)).not.toContain('mustNotAppear')
  })

  it.each([
    ['same request ID', ['request-1', 'request-1'], 'request_correlation_mismatch'],
    ['event ID used as request ID', [eventId, 'request-2'], 'request_correlation_mismatch'],
  ])('rejects %s', (_label, requestIds, code) => {
    expect(() =>
      verifyRequestCorrelation({
        deviceId,
        eventId,
        eventCount: 1,
        eventPath: `devices/${deviceId}/events/${eventId}`,
        canonicalHash: `sha256:${'e'.repeat(64)}`,
        deliveries: requestIds.map((requestId, index) => ({
          statusCode: index === 0 ? 201 : 200,
          eventId,
          requestId,
          observedAt: `2026-08-11T08:09:0${index}.000Z`,
        })),
      }),
    ).toThrowError(expect.objectContaining({ code }))
  })
})

describe('real-device dry-run fixture and operator handoff', () => {
  it('produces one schema-valid fixture covering every acceptance gate', () => {
    const result = runDryRunFixture({ now: () => '2026-08-11T08:10:00.000Z' })

    expect(validateEvidenceBundle(result)).toBe(true)
    expect(result.domain).toEqual({
      deviceId: 'PC-DRY-RUN-001',
      eventId: 'PC-DRY-RUN-001:fixture-urination-1',
    })
    expect(result.assertions.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'dry-run-fixture',
        'frozen-development-preflight',
        'urination-first-201',
        'urination-replay-200-zero-writes',
        'battery-first-201-canonical-topic',
        'battery-daily-byte-unchanged',
        'unauthorized-publish-denied',
        'owner-routes-visible',
        'non-owner-routes-denied',
        'distinct-transport-request-ids',
        'marker-scoped-cleanup',
      ]),
    )
    expect(JSON.stringify(result)).not.toMatch(/canonicalPayload|Bearer|@|memberUid/)
  })

  it('registers the dry-run command and documents the physical operator checkpoints', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const readme = readFileSync(
      resolve(process.cwd(), 'verification/real-device/README.md'),
      'utf8',
    )

    expect(packageJson.scripts['real-device:development:dry-run']).toBe(
      'node verification/real-device/run.mjs --dry-run',
    )
    expect(readme).toContain('npm run real-device:development:dry-run')
    expect(readme).toContain('Capture the device-produced `eventId`')
    expect(readme).toContain('Never paste credentials or canonical payloads')
    expect(readme).toContain('Owner and non-owner')
    expect(readme).toContain('marker-scoped cleanup')
  })
})
