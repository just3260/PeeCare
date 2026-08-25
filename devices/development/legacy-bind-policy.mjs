import { validateDeviceInventory } from './device-configuration.mjs'
import { validateAclPolicy } from './verify-device-acl.mjs'

const BIND_TOPIC = 'peecare/device/1/bind'
const SHARED_USERNAME = 'approved-legacy-device'
const RETRY_DELAYS_MS = Object.freeze([0, 5_000, 10_000])
const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/
const PAIR_CODE_PATTERN = /^[0-9]{8}$/
const SECRET_VALUE_PATTERN = /(?:Bearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|passphrase|secret|token|api[_-]?key)\s*[:=])/i
const JWT_VALUE_PATTERN = /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:$|[^A-Za-z0-9_-])/
const SENSITIVE_KEY_TOKENS = new Set([
  'auth',
  'authentication',
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'jwt',
  'oauth',
  'passphrase',
  'password',
  'secret',
  'session',
  'token',
])
const SENSITIVE_KEY_COMPOUNDS = new Set([
  'access:key',
  'api:key',
  'api:secret',
  'pass:phrase',
  'private:key',
  'signing:key',
])
const SENSITIVE_COMPACT_KEYS = new Set([
  'accesskey',
  'apikey',
  'apisecret',
  'bearertoken',
  'cookiejar',
  'credentialvalue',
  'idtoken',
  'privatekey',
  'refreshtoken',
  'sessionid',
  'signingkey',
])

export class LegacyBindPolicyError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'LegacyBindPolicyError'
    this.code = code
  }
}

