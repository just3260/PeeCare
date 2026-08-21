import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEMPLATE_PATH = resolve(MODULE_DIRECTORY, 'emqx-webhook.template.json')
const CANONICAL_TOPIC_PATTERN =
  /^products\/[^/#+]+\/devices\/[^/#+]+\/(?:events\/urination|status\/battery)$/
const APPROVED_TOPIC_FILTERS = Object.freeze([
  'products/+/devices/+/events/urination',
  'products/+/devices/+/status/battery',
])
const CURRENT_SECRET_TOKEN = '{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}'
const INGESTION_ORIGIN_TOKEN = '{{PEECARE_DEVELOPMENT_INGESTION_ORIGIN}}'
const CONNECTOR_NAME_TOKEN = '{{PEECARE_EMQX_CONNECTOR_NAME}}'
const ACTION_NAME_TOKEN = '{{PEECARE_EMQX_ACTION_NAME}}'
const COMPATIBILITY_ACTION_NAME_TOKEN =
  '{{PEECARE_EMQX_COMPATIBILITY_ACTION_NAME}}'
const BATTERY_COMPATIBILITY_ACTION_NAME_TOKEN =
  '{{PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME}}'
const LEGACY_COMPATIBILITY_TOPIC = 'peecare/device/1/status'
const LEGACY_COMPATIBILITY_TARGET_TOPIC =
  'products/pc-mini/devices/68E274BD2A58/events/urination'
const LEGACY_BATTERY_COMPATIBILITY_TARGET_TOPIC =
  'products/pc-mini/devices/68E274BD2A58/status/battery'
const LEGACY_COMPATIBILITY_TARGET_DEVICE_ID = '68E274BD2A58'
const MAX_LEGACY_PUMP_SECONDS = 4_294_967.295
const UUID_V4_NO_HYPHEN_PATTERN =
  /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/
const LEGACY_COMPATIBILITY_RULE_ID =
  'peecare_development_legacy_status_compatibility'
const LEGACY_BATTERY_COMPATIBILITY_RULE_ID =
  'peecare_development_legacy_status_battery_compatibility'
const LEGACY_COMPATIBILITY_SQL =
  'SELECT\n  json_decode(payload) AS legacyPayload,\n  username,\n  qos,\n  publish_received_at,\n  CASE\n    WHEN is_num(legacyPayload.pumpSecondsToday)\n    THEN round(legacyPayload.pumpSecondsToday * 1000)\n    ELSE 0\n  END AS pumpDurationMs,\n  uuid_v4_no_hyphen() AS compatibilityUuid\nFROM "peecare/device/1/status"\nWHERE clientid = \'{{PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID}}\'\n  AND username = \'{{PEECARE_APPROVED_LEGACY_MQTT_USERNAME}}\'\n  AND flags.retain = false\n  AND is_map(legacyPayload)\n  AND is_bool(legacyPayload.online)\n  AND legacyPayload.online = true\n  AND is_num(legacyPayload.pumpSecondsToday)\n  AND legacyPayload.pumpSecondsToday >= 0\n  AND legacyPayload.pumpSecondsToday <= 4294967.295'
const LEGACY_COMPATIBILITY_ACTION_BODY =
  '{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":{"topic":"products/pc-mini/devices/68E274BD2A58/events/urination","clientId":"68E274BD2A58","username":"${username}","qos":${qos},"retained":false,"brokerReceivedAtMs":${publish_received_at},"payload":{"schemaVersion":1,"eventId":"compat:68E274BD2A58:${compatibilityUuid}","eventType":"urination","deviceId":"68E274BD2A58","sequence":1,"recordedAtMs":${publish_received_at},"firmwareVersion":"1.0.0","flushDurationMs":0,"pumpDurationMs":${pumpDurationMs}}}}'
const LEGACY_BATTERY_COMPATIBILITY_SQL =
  'SELECT\n  json_decode(payload) AS legacyPayload,\n  qos,\n  publish_received_at,\n  CASE\n    WHEN is_num(legacyPayload.batteryV)\n    THEN legacyPayload.batteryV\n    ELSE -1\n  END AS batteryVolts,\n  round(batteryVolts * 1000) AS batteryVoltageMv,\n  CASE\n    WHEN batteryVolts >= 8.5 THEN 100\n    WHEN batteryVolts >= 8.0 THEN 75\n    WHEN batteryVolts >= 7.5 THEN 50\n    WHEN batteryVolts >= 7.0 THEN 25\n    ELSE 0\n  END AS batteryLevelPercent,\n  uuid_v4_no_hyphen() AS compatibilityUuid\nFROM "peecare/device/1/status"\nWHERE is_map(legacyPayload)\n  AND is_num(legacyPayload.batteryV)\n  AND batteryVolts >= 0\n  AND batteryVolts <= 20'
const LEGACY_BATTERY_COMPATIBILITY_ACTION_BODY =
  '{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":{"topic":"products/pc-mini/devices/68E274BD2A58/status/battery","clientId":"68E274BD2A58","username":"Peecare","qos":${qos},"retained":false,"brokerReceivedAtMs":${publish_received_at},"payload":{"schemaVersion":1,"eventId":"compatbattery:68E274BD2A58:${compatibilityUuid}","eventType":"battery","deviceId":"68E274BD2A58","sequence":1,"recordedAtMs":${publish_received_at},"firmwareVersion":"1.0.0","batteryLevelPercent":${batteryLevelPercent},"batteryVoltageMv":${batteryVoltageMv}}}}'
const SERVERLESS_ACTION_BODY =
  `{"webhookAuthorization":"Bearer ${CURRENT_SECRET_TOKEN}","event":\${.}}`
const APPROVED_DELIVERY_POLICY = Object.freeze({
  pool_size: 2,
  enable_pipelining: 1,
  connect_timeout: '10s',
  health_check_interval: '15s',
})
const UNCONSTRAINED_ACTION_FIELDS = Object.freeze([
  'query_mode',
  'worker_pool_size',
  'inflight_window',
  'max_buffer_bytes',
  'request_ttl',
])

export class EmqxWebhookConfigurationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'EmqxWebhookConfigurationError'
    this.code = code
  }
}

