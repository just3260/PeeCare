import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
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
const APPROVED_DELIVERY_POLICY = Object.freeze({
  query_mode: 'async',
  worker_pool_size: 2,
  inflight_window: 10,
  max_buffer_bytes: '8MB',
  request_ttl: '30s',
  health_check_interval: '15s',
})
const APPROVED_ALERT_THRESHOLDS = Object.freeze({
  warning: Object.freeze({ retried: 1, queuingSeconds: 60 }),
  critical: Object.freeze({ failedInFiveMinutes: 3, dropped: 1, lateReply: 1 }),
})
const REQUIRED_API_FIELDS = Object.freeze(Object.keys(APPROVED_DELIVERY_POLICY))

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
  if (
    !isDeepEqual(template?.action?.resource_opts, APPROVED_DELIVERY_POLICY) ||
    JSON.stringify(template).includes('retry_interval')
  ) {
    fail(
      'unapproved_delivery_policy',
      'HTTP action delivery policy must exactly match the approved bounded values.',
    )
  }
  if (!isDeepEqual(template?.alertThresholds, APPROVED_ALERT_THRESHOLDS)) {
    fail(
      'unapproved_alert_thresholds',
      'Webhook alert thresholds must exactly match the approved warning and critical values.',
    )
  }
}

function validateSecretToken(template) {
  if (
    template?.action?.parameters?.headers?.authorization !==
    `Bearer ${CURRENT_SECRET_TOKEN}`
  ) {
    fail(
      'invalid_secret_reference',
      'The sanitized action must contain only the approved current-secret reference token.',
    )
  }
}

