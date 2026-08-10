import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

const REVISION_FIELDS = Object.freeze([
  'deviceInventoryVersion',
  'emqxRuleVersion',
  'emqxActionVersion',
  'cloudRunImageDigest',
  'firebaseProjectId',
  'hostingVersion',
])

const OBSERVATION_FIELDS = Object.freeze([
  'layer',
  'observedAt',
  'statusCode',
  'requestId',
  'path',
  'hash',
])
const ASSERTION_FIELDS = Object.freeze(['name', 'passed', 'code'])

export class RealDeviceVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RealDeviceVerificationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new RealDeviceVerificationError(code, message)
}

function isSafeIdentifier(value, maximumLength = 256) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\r\n\0]/.test(value)
  )
}

function isTimestamp(value) {
  return isSafeIdentifier(value, 64) && !Number.isNaN(Date.parse(value))
}

function hasOnlyKeys(value, allowed, required = allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key))
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function validatedRevisionSet(value, label) {
  if (value === null || typeof value !== 'object') {
    fail('invalid_revision_set', `${label} revisions are required.`)
  }
  const revisions = {}
  for (const field of REVISION_FIELDS) {
    const revision = value[field]
    if (
      !isSafeIdentifier(revision)
    ) {
      fail('invalid_revision_set', `${label} ${field} must be a safe non-empty identifier.`)
    }
    revisions[field] = revision
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(revisions.cloudRunImageDigest)) {
    fail('invalid_revision_set', 'Cloud Run must be pinned to an immutable sha256 image digest.')
  }
  return revisions
}

function sanitizedObservation(value) {
  if (value === null || typeof value !== 'object') {
    fail('invalid_evidence', 'Each observation must be an object.')
  }
  return Object.fromEntries(
    OBSERVATION_FIELDS.filter((field) => value[field] !== undefined).map((field) => [
      field,
      value[field],
    ]),
  )
}

function sanitizedAssertion(value) {
  if (value === null || typeof value !== 'object') {
    fail('invalid_evidence', 'Each assertion must be an object.')
  }
  return Object.fromEntries(
    ASSERTION_FIELDS.filter((field) => value[field] !== undefined).map((field) => [
      field,
      value[field],
    ]),
  )
}