export function loadWebhookTemplate(path = DEFAULT_TEMPLATE_PATH) {
  return Object.freeze(JSON.parse(readFileSync(path, 'utf8')))
}

export function matchesCanonicalTopic(topic) {
  return typeof topic === 'string' && CANONICAL_TOPIC_PATTERN.test(topic)
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function isBoundedLegacyIdentity(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value)
  )
}

export function matchesLegacyCompatibilityDelivery(message, approvedPublisher) {
  if (
    !isBoundedLegacyIdentity(approvedPublisher?.clientId) ||
    !isBoundedLegacyIdentity(approvedPublisher?.username) ||
    message?.topic !== LEGACY_COMPATIBILITY_TOPIC ||
    message.clientid !== approvedPublisher.clientId ||
    message.username !== approvedPublisher.username ||
    message.flags?.retain !== false ||
    !isPlainObject(message.payload)
  ) {
    return false
  }
  const { online, pumpSecondsToday } = message.payload
  return (
    online === true &&
    typeof pumpSecondsToday === 'number' &&
    Number.isFinite(pumpSecondsToday) &&
    pumpSecondsToday >= 0 &&
    pumpSecondsToday <= MAX_LEGACY_PUMP_SECONDS
  )
}

export function matchesLegacyBatteryCompatibilityDelivery(message) {
  if (
    message?.topic !== LEGACY_COMPATIBILITY_TOPIC ||
    !isPlainObject(message.payload)
  ) {
    return false
  }
  const { batteryV } = message.payload
  return (
    typeof batteryV === 'number' &&
    Number.isFinite(batteryV) &&
    batteryV >= 0 &&
    batteryV <= 20
  )
}

