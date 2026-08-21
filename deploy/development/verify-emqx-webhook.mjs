import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCurrentPasswordFromInteractiveTty } from '../../devices/development/credential-lifecycle.mjs'
import { validateDeviceInventory } from '../../devices/development/device-configuration.mjs'
import { createMqtt5TlsProbe } from '../../devices/development/verify-device-acl.mjs'

const APPROVED_PROJECT = 'petcare-c7483'
const APPROVED_REGION = 'asia-east1'
const APPROVED_MQTT_HOST = 'd1f775fd.ala.asia-southeast1.emqxsl.com'
const SECRET_REFERENCE_PATTERN =
  /^projects\/(?:petcare-c7483|348528459946)\/secrets\/peecare-emqx-webhook-current\/versions\/[1-9][0-9]*$/
const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const COMPATIBILITY_TARGET_DEVICE_ID = '68E274BD2A58'
const COMPATIBILITY_TARGET_PRODUCT_MODEL = 'pc-mini'
const COMPATIBILITY_TARGET_TOPIC =
  'products/pc-mini/devices/68E274BD2A58/events/urination'
const COMPATIBILITY_BATTERY_TARGET_TOPIC =
  'products/pc-mini/devices/68E274BD2A58/status/battery'
const COMPATIBILITY_EVENT_ID_PATTERN =
  /^compat:68E274BD2A58:[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/
const COMPATIBILITY_BATTERY_EVENT_ID_PATTERN =
  /^compatbattery:68E274BD2A58:[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/
const MAX_COMPATIBILITY_PUMP_SECONDS = 4_294_967.295
const MAX_COMPATIBILITY_BATTERY_VOLTS = 20

export class EmqxWebhookVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'EmqxWebhookVerificationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new EmqxWebhookVerificationError(code, message)
}

function validatedMqttEndpoint(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail('unsafe_mqtt_endpoint', 'MQTT URL must be a credential-free mqtts endpoint.')
  }
  if (
    url.protocol !== 'mqtts:' ||
    url.port !== '8883' ||
    url.hostname !== APPROVED_MQTT_HOST ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    fail('unsafe_mqtt_endpoint', 'MQTT URL must be a credential-free mqtts endpoint.')
  }
  return url.href
}

function validateMqttIdentity(deviceId, username, password) {
  if (
    typeof deviceId !== 'string' ||
    !TOPIC_SEGMENT_PATTERN.test(deviceId) ||
    username !== `device-${deviceId}` ||
    typeof password !== 'string' ||
    password.length === 0
  ) {
    fail('device_credential_precondition_unmet', 'Registered device credentials are required.')
  }
}

function validateDocumentIdentity(deviceId, eventId) {
  if (
    typeof deviceId !== 'string' ||
    !TOPIC_SEGMENT_PATTERN.test(deviceId) ||
    typeof eventId !== 'string' ||
    eventId.length < 1 ||
    eventId.length > 128 ||
    /[\/\0]/.test(eventId)
  ) {
    fail('invalid_probe_identity', 'Firestore probe identity is missing or unsafe.')
  }
}