function containsSensitiveEvidence(serialized) {
  return (
    /(?:bearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|password|secret)\b)/i.test(
      serialized,
    ) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(serialized) ||
    /(?:^|["/])members\//i.test(serialized) ||
    /raw-member-uid/i.test(serialized) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(serialized)
  )
}

export function validateEvidenceBundle(bundle) {
  const topLevelFields = [
    'schemaVersion',
    'status',
    'startedAt',
    'completedAt',
    'domain',
    'preflight',
    'observations',
    'assertions',
    'cleanup',
    'failure',
  ]
  const requiredTopLevelFields = topLevelFields.slice(0, 8)
  if (
    !hasOnlyKeys(bundle, topLevelFields, requiredTopLevelFields) ||
    bundle.schemaVersion !== 1 ||
    !['passed', 'failed'].includes(bundle.status) ||
    !isTimestamp(bundle.startedAt) ||
    !isTimestamp(bundle.completedAt) ||
    !hasOnlyKeys(bundle.domain, ['deviceId', 'eventId']) ||
    !isSafeIdentifier(bundle.domain.deviceId, 128) ||
    !isSafeIdentifier(bundle.domain.eventId, 256) ||
    !hasOnlyKeys(bundle.preflight, ['capturedAt', ...REVISION_FIELDS]) ||
    !isTimestamp(bundle.preflight.capturedAt)
  ) {
    fail('invalid_evidence', 'Evidence does not match the required schema.')
  }
  validatedRevisionSet(bundle.preflight, 'Evidence preflight')

  if (
    !Array.isArray(bundle.observations) ||
    !bundle.observations.every(
      (observation) =>
        hasOnlyKeys(observation, OBSERVATION_FIELDS, ['layer', 'observedAt']) &&
        isSafeIdentifier(observation.layer, 64) &&
        isTimestamp(observation.observedAt) &&
        (observation.statusCode === undefined ||
          (Number.isInteger(observation.statusCode) &&
            observation.statusCode >= 100 &&
            observation.statusCode <= 599)) &&
        (observation.requestId === undefined || isSafeIdentifier(observation.requestId, 256)) &&
        (observation.path === undefined || isSafeIdentifier(observation.path, 512)) &&
        (observation.hash === undefined || /^sha256:[0-9a-f]{64}$/.test(observation.hash)),
    ) ||
    !Array.isArray(bundle.assertions) ||
    !bundle.assertions.every(
      (assertion) =>
        hasOnlyKeys(assertion, ASSERTION_FIELDS, ['name', 'passed']) &&
        isSafeIdentifier(assertion.name, 128) &&
        typeof assertion.passed === 'boolean' &&
        (assertion.code === undefined || isSafeIdentifier(assertion.code, 128)),
    )
  ) {
    fail('invalid_evidence', 'Evidence observations or assertions do not match the schema.')
  }

  if (
    (bundle.cleanup !== undefined &&
      (!hasOnlyKeys(bundle.cleanup, ['marker', 'paths', 'completed']) ||
        !isSafeIdentifier(bundle.cleanup.marker, 68) ||
        !Array.isArray(bundle.cleanup.paths) ||
        !bundle.cleanup.paths.every((path) => isSafeIdentifier(path, 512)) ||
        typeof bundle.cleanup.completed !== 'boolean')) ||
    (bundle.failure !== undefined &&
      (!hasOnlyKeys(bundle.failure, ['code']) || !isSafeIdentifier(bundle.failure.code, 128))) ||
    (bundle.status === 'failed' && bundle.failure === undefined) ||
    (bundle.status === 'passed' && bundle.failure !== undefined)
  ) {
    fail('invalid_evidence', 'Evidence cleanup or failure metadata does not match the schema.')
  }

  if (containsSensitiveEvidence(JSON.stringify(bundle))) {
    fail('evidence_sanitization_failed', 'Evidence contains credential or member-identifying data.')
  }
  return true
}

export function createSanitizedEvidenceBundle(input) {
  if (input === null || typeof input !== 'object') {
    fail('invalid_evidence', 'Evidence input is required.')
  }
  const bundle = {
    schemaVersion: 1,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    domain: { deviceId: input.deviceId, eventId: input.eventId },
    preflight: Object.fromEntries(
      ['capturedAt', ...REVISION_FIELDS].map((field) => [field, input.preflight?.[field]]),
    ),
    observations: Array.isArray(input.observations)
      ? input.observations.map(sanitizedObservation)
      : input.observations,
    assertions: Array.isArray(input.assertions)
      ? input.assertions.map(sanitizedAssertion)
      : input.assertions,
    ...(input.cleanup === undefined
      ? {}
      : {
          cleanup: {
            marker: input.cleanup?.marker,
            paths: Array.isArray(input.cleanup?.paths) ? [...input.cleanup.paths] : input.cleanup?.paths,
            completed: input.cleanup?.completed,
          },
        }),
    ...(input.failure === undefined ? {} : { failure: { code: input.failure?.code } }),
  }
  validateEvidenceBundle(bundle)
  return deepFreeze(bundle)
}

function correlationMismatch(message) {
  fail('correlation_mismatch', message)
}

function correlationObservation(layer, value) {
  return sanitizedObservation({
    layer,
    observedAt: value.observedAt,
    statusCode: value.statusCode,
    requestId: value.requestId,
    path: value.path,
    hash: value.hash,
  })
}

function evaluateUrinationCorrelation(snapshot, deviceId, eventId) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  const required = ['broker', 'cloudRun', 'events', 'projection', 'daily', 'web']
  if (required.some((field) => snapshot[field] === null || snapshot[field] === undefined)) {
    return null
  }
  if (!Array.isArray(snapshot.events) || snapshot.events.length === 0) return null
  if (snapshot.events.length !== 1) {
    fail('multiple_events', 'Correlation requires exactly one immutable Firestore event document.')
  }

  const [event] = snapshot.events
  for (const [layer, value] of [
    ['broker', snapshot.broker],
    ['cloud-run', snapshot.cloudRun],
    ['firestore-event', event],
    ['firestore-projection', snapshot.projection],
    ['web-history', snapshot.web],
  ]) {
    if (value?.eventId !== eventId) {
      correlationMismatch(`${layer} did not resolve the approved eventId.`)
    }
  }
  if (snapshot.broker.deliveryCount !== 1) {
    correlationMismatch('Broker delivery correlation must resolve exactly once.')
  }
  if (
    event.path !== `devices/${deviceId}/events/${eventId}` ||
    snapshot.projection.path !== `devices/${deviceId}`
  ) {
    correlationMismatch('Firestore evidence resolved outside the approved device path.')
  }
  if (
    !Number.isSafeInteger(snapshot.daily.urinationCount) ||
    snapshot.daily.urinationCount < 0 ||
    snapshot.web.dailyCount !== snapshot.daily.urinationCount
  ) {
    correlationMismatch('Firestore and Web daily counts do not match.')
  }

  return deepFreeze({
    observations: [
      correlationObservation('broker', snapshot.broker),
      correlationObservation('cloud-run', snapshot.cloudRun),
      correlationObservation('firestore-event', event),
      correlationObservation('firestore-projection', snapshot.projection),
      correlationObservation('firestore-daily', snapshot.daily),
      correlationObservation('web-history', snapshot.web),
    ],
    assertions: [
      { name: 'broker-event-correlation', passed: true },
      { name: 'cloud-run-event-correlation', passed: true },
      { name: 'single-firestore-event', passed: true },
      { name: 'latest-urination-projection', passed: true },
      { name: 'daily-count-observed', passed: true },
      { name: 'web-event-and-count-observed', passed: true },
    ],
  })
}