function validateCompatibilityProjectionInputs(message, compatibilityUuid) {
  if (![0, 1, 2].includes(message.qos)) {
    fail('invalid_qos', 'Compatibility delivery qos must be 0, 1, or 2.')
  }
  if (
    !Number.isSafeInteger(message.publish_received_at) ||
    message.publish_received_at < 0
  ) {
    fail(
      'invalid_broker_timestamp',
      'Compatibility broker receive time must be a non-negative safe integer.',
    )
  }
  if (
    typeof compatibilityUuid !== 'string' ||
    !UUID_V4_NO_HYPHEN_PATTERN.test(compatibilityUuid)
  ) {
    fail(
      'invalid_compatibility_event_id',
      'Compatibility event identity must be a lowercase UUID v4 without hyphens.',
    )
  }
}

export function buildLegacyCompatibilityWebhookRequest(
  message,
  approvedPublisher,
  compatibilityUuid,
) {
  if (!matchesLegacyCompatibilityDelivery(message, approvedPublisher)) {
    fail(
      'ineligible_legacy_delivery',
      'Legacy delivery does not satisfy the compatibility boundary.',
    )
  }
  validateCompatibilityProjectionInputs(message, compatibilityUuid)

  const brokerReceivedAtMs = message.publish_received_at
  const payload = Object.freeze({
    schemaVersion: 1,
    eventId: `compat:${LEGACY_COMPATIBILITY_TARGET_DEVICE_ID}:${compatibilityUuid}`,
    eventType: 'urination',
    deviceId: LEGACY_COMPATIBILITY_TARGET_DEVICE_ID,
    sequence: 1,
    recordedAtMs: brokerReceivedAtMs,
    firmwareVersion: '1.0.0',
    flushDurationMs: 0,
    pumpDurationMs: Math.round(message.payload.pumpSecondsToday * 1_000),
  })
  return Object.freeze({
    method: 'POST',
    path: '/v1/emqx/events',
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body: Object.freeze({
      topic: LEGACY_COMPATIBILITY_TARGET_TOPIC,
      clientId: LEGACY_COMPATIBILITY_TARGET_DEVICE_ID,
      username: approvedPublisher.username,
      qos: message.qos,
      retained: false,
      brokerReceivedAtMs,
      payload,
    }),
  })
}

export function buildLegacyBatteryCompatibilityWebhookRequest(
  message,
  compatibilityUuid,
) {
  if (!matchesLegacyBatteryCompatibilityDelivery(message)) {
    fail(
      'ineligible_legacy_battery_delivery',
      'Legacy delivery does not satisfy the Battery compatibility boundary.',
    )
  }
  validateCompatibilityProjectionInputs(message, compatibilityUuid)

  const brokerReceivedAtMs = message.publish_received_at
  const batteryVolts = message.payload.batteryV
  const batteryLevelPercent =
    batteryVolts >= 8.5
      ? 100
      : batteryVolts >= 8.0
        ? 75
        : batteryVolts >= 7.5
          ? 50
          : batteryVolts >= 7.0
            ? 25
            : 0
  const payload = Object.freeze({
    schemaVersion: 1,
    eventId: `compatbattery:${LEGACY_COMPATIBILITY_TARGET_DEVICE_ID}:${compatibilityUuid}`,
    eventType: 'battery',
    deviceId: LEGACY_COMPATIBILITY_TARGET_DEVICE_ID,
    sequence: 1,
    recordedAtMs: brokerReceivedAtMs,
    firmwareVersion: '1.0.0',
    batteryLevelPercent,
    batteryVoltageMv: Math.round(batteryVolts * 1_000),
  })
  return Object.freeze({
    method: 'POST',
    path: '/v1/emqx/events',
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body: Object.freeze({
      topic: LEGACY_BATTERY_COMPATIBILITY_TARGET_TOPIC,
      clientId: LEGACY_COMPATIBILITY_TARGET_DEVICE_ID,
      username: 'Peecare',
      qos: message.qos,
      retained: false,
      brokerReceivedAtMs,
      payload,
    }),
  })
}