export function createEmqxWebhookVerificationAdapter({
  mqttUrl,
  deviceId,
  username,
  password,
  projectId,
  mqttProbe = createMqtt5TlsProbe(),
  firestore,
  compatibilityOnly = false,
}) {
  const validatedMqttUrl = compatibilityOnly
    ? undefined
    : validatedMqttEndpoint(mqttUrl)
  if (!compatibilityOnly) validateMqttIdentity(deviceId, username, password)
  if (projectId !== APPROVED_PROJECT) {
    fail('target_mismatch', 'Firestore project must match the approved development project.')
  }
  if (!compatibilityOnly && typeof mqttProbe !== 'function') {
    fail('invalid_verification_adapter', 'Verification adapter dependencies are invalid.')
  }
  const firestorePromise = firestore
    ? Promise.resolve(firestore)
    : import('@google-cloud/firestore').then(
        ({ Firestore }) => new Firestore({ projectId }),
      )

  return Object.freeze({
    async publishProbe({ topic, qos, payload }) {
      if (compatibilityOnly) {
        fail(
          'invalid_verification_adapter',
          'Compatibility-only verification cannot publish MQTT probes.',
        )
      }
      if (
        typeof topic !== 'string' ||
        topic.length < 1 ||
        topic.length > 512 ||
        ![0, 1, 2].includes(qos) ||
        payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        typeof payload.deviceId !== 'string' ||
        !TOPIC_SEGMENT_PATTERN.test(payload.deviceId)
      ) {
        fail('invalid_probe', 'MQTT probe is malformed.')
      }
      let outcome
      try {
        outcome = await mqttProbe({
          operation: 'publish',
          mqttUrl: validatedMqttUrl,
          deviceId,
          username,
          password,
          topic,
          qos,
          retained: false,
          payload,
        })
      } catch (error) {
        if (typeof error?.code === 'string') throw error
        fail('mqtt_publish_failed', 'MQTT probe failed.')
      }
      if (outcome === 'allowed') return 'accepted'
      if (outcome === 'denied') return 'rejected'
      if (outcome === 'closed') return 'ambiguous'
      fail('invalid_verification_adapter', 'MQTT probe returned an invalid outcome.')
    },

    async readEventDocument({ deviceId, eventId }) {
      validateDocumentIdentity(deviceId, eventId)
      try {
        const client = await firestorePromise
        const snapshot = await client
          .doc(`devices/${deviceId}/events/${eventId}`)
          .get()
        return Object.freeze({ count: snapshot.exists ? 1 : 0 })
      } catch {
        fail('firestore_read_failed', 'Unable to read the probe event document.')
      }
    },

    async readDeviceRegistry({ deviceId: registryDeviceId }) {
      if (registryDeviceId !== COMPATIBILITY_TARGET_DEVICE_ID) {
        fail('invalid_probe_identity', 'Compatibility registry identity is invalid.')
      }
      try {
        const client = await firestorePromise
        const snapshot = await client.doc(`devices/${registryDeviceId}`).get()
        return snapshot.exists ? Object.freeze({ ...snapshot.data() }) : null
      } catch {
        fail('firestore_read_failed', 'Unable to read the compatibility registry.')
      }
    },

    async readCompatibilityEvents({ deviceId: eventDeviceId, createdAfterMs }) {
      if (
        eventDeviceId !== COMPATIBILITY_TARGET_DEVICE_ID ||
        !Number.isSafeInteger(createdAfterMs) ||
        createdAfterMs < 0
      ) {
        fail('invalid_probe_identity', 'Compatibility event query is invalid.')
      }
      try {
        const client = await firestorePromise
        const snapshot = await client
          .collection(`devices/${eventDeviceId}/events`)
          .where('createdAtMs', '>', createdAfterMs)
          .orderBy('createdAtMs', 'asc')
          .get()
        return Object.freeze(
          snapshot.docs.map((document) =>
            Object.freeze({ ...document.data(), eventId: document.id }),
          ),
        )
      } catch {
        fail('firestore_read_failed', 'Unable to read compatibility event evidence.')
      }
    },
  })
}

function validateEnvironment(environment) {
  if (
    environment?.PEECARE_DEVELOPMENT_PROJECT_ID !== APPROVED_PROJECT ||
    environment?.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== APPROVED_REGION
  ) {
    fail('target_mismatch', 'Verification inventory must match development project and region.')
  }
  const currentReference = environment.PEECARE_INGESTION_SECRET_CURRENT_REF
  const previousReference = environment.PEECARE_INGESTION_SECRET_PREVIOUS_REF
  if (
    typeof currentReference !== 'string' ||
    !SECRET_REFERENCE_PATTERN.test(currentReference)
  ) {
    fail('invalid_secret_reference', 'A numeric current ingestion secret reference is required.')
  }
  if (
    previousReference !== undefined &&
    (typeof previousReference !== 'string' ||
      !SECRET_REFERENCE_PATTERN.test(previousReference) ||
      previousReference.split('/').at(-1) === currentReference.split('/').at(-1))
  ) {
    fail('invalid_rotation_references', 'Previous ingestion secret reference is invalid.')
  }
  const deviceId = environment.PEECARE_DEVELOPMENT_DEVICE_ID
  const productModel = environment.PEECARE_DEVELOPMENT_PRODUCT_MODEL
  if (
    typeof deviceId !== 'string' ||
    typeof productModel !== 'string' ||
    !TOPIC_SEGMENT_PATTERN.test(deviceId) ||
    !TOPIC_SEGMENT_PATTERN.test(productModel)
  ) {
    fail('invalid_probe_identity', 'Probe device identity is missing or unsafe.')
  }
  return Object.freeze({
    deviceId,
    productModel,
    rotation:
      previousReference === undefined
        ? Object.freeze({
            status: 'precondition_unmet',
            code: 'previous_secret_not_deployed',
          })
        : Object.freeze({ status: 'precondition_satisfied' }),
  })
}