function validateApiSpec(apiSpec) {
  const actionsPath =
    apiSpec?.paths?.['/api/v5/actions'] ?? apiSpec?.paths?.['/actions']
  const serialized = JSON.stringify(apiSpec)
  if (
    !actionsPath?.post ||
    REQUIRED_API_FIELDS.some((field) => !serialized.includes(`"${field}"`))
  ) {
    fail(
      'unsupported_emqx_schema',
      'Live EMQX API schema does not support every approved HTTP action resource option.',
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
    !/^projects\/(?:petcare-c7483|348528459946)\/secrets\/[A-Za-z0-9_-]+\/versions\/[1-9][0-9]*$/.test(
      secretReference,
    )
  ) {
    fail(
      'invalid_secret_reference',
      'A numeric current Secret Manager version reference in the development project is required.',
    )
  }
  return Object.freeze({ origin, secretReference })
}

function fixedResource(resource) {
  if (resource === null) return null
  const copy = structuredClone(resource)
  for (const key of [
    'actions',
    'action_details',
    'created_at',
    'from',
    'last_modified_at',
    'metadata',
    'node_status',
    'rules',
    'status',
    'status_reason',
  ]) {
    delete copy[key]
  }
  return copy
}

function containsDesired(actual, desired) {
  if (Array.isArray(desired)) {
    return (
      Array.isArray(actual) &&
      actual.length === desired.length &&
      desired.every((value, index) => containsDesired(actual[index], value))
    )
  }
  if (desired && typeof desired === 'object') {
    return (
      actual !== null &&
      typeof actual === 'object' &&
      Object.entries(desired).every(([key, value]) => {
        if (
          key === 'authorization' &&
          value === `Bearer ${CURRENT_SECRET_TOKEN}` &&
          typeof actual[key] === 'string' &&
          actual[key].includes('******')
        ) {
          return true
        }
        return containsDesired(actual[key], value)
      })
    )
  }
  return actual === desired
}

function planOperation(current, desired) {
  if (current === null) return 'create'
  return containsDesired(fixedResource(current), desired) ? 'noop' : 'update'
}

function defaultExecute(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function createEmqxWebhookManagementAdapter({
  managementUrl,
  apiKey,
  apiSecret,
  fetchImpl = globalThis.fetch,
  execute = defaultExecute,
  requestTimeoutMs = 10_000,
}) {
  const baseUrl = validateHttpsOrigin(
    managementUrl,
    'unsafe_management_endpoint',
    'EMQX management URL must be an HTTPS origin.',
  )
  if (
    typeof apiKey !== 'string' ||
    apiKey.length === 0 ||
    typeof apiSecret !== 'string' ||
    apiSecret.length === 0 ||
    /[\r\n\0]/.test(`${apiKey}${apiSecret}`)
  ) {
    fail('missing_management_credentials', 'Scoped EMQX API credentials are required.')
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    fail('invalid_management_timeout', 'EMQX management timeout must be a positive integer.')
  }
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`

  async function request(path, { method = 'GET', body, expectedStatuses = [200] } = {}) {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: {
          accept: 'application/json',
          authorization,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      fail('emqx_network_failure', 'EMQX management request failed.')
    }
    if (!expectedStatuses.includes(response.status)) {
      fail('emqx_unexpected_status', `EMQX returned unexpected HTTP status ${response.status}.`)
    }
    if (response.status === 204 || response.status === 404) return null
    try {
      return await response.json()
    } catch {
      fail('emqx_unexpected_response', 'EMQX response was not valid JSON.')
    }
  }

  const resources = (configuration) => [
    {
      key: 'connector',
      collection: '/api/v5/connectors',
      id: `http:${configuration.connector.name}`,
      body: configuration.connector,
    },
    {
      key: 'action',
      collection: '/api/v5/actions',
      id: `http:${configuration.action.name}`,
      body: configuration.action,
    },
    {
      key: 'rule',
      collection: '/api/v5/rules',
      id: configuration.rule.id,
      body: configuration.rule,
    },
  ]

  async function planConfiguration(configuration) {
    const definitions = resources(configuration)
    const current = await Promise.all(
      definitions.map(({ collection, id }) =>
        request(`${collection}/${encodeURIComponent(id)}`, {
          expectedStatuses: [200, 404],
        }),
      ),
    )
    return Object.fromEntries(
      definitions.map(({ key, body }, index) => [
        key,
        planOperation(current[index], body),
      ]),
    )
  }

  return {
    readApiSpec() {
      return request('/api-spec.json')
    },
    planConfiguration,
    accessSecret(reference) {
      const segments = reference.split('/')
      const result = execute('gcloud', [
        'secrets',
        'versions',
        'access',
        segments[5],
        '--secret',
        segments[3],
        '--project',
        segments[1],
      ])
      if (result.status !== 0 || typeof result.stdout !== 'string') {
        fail('secret_access_failed', 'Unable to access the current webhook secret version.')
      }
      return result.stdout.replace(/\r?\n$/, '')
    },
    async applyConfiguration(configuration) {
      const plan = await planConfiguration(configuration)
      for (const resource of resources(configuration)) {
        const operation = plan[resource.key]
        if (operation === 'noop') continue
        await request(
          operation === 'create'
            ? resource.collection
            : `${resource.collection}/${encodeURIComponent(resource.id)}`,
          {
            method: operation === 'create' ? 'POST' : 'PUT',
            body: resource.body,
            expectedStatuses:
              operation === 'create' ? [201, 204] : [200, 204],
          },
        )
      }
    },
  }
}

function resolvedConfiguration(template, origin, secret) {
  if (
    typeof secret !== 'string' ||
    secret.length === 0 ||
    /[\r\n\0]/.test(secret)
  ) {
    fail('invalid_secret_value', 'Resolved current secret is empty or unsafe for an HTTP header.')
  }
  const configuration = structuredClone(template)
  configuration.connector.url = origin
  configuration.action.parameters.headers.authorization = `Bearer ${secret}`
  return configuration
}

function sanitizedConfiguration(template, origin) {
  const configuration = structuredClone(template)
  configuration.connector.url = origin
  return configuration
}

function validatePlan(plan) {
  const allowed = new Set(['create', 'update', 'noop'])
  if (
    !plan ||
    !allowed.has(plan.connector) ||
    !allowed.has(plan.action) ||
    !allowed.has(plan.rule)
  ) {
    fail('invalid_dry_run_plan', 'EMQX configuration plan must classify every resource safely.')
  }
  return Object.freeze({
    connector: plan.connector,
    action: plan.action,
    rule: plan.rule,
  })
}

function configurationSummary(mode, status, origin, secretReference, plan) {
  return Object.freeze({
    status,
    mode,
    targetOrigin: origin,
    secretReference,
    secretToken: CURRENT_SECRET_TOKEN,
    plan,
    deliveryPolicy: APPROVED_DELIVERY_POLICY,
    alertThresholds: APPROVED_ALERT_THRESHOLDS,
  })
}

export async function runEmqxWebhookConfiguration({
  mode,
  environment,
  template,
  adapter,
  write,
}) {
  if (mode !== 'dry-run' && mode !== 'apply') {
    fail('explicit_mode_required', 'Configuration requires explicit dry-run or apply mode.')
  }
  validateWebhookTemplate(template)
  const { origin, secretReference } = validateEnvironment(environment)
  validateApiSpec(await adapter.readApiSpec())
  const plan = validatePlan(
    await adapter.planConfiguration(sanitizedConfiguration(template, origin)),
  )

  if (mode === 'dry-run') {
    const summary = configurationSummary(mode, 'ready', origin, secretReference, plan)
    write(JSON.stringify(summary))
    return summary
  }

  const secret = await adapter.accessSecret(secretReference)
  await adapter.applyConfiguration(resolvedConfiguration(template, origin, secret))
  const summary = configurationSummary(mode, 'applied', origin, secretReference, plan)
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
      adapter: createEmqxWebhookManagementAdapter({
        managementUrl: process.env.PEECARE_EMQX_API_URL,
        apiKey: process.env.PEECARE_EMQX_API_KEY,
        apiSecret: process.env.PEECARE_EMQX_API_SECRET,
      }),
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
