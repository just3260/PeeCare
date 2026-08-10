import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { buildWebhookRequest } from './configure-emqx-webhook.mjs'
import { readCurrentPasswordFromInteractiveTty } from '../../devices/development/credential-lifecycle.mjs'
import { createMqtt5TlsProbe } from '../../devices/development/verify-device-acl.mjs'

const SECRET_REFERENCE_PATTERN =
  /^projects\/(?:petcare-c7483|348528459946)\/secrets\/[A-Za-z0-9_-]+\/versions\/[1-9][0-9]*$/
const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

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

function validatedHttpsOrigin(rawUrl, code, label) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail(code, `${label} must be a credential-free HTTPS origin.`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    fail(code, `${label} must be a credential-free HTTPS origin.`)
  }
  return url.origin
}

function validatedMqttUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail('unsafe_mqtt_endpoint', 'MQTT verification requires mqtts:// on port 8883.')
  }
  if (
    url.protocol !== 'mqtts:' ||
    url.port !== '8883' ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    fail('unsafe_mqtt_endpoint', 'MQTT verification requires mqtts:// on port 8883.')
  }
  return url.toString()
}

function normalizedMetrics(response) {
  const metrics = response?.metrics ?? response
  const counters = {
    matched: metrics?.matched,
    success: metrics?.success,
    failed: metrics?.failed,
    dropped: metrics?.dropped,
    lateReply: metrics?.late_reply ?? metrics?.lateReply,
  }
  if (
    Object.values(counters).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    fail('invalid_delivery_counters', 'EMQX action counters are missing or invalid.')
  }
  return Object.freeze(counters)
}

function mutableAction(action, authorization) {
  const allowed = [
    'connector',
    'description',
    'enable',
    'local_topic',
    'name',
    'parameters',
    'resource_opts',
    'type',
  ]
  const body = Object.fromEntries(
    allowed.filter((key) => action?.[key] !== undefined).map((key) => [key, structuredClone(action[key])]),
  )
  if (!body.parameters?.headers || typeof body.parameters.headers !== 'object') {
    fail('invalid_live_action', 'Live EMQX HTTP action is missing its header configuration.')
  }
  for (const name of Object.keys(body.parameters.headers)) {
    if (name.toLowerCase() === 'authorization') delete body.parameters.headers[name]
  }
  body.parameters.headers.authorization = authorization
  return body
}