function eventPayload(eventType, deviceId, timestamp, runId, sequence, eventIdLabel = eventType) {
  const common = {
    schemaVersion: 1,
    eventId: `emqx-e2e-${eventIdLabel}-${timestamp}-${runId}`,
    eventType,
    deviceId,
    sequence,
    recordedAtMs: timestamp - 1_000,
    firmwareVersion: '1.0.0',
  }
  return eventType === 'urination'
    ? { ...common, flushDurationMs: 1_000, pumpDurationMs: 2_000 }
    : { ...common, batteryLevelPercent: 75, batteryVoltageMv: 3_975 }
}

function assertDocumentCount(result) {
  if (!result || !Number.isSafeInteger(result.count) || result.count < 0) {
    fail('invalid_firestore_result', 'Firestore adapter returned an invalid document count.')
  }
  return result.count
}

function isBoundedCompatibilityIdentity(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value)
  )
}

function validateCompatibilityMode(compatibility) {
  if (compatibility === undefined || compatibility?.enabled === false) {
    return Object.freeze({ enabled: false })
  }
  if (compatibility?.enabled !== true) {
    fail(
      'compatibility_precondition_unmet',
      'Compatibility verification mode must be explicitly enabled or disabled.',
    )
  }
  const expectedPumpSecondsToday = compatibility.expectedPumpSecondsToday
  const expectedBatteryV = compatibility.expectedBatteryV
  const expectedQos = compatibility.expectedQos ?? 0
  if (
    !isBoundedCompatibilityIdentity(compatibility.approvedClientId) ||
    !isBoundedCompatibilityIdentity(compatibility.approvedUsername) ||
    typeof expectedPumpSecondsToday !== 'number' ||
    !Number.isFinite(expectedPumpSecondsToday) ||
    expectedPumpSecondsToday < 0 ||
    expectedPumpSecondsToday > MAX_COMPATIBILITY_PUMP_SECONDS ||
    typeof expectedBatteryV !== 'number' ||
    !Number.isFinite(expectedBatteryV) ||
    expectedBatteryV < 0 ||
    expectedBatteryV > MAX_COMPATIBILITY_BATTERY_VOLTS ||
    ![0, 1, 2].includes(expectedQos)
  ) {
    fail(
      'compatibility_precondition_unmet',
      'Enabled compatibility verification requires bounded source identity and delivery values.',
    )
  }
  return Object.freeze({
    enabled: true,
    approvedClientId: compatibility.approvedClientId,
    approvedUsername: compatibility.approvedUsername,
    expectedPumpDurationMs: Math.round(expectedPumpSecondsToday * 1_000),
    expectedBatteryVoltageMv: Math.round(expectedBatteryV * 1_000),
    expectedBatteryLevelPercent:
      expectedBatteryV >= 8.5
        ? 100
        : expectedBatteryV >= 8.0
          ? 75
          : expectedBatteryV >= 7.5
            ? 50
            : expectedBatteryV >= 7.0
              ? 25
              : 0,
    expectedQos,
  })
}