export async function observeUrinationCorrelation({
  deviceId,
  eventId,
  observationWindowMs,
  adapter,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (
    !isSafeIdentifier(deviceId, 128) ||
    !isSafeIdentifier(eventId, 256) ||
    !Number.isInteger(observationWindowMs) ||
    observationWindowMs <= 0 ||
    typeof adapter?.readCorrelation !== 'function' ||
    typeof now !== 'function' ||
    typeof wait !== 'function'
  ) {
    fail('invalid_observation', 'Correlation requires safe identities and a positive observation window.')
  }

  const deadline = now() + observationWindowMs
  while (true) {
    const result = evaluateUrinationCorrelation(
      await adapter.readCorrelation({ deviceId, eventId }),
      deviceId,
      eventId,
    )
    if (result) return result
    const remaining = deadline - now()
    if (remaining <= 0) {
      fail('observation_timeout', 'Urination correlation did not complete within the approved window.')
    }
    await wait(Math.min(250, remaining))
  }
}

function evaluateBatteryFlow(snapshot, deviceId, eventId) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  if (!Array.isArray(snapshot.events) || snapshot.events.length === 0) return null
  if (snapshot.projection === null || snapshot.projection === undefined || snapshot.web === null || snapshot.web === undefined) {
    return null
  }
  if (snapshot.events.length !== 1) {
    fail('multiple_events', 'Battery verification requires exactly one immutable event document.')
  }

  const [event] = snapshot.events
  const canonicalLevels = [0, 25, 50, 75, 100]
  const voltageIsValid =
    event.voltageMv === undefined ||
    event.voltageMv === null ||
    (Number.isInteger(event.voltageMv) && event.voltageMv >= 0)
  if (
    event.eventId !== eventId ||
    event.eventType !== 'battery' ||
    event.path !== `devices/${deviceId}/events/${eventId}` ||
    !canonicalLevels.includes(event.levelPercent) ||
    !voltageIsValid ||
    snapshot.projection.eventId !== eventId ||
    snapshot.projection.path !== `devices/${deviceId}` ||
    snapshot.projection.levelPercent !== event.levelPercent ||
    snapshot.projection.voltageMv !== event.voltageMv ||
    snapshot.web.eventId !== eventId ||
    snapshot.web.levelPercent !== event.levelPercent
  ) {
    fail('battery_mismatch', 'Battery event, projection, and Web overview are not a coherent tuple.')
  }

  return deepFreeze({
    observations: [
      correlationObservation('firestore-event', event),
      correlationObservation('firestore-projection', snapshot.projection),
      correlationObservation('web-overview', snapshot.web),
    ],
    assertions: [
      { name: 'single-immutable-battery-event', passed: true },
      { name: 'coherent-latest-battery-projection', passed: true },
      { name: 'web-battery-overview', passed: true },
    ],
  })
}