function defaultExecute(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function createEmqxWebhookVerificationAdapter({
  managementUrl,
  apiKey,
  apiSecret,
  ingestionOrigin,
  mqttUrl,
  mqttPassword,
  fetchImpl = globalThis.fetch,
  execute = defaultExecute,
  publishMqtt,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  requestTimeoutMs = 10_000,
  observationWindowMs = 1_000,
}) {
  const baseUrl = validatedHttpsOrigin(
    managementUrl,
    'unsafe_management_endpoint',
    'EMQX management URL',
  )
  const targetOrigin = validatedHttpsOrigin(
    ingestionOrigin,
    'invalid_target',
    'Development ingestion URL',
  )
  const brokerUrl = validatedMqttUrl(mqttUrl)
  if (
    typeof apiKey !== 'string' ||
    apiKey.length === 0 ||
    typeof apiSecret !== 'string' ||
    apiSecret.length === 0 ||
    /[\r\n\0]/.test(`${apiKey}${apiSecret}`)
  ) {
    fail('missing_management_credentials', 'Scoped EMQX API credentials are required.')
  }
  if (
    typeof mqttPassword !== 'string' ||
    mqttPassword.length === 0 ||
    /[\r\n\0]/.test(mqttPassword)
  ) {
    fail('unsafe_credential_input', 'A non-empty MQTT device password is required.')
  }
  if (typeof publishMqtt !== 'function') {
    fail('mqtt_publisher_required', 'A TLS MQTT publisher is required for live verification.')
  }
  if (
    typeof fetchImpl !== 'function' ||
    typeof execute !== 'function' ||
    typeof wait !== 'function' ||
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    !Number.isInteger(observationWindowMs) ||
    observationWindowMs <= 0
  ) {
    fail('invalid_verification_adapter', 'Verification adapter dependencies are invalid.')
  }

  const actionPath = '/api/v5/actions/http%3Apeecare_development_ingestion'
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`
  let lastCounters
  let selectedSecret

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
    if (response.status === 204) return null
    try {
      return await response.json()
    } catch {
      fail('emqx_unexpected_response', 'EMQX response was not valid JSON.')
    }
  }

  async function readCounters() {
    lastCounters = normalizedMetrics(await request(`${actionPath}/metrics`))
    return lastCounters
  }

  return {
    async inspectConfiguration() {
      const [rule, action, counters] = await Promise.all([
        request('/api/v5/rules/peecare_development_telemetry'),
        request(actionPath),
        readCounters(),
      ])
      return Object.freeze({
        rule: rule?.enable === true ? 'enabled' : 'disabled',
        action: action?.status === 'connected' ? 'connected' : 'disconnected',
        counters,
      })
    },
    async switchSecret(reference) {
      if (typeof reference !== 'string' || !SECRET_REFERENCE_PATTERN.test(reference)) {
        fail('invalid_rotation_references', 'A numeric Secret Manager version reference is required.')
      }
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
      const secret = typeof result?.stdout === 'string' ? result.stdout.replace(/\r?\n$/, '') : ''
      if (result?.status !== 0 || secret.length === 0 || /[\r\n\0]/.test(secret)) {
        fail('secret_access_failed', 'Unable to access a safe webhook secret version.')
      }
      const action = await request(actionPath)
      await request(actionPath, {
        method: 'PUT',
        body: mutableAction(action, `Bearer ${secret}`),
        expectedStatuses: [200, 204],
      })
      selectedSecret = secret
    },
    async probe(testCase) {
      const deviceId = testCase?.payload?.deviceId
      const username = `device-${deviceId}`
      if (testCase?.name === 'array-payload') {
        try {
          buildWebhookRequest({
            topic: testCase.topic,
            clientid: deviceId,
            username,
            qos: testCase.qos,
            flags: { retain: testCase.retained },
            publish_received_at: Date.now(),
            payload: testCase.payload,
          })
        } catch (error) {
          if (error?.code === 'invalid_payload') {
            return { webhookStatus: null, contractError: 'invalid_payload', counters: lastCounters }
          }
          throw error
        }
        fail('payload_boundary_failed', 'Array payload unexpectedly passed contract validation.')
      }
      if (testCase?.name === 'retained-rejection') {
        if (typeof selectedSecret !== 'string') {
          fail('rotation_not_initialized', 'Select a webhook secret before retained verification.')
        }
        const rendered = buildWebhookRequest({
          topic: testCase.topic,
          clientid: deviceId,
          username,
          qos: testCase.qos,
          flags: { retain: true },
          publish_received_at: Date.now(),
          payload: testCase.payload,
        })
        let response
        try {
          response = await fetchImpl(`${targetOrigin}${rendered.path}`, {
            method: rendered.method,
            signal: AbortSignal.timeout(requestTimeoutMs),
            headers: {
              ...rendered.headers,
              authorization: `Bearer ${selectedSecret}`,
            },
            body: JSON.stringify(rendered.body),
          })
        } catch {
          fail('webhook_network_failure', 'Retained webhook verification request failed.')
        }
        let body
        try {
          body = await response.json()
        } catch {
          body = null
        }
        return {
          webhookStatus: response.status,
          errorCode: body?.error?.code,
          counters: lastCounters,
        }
      }
      if (testCase?.name !== 'legacy-non-delivery') {
        buildWebhookRequest({
          topic: testCase.topic,
          clientid: deviceId,
          username,
          qos: testCase.qos,
          flags: { retain: testCase.retained },
          publish_received_at: Date.now(),
          payload: testCase.payload,
        })
      }
      const baseline = lastCounters ?? (await readCounters())
      if (testCase.name === 'legacy-non-delivery') {
        await request('/api/v5/publish', {
          method: 'POST',
          body: {
            topic: testCase.topic,
            qos: testCase.qos,
            retain: false,
            payload: JSON.stringify(testCase.payload),
          },
          expectedStatuses: [200, 202],
        })
        await wait(observationWindowMs)
        return { webhookStatus: null, counters: await readCounters() }
      }
      const outcome = await publishMqtt({
        operation: 'publish',
        mqttUrl: brokerUrl,
        deviceId,
        username,
        password: mqttPassword,
        topic: testCase.topic,
        qos: testCase.qos,
        retained: testCase.retained,
        payload: testCase.payload,
      })
      if (outcome !== 'allowed') {
        fail('mqtt_publish_failed', 'MQTT verification publish was not acknowledged.')
      }
      await wait(observationWindowMs)
      const counters = await readCounters()
      return {
        webhookStatus:
          counters.success === baseline.success + 1 && counters.failed === baseline.failed
            ? 200
            : null,
        counters,
      }
    },
  }
}

function validateEnvironment(environment) {
  const previousReference = environment?.PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF
  const currentReference = environment?.PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF
  const deviceId = environment?.PEECARE_DEVELOPMENT_DEVICE_ID
  const productModel = environment?.PEECARE_DEVELOPMENT_PRODUCT_MODEL
  if (
    typeof previousReference !== 'string' ||
    typeof currentReference !== 'string' ||
    !SECRET_REFERENCE_PATTERN.test(previousReference) ||
    !SECRET_REFERENCE_PATTERN.test(currentReference) ||
    previousReference === currentReference
  ) {
    fail(
      'invalid_rotation_references',
      'Distinct numeric previous and current Secret Manager version references are required.',
    )
  }
  if (
    typeof deviceId !== 'string' ||
    typeof productModel !== 'string' ||
    !TOPIC_SEGMENT_PATTERN.test(deviceId) ||
    !TOPIC_SEGMENT_PATTERN.test(productModel)
  ) {
    fail('invalid_probe_identity', 'Probe device identity is missing or unsafe.')
  }
  return Object.freeze({ previousReference, currentReference, deviceId, productModel })
}

function assertCounters(counters, code = 'invalid_delivery_counters') {
  if (
    !counters ||
    !Number.isSafeInteger(counters.matched) ||
    counters.matched < 0 ||
    !Number.isSafeInteger(counters.success) ||
    counters.success < 0 ||
    !Number.isSafeInteger(counters.failed) ||
    counters.failed < 0 ||
    !Number.isSafeInteger(counters.dropped) ||
    counters.dropped < 0 ||
    !Number.isSafeInteger(counters.lateReply) ||
    counters.lateReply < 0
  ) {
    fail(code, 'EMQX action counters are missing or invalid.')
  }
  return counters
}

function expectNoDropOrLateReply(counters, before) {
  if (
    counters.dropped !== before.dropped ||
    counters.lateReply !== before.lateReply
  ) {
    fail(
      'delivery_health_degraded',
      'Verification produced a dropped or late-reply delivery.',
    )
  }
}

function expectSuccessfulDelivery(result, before) {
  const counters = assertCounters(result?.counters)
  expectNoDropOrLateReply(counters, before)
  if (
    !Number.isInteger(result?.webhookStatus) ||
    result.webhookStatus < 200 ||
    result.webhookStatus >= 300
  ) {
    fail('webhook_probe_failed', 'Canonical webhook probe did not receive a 2xx response.')
  }
  if (counters.success !== before.success + 1 || counters.failed !== before.failed) {
    fail('delivery_counter_stalled', 'Canonical delivery did not increment success exactly once.')
  }
  return counters
}

function eventPayload(eventType, deviceId, now, sequence) {
  const common = {
    schemaVersion: 1,
    eventId: `${deviceId}:webhook-verify:${sequence}`,
    eventType,
    deviceId,
    sequence,
    recordedAtMs: now - 1_000,
    firmwareVersion: '1.0.0',
  }
  return eventType === 'urination'
    ? { ...common, flushDurationMs: 3_000, pumpDurationMs: 5_000 }
    : { ...common, batteryLevelPercent: 75, batteryVoltageMv: 3_975 }
}

function sanitizedSummary(initial, final) {
  return Object.freeze({
    status: 'healthy',
    rule: 'enabled',
    action: 'connected',
    rotation: Object.freeze({ previous: 'verified', current: 'verified' }),
    deliveries: Object.freeze({
      urination: 1,
      battery: 1,
      legacy: 0,
      retainedRejected: 1,
      invalidPayload: 1,
    }),
    counterDelta: Object.freeze({
      success: final.success - initial.success,
      failed: final.failed - initial.failed,
      dropped: final.dropped - initial.dropped,
      lateReply: final.lateReply - initial.lateReply,
    }),
  })
}

export async function runEmqxWebhookVerification({ environment, adapter, now = Date.now, write }) {
  const { previousReference, currentReference, deviceId, productModel } =
    validateEnvironment(environment)
  const timestamp = now()
  if (!Number.isSafeInteger(timestamp) || timestamp < 1_000) {
    fail('invalid_probe_time', 'Verification clock must return positive epoch milliseconds.')
  }
  const inspected = await adapter.inspectConfiguration()
  if (inspected?.rule !== 'enabled' || inspected?.action !== 'connected') {
    fail('configuration_unhealthy', 'Webhook rule and action must be enabled and connected.')
  }
  const initial = assertCounters(inspected.counters)

  const canonicalPrefix = `products/${productModel}/devices/${deviceId}`
  let previousResult
  await adapter.switchSecret(previousReference)
  try {
    previousResult = await adapter.probe({
      name: 'previous-urination',
      topic: `${canonicalPrefix}/events/urination`,
      qos: 1,
      retained: false,
      payload: eventPayload('urination', deviceId, timestamp, 1),
    })
  } finally {
    await adapter.switchSecret(currentReference)
  }
  let counters = expectSuccessfulDelivery(previousResult, initial)

  const currentResult = await adapter.probe({
    name: 'current-battery',
    topic: `${canonicalPrefix}/status/battery`,
    qos: 1,
    retained: false,
    payload: eventPayload('battery', deviceId, timestamp, 2),
  })
  counters = expectSuccessfulDelivery(currentResult, counters)

  const legacyResult = await adapter.probe({
    name: 'legacy-non-delivery',
    topic: `devices/${deviceId}/events/urination`,
    qos: 1,
    retained: false,
    payload: eventPayload('urination', deviceId, timestamp, 3),
  })
  const legacyCounters = assertCounters(legacyResult?.counters)
  expectNoDropOrLateReply(legacyCounters, counters)
  if (
    legacyResult.webhookStatus !== null ||
    legacyCounters.success !== counters.success ||
    legacyCounters.failed !== counters.failed
  ) {
    fail('legacy_delivery_detected', 'Legacy topic unexpectedly produced a webhook delivery.')
  }

  const retainedResult = await adapter.probe({
    name: 'retained-rejection',
    topic: `${canonicalPrefix}/events/urination`,
    qos: 1,
    retained: true,
    payload: eventPayload('urination', deviceId, timestamp, 4),
  })
  const retainedCounters = assertCounters(retainedResult?.counters)
  expectNoDropOrLateReply(retainedCounters, legacyCounters)
  if (
    retainedResult.webhookStatus !== 422 ||
    retainedResult.errorCode !== 'retained_event' ||
    retainedCounters.success !== counters.success ||
    ![counters.failed, counters.failed + 1].includes(retainedCounters.failed)
  ) {
    fail('retained_probe_failed', 'Retained probe did not produce the expected rejection.')
  }
  counters = retainedCounters

  const arrayResult = await adapter.probe({
    name: 'array-payload',
    topic: `${canonicalPrefix}/events/urination`,
    qos: 1,
    retained: false,
    payload: [{ deviceId }],
  })
  const arrayCounters = assertCounters(arrayResult?.counters)
  expectNoDropOrLateReply(arrayCounters, counters)
  if (
    arrayResult.webhookStatus !== null ||
    arrayResult.contractError !== 'invalid_payload' ||
    arrayCounters.success !== counters.success ||
    arrayCounters.failed !== counters.failed
  ) {
    fail('payload_boundary_failed', 'Array payload was not recorded as a contract failure.')
  }

  const summary = sanitizedSummary(initial, arrayCounters)
  write(JSON.stringify(summary))
  return summary
}

function safeFailureCode(error) {
  return typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'emqx_webhook_verification_failed'
}

export async function runEmqxWebhookVerificationCli({
  argv = process.argv.slice(2),
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  readPassword = readCurrentPasswordFromInteractiveTty,
  createAdapter = createEmqxWebhookVerificationAdapter,
  publishMqtt = createMqtt5TlsProbe(),
} = {}) {
  try {
    if (argv.length !== 0) {
      fail('invalid_arguments', 'Webhook verification accepts no command arguments.')
    }
    if (Object.keys(environment).some((key) => /(?:DEVICE.*PASSWORD|PASSWORD.*DEVICE)/i.test(key))) {
      fail(
        'device_password_input_forbidden',
        'Device password must come from the hidden TTY prompt.',
      )
    }
    const mqttPassword = await readPassword()
    const adapter = createAdapter({
      managementUrl: environment.PEECARE_EMQX_API_URL,
      apiKey: environment.PEECARE_EMQX_API_KEY,
      apiSecret: environment.PEECARE_EMQX_API_SECRET,
      ingestionOrigin: environment.PEECARE_DEVELOPMENT_INGESTION_ORIGIN,
      mqttUrl: environment.PEECARE_DEVICE_MQTT_URL,
      mqttPassword,
      publishMqtt,
    })
    await runEmqxWebhookVerification({
      environment,
      adapter,
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