function assertCompatibilityRegistry(registry) {
  if (
    !registry ||
    registry.deviceId !== COMPATIBILITY_TARGET_DEVICE_ID ||
    registry.productModel !== COMPATIBILITY_TARGET_PRODUCT_MODEL ||
    registry.ingestionStatus !== 'enabled'
  ) {
    fail(
      'compatibility_registry_mismatch',
      'Compatibility target registry does not match the enabled development device.',
    )
  }
}

function hasCommonCompatibilityFields(event, startedAtMs) {
  return (
    event?.deviceId === COMPATIBILITY_TARGET_DEVICE_ID &&
    event.productModel === COMPATIBILITY_TARGET_PRODUCT_MODEL &&
    event.schemaVersion === 1 &&
    event.sequence === 1 &&
    event.firmwareVersion === '1.0.0' &&
    Number.isSafeInteger(event.brokerReceivedAtMs) &&
    event.recordedAtMs === event.brokerReceivedAtMs &&
    Number.isSafeInteger(event.createdAtMs) &&
    event.createdAtMs > startedAtMs &&
    event.transport?.clientId === COMPATIBILITY_TARGET_DEVICE_ID
  )
}

function assertCompatibilityUrinationEvent(event, compatibility, startedAtMs) {
  if (
    !COMPATIBILITY_EVENT_ID_PATTERN.test(event.eventId) ||
    !hasCommonCompatibilityFields(event, startedAtMs) ||
    event.eventType !== 'urination' ||
    event.flushDurationMs !== 0 ||
    event.pumpDurationMs !== compatibility.expectedPumpDurationMs ||
    event.transport?.topic !== COMPATIBILITY_TARGET_TOPIC ||
    event.transport?.username !== compatibility.approvedUsername ||
    event.transport?.qos !== compatibility.expectedQos
  ) {
    fail(
      'compatibility_urination_field_mismatch',
      'Compatibility Urination evidence does not match the declared delivery.',
    )
  }
}

function assertCompatibilityBatteryEvent(event, compatibility, startedAtMs) {
  if (
    !COMPATIBILITY_BATTERY_EVENT_ID_PATTERN.test(event.eventId) ||
    !hasCommonCompatibilityFields(event, startedAtMs) ||
    event.eventType !== 'battery' ||
    event.batteryVoltageMv !== compatibility.expectedBatteryVoltageMv ||
    event.batteryLevelPercent !== compatibility.expectedBatteryLevelPercent ||
    event.transport?.topic !== COMPATIBILITY_BATTERY_TARGET_TOPIC ||
    event.transport?.username !== 'Peecare' ||
    event.transport?.qos !== compatibility.expectedQos
  ) {
    fail(
      'compatibility_battery_field_mismatch',
      'Compatibility Battery evidence does not match the declared delivery.',
    )
  }
}

function compatibilityEventGroup(event) {
  if (typeof event?.eventId === 'string') {
    if (event.eventId.startsWith('compatbattery:')) return 'battery'
    if (event.eventId.startsWith('compat:')) return 'urination'
  }
  return 'unknown'
}