function fail(code, message) {
  throw new LegacyBindPolicyError(code, message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sensitiveKeyTokens(key) {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
}

function isSensitiveKey(key) {
  const tokens = sensitiveKeyTokens(key)
  if (tokens.some((token) => SENSITIVE_KEY_TOKENS.has(token))) return true
  if (SENSITIVE_COMPACT_KEYS.has(tokens.join(''))) return true
  return tokens.some((token, index) =>
    SENSITIVE_KEY_COMPOUNDS.has(`${token}:${tokens[index + 1]}`),
  )
}

function assertNoSecrets(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSecrets(child, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) {
    if (
      typeof value === 'string' &&
      (SECRET_VALUE_PATTERN.test(value) || JWT_VALUE_PATTERN.test(value))
    ) {
      fail('secret_material_forbidden', `Secret-like value is forbidden at ${path}`)
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      fail('secret_material_forbidden', `Secret-bearing field is forbidden at ${path}.${key}`)
    }
    assertNoSecrets(child, `${path}.${key}`)
  }
}

function assertExactKeys(value, expectedKeys, code, label) {
  if (!isRecord(value)) fail(code, `${label} must be an object`)
  const actualKeys = Object.keys(value).sort()
  const canonicalKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== canonicalKeys.length ||
    actualKeys.some((key, index) => key !== canonicalKeys[index])
  ) {
    fail(code, `${label} must contain only its documented fields`)
  }
}

function validateInventory(inventory) {
  let devices
  try {
    devices = validateDeviceInventory(inventory)
  } catch {
    fail('invalid_device_inventory', 'Legacy bind validation requires the canonical device inventory')
  }
  if (devices.length !== 1) {
    fail('invalid_device_inventory', 'Legacy bind validation requires exactly one development device')
  }
  return devices[0]
}

function validatePerDeviceAcl(perDeviceAcl, device) {
  assertExactKeys(perDeviceAcl, ['username', 'rules'], 'telemetry_acl_drift', 'Per-device ACL')
  if (!Array.isArray(perDeviceAcl.rules) || perDeviceAcl.rules.length !== 3) {
    fail('telemetry_acl_drift', 'Per-device ACL must keep two allows followed by deny-all')
  }
  perDeviceAcl.rules.forEach((rule, index) => {
    assertExactKeys(
      rule,
      index < 2 ? ['permission', 'action', 'topic', 'qos', 'retain'] : ['permission', 'action', 'topic'],
      'telemetry_acl_drift',
      `Per-device ACL rule ${index}`,
    )
  })
  try {
    validateAclPolicy(perDeviceAcl, {
      username: device.mqttPrincipal,
      deviceId: device.deviceId,
      productModel: device.productModel,
    })
  } catch {
    fail('telemetry_acl_drift', 'Per-device ACL must retain canonical QoS 1 telemetry and deny-all')
  }
  if (perDeviceAcl.rules.some((rule) => rule.topic === BIND_TOPIC)) {
    fail('telemetry_acl_drift', 'Per-device ACL must not grant legacy bind permission')
  }
}

function validateSharedPolicy(legacyPolicy, device) {
  assertExactKeys(legacyPolicy, ['schemaVersion', 'identity', 'rules'], 'invalid_legacy_policy', 'Legacy policy')
  if (legacyPolicy.schemaVersion !== 1) {
    fail('invalid_legacy_policy', 'Legacy policy must use schemaVersion 1')
  }
  assertExactKeys(legacyPolicy.identity, ['username', 'clientId'], 'invalid_shared_identity', 'Shared identity')
  if (
    legacyPolicy.identity.username !== SHARED_USERNAME ||
    legacyPolicy.identity.username === device.mqttPrincipal ||
    legacyPolicy.identity.clientId !== device.deviceId ||
    !DEVICE_ID_PATTERN.test(legacyPolicy.identity.clientId)
  ) {
    fail('invalid_shared_identity', 'Shared bind identity must remain distinct and use the canonical client ID')
  }
  if (!Array.isArray(legacyPolicy.rules) || legacyPolicy.rules.length !== 2) {
    fail('invalid_legacy_policy', 'Legacy policy must contain one bind allow followed by deny-all')
  }

  const [allow, deny] = legacyPolicy.rules
  assertExactKeys(
    allow,
    ['permission', 'action', 'topic', 'qos', 'retain'],
    'invalid_bind_allow',
    'Legacy bind allow',
  )
  if (
    allow.permission !== 'allow' ||
    allow.action !== 'publish' ||
    allow.topic !== BIND_TOPIC ||
    !Array.isArray(allow.qos) ||
    allow.qos.length !== 1 ||
    allow.qos[0] !== 0 ||
    allow.retain !== false
  ) {
    fail('invalid_bind_allow', 'Legacy bind allow must use the exact topic, QoS 0, and retain false')
  }
  assertExactKeys(deny, ['permission', 'action', 'topic'], 'invalid_bind_deny', 'Legacy deny rule')
  if (deny.permission !== 'deny' || deny.action !== 'all' || deny.topic !== '#') {
    fail('invalid_bind_deny', 'Legacy policy must end with deny-all on #')
  }

  return legacyPolicy.identity
}

function validateRetryFixture(retryFixture, device) {
  assertExactKeys(
    retryFixture,
    ['schemaVersion', 'hardwareAttestation', 'publishConfirmsOwnership', 'attempts'],
    'invalid_retry_fixture',
    'Retry fixture',
  )
  if (
    retryFixture.schemaVersion !== 1 ||
    retryFixture.hardwareAttestation !== false ||
    retryFixture.publishConfirmsOwnership !== false ||
    !Array.isArray(retryFixture.attempts) ||
    retryFixture.attempts.length !== RETRY_DELAYS_MS.length
  ) {
    fail('invalid_retry_fixture', 'Retry fixture must preserve the bounded no-attestation contract')
  }

  let canonicalPayload
  retryFixture.attempts.forEach((attempt, index) => {
    assertExactKeys(
      attempt,
      ['delayMs', 'topic', 'qos', 'retained', 'payload'],
      'invalid_retry_attempt',
      `Retry attempt ${index}`,
    )
    assertExactKeys(
      attempt.payload,
      ['device_id', 'pair_code'],
      'invalid_bind_payload',
      `Retry attempt ${index} payload`,
    )
    if (
      attempt.delayMs !== RETRY_DELAYS_MS[index] ||
      attempt.topic !== BIND_TOPIC ||
      attempt.qos !== 0 ||
      attempt.retained !== false
    ) {
      fail('invalid_retry_attempt', 'Retries must preserve the exact 0/5/10 second QoS 0 publication')
    }
    if (
      attempt.payload.device_id !== device.deviceId ||
      !DEVICE_ID_PATTERN.test(attempt.payload.device_id) ||
      !PAIR_CODE_PATTERN.test(attempt.payload.pair_code)
    ) {
      fail('invalid_bind_payload', 'Bind payload must contain the canonical device ID and eight ASCII digits')
    }

    const serializedPayload = JSON.stringify(attempt.payload)
    if (canonicalPayload === undefined) canonicalPayload = serializedPayload
    if (serializedPayload !== canonicalPayload) {
      fail('retry_payload_drift', 'Every retry must publish the exact same payload')
    }
  })
}

export function validateLegacyBindArtifacts({ inventory, perDeviceAcl, legacyPolicy, retryFixture } = {}) {
  assertNoSecrets({ inventory, perDeviceAcl, legacyPolicy, retryFixture })
  const device = validateInventory(inventory)
  validatePerDeviceAcl(perDeviceAcl, device)
  const sharedIdentity = validateSharedPolicy(legacyPolicy, device)
  validateRetryFixture(retryFixture, device)

  return {
    sharedUsername: sharedIdentity.username,
    sharedClientId: sharedIdentity.clientId,
    bindTopic: BIND_TOPIC,
    retryDelaysMs: [...RETRY_DELAYS_MS],
    telemetryPrincipal: device.mqttPrincipal,
    trustBoundary: 'shared-credential-no-hardware-attestation',
  }
}