export function buildWebhookRequest(message) {
  if (!matchesCanonicalTopic(message?.topic)) {
    fail('invalid_topic', 'Webhook request requires a canonical telemetry topic.')
  }
  if (
    typeof message.clientid !== 'string' ||
    message.clientid.length < 1 ||
    message.clientid.length > 128 ||
    typeof message.username !== 'string' ||
    message.username.length < 1 ||
    message.username.length > 128
  ) {
    fail(
      'invalid_publisher',
      'Publisher clientId and username must be independently bounded strings.',
    )
  }
  if (![0, 1, 2].includes(message.qos)) {
    fail('invalid_qos', 'Webhook request qos must be 0, 1, or 2.')
  }
  if (typeof message.flags?.retain !== 'boolean') {
    fail('invalid_retained', 'Webhook request retained flag must be a boolean.')
  }
  if (
    !Number.isSafeInteger(message.publish_received_at) ||
    message.publish_received_at < 0
  ) {
    fail(
      'invalid_broker_timestamp',
      'Webhook broker receive time must be a non-negative safe integer.',
    )
  }
  if (
    !isPlainObject(message.payload)
  ) {
    fail('invalid_payload', 'Decoded MQTT payload must be a plain JSON object.')
  }
  return Object.freeze({
    method: 'POST',
    path: '/v1/emqx/events',
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body: Object.freeze({
      topic: message.topic,
      clientId: message.clientid,
      username: message.username,
      qos: message.qos,
      retained: message.flags?.retain,
      brokerReceivedAtMs: message.publish_received_at,
      payload: message.payload,
    }),
  })
}

function fail(code, message) {
  throw new EmqxWebhookConfigurationError(code, message)
}

function isDeepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateDeliveryPolicy(template) {
  const actual = Object.fromEntries(
    Object.keys(APPROVED_DELIVERY_POLICY).map((key) => [key, template?.connector?.[key]]),
  )
  if (
    !isDeepEqual(actual, APPROVED_DELIVERY_POLICY) ||
    JSON.stringify(template).includes('retry_interval')
  ) {
    fail(
      'unapproved_delivery_policy',
      'HTTP connector delivery policy must exactly match the approved Serverless console values.',
    )
  }
}

function validateSecretToken(template) {
  if (
    template?.action?.parameters?.body !== SERVERLESS_ACTION_BODY ||
    !isDeepEqual(template?.action?.parameters?.headers, {
      'content-type': 'application/json',
    })
  ) {
    fail(
      'invalid_secret_reference',
      'The sanitized action must contain the fixed body-wrapper secret token and no custom header.',
    )
  }
}

function validateHttpsOrigin(rawUrl, code, message) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail(code, message)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    fail(code, message)
  }
  return url.origin
}