async function expectCompatibilityDelivery({
  adapter,
  compatibility,
  startedAtMs,
  pollAttempts,
  pollIntervalMs,
  wait,
}) {
  let registry
  try {
    registry = await adapter.readDeviceRegistry({
      deviceId: COMPATIBILITY_TARGET_DEVICE_ID,
    })
  } catch {
    fail(
      'compatibility_firestore_read_failed',
      'Unable to read compatibility verification evidence.',
    )
  }
  assertCompatibilityRegistry(registry)

  let finalEvents = []
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    let events
    try {
      events = await adapter.readCompatibilityEvents({
        deviceId: COMPATIBILITY_TARGET_DEVICE_ID,
        createdAfterMs: startedAtMs,
      })
    } catch {
      fail(
        'compatibility_firestore_read_failed',
        'Unable to read compatibility verification evidence.',
      )
    }
    if (!Array.isArray(events)) {
      fail(
        'compatibility_firestore_read_failed',
        'Compatibility event query returned an invalid result.',
      )
    }
    finalEvents = events
    const urinationEvents = events.filter(
      (event) => compatibilityEventGroup(event) === 'urination',
    )
    const batteryEvents = events.filter(
      (event) => compatibilityEventGroup(event) === 'battery',
    )
    if (urinationEvents.length > 1) {
      fail(
        'compatibility_urination_multiple_matches',
        'Compatibility verification found ambiguous Urination evidence.',
      )
    }
    if (batteryEvents.length > 1) {
      fail(
        'compatibility_battery_multiple_matches',
        'Compatibility verification found ambiguous Battery evidence.',
      )
    }
    if (urinationEvents.length === 1 && batteryEvents.length === 1) {
      assertCompatibilityUrinationEvent(
        urinationEvents[0],
        compatibility,
        startedAtMs,
      )
      assertCompatibilityBatteryEvent(
        batteryEvents[0],
        compatibility,
        startedAtMs,
      )
      if (
        urinationEvents[0].brokerReceivedAtMs !==
        batteryEvents[0].brokerReceivedAtMs
      ) {
        fail(
          'compatibility_pair_mismatch',
          'Compatibility events do not belong to the same broker delivery.',
        )
      }
      if (attempt + 1 === pollAttempts) return
    }
    if (attempt + 1 < pollAttempts) await wait(pollIntervalMs)
  }
  const finalGroups = finalEvents.map(compatibilityEventGroup)
  if (finalGroups.includes('urination') && !finalGroups.includes('battery')) {
    fail(
      'compatibility_battery_delivery_timeout',
      'Compatibility Battery delivery did not land within bounded polling.',
    )
  }
  if (finalGroups.includes('battery') && !finalGroups.includes('urination')) {
    fail(
      'compatibility_urination_delivery_timeout',
      'Compatibility Urination delivery did not land within bounded polling.',
    )
  }
  fail(
    'compatibility_delivery_timeout',
    'Compatibility delivery did not land within bounded polling.',
  )
}

async function publishCanonical(adapter, probe) {
  const outcome = await adapter.publishProbe(probe)
  if (outcome !== 'accepted') {
    fail('mqtt_publish_failed', 'MQTT broker did not accept the canonical probe.')
  }
}

async function expectCanonicalDocument({
  adapter,
  deviceId,
  eventId,
  pollAttempts,
  pollIntervalMs,
  wait,
}) {
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const count = assertDocumentCount(
      await adapter.readEventDocument({ deviceId, eventId }),
    )
    if (count === 1) return
    if (count > 1) {
      fail('canonical_delivery_failed', 'Canonical probe produced more than one document.')
    }
    if (attempt + 1 < pollAttempts) await wait(pollIntervalMs)
  }
  fail('canonical_delivery_failed', 'Canonical probe did not land within bounded polling.')
}

async function expectLegacyNonDelivery({
  adapter,
  deviceId,
  eventId,
  pollAttempts,
  pollIntervalMs,
  wait,
}) {
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const count = assertDocumentCount(
      await adapter.readEventDocument({ deviceId, eventId }),
    )
    if (count !== 0) {
      fail('legacy_delivery_detected', 'Legacy topic unexpectedly produced an event document.')
    }
    if (attempt + 1 < pollAttempts) await wait(pollIntervalMs)
  }
}

