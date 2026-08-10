import { Buffer } from 'node:buffer'
import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isatty } from 'node:tty'
import { fileURLToPath } from 'node:url'
import {
  createCredentialLifecycleVerifier,
  readCurrentPasswordFromInteractiveTty,
} from './credential-lifecycle.mjs'
import { validateFirmwareConfiguration, validateRetryAfterDisconnect } from './firmware-config.mjs'
import { createFirestoreRegistryReader, runDevicePreflight } from './registry-alignment.mjs'
import { validateAclPolicy } from './verify-device-acl.mjs'

const MODES = new Map([
  ['--dry-run', 'dry-run'],
  ['--apply', 'apply'],
  ['--rotate', 'rotate'],
  ['--revoke', 'revoke'],
])

const AUTHENTICATION_USERS_PATH =
  '/api/v5/authentication/password_based%3Abuilt_in_database/users'
const AUTHORIZATION_USERS_PATH =
  '/api/v5/authorization/sources/built_in_database/rules/users'

export class ProvisioningError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'ProvisioningError'
    this.code = code
  }
}

function fail(code, message) {
  throw new ProvisioningError(code, message)
}

function parseUrl(rawUrl, code) {
  try {
    return new URL(rawUrl)
  } catch {
    fail(code, 'Runtime endpoint is not a valid URL')
  }
}

export function validateRuntimeEndpoints(runtime) {
  const management = parseUrl(runtime?.managementUrl, 'unsafe_runtime_endpoint')
  const mqtt = parseUrl(runtime?.mqttUrl, 'unsafe_runtime_endpoint')

  const managementPath = management.pathname.replace(/\/$/, '')
  if (
    management.protocol !== 'https:' ||
    management.username ||
    management.password ||
    management.search ||
    management.hash ||
    managementPath
  ) {
    fail('unsafe_runtime_endpoint', 'EMQX management URL must be an HTTPS origin')
  }
  if (
    mqtt.protocol !== 'mqtts:' ||
    mqtt.port !== '8883' ||
    !mqtt.hostname ||
    mqtt.username ||
    mqtt.password ||
    (mqtt.pathname !== '' && mqtt.pathname !== '/') ||
    mqtt.search ||
    mqtt.hash
  ) {
    fail('unsafe_runtime_endpoint', 'Device MQTT URL must be a credential-free mqtts:// URL on port 8883')
  }

  return {
    managementUrl: management.origin,
    mqttUrl: mqtt.toString(),
  }
}

export function parseProvisionArguments(argv, environment = process.env) {
  if (
    Object.keys(environment).some((key) => /(?:DEVICE.*PASSWORD|PASSWORD.*DEVICE)/i.test(key)) ||
    argv.some((argument) => /(?:password|passphrase|credential)/i.test(argument))
  ) {
    fail('device_password_input_forbidden', 'Device passwords cannot be supplied through arguments or environment')
  }

  const requestedModes = argv.filter((argument) => MODES.has(argument))
  const allowedArguments = new Set([...MODES.keys(), '--secret-output-tty'])
  if (argv.some((argument) => !allowedArguments.has(argument))) {
    fail('invalid_arguments', 'Unknown provisioning argument')
  }
  if (requestedModes.length !== 1) {
    fail('invalid_arguments', 'Exactly one provisioning mode is required')
  }

  const mode = MODES.get(requestedModes[0])
  const secretOutputTty = argv.includes('--secret-output-tty')
  if ((mode === 'apply' || mode === 'rotate') !== secretOutputTty) {
    fail('unsafe_handoff', 'Apply and rotate require --secret-output-tty; other modes forbid it')
  }

  return { mode, secretOutputTty }
}