function validateEnvironment(environment) {
  const origin = validateHttpsOrigin(
    environment?.PEECARE_DEVELOPMENT_INGESTION_ORIGIN,
    'invalid_target',
    'Development ingestion target must be an HTTPS origin.',
  )

  const secretReference = environment.PEECARE_INGESTION_SECRET_CURRENT_REF
  if (
    typeof secretReference !== 'string' ||
    !/^projects\/(?:petcare-c7483|348528459946)\/secrets\/peecare-emqx-webhook-current\/versions\/[1-9][0-9]*$/.test(
      secretReference,
    )
  ) {
    fail(
      'invalid_secret_reference',
      'A numeric current Secret Manager version reference in the development project is required.',
    )
  }
  const connectorName = validateIntegrationIdentity(
    environment.PEECARE_EMQX_CONNECTOR_NAME,
  )
  const actionName = validateIntegrationIdentity(environment.PEECARE_EMQX_ACTION_NAME)
  const compatibilityMode =
    environment.PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE ?? 'disabled'
  if (!['disabled', 'enabled'].includes(compatibilityMode)) {
    fail(
      'invalid_compatibility_mode',
      'Legacy compatibility mode must be disabled or enabled.',
    )
  }
  if (compatibilityMode === 'disabled') {
    return Object.freeze({
      origin,
      secretReference,
      connectorName,
      actionName,
      compatibility: Object.freeze({ mode: 'disabled' }),
    })
  }

  const compatibilityActionName =
    environment.PEECARE_EMQX_COMPATIBILITY_ACTION_NAME
  const batteryCompatibilityActionName =
    environment.PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME
  const approvedClientId = environment.PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID
  const approvedUsername = environment.PEECARE_APPROVED_LEGACY_MQTT_USERNAME
  if (
    !isBoundedLegacyIdentity(compatibilityActionName) ||
    /\s/.test(compatibilityActionName) ||
    !isBoundedLegacyIdentity(batteryCompatibilityActionName) ||
    /\s/.test(batteryCompatibilityActionName) ||
    !isBoundedLegacyIdentity(approvedClientId) ||
    !isBoundedLegacyIdentity(approvedUsername) ||
    new Set([
      actionName,
      compatibilityActionName,
      batteryCompatibilityActionName,
    ]).size !== 3
  ) {
    fail(
      'compatibility_precondition_unmet',
      'Enabled compatibility requires bounded action and approved publisher identities.',
    )
  }
  return Object.freeze({
    origin,
    secretReference,
    connectorName,
    actionName,
    compatibility: Object.freeze({
      mode: 'enabled',
      actionName: compatibilityActionName,
      batteryActionName: batteryCompatibilityActionName,
    }),
  })
}

function validateIntegrationIdentity(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    /[\s\0]/.test(value)
  ) {
    fail(
      'invalid_integration_identity',
      'Connector and action identities must be bounded non-whitespace strings.',
    )
  }
  return value
}

function configurationSummary(
  template,
  origin,
  secretReference,
  connectorName,
  actionName,
  compatibility,
) {
  const compatibilityChecklist = Object.freeze({
    rule: Object.freeze({
      id: LEGACY_COMPATIBILITY_RULE_ID,
      enabled: compatibility.mode === 'enabled',
      topicFilter: LEGACY_COMPATIBILITY_TOPIC,
      sql: template.compatibilityRule.sql,
    }),
    action: Object.freeze({
      name:
        compatibility.mode === 'enabled'
          ? compatibility.actionName
          : COMPATIBILITY_ACTION_NAME_TOKEN,
      connectorName,
      method: 'POST',
      path: '/v1/emqx/events',
      body: LEGACY_COMPATIBILITY_ACTION_BODY,
    }),
    batteryRule: Object.freeze({
      id: LEGACY_BATTERY_COMPATIBILITY_RULE_ID,
      enabled: compatibility.mode === 'enabled',
      topicFilter: LEGACY_COMPATIBILITY_TOPIC,
      sql: template.batteryCompatibilityRule.sql,
    }),
    batteryAction: Object.freeze({
      name:
        compatibility.mode === 'enabled'
          ? compatibility.batteryActionName
          : BATTERY_COMPATIBILITY_ACTION_NAME_TOKEN,
      connectorName,
      method: 'POST',
      path: '/v1/emqx/events',
      body: LEGACY_BATTERY_COMPATIBILITY_ACTION_BODY,
    }),
    fixedTarget: Object.freeze({
      productModel: 'pc-mini',
      deviceId: LEGACY_COMPATIBILITY_TARGET_DEVICE_ID,
      eventType: 'urination',
    }),
    batteryFixedTarget: Object.freeze({
      productModel: 'pc-mini',
      deviceId: LEGACY_COMPATIBILITY_TARGET_DEVICE_ID,
      eventType: 'battery',
    }),
    warnings: Object.freeze([
      'daily_stats_will_be_modified',
      'pump_seconds_today_is_cumulative_test_data',
      'retries_create_distinct_events',
    ]),
    batteryWarnings: Object.freeze([
      'battery_history_and_latest_projection_will_be_modified',
    ]),
  })
  return Object.freeze({
    status: 'ready',
    mode: 'checklist',
    compatibilityMode: compatibility.mode,
    targetOrigin: origin,
    secretReference,
    secretToken: CURRENT_SECRET_TOKEN,
    connectorName,
    actionName,
    deliveryPolicy: APPROVED_DELIVERY_POLICY,
    unconstrainedActionFields: UNCONSTRAINED_ACTION_FIELDS,
    checklist: Object.freeze({
      connector: Object.freeze({
        name: connectorName,
        origin,
        type: 'HTTP Server',
        https: true,
        tlsEnabled: true,
        tlsVerify: 'disabled',
        tlsVerifyException: 'serverless_console_has_no_ca_bundle_field',
        ...APPROVED_DELIVERY_POLICY,
      }),
      rule: Object.freeze({
        id: template.rule.id,
        enabled: compatibility.mode === 'disabled',
        sql: template.rule.sql,
        topicFilters: APPROVED_TOPIC_FILTERS,
      }),
      action: Object.freeze({
        name: actionName,
        enabled: compatibility.mode === 'disabled',
        connectorName,
        method: 'POST',
        path: '/v1/emqx/events',
        contentType: 'application/json',
        customHeaders: 'unsupported',
        body: SERVERLESS_ACTION_BODY,
      }),
      selectedTopology: Object.freeze(
        compatibility.mode === 'enabled'
          ? {
              mode: 'paired_compatibility',
              ruleCount: 2,
              actionCount: 2,
            }
          : {
              mode: 'canonical_only',
              ruleCount: 1,
              actionCount: 1,
            },
      ),
      compatibility: compatibilityChecklist,
    }),
  })
}