export async function runEmqxWebhookVerification({
  environment,
  adapter,
  compatibility,
  now = Date.now,
  createRunId = randomUUID,
  pollAttempts = 5,
  pollIntervalMs = 1_000,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  write,
}) {
  const { deviceId, productModel, rotation } = validateEnvironment(environment)
  const compatibilityMode = validateCompatibilityMode(compatibility)
  if (
    typeof wait !== 'function' ||
    !Number.isInteger(pollAttempts) ||
    pollAttempts < 1 ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 0
  ) {
    fail('invalid_verification_adapter', 'Verification dependencies are invalid.')
  }
  if (
    compatibilityMode.enabled &&
    (typeof adapter?.readDeviceRegistry !== 'function' ||
      typeof adapter?.readCompatibilityEvents !== 'function')
  ) {
    fail(
      'compatibility_precondition_unmet',
      'Enabled compatibility verification requires Firestore evidence adapters.',
    )
  }
  if (
    !compatibilityMode.enabled &&
    (typeof adapter?.publishProbe !== 'function' ||
      typeof adapter?.readEventDocument !== 'function')
  ) {
    fail('invalid_verification_adapter', 'Verification dependencies are invalid.')
  }
  const timestamp = now()
  const runId = createRunId()
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 1_000 ||
    typeof runId !== 'string' ||
    !/^[A-Za-z0-9-]{1,64}$/.test(runId)
  ) {
    fail('invalid_probe_identity', 'Probe run identity is invalid.')
  }

  let legacyDelivery
  if (compatibilityMode.enabled) {
    await expectCompatibilityDelivery({
      adapter,
      compatibility: compatibilityMode,
      startedAtMs: timestamp,
      pollAttempts,
      pollIntervalMs,
      wait,
    })
    legacyDelivery = 'paired_shape_observed'
  } else {
    const canonicalPrefix = `products/${productModel}/devices/${deviceId}`
    const urination = eventPayload('urination', deviceId, timestamp, runId, 1)
    const battery = eventPayload('battery', deviceId, timestamp, runId, 2)
    const legacy = eventPayload('urination', deviceId, timestamp, runId, 3, 'legacy')

    await publishCanonical(adapter, {
      topic: `${canonicalPrefix}/events/urination`,
      qos: 1,
      payload: urination,
    })
    await expectCanonicalDocument({
      adapter,
      deviceId,
      eventId: urination.eventId,
      pollAttempts,
      pollIntervalMs,
      wait,
    })

    await publishCanonical(adapter, {
      topic: `${canonicalPrefix}/status/battery`,
      qos: 1,
      payload: battery,
    })
    await expectCanonicalDocument({
      adapter,
      deviceId,
      eventId: battery.eventId,
      pollAttempts,
      pollIntervalMs,
      wait,
    })

    const legacyOutcome = await adapter.publishProbe({
      topic: 'peecare/device/1/status',
      qos: 1,
      payload: legacy,
    })
    if (legacyOutcome === 'accepted' || legacyOutcome === 'ambiguous') {
      await expectLegacyNonDelivery({
        adapter,
        deviceId,
        eventId: legacy.eventId,
        pollAttempts,
        pollIntervalMs,
        wait,
      })
    } else if (legacyOutcome !== 'rejected') {
      fail('invalid_verification_adapter', 'MQTT probe returned an invalid outcome.')
    }
    legacyDelivery = 'not_delivered'
  }

  const summary = Object.freeze({
    status: 'healthy',
    mode: compatibilityMode.enabled
      ? 'paired_compatibility'
      : 'canonical_only',
    ...(compatibilityMode.enabled
      ? {
          verification: Object.freeze({
            urinationCompatibility: 'shape_observed',
            batteryCompatibility: 'shape_observed',
            sourceProvenance: 'human_attestation_required',
          }),
        }
      : {}),
    deliveries: Object.freeze({
      urination: 'delivered',
      battery: 'delivered',
      legacy: legacyDelivery,
    }),
    rotation,
  })
  write(JSON.stringify(summary))
  return summary
}

function safeFailureCode(error) {
  return typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'emqx_webhook_verification_failed'
}