export async function observeBatteryFlow({
  deviceId,
  eventId,
  observationWindowMs,
  adapter,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (
    !isSafeIdentifier(deviceId, 128) ||
    !isSafeIdentifier(eventId, 256) ||
    !Number.isInteger(observationWindowMs) ||
    observationWindowMs <= 0 ||
    typeof adapter?.readBatteryFlow !== 'function' ||
    typeof now !== 'function' ||
    typeof wait !== 'function'
  ) {
    fail('invalid_observation', 'Battery verification requires safe identities and a positive window.')
  }

  const deadline = now() + observationWindowMs
  while (true) {
    const result = evaluateBatteryFlow(
      await adapter.readBatteryFlow({ deviceId, eventId }),
      deviceId,
      eventId,
    )
    if (result) return result
    const remaining = deadline - now()
    if (remaining <= 0) {
      fail('observation_timeout', 'Battery flow did not complete within the approved window.')
    }
    await wait(Math.min(250, remaining))
  }
}

function validatedDuplicateState(value) {
  const fields = ['eventCount', 'eventHash', 'projectionHash', 'dailyHash', 'dailyCount']
  if (
    !hasOnlyKeys(value, fields) ||
    value.eventCount !== 1 ||
    !/^sha256:[0-9a-f]{64}$/.test(value.eventHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(value.projectionHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(value.dailyHash) ||
    !Number.isSafeInteger(value.dailyCount) ||
    value.dailyCount < 0
  ) {
    fail('invalid_duplicate_snapshot', 'Replay snapshots must contain only validated state metadata.')
  }
  return value
}

export async function verifyDuplicateAndAcl({ deviceId, eventId, adapter }) {
  if (
    !isSafeIdentifier(deviceId, 128) ||
    !isSafeIdentifier(eventId, 256) ||
    typeof adapter?.readState !== 'function' ||
    typeof adapter?.replayCanonicalEvent !== 'function' ||
    typeof adapter?.publishUnauthorized !== 'function'
  ) {
    fail('invalid_duplicate_adapter', 'Replay verification requires safe identities and explicit adapters.')
  }

  const before = validatedDuplicateState(
    await adapter.readState({ deviceId, eventId }),
  )
  const [replay, acl] = await Promise.all([
    adapter.replayCanonicalEvent({ deviceId, eventId }),
    adapter.publishUnauthorized({ deviceId }),
  ])
  const after = validatedDuplicateState(
    await adapter.readState({ deviceId, eventId }),
  )

  if (replay?.statusCode !== 200 || replay.eventId !== eventId) {
    fail('duplicate_not_idempotent', 'Canonical replay must return HTTP 200 for the same eventId.')
  }
  if (!isDeepStrictEqual(before, after)) {
    fail('duplicate_changed_state', 'Canonical replay changed event, projection, or daily state.')
  }
  if (acl?.result !== 'denied') {
    fail('acl_not_denied', 'Unauthorized MQTT publish was not explicitly denied.')
  }
  if (!isTimestamp(replay.observedAt) || !isTimestamp(acl.observedAt)) {
    fail('invalid_observation', 'Replay and ACL observations require timestamps.')
  }

  return deepFreeze({
    observations: [
      correlationObservation('cloud-run', replay),
      correlationObservation('acl', acl),
    ],
    assertions: [
      { name: 'duplicate-response', passed: true },
      { name: 'duplicate-zero-writes', passed: true },
      { name: 'unauthorized-publish-denied', passed: true },
    ],
  })
}

function validatedCleanup(marker, cleanup) {
  if (
    cleanup === null ||
    typeof cleanup !== 'object' ||
    !Array.isArray(cleanup.paths) ||
    typeof cleanup.completed !== 'boolean' ||
    cleanup.paths.some(
      (path) =>
        !isSafeIdentifier(path, 512) ||
        path.startsWith('/') ||
        path.split('/').some((segment) => segment === '.' || segment === '..') ||
        !path.split('/').includes(marker),
    )
  ) {
    fail('unsafe_cleanup_scope', 'Cleanup must report only relative paths scoped to the exact run marker.')
  }
  return { marker, paths: [...cleanup.paths], completed: cleanup.completed }
}

export async function runVerificationWithEvidence({
  baseEvidence,
  marker,
  execute,
  cleanup,
  persistEvidence,
  completedAt = () => new Date().toISOString(),
}) {
  if (
    !/^rdv-[a-z0-9][a-z0-9-]{0,63}$/.test(marker ?? '') ||
    typeof execute !== 'function' ||
    typeof cleanup !== 'function' ||
    typeof persistEvidence !== 'function' ||
    typeof completedAt !== 'function'
  ) {
    fail('invalid_run_adapter', 'Evidence execution requires a safe marker and explicit adapters.')
  }

  let outcome
  let failureCode
  try {
    outcome = await execute()
  } catch (error) {
    failureCode =
      error instanceof RealDeviceVerificationError && isSafeIdentifier(error.code, 128)
        ? error.code
        : 'verification_failed'
  }

  const cleanupResult = validatedCleanup(marker, await cleanup({ marker }))
  const candidate = {
    ...baseEvidence,
    status: failureCode ? 'failed' : 'passed',
    completedAt: completedAt(),
    observations: failureCode ? [] : outcome?.observations,
    assertions: failureCode
      ? [{ name: 'verification-completed', passed: false, code: failureCode }]
      : outcome?.assertions,
    cleanup: cleanupResult,
    ...(failureCode ? { failure: { code: failureCode } } : {}),
  }

  let bundle
  try {
    bundle = createSanitizedEvidenceBundle(candidate)
  } catch (error) {
    if (
      !(error instanceof RealDeviceVerificationError) ||
      !['evidence_sanitization_failed', 'invalid_evidence'].includes(error.code)
    ) {
      throw error
    }
    bundle = createSanitizedEvidenceBundle({
      ...baseEvidence,
      status: 'failed',
      completedAt: candidate.completedAt,
      observations: [],
      assertions: [
        { name: 'verification-completed', passed: false, code: 'evidence_sanitization_failed' },
      ],
      cleanup: cleanupResult,
      failure: { code: 'evidence_sanitization_failed' },
    })
  }

  await persistEvidence(bundle)
  return bundle
}

function taipeiDayKey(epochMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epochMs)
  const part = (type) => parts.find((entry) => entry.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function dailyDocumentMap(documents) {
  if (!Array.isArray(documents)) {
    fail('invalid_exact_snapshot', 'Exact state requires all daily document metadata.')
  }
  const result = new Map()
  for (const document of documents) {
    if (
      !isSafeIdentifier(document?.path, 512) ||
      !/^sha256:[0-9a-f]{64}$/.test(document?.hash) ||
      !Number.isSafeInteger(document?.urinationCount) ||
      document.urinationCount < 0 ||
      result.has(document.path)
    ) {
      fail('invalid_exact_snapshot', 'Daily document metadata is malformed or duplicated.')
    }
    result.set(document.path, document)
  }
  return result
}

function exactDailyIncrement(beforeDocuments, afterDocuments, eventAtMs) {
  const before = dailyDocumentMap(beforeDocuments)
  const after = dailyDocumentMap(afterDocuments)
  const paths = new Set([...before.keys(), ...after.keys()])
  const changed = [...paths].filter(
    (path) => !isDeepStrictEqual(before.get(path), after.get(path)),
  )
  if (changed.length !== 1) return null
  const path = changed[0]
  const beforeDocument = before.get(path)
  const afterDocument = after.get(path)
  if (
    !afterDocument ||
    afterDocument.urinationCount !== (beforeDocument?.urinationCount ?? 0) + 1 ||
    !path.endsWith(`/dailyStats/${taipeiDayKey(eventAtMs)}`)
  ) {
    return null
  }
  return afterDocument
}

function coherentUrinationTuple(event, projection, deviceId, eventId) {
  return (
    event?.eventId === eventId &&
    event.path === `devices/${deviceId}/events/${eventId}` &&
    Number.isSafeInteger(event.effectiveAtMs) &&
    event.effectiveAtMs >= 0 &&
    Number.isSafeInteger(event.receivedAtMs) &&
    event.receivedAtMs >= event.effectiveAtMs &&
    projection?.eventId === eventId &&
    projection.path === `devices/${deviceId}` &&
    projection.atMs === event.effectiveAtMs &&
    projection.receivedAtMs === event.receivedAtMs
  )
}

function coherentBatteryTuple(event, projection, deviceId, eventId) {
  return (
    coherentUrinationTuple(event, projection, deviceId, eventId) &&
    [0, 25, 50, 75, 100].includes(event.levelPercent) &&
    projection.levelPercent === event.levelPercent &&
    projection.voltageMv === event.voltageMv &&
    (event.voltageMv === undefined ||
      event.voltageMv === null ||
      (Number.isInteger(event.voltageMv) && event.voltageMv >= 0))
  )
}

export async function verifyExactEventSideEffects({
  productModel,
  deviceId,
  urinationEventId,
  batteryEventId,
  adapter,
}) {
  const safeTopicSegment = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
  if (
    !safeTopicSegment(productModel) ||
    !safeTopicSegment(deviceId) ||
    !isSafeIdentifier(urinationEventId, 256) ||
    !isSafeIdentifier(batteryEventId, 256) ||
    urinationEventId === batteryEventId ||
    typeof adapter?.readExactState !== 'function' ||
    typeof adapter?.deliverUrination !== 'function' ||
    typeof adapter?.deliverBattery !== 'function'
  ) {
    fail('invalid_exact_adapter', 'Exact side-effect verification requires safe identities and adapters.')
  }

  const baseline = await adapter.readExactState({ deviceId, urinationEventId, batteryEventId })
  const urinationFirst = await adapter.deliverUrination({
    deviceId,
    eventId: urinationEventId,
  })
  const afterUrination = await adapter.readExactState({
    deviceId,
    urinationEventId,
    batteryEventId,
  })
  if (urinationFirst?.statusCode !== 201 || urinationFirst.eventId !== urinationEventId) {
    fail('urination_side_effect_mismatch', 'First urination delivery must return 201 for the eventId.')
  }
  if (
    baseline?.urinationEventCount !== 0 ||
    afterUrination?.urinationEventCount !== 1 ||
    !coherentUrinationTuple(
      afterUrination.urinationEvent,
      afterUrination.latestUrination,
      deviceId,
      urinationEventId,
    ) ||
    !isDeepStrictEqual(baseline.batteryEvent, afterUrination.batteryEvent) ||
    !isDeepStrictEqual(baseline.latestBattery, afterUrination.latestBattery)
  ) {
    fail('urination_side_effect_mismatch', 'Urination event or latest tuple is not exact.')
  }
  const changedDaily = exactDailyIncrement(
    baseline.dailyDocuments,
    afterUrination.dailyDocuments,
    afterUrination.urinationEvent.effectiveAtMs,
  )
  if (!changedDaily) {
    fail('urination_side_effect_mismatch', 'Exactly one Asia/Taipei daily document must increment by one.')
  }

  const urinationReplay = await adapter.deliverUrination({
    deviceId,
    eventId: urinationEventId,
  })
  const afterReplay = await adapter.readExactState({ deviceId, urinationEventId, batteryEventId })
  if (
    urinationReplay?.statusCode !== 200 ||
    urinationReplay.eventId !== urinationEventId ||
    !isDeepStrictEqual(afterUrination, afterReplay)
  ) {
    fail('duplicate_changed_state', 'Urination replay must return 200 with zero Firestore writes.')
  }

  const batteryTopic = `products/${productModel}/devices/${deviceId}/status/battery`
  const batteryFirst = await adapter.deliverBattery({
    productModel,
    deviceId,
    eventId: batteryEventId,
    topic: batteryTopic,
  })
  const afterBattery = await adapter.readExactState({ deviceId, urinationEventId, batteryEventId })
  if (
    batteryFirst?.statusCode !== 201 ||
    batteryFirst.eventId !== batteryEventId ||
    batteryFirst.topic !== batteryTopic ||
    afterReplay?.batteryEventCount !== 0 ||
    afterBattery?.batteryEventCount !== 1 ||
    !coherentBatteryTuple(
      afterBattery.batteryEvent,
      afterBattery.latestBattery,
      deviceId,
      batteryEventId,
    ) ||
    afterBattery.urinationEventCount !== afterReplay.urinationEventCount ||
    !isDeepStrictEqual(afterBattery.urinationEvent, afterReplay.urinationEvent) ||
    !isDeepStrictEqual(afterBattery.latestUrination, afterReplay.latestUrination)
  ) {
    fail('battery_side_effect_mismatch', 'Battery delivery did not create one coherent canonical snapshot.')
  }
  if (!isDeepStrictEqual(afterReplay.dailyDocuments, afterBattery.dailyDocuments)) {
    fail('battery_daily_changed', 'Battery delivery changed a daily urination document.')
  }

  return deepFreeze({
    observations: [
      correlationObservation('cloud-run', urinationFirst),
      correlationObservation('firestore-event', afterUrination.urinationEvent),
      correlationObservation('firestore-projection', afterUrination.latestUrination),
      correlationObservation('firestore-daily', changedDaily),
      correlationObservation('cloud-run', urinationReplay),
      correlationObservation('cloud-run', batteryFirst),
      correlationObservation('firestore-event', afterBattery.batteryEvent),
      correlationObservation('firestore-projection', afterBattery.latestBattery),
    ],
    assertions: [
      { name: 'urination-first-201', passed: true },
      { name: 'urination-event-and-latest-tuple', passed: true },
      { name: 'urination-daily-plus-one', passed: true },
      { name: 'urination-replay-200-zero-writes', passed: true },
      { name: 'battery-first-201-canonical-topic', passed: true },
      { name: 'battery-event-and-coherent-snapshot', passed: true },
      { name: 'battery-daily-byte-unchanged', passed: true },
    ],
  })
}

export async function verifyWebOwnerAccess({
  deviceId,
  eventId,
  expectedDailyCount,
  ownerMemberRef,
  nonOwnerMemberRef,
  adapter,
}) {
  const memberReferencePattern = /^auth-test-[a-z0-9][a-z0-9-]{0,63}$/
  if (
    !isSafeIdentifier(deviceId, 128) ||
    !isSafeIdentifier(eventId, 256) ||
    !Number.isSafeInteger(expectedDailyCount) ||
    expectedDailyCount < 0 ||
    !memberReferencePattern.test(ownerMemberRef ?? '') ||
    !memberReferencePattern.test(nonOwnerMemberRef ?? '') ||
    ownerMemberRef === nonOwnerMemberRef ||
    typeof adapter?.observeWeb !== 'function'
  ) {
    fail('invalid_web_members', 'Web verification requires two distinct approved Auth test members.')
  }

  const [owner, nonOwner] = await Promise.all([
    adapter.observeWeb({ authMemberRef: ownerMemberRef, deviceId }),
    adapter.observeWeb({ authMemberRef: nonOwnerMemberRef, deviceId }),
  ])
  const expectedPaths = {
    overview: `/devices/${deviceId}`,
    history: `/devices/${deviceId}/history`,
    stats: `/devices/${deviceId}/stats`,
  }
  if (
    owner?.overview?.status !== 'visible' ||
    owner.overview.eventId !== eventId ||
    owner.overview.path !== expectedPaths.overview ||
    owner?.history?.status !== 'visible' ||
    owner.history.path !== expectedPaths.history ||
    !Array.isArray(owner.history.eventIds) ||
    owner.history.eventIds.filter((value) => value === eventId).length !== 1 ||
    owner?.stats?.status !== 'visible' ||
    owner.stats.path !== expectedPaths.stats ||
    owner.stats.dailyCount !== expectedDailyCount
  ) {
    fail('owner_web_mismatch', 'Owner Web overview, history, or stats did not show the event exactly once.')
  }
  if (
    nonOwner?.visibleDeviceData !== false ||
    nonOwner?.overview?.status !== 'permission-denied' ||
    nonOwner.overview.path !== expectedPaths.overview ||
    nonOwner?.history?.status !== 'permission-denied' ||
    nonOwner.history.path !== expectedPaths.history ||
    nonOwner?.stats?.status !== 'permission-denied' ||
    nonOwner.stats.path !== expectedPaths.stats
  ) {
    fail('non_owner_not_denied', 'Non-owner routes must explicitly report permission-denied.')
  }

  const routes = [
    ['owner-web-overview', owner.overview],
    ['owner-web-history', owner.history],
    ['owner-web-stats', owner.stats],
    ['non-owner-web-overview', nonOwner.overview],
    ['non-owner-web-history', nonOwner.history],
    ['non-owner-web-stats', nonOwner.stats],
  ]
  if (routes.some(([, route]) => !isTimestamp(route.observedAt))) {
    fail('invalid_observation', 'Every hosted Web route observation requires a timestamp.')
  }

  return deepFreeze({
    observations: routes.map(([layer, route]) => correlationObservation(layer, route)),
    assertions: [
      { name: 'owner-overview-visible', passed: true },
      { name: 'owner-history-visible', passed: true },
      { name: 'owner-stats-visible', passed: true },
      { name: 'non-owner-overview-denied', passed: true },
      { name: 'non-owner-history-denied', passed: true },
      { name: 'non-owner-stats-denied', passed: true },
    ],
  })
}

export function verifyRequestCorrelation({
  deviceId,
  eventId,
  eventCount,
  eventPath,
  canonicalHash,
  deliveries,
}) {
  if (
    !isSafeIdentifier(deviceId, 128) ||
    !isSafeIdentifier(eventId, 256) ||
    eventCount !== 1 ||
    eventPath !== `devices/${deviceId}/events/${eventId}` ||
    !/^sha256:[0-9a-f]{64}$/.test(canonicalHash ?? '') ||
    !Array.isArray(deliveries) ||
    deliveries.length !== 2
  ) {
    fail('domain_correlation_mismatch', 'Domain evidence must resolve one canonical stored event.')
  }

  const [first, replay] = deliveries
  const requestIds = deliveries.map((delivery) => delivery?.requestId)
  if (
    first?.statusCode !== 201 ||
    replay?.statusCode !== 200 ||
    deliveries.some(
      (delivery) =>
        delivery?.eventId !== eventId ||
        !isSafeIdentifier(delivery.requestId, 256) ||
        !isTimestamp(delivery.observedAt),
    ) ||
    requestIds[0] === requestIds[1] ||
    requestIds.includes(eventId) ||
    requestIds.includes(deviceId)
  ) {
    fail(
      'request_correlation_mismatch',
      'First delivery and replay require distinct transport request IDs under one event identity.',
    )
  }

  return deepFreeze({
    domain: { deviceId, eventId },
    observations: [
      correlationObservation('cloud-run', first),
      correlationObservation('cloud-run', replay),
      correlationObservation('firestore-event', {
        observedAt: replay.observedAt,
        path: eventPath,
        hash: canonicalHash,
      }),
    ],
    assertions: [
      { name: 'distinct-transport-request-ids', passed: true },
      { name: 'single-domain-event-identity', passed: true },
      { name: 'single-stored-event', passed: true },
    ],
  })
}

export function runDryRunFixture({ now = () => new Date().toISOString() } = {}) {
  if (typeof now !== 'function') {
    fail('invalid_dry_run', 'Dry-run fixture requires a clock adapter.')
  }
  const timestamp = now()
  const deviceId = 'PC-DRY-RUN-001'
  const eventId = `${deviceId}:fixture-urination-1`
  const marker = 'rdv-dry-run-001'
  return createSanitizedEvidenceBundle({
    status: 'passed',
    startedAt: timestamp,
    completedAt: timestamp,
    deviceId,
    eventId,
    preflight: {
      capturedAt: timestamp,
      deviceInventoryVersion: 'fixture-inventory-1',
      emqxRuleVersion: 'fixture-rule-1',
      emqxActionVersion: 'fixture-action-1',
      cloudRunImageDigest: `sha256:${'0'.repeat(64)}`,
      firebaseProjectId: 'fixture-development',
      hostingVersion: 'fixture-hosting-1',
    },
    observations: [
      { layer: 'cloud-run', observedAt: timestamp, statusCode: 201, requestId: 'fixture-request-1' },
      { layer: 'cloud-run', observedAt: timestamp, statusCode: 200, requestId: 'fixture-request-2' },
      {
        layer: 'firestore-event',
        observedAt: timestamp,
        path: `devices/${deviceId}/events/${eventId}`,
        hash: `sha256:${'1'.repeat(64)}`,
      },
      {
        layer: 'firestore-daily',
        observedAt: timestamp,
        path: `devices/${deviceId}/dailyStats/fixture-day`,
        hash: `sha256:${'2'.repeat(64)}`,
      },
      { layer: 'web-overview', observedAt: timestamp, path: `/devices/${deviceId}` },
    ],
    assertions: [
      { name: 'dry-run-fixture', passed: true },
      { name: 'frozen-development-preflight', passed: true },
      { name: 'urination-first-201', passed: true },
      { name: 'urination-replay-200-zero-writes', passed: true },
      { name: 'battery-first-201-canonical-topic', passed: true },
      { name: 'battery-daily-byte-unchanged', passed: true },
      { name: 'unauthorized-publish-denied', passed: true },
      { name: 'owner-routes-visible', passed: true },
      { name: 'non-owner-routes-denied', passed: true },
      { name: 'distinct-transport-request-ids', passed: true },
      { name: 'marker-scoped-cleanup', passed: true },
    ],
    cleanup: {
      marker,
      paths: [`verificationMarkers/${marker}`],
      completed: true,
    },
  })
}

export async function freezeDevelopmentPreflight({
  approvedRevisions,
  inspectRevisions,
  capturedAt = () => new Date().toISOString(),
  next,
}) {
  if (typeof inspectRevisions !== 'function' || typeof capturedAt !== 'function') {
    fail('invalid_preflight_adapter', 'Preflight requires revision and clock adapters.')
  }
  if (next !== undefined && typeof next !== 'function') {
    fail('invalid_preflight_adapter', 'The physical trigger adapter must be callable.')
  }

  const approved = validatedRevisionSet(approvedRevisions, 'Approved')
  const inspected = validatedRevisionSet(await inspectRevisions(), 'Inspected')
  const driftedFields = REVISION_FIELDS.filter((field) => approved[field] !== inspected[field])
  if (driftedFields.length > 0) {
    fail('revision_drift', `Development preflight detected drift in ${driftedFields.join(', ')}.`)
  }

  const timestamp = capturedAt()
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    fail('invalid_preflight_timestamp', 'Preflight capture time must be an ISO timestamp.')
  }
  const snapshot = Object.freeze({ capturedAt: timestamp, ...inspected })
  if (next) await next(snapshot)
  return snapshot
}

function runCli() {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 1 || args[0] !== '--dry-run') {
      fail('dry_run_required', 'Use the explicit --dry-run fixture command.')
    }
    process.stdout.write(`${JSON.stringify(runDryRunFixture())}\n`)
  } catch (error) {
    const code =
      error instanceof RealDeviceVerificationError ? error.code : 'real_device_verification_failed'
    process.stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