export async function runEmqxWebhookConfiguration({
  mode,
  environment,
  template,
  write,
}) {
  if (mode === 'apply') {
    fail(
      'serverless_api_write_unsupported',
      'Serverless data integration must be configured through the Dashboard.',
    )
  }
  if (mode !== 'dry-run') {
    fail('explicit_mode_required', 'Configuration checklist requires explicit dry-run mode.')
  }
  validateWebhookTemplate(template)
  const {
    origin,
    secretReference,
    connectorName,
    actionName,
    compatibility,
  } =
    validateEnvironment(environment)
  const summary = configurationSummary(
    template,
    origin,
    secretReference,
    connectorName,
    actionName,
    compatibility,
  )
  write(JSON.stringify(summary))
  return summary
}

export function validateWebhookTemplate(template) {
  const filters =
    typeof template?.rule?.sql === 'string'
      ? [...template.rule.sql.matchAll(/"([^"]+)"/g)].map((match) => match[1])
      : []
  if (
    filters.length !== APPROVED_TOPIC_FILTERS.length ||
    filters.some((filter, index) => filter !== APPROVED_TOPIC_FILTERS[index])
  ) {
    throw new EmqxWebhookConfigurationError(
      'invalid_topic_filters',
      'Rule SQL must use only the approved urination and battery topic filters.',
    )
  }
  if (
    template?.compatibilityRule?.id !== LEGACY_COMPATIBILITY_RULE_ID ||
    template?.compatibilityRule?.name !== LEGACY_COMPATIBILITY_RULE_ID ||
    template?.compatibilityRule?.enable !== false ||
    template?.compatibilityRule?.sql !== LEGACY_COMPATIBILITY_SQL ||
    !isDeepEqual(template?.compatibilityRule?.actions, [
      `http:${COMPATIBILITY_ACTION_NAME_TOKEN}`,
    ]) ||
    template?.compatibilityAction?.type !== 'http' ||
    template?.compatibilityAction?.name !== COMPATIBILITY_ACTION_NAME_TOKEN ||
    template?.compatibilityAction?.connector !== CONNECTOR_NAME_TOKEN ||
    template?.compatibilityAction?.enable !== true ||
    template?.compatibilityAction?.parameters?.method !== 'post' ||
    template?.compatibilityAction?.parameters?.path !== '/v1/emqx/events' ||
    !isDeepEqual(template?.compatibilityAction?.parameters?.headers, {
      'content-type': 'application/json',
    }) ||
    template?.compatibilityAction?.parameters?.body !==
      LEGACY_COMPATIBILITY_ACTION_BODY ||
    template?.batteryCompatibilityRule?.id !==
      LEGACY_BATTERY_COMPATIBILITY_RULE_ID ||
    template?.batteryCompatibilityRule?.name !==
      LEGACY_BATTERY_COMPATIBILITY_RULE_ID ||
    template?.batteryCompatibilityRule?.enable !== false ||
    template?.batteryCompatibilityRule?.sql !==
      LEGACY_BATTERY_COMPATIBILITY_SQL ||
    !isDeepEqual(template?.batteryCompatibilityRule?.actions, [
      `http:${BATTERY_COMPATIBILITY_ACTION_NAME_TOKEN}`,
    ]) ||
    template?.batteryCompatibilityAction?.type !== 'http' ||
    template?.batteryCompatibilityAction?.name !==
      BATTERY_COMPATIBILITY_ACTION_NAME_TOKEN ||
    template?.batteryCompatibilityAction?.connector !== CONNECTOR_NAME_TOKEN ||
    template?.batteryCompatibilityAction?.enable !== true ||
    template?.batteryCompatibilityAction?.parameters?.method !== 'post' ||
    template?.batteryCompatibilityAction?.parameters?.path !== '/v1/emqx/events' ||
    !isDeepEqual(template?.batteryCompatibilityAction?.parameters?.headers, {
      'content-type': 'application/json',
    }) ||
    template?.batteryCompatibilityAction?.parameters?.body !==
      LEGACY_BATTERY_COMPATIBILITY_ACTION_BODY
  ) {
    fail(
      'invalid_compatibility_template',
      'Compatibility rule and action must match the fixed development-only contract.',
    )
  }
  if (
    template?.connector?.name !== CONNECTOR_NAME_TOKEN ||
    template?.connector?.url !== INGESTION_ORIGIN_TOKEN ||
    template?.action?.name !== ACTION_NAME_TOKEN ||
    template?.action?.connector !== CONNECTOR_NAME_TOKEN ||
    !isDeepEqual(template?.rule?.actions, [`http:${ACTION_NAME_TOKEN}`])
  ) {
    fail(
      'invalid_integration_identity',
      'Template integration identities must use the approved environment tokens.',
    )
  }
  if (
    template?.connector?.ssl?.enable !== true ||
    template?.connector?.ssl?.verify !== 'disabled'
  ) {
    fail(
      'invalid_tls_exception',
      'Serverless template must record HTTPS/TLS enabled with TLS Verify disabled.',
    )
  }
  if (
    !isDeepEqual(template?.unconstrainedActionFields, UNCONSTRAINED_ACTION_FIELDS)
  ) {
    fail(
      'invalid_unconstrained_fields',
      'Template must identify the action fields controlled by platform defaults.',
    )
  }
  validateSecretToken(template)
  validateDeliveryPolicy(template)
  return template
}

async function runCli() {
  try {
    const [argument] = process.argv.slice(2)
    const mode =
      process.argv.length === 3 && argument === '--dry-run'
        ? 'dry-run'
        : process.argv.length === 3 && argument === '--apply'
          ? 'apply'
          : undefined
    await runEmqxWebhookConfiguration({
      mode,
      environment: process.env,
      template: loadWebhookTemplate(),
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof EmqxWebhookConfigurationError
        ? error.code
        : 'emqx_webhook_configuration_failed'
    process.stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