function compatibilityModeFromCli(argv, environment) {
  if (argv.length !== 1) {
    fail(
      'invalid_arguments',
      'Webhook verification requires an explicit canonical-only or compatibility mode.',
    )
  }
  if (argv[0] === '--canonical-only') {
    return Object.freeze({ enabled: false })
  }
  if (argv[0] !== '--compatibility') {
    fail(
      'invalid_arguments',
      'Webhook verification requires an explicit canonical-only or compatibility mode.',
    )
  }

  const approvedClientId = environment.PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID
  const approvedUsername = environment.PEECARE_APPROVED_LEGACY_MQTT_USERNAME
  const rawPumpSeconds =
    environment.PEECARE_EXPECTED_LEGACY_PUMP_SECONDS_TODAY
  const rawBatteryV = environment.PEECARE_EXPECTED_LEGACY_BATTERY_V
  const rawQos = environment.PEECARE_EXPECTED_LEGACY_QOS
  if (
    !isBoundedCompatibilityIdentity(approvedClientId) ||
    !isBoundedCompatibilityIdentity(approvedUsername) ||
    typeof rawPumpSeconds !== 'string' ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(rawPumpSeconds) ||
    typeof rawBatteryV !== 'string' ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(rawBatteryV) ||
    !['0', '1', '2'].includes(rawQos)
  ) {
    fail(
      'compatibility_precondition_unmet',
      'Compatibility verification requires approved source identity, pump seconds, and qos.',
    )
  }
  const expectedPumpSecondsToday = Number(rawPumpSeconds)
  const expectedBatteryV = Number(rawBatteryV)
  if (
    !Number.isFinite(expectedPumpSecondsToday) ||
    expectedPumpSecondsToday > MAX_COMPATIBILITY_PUMP_SECONDS ||
    !Number.isFinite(expectedBatteryV) ||
    expectedBatteryV > MAX_COMPATIBILITY_BATTERY_VOLTS
  ) {
    fail(
      'compatibility_precondition_unmet',
      'Compatibility expected pump seconds are outside the approved range.',
    )
  }
  return Object.freeze({
    enabled: true,
    approvedClientId,
    approvedUsername,
    expectedPumpSecondsToday,
    expectedBatteryV,
    expectedQos: Number(rawQos),
  })
}

export async function runEmqxWebhookVerificationCli({
  argv = process.argv.slice(2),
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  createAdapter = createEmqxWebhookVerificationAdapter,
  artifacts,
  readPassword = readCurrentPasswordFromInteractiveTty,
  now = Date.now,
  createRunId = randomUUID,
  wait,
} = {}) {
  try {
    if (Object.keys(environment).some((key) => /(?:DEVICE.*PASSWORD|PASSWORD.*DEVICE)/i.test(key))) {
      fail('device_password_input_forbidden', 'Device password must come from the hidden TTY prompt.')
    }
    const compatibility = compatibilityModeFromCli(argv, environment)
    const loadedArtifacts = artifacts ?? {
      inventory: JSON.parse(
        await readFile(resolve(process.cwd(), 'devices/development/device-inventory.json'), 'utf8'),
      ),
    }
    const devices = validateDeviceInventory(loadedArtifacts.inventory)
    if (devices.length !== 1) {
      fail('invalid_device_inventory', 'Webhook verification requires one inventory device.')
    }
    const [device] = devices
    let adapter
    if (compatibility.enabled) {
      adapter = createAdapter({
        compatibilityOnly: true,
        deviceId: device.deviceId,
        projectId: environment.PEECARE_DEVELOPMENT_PROJECT_ID,
      })
    } else {
      validatedMqttEndpoint(environment.PEECARE_DEVICE_MQTT_URL)
      let password
      try {
        password = await readPassword()
      } catch {
        fail('device_credential_precondition_unmet', 'Device password is required from hidden TTY.')
      }
      if (typeof password !== 'string' || password.length === 0) {
        fail('device_credential_precondition_unmet', 'Device password is required from hidden TTY.')
      }
      adapter = createAdapter({
        mqttUrl: environment.PEECARE_DEVICE_MQTT_URL,
        deviceId: device.deviceId,
        username: device.mqttPrincipal,
        password,
        projectId: environment.PEECARE_DEVELOPMENT_PROJECT_ID,
      })
    }
    await runEmqxWebhookVerification({
      environment: {
        ...environment,
        PEECARE_DEVELOPMENT_DEVICE_ID: device.deviceId,
        PEECARE_DEVELOPMENT_PRODUCT_MODEL: device.productModel,
      },
      adapter,
      compatibility,
      now,
      createRunId,
      ...(wait ? { wait } : {}),
      write: (line) => stdout.write(`${line}\n`),
    })
    return 0
  } catch (error) {
    stderr.write(
      `${JSON.stringify({ status: 'error', code: safeFailureCode(error) })}\n`,
    )
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runEmqxWebhookVerificationCli()
}