function authorizationHeader(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) fail('missing_management_credentials', 'EMQX management credentials are required')
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`
}

export function createEmqxManagementAdapter({
  managementUrl,
  apiKey,
  apiSecret,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 10_000,
}) {
  const { managementUrl: baseUrl } = validateRuntimeEndpoints({
    managementUrl,
    mqttUrl: 'mqtts://validation.invalid:8883',
  })
  const authorization = authorizationHeader(apiKey, apiSecret)
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    fail('invalid_management_timeout', 'EMQX management timeout must be a positive integer')
  }

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
      fail('emqx_network_failure', 'EMQX management request failed')
    }
    if (!expectedStatuses.includes(response.status)) {
      fail('emqx_unexpected_status', `EMQX returned unexpected HTTP status ${response.status}`)
    }
    if (response.status === 204) return undefined
    try {
      return await response.json()
    } catch {
      fail('emqx_unexpected_response', 'EMQX response was not valid JSON')
    }
  }

  return {
    readAuthenticator() {
      return request('/api/v5/authentication/password_based%3Abuilt_in_database')
    },
    readAuthorizationSource() {
      return request('/api/v5/authorization/sources/built_in_database')
    },
    createCredential({ username, password, isSuperuser }) {
      return request(AUTHENTICATION_USERS_PATH, {
        method: 'POST',
        body: { user_id: username, password, is_superuser: isSuperuser },
        expectedStatuses: [201, 204],
      })
    },
    replaceCredential({ username, password, isSuperuser }) {
      return request(`${AUTHENTICATION_USERS_PATH}/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: { password, is_superuser: isSuperuser },
        expectedStatuses: [200, 204],
      })
    },
    putAcl(username, rules) {
      return request(`${AUTHORIZATION_USERS_PATH}/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: { username, rules },
        expectedStatuses: [200, 204],
      })
    },
    deleteAcl(username) {
      return request(`${AUTHORIZATION_USERS_PATH}/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        expectedStatuses: [204],
      })
    },
    deleteCredential(username) {
      return request(`${AUTHENTICATION_USERS_PATH}/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        expectedStatuses: [204],
      })
    },
  }
}

export function openInteractiveSecretTty() {
  let descriptor
  try {
    descriptor = openSync('/dev/tty', constants.O_WRONLY | constants.O_NOCTTY)
    if (!isatty(descriptor)) fail('unsafe_handoff', 'Secret output target is not an interactive TTY')
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (error instanceof ProvisioningError) throw error
    fail('unsafe_handoff', 'Unable to open the interactive TTY')
  }

  let closed = false
  return {
    async writeSecret(secret) {
      if (closed) fail('unsafe_handoff', 'Secret output TTY is already closed')
      const expectedBytes = Buffer.byteLength(secret)
      const writtenBytes = writeSync(descriptor, secret, undefined, 'utf8')
      if (writtenBytes !== expectedBytes) fail('handoff_write_failed', 'Incomplete secret handoff')
    },
    async close() {
      if (!closed) {
        closed = true
        closeSync(descriptor)
      }
    },
  }
}

function summary(mode, device, status, verifications) {
  return {
    mode,
    deviceId: device.deviceId,
    principal: device.mqttPrincipal,
    status,
    verifications: [...verifications],
  }
}

export function emitProvisionSummary(output, result) {
  const sanitized = {
    mode: result.mode,
    deviceId: result.deviceId,
    principal: result.principal,
    status: result.status,
    verifications: Array.isArray(result.verifications) ? [...result.verifications] : [],
  }
  output.write(`${JSON.stringify(sanitized)}\n`)
}

async function rollbackCreatedIdentity(emqx, username, rollbackStatus) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => emqx.deleteAcl(username)),
    Promise.resolve().then(() => emqx.deleteCredential(username)),
  ])
  return results.every((result) => result.status === 'fulfilled') ? rollbackStatus : 'rollback_failed'
}

async function restoreCredential(emqx, credential, aclRules, rollbackStatus) {
  try {
    await emqx.replaceCredential(credential)
    await emqx.putAcl(credential.username, aclRules)
    return rollbackStatus
  } catch {
    return 'rollback_failed'
  }
}

async function recreateCredential(emqx, credential, aclRules, rollbackStatus) {
  try {
    await emqx.createCredential(credential)
    await emqx.putAcl(credential.username, aclRules)
    return rollbackStatus
  } catch {
    return 'rollback_failed'
  }
}

export async function provisionDevice({
  mode,
  secretOutputTty = false,
  device,
  runtime,
  aclRules = [],
  dependencies,
}) {
  validateRuntimeEndpoints(runtime)
  const verifications = [...(await dependencies.preflight())]
  validateAclPolicy(
    { username: device.mqttPrincipal, rules: aclRules },
    { deviceId: device.deviceId, productModel: device.productModel, username: device.mqttPrincipal },
  )
  verifications.push('acl-policy')

  if (mode === 'dry-run') return summary(mode, device, 'ready', verifications)
  if (!dependencies.lifecycle) {
    fail('lifecycle_verifier_required', 'Mutation modes require credential lifecycle verification')
  }

  let currentPassword
  if (mode === 'rotate' || mode === 'revoke') {
    try {
      currentPassword = await dependencies.lifecycle.readCurrentPassword()
      if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
        fail('unsafe_credential_input', 'Current device password is empty')
      }
    } catch {
      return summary(mode, device, 'unsafe_credential_input', verifications)
    }
  }

  if (mode === 'revoke') {
    try {
      await dependencies.emqx.deleteCredential(device.mqttPrincipal)
    } catch {
      return summary(mode, device, 'mutation_failed', verifications)
    }
    try {
      await dependencies.lifecycle.expectRejected({
        deviceId: device.deviceId,
        username: device.mqttPrincipal,
        mqttUrl: runtime.mqttUrl,
        password: currentPassword,
      })
      verifications.push('revoked-password-rejected')
      return summary(mode, device, 'revoked', verifications)
    } catch {
      const status = await recreateCredential(
        dependencies.emqx,
        { username: device.mqttPrincipal, password: currentPassword, isSuperuser: false },
        aclRules,
        'lifecycle_failed_rolled_back',
      )
      return summary(mode, device, status, verifications)
    }
  }
  if ((mode !== 'apply' && mode !== 'rotate') || !secretOutputTty) {
    return summary(mode, device, 'unsafe_handoff', verifications)
  }

  let tty
  try {
    tty = await dependencies.openSecretTty()
  } catch {
    return summary(mode, device, 'unsafe_handoff', verifications)
  }

  const password = dependencies.randomBytes(32).toString('base64url')
  const credential = {
    username: device.mqttPrincipal,
    password,
    isSuperuser: false,
  }
  let credentialMutated = false
  try {
    if (mode === 'apply') await dependencies.emqx.createCredential(credential)
    else await dependencies.emqx.replaceCredential(credential)
    credentialMutated = true

    await dependencies.emqx.putAcl(device.mqttPrincipal, aclRules)
  } catch {
    let status = 'mutation_failed'
    if (credentialMutated && mode === 'apply') {
      status = await rollbackCreatedIdentity(
        dependencies.emqx,
        device.mqttPrincipal,
        'mutation_failed_rolled_back',
      )
    } else if (credentialMutated) {
      status = await restoreCredential(
        dependencies.emqx,
        { username: device.mqttPrincipal, password: currentPassword, isSuperuser: false },
        aclRules,
        'mutation_failed_rolled_back',
      )
    }
    await tty.close()
    return summary(mode, device, status, verifications)
  }

  try {
    const connection = {
      deviceId: device.deviceId,
      username: device.mqttPrincipal,
      mqttUrl: runtime.mqttUrl,
      password,
    }
    if (mode === 'apply') {
      await dependencies.lifecycle.expectConnected(connection)
      verifications.push('initial-connect')
    } else {
      await dependencies.lifecycle.expectRejected({ ...connection, password: currentPassword })
      verifications.push('old-password-rejected')
      await dependencies.lifecycle.expectConnected(connection)
      verifications.push('new-password-connect')
    }
  } catch {
    const status =
      mode === 'apply'
        ? await rollbackCreatedIdentity(
            dependencies.emqx,
            device.mqttPrincipal,
            'lifecycle_failed_rolled_back',
          )
        : await restoreCredential(
            dependencies.emqx,
            { username: device.mqttPrincipal, password: currentPassword, isSuperuser: false },
            aclRules,
            'lifecycle_failed_rolled_back',
          )
    await tty.close()
    return summary(mode, device, status, verifications)
  }

  try {
    await tty.writeSecret(`${password}\n`)
  } catch {
    const status =
      mode === 'apply'
        ? await rollbackCreatedIdentity(
            dependencies.emqx,
            device.mqttPrincipal,
            'handoff_failed_rolled_back',
          )
        : await restoreCredential(
            dependencies.emqx,
            { username: device.mqttPrincipal, password: currentPassword, isSuperuser: false },
            aclRules,
            'handoff_failed_rolled_back',
          )
    await tty.close()
    return summary(mode, device, status, verifications)
  }

  await tty.close()
  return summary(mode, device, mode === 'apply' ? 'applied' : 'rotated', verifications)
}

export const defaultProvisionDependencies = {
  openSecretTty: openInteractiveSecretTty,
  randomBytes: nodeRandomBytes,
}

const artifactDirectory = resolve(process.cwd(), 'devices/development')

async function readJsonArtifact(relativePath) {
  return JSON.parse(await readFile(resolve(artifactDirectory, relativePath), 'utf8'))
}

async function loadProvisionArtifacts() {
  const [inventory, firmware, aclPolicy, retryFixture] = await Promise.all([
    readJsonArtifact('device-inventory.json'),
    readJsonArtifact('firmware-config.template.json'),
    readJsonArtifact('acl-policy.json'),
    readJsonArtifact('fixtures/retry-after-disconnect.json'),
  ])
  return { inventory, firmware, aclPolicy, retryFixture }
}

function sanitizedFailureStatus(error) {
  return typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'unexpected_failure'
}

export async function runProvisionCli({
  argv = process.argv.slice(2),
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  artifacts,
  runtime,
  emqx,
  registryReader,
  lifecycle,
  openSecretTty = openInteractiveSecretTty,
  randomBytes = nodeRandomBytes,
} = {}) {
  let parsed = { mode: 'invalid', secretOutputTty: false }
  let device = { deviceId: 'unknown', mqttPrincipal: 'unknown', productModel: 'unknown' }
  try {
    parsed = parseProvisionArguments(argv, environment)
    const loadedArtifacts = artifacts ?? (await loadProvisionArtifacts())
    device = loadedArtifacts.inventory?.devices?.[0] ?? device
    const resolvedRuntime =
      runtime ??
      {
        managementUrl: environment.PEECARE_EMQX_API_URL,
        mqttUrl: environment.PEECARE_DEVICE_MQTT_URL,
      }
    validateRuntimeEndpoints(resolvedRuntime)

    const managementAdapter =
      emqx ??
      createEmqxManagementAdapter({
        managementUrl: resolvedRuntime.managementUrl,
        apiKey: environment.PEECARE_EMQX_API_KEY,
        apiSecret: environment.PEECARE_EMQX_API_SECRET,
      })
    let firestoreReader = registryReader
    if (!firestoreReader) {
      const { Firestore } = await import('@google-cloud/firestore')
      firestoreReader = createFirestoreRegistryReader({ Firestore, environment })
    }
    const lifecycleVerifier =
      lifecycle ??
      createCredentialLifecycleVerifier({
        readCurrentPassword: readCurrentPasswordFromInteractiveTty,
      })

    const preflight = async () => {
      validateFirmwareConfiguration(loadedArtifacts.inventory, loadedArtifacts.firmware)
      validateRetryAfterDisconnect(loadedArtifacts.retryFixture)
      const verifications = await runDevicePreflight({
        inventory: loadedArtifacts.inventory,
        firmware: loadedArtifacts.firmware,
        registryReader: firestoreReader,
        emqx: managementAdapter,
      })
      return [...verifications, 'firmware-retry']
    }

    const result = await provisionDevice({
      ...parsed,
      device,
      runtime: resolvedRuntime,
      aclRules: loadedArtifacts.aclPolicy.rules,
      dependencies: {
        emqx: managementAdapter,
        lifecycle: lifecycleVerifier,
        openSecretTty,
        randomBytes,
        preflight,
      },
    })
    const succeeded = new Set(['ready', 'applied', 'rotated', 'revoked']).has(result.status)
    emitProvisionSummary(succeeded ? stdout : stderr, result)
    return succeeded ? 0 : 1
  } catch (error) {
    emitProvisionSummary(stderr, {
      mode: parsed.mode,
      deviceId: device.deviceId,
      principal: device.mqttPrincipal,
      status: sanitizedFailureStatus(error),
      verifications: [],
    })
    return 1
  }
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runProvisionCli()
}
