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
    message.payload === null ||
    typeof message.payload !== 'object' ||
    Array.isArray(message.payload) ||
    (Object.getPrototypeOf(message.payload) !== Object.prototype &&
      Object.getPrototypeOf(message.payload) !== null)
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
  return Object.freeze({ origin, secretReference, connectorName, actionName })
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
) {
  return Object.freeze({
    status: 'ready',
    mode: 'checklist',
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
        enabled: true,
        sql: template.rule.sql,
        topicFilters: APPROVED_TOPIC_FILTERS,
      }),
      action: Object.freeze({
        name: actionName,
        connectorName,
        method: 'POST',
        path: '/v1/emqx/events',
        contentType: 'application/json',
        customHeaders: 'unsupported',
        body: SERVERLESS_ACTION_BODY,
      }),
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
  const { origin, secretReference, connectorName, actionName } =
    validateEnvironment(environment)
  const summary = configurationSummary(
    template,
    origin,
    secretReference,
    connectorName,
    actionName,
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
