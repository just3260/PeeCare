import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readHiddenPassword } from '../../devices/development/credential-lifecycle.mjs'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..')
const LOCAL_INVENTORY_PATH = resolve(
  MODULE_DIRECTORY,
  'beta-tester-inventory.local.json',
)

const INVENTORY_KEYS = Object.freeze(['environment', 'marker', 'testers'])
const TESTER_KEYS = Object.freeze(['alias', 'deviceId'])
const INVENTORY_MARKER = 'peecare-development-web-beta-v1'
const SAFE_ALIAS = /^[a-z][a-z0-9-]{1,31}$/
const DEVELOPMENT_DEVICE_ID = /^PC-DEV-[0-9]{6}$/
const PROHIBITED_KEY = /(?:email|e-mail|uid|password|passphrase|credential|secret|token|private[_-]?key|service[_-]?account|api[_-]?key)/i
const PROHIBITED_VALUE = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b|\bAIza[0-9A-Za-z_-]{20,}\b|\b(?:password|credential|secret|refresh[_-]?token|id[_-]?token|private[_-]?key)\b)/i
const FIREBASE_UID_LIKE = /^[A-Za-z0-9]{24,128}$/

const APPROVED_BETA_TARGET = Object.freeze({
  projectId: 'petcare-c7483',
  hostingSite: 'petcare-c7483',
  hostingTarget: 'development',
  webAppId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
  authDomain: 'petcare-c7483.firebaseapp.com',
  firestoreRegion: 'asia-east1',
  memberApiOrigin:
    'https://peecare-member-development-348528459946.asia-east1.run.app',
})

export class BetaReleaseError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BetaReleaseError'
    this.code = code
  }
}

function inventoryInvalid(message) {
  throw new BetaReleaseError('inventory_invalid', message)
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function containsProhibitedMaterial(value) {
  if (Array.isArray(value)) return value.some(containsProhibitedMaterial)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, nested]) => PROHIBITED_KEY.test(key) || containsProhibitedMaterial(nested),
    )
  }
  return typeof value === 'string' && PROHIBITED_VALUE.test(value)
}

export function validateBetaTesterInventory(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value, INVENTORY_KEYS) ||
    value.environment !== 'development' ||
    value.marker !== INVENTORY_MARKER ||
    !Array.isArray(value.testers) ||
    value.testers.length !== 1 ||
    containsProhibitedMaterial(value)
  ) {
    inventoryInvalid('Beta tester inventory must contain only the approved non-PII development shape.')
  }

  const aliases = new Set()
  const deviceIds = new Set()
  for (const tester of value.testers) {
    if (
      tester === null ||
      typeof tester !== 'object' ||
      Array.isArray(tester) ||
      !hasExactKeys(tester, TESTER_KEYS) ||
      typeof tester.alias !== 'string' ||
      !SAFE_ALIAS.test(tester.alias) ||
      FIREBASE_UID_LIKE.test(tester.alias) ||
      typeof tester.deviceId !== 'string' ||
      !DEVELOPMENT_DEVICE_ID.test(tester.deviceId) ||
      aliases.has(tester.alias) ||
      deviceIds.has(tester.deviceId)
    ) {
      inventoryInvalid('Every tester must have a unique safe alias and marked development device ID.')
    }
    aliases.add(tester.alias)
    deviceIds.add(tester.deviceId)
  }

  return Object.freeze(
    value.testers.map(({ alias, deviceId }) => Object.freeze({ alias, deviceId })),
  )
}

function prerequisiteFailed(message) {
  throw new BetaReleaseError('cloud_prerequisite_failed', message)
}

function validateBetaEnvironment(environment) {
  const exactValues = [
    ['PEECARE_DEVELOPMENT_HOSTING_TARGET', APPROVED_BETA_TARGET.hostingTarget],
    ['VITE_FIREBASE_ENVIRONMENT', 'development'],
    ['VITE_FIREBASE_APPROVED_PROJECT_ID', APPROVED_BETA_TARGET.projectId],
    ['VITE_FIREBASE_PROJECT_ID', APPROVED_BETA_TARGET.projectId],
    ['VITE_FIREBASE_APP_ID', APPROVED_BETA_TARGET.webAppId],
    ['VITE_FIREBASE_AUTH_DOMAIN', APPROVED_BETA_TARGET.authDomain],
    ['VITE_MEMBER_API_URL', APPROVED_BETA_TARGET.memberApiOrigin],
  ]
  if (
    exactValues.some(([key, expected]) => environment?.[key] !== expected) ||
    typeof environment?.VITE_FIREBASE_API_KEY !== 'string' ||
    environment.VITE_FIREBASE_API_KEY.trim().length === 0
  ) {
    prerequisiteFailed('Public Web configuration does not match the approved development beta target.')
  }
}

function validateCloudInventory(cloud, testers) {
  if (
    cloud === null ||
    typeof cloud !== 'object' ||
    cloud.projectId !== APPROVED_BETA_TARGET.projectId ||
    cloud.hostingSite !== APPROVED_BETA_TARGET.hostingSite ||
    cloud.hostingTarget !== APPROVED_BETA_TARGET.hostingTarget ||
    cloud.webAppId !== APPROVED_BETA_TARGET.webAppId ||
    cloud.webApiKeyMatches !== true ||
    cloud.authDomain !== APPROVED_BETA_TARGET.authDomain ||
    cloud.firestoreRegion !== APPROVED_BETA_TARGET.firestoreRegion ||
    cloud.memberApi?.origin !== APPROVED_BETA_TARGET.memberApiOrigin ||
    cloud.memberApi?.healthy !== true ||
    !Array.isArray(cloud.devices) ||
    cloud.devices.length !== testers.length
  ) {
    prerequisiteFailed('Cloud inventory does not match the approved development beta target.')
  }

  const inspectedDevices = new Map()
  for (const device of cloud.devices) {
    if (
      device === null ||
      typeof device !== 'object' ||
      typeof device.deviceId !== 'string' ||
      inspectedDevices.has(device.deviceId)
    ) {
      prerequisiteFailed('Cloud device inventory is incomplete or ambiguous.')
    }
    inspectedDevices.set(device.deviceId, device)
  }
  for (const tester of testers) {
    const device = inspectedDevices.get(tester.deviceId)
    if (device?.owned !== true || device.developmentMarked !== true) {
      prerequisiteFailed('Every assigned beta device must be marked for development and have an owner.')
    }
  }
}

export function createBetaCloudInspector({
  authorizedJson,
  readDevice,
  request,
  firebaseRc,
}) {
  if (
    typeof authorizedJson !== 'function' ||
    typeof readDevice !== 'function' ||
    typeof request !== 'function'
  ) {
    prerequisiteFailed('Cloud inspection requires explicit read-only adapters.')
  }

  return async ({
    projectId,
    hostingSite,
    hostingTarget,
    webAppId,
    webApiKey,
    authDomain,
    firestoreRegion: _firestoreRegion,
    memberApiOrigin,
    deviceIds,
  }) => {
    const encodedAppId = encodeURIComponent(webAppId)
    const [webConfig, site, database, authConfig, health, devices] = await Promise.all([
      authorizedJson(
        `https://firebase.googleapis.com/v1beta1/projects/-/webApps/${encodedAppId}/config`,
      ),
      authorizedJson(
        `https://firebasehosting.googleapis.com/v1beta1/projects/-/sites/${hostingSite}`,
      ),
      authorizedJson(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`,
      ),
      authorizedJson(
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
      ),
      request(`${memberApiOrigin}/health`, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      }),
      Promise.all(deviceIds.map((deviceId) => readDevice(deviceId))),
    ])

    let healthPayload = null
    if (health?.ok === true) {
      try {
        healthPayload = await health.json()
      } catch {
        healthPayload = null
      }
    }
    const targetSites = firebaseRc?.targets?.[projectId]?.hosting?.[hostingTarget]
    const inspectedSite =
      typeof site?.name === 'string' ? site.name.split('/').at(-1) : undefined
    const webAppMatchesSite = site?.appId === webConfig?.appId
    const authorizedDomain = Array.isArray(authConfig?.authorizedDomains)
      ? authConfig.authorizedDomains.includes(authDomain)
      : false

    return Object.freeze({
      projectId: webConfig?.projectId,
      hostingSite: inspectedSite,
      hostingTarget:
        Array.isArray(targetSites) &&
        targetSites.length === 1 &&
        targetSites[0] === inspectedSite
          ? hostingTarget
          : undefined,
      webAppId: webAppMatchesSite ? webConfig.appId : undefined,
      webApiKeyMatches:
        webAppMatchesSite &&
        typeof webApiKey === 'string' &&
        webConfig?.apiKey === webApiKey,
      authDomain:
        webAppMatchesSite && webConfig?.authDomain === authDomain && authorizedDomain
          ? webConfig.authDomain
          : undefined,
      firestoreRegion: database?.locationId,
      memberApi: Object.freeze({
        origin: memberApiOrigin,
        healthy: health?.ok === true && healthPayload?.status === 'ok',
      }),
      devices: Object.freeze(
        deviceIds.map((deviceId, index) => {
          const snapshot = devices[index]
          const data = snapshot?.data
          return Object.freeze({
            deviceId,
            owned:
              snapshot?.exists === true &&
              typeof data?.ownerUid === 'string' &&
              data.ownerUid.length > 0,
            developmentMarked:
              data?.deviceId === deviceId &&
              DEVELOPMENT_DEVICE_ID.test(deviceId) &&
              data?.ingestionStatus === 'enabled',
          })
        }),
      ),
    })
  }
}

// Task 2.1: hidden and ephemeral tester authentication boundary.
const TESTER_AUTHENTICATION_OPTION_KEYS = Object.freeze([
  'aliases',
  'argv',
  'environment',
  'input',
  'output',
  'authenticate',
])
const TESTER_AUTHENTICATION_CLI_OPTION_KEYS = Object.freeze([
  ...TESTER_AUTHENTICATION_OPTION_KEYS,
  'stdout',
  'stderr',
])
const TESTER_CREDENTIAL_ENV_KEY =
  /(?:(?:beta|tester).*(?:email|password|passphrase|credential|token)|(?:email|password|passphrase|credential|token).*(?:beta|tester))/i

function credentialInputUnavailable() {
  throw new BetaReleaseError(
    'credential_input_unavailable',
    'Tester authentication requires hidden input from an interactive TTY.',
  )
}

function hasOnlyAllowedOptions(value, allowedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  )
}

function isMutableCredentialPair(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value, ['email', 'password']) ||
    typeof value.email !== 'string' ||
    value.email.trim().length === 0 ||
    typeof value.password !== 'string' ||
    value.password.length === 0
  ) {
    return false
  }
  return ['email', 'password'].every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.writable === true || typeof descriptor?.set === 'function'
  })
}

function clearCredentialPair(credentials) {
  credentials.email = null
  credentials.password = null
}

export async function readHiddenBetaTesterCredentials(options) {
  if (
    !hasOnlyAllowedOptions(options, ['alias', 'input', 'output']) ||
    typeof options.alias !== 'string' ||
    !SAFE_ALIAS.test(options.alias)
  ) {
    credentialInputUnavailable()
  }

  const credentials = { email: null, password: null }
  try {
    credentials.email = await readHiddenPassword({
      input: options.input,
      output: options.output,
      prompt: `Tester ${options.alias} email: `,
    })
    credentials.password = await readHiddenPassword({
      input: options.input,
      output: options.output,
      prompt: `Tester ${options.alias} password: `,
    })
    if (credentials.email.trim().length === 0 || credentials.password.length === 0) {
      credentialInputUnavailable()
    }
    return credentials
  } catch {
    clearCredentialPair(credentials)
    credentialInputUnavailable()
  }
}

export async function runBetaTesterAuthentication(options) {
  if (!hasOnlyAllowedOptions(options, TESTER_AUTHENTICATION_OPTION_KEYS)) {
    credentialInputUnavailable()
  }

  const {
    aliases,
    argv = [],
    environment = {},
    input = process.stdin,
    output = process.stderr,
    authenticate,
  } = options
  if (
    !Array.isArray(aliases) ||
    aliases.length !== 1 ||
    typeof aliases[0] !== 'string' ||
    !SAFE_ALIAS.test(aliases[0]) ||
    !Array.isArray(argv) ||
    argv.length !== 0 ||
    environment === null ||
    typeof environment !== 'object' ||
    Array.isArray(environment) ||
    Object.keys(environment).some((key) => TESTER_CREDENTIAL_ENV_KEY.test(key)) ||
    typeof authenticate !== 'function'
  ) {
    credentialInputUnavailable()
  }

  const alias = aliases[0]
  let credentials
  try {
    credentials = await readHiddenBetaTesterCredentials({ alias, input, output })
  } catch {
    credentialInputUnavailable()
  }
  if (!isMutableCredentialPair(credentials)) {
    credentialInputUnavailable()
  }

  try {
    await authenticate(credentials)
  } catch {
    throw new BetaReleaseError(
      'tester_authentication_failed',
      'Beta tester authentication failed.',
    )
  } finally {
    clearCredentialPair(credentials)
    credentials = null
  }

  return Object.freeze({ alias, status: 'authenticated' })
}

export async function runBetaTesterAuthenticationCli(options = {}) {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  try {
    if (!hasOnlyAllowedOptions(options, TESTER_AUTHENTICATION_CLI_OPTION_KEYS)) {
      credentialInputUnavailable()
    }
    const result = await runBetaTesterAuthentication({
      aliases: options.aliases,
      argv: options.argv,
      environment: options.environment,
      input: options.input,
      output: options.output,
      authenticate: options.authenticate,
    })
    stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    const code =
      error instanceof BetaReleaseError &&
      ['credential_input_unavailable', 'tester_authentication_failed'].includes(
        error.code,
      )
        ? error.code
        : 'tester_authentication_failed'
    stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
    return 1
  }
}

export async function runBetaPreflight({
  environment,
  args,
  inventory,
  inspectCloud,
  build: _build,
  upload: _upload,
  write,
}) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== '--dry-run') {
    throw new BetaReleaseError(
      'explicit_mode_required',
      'Beta preflight requires exactly --dry-run.',
    )
  }

  const testers = validateBetaTesterInventory(inventory)
  validateBetaEnvironment(environment)
  if (typeof inspectCloud !== 'function') {
    prerequisiteFailed('A read-only cloud inventory inspector is required.')
  }

  let cloud
  try {
    cloud = await inspectCloud({
      ...APPROVED_BETA_TARGET,
      webApiKey: environment.VITE_FIREBASE_API_KEY,
      deviceIds: testers.map(({ deviceId }) => deviceId),
    })
  } catch {
    prerequisiteFailed('The read-only cloud inventory inspection failed.')
  }
  validateCloudInventory(cloud, testers)

  const plan = Object.freeze({
    status: 'ready',
    dryRun: true,
    projectId: APPROVED_BETA_TARGET.projectId,
    hostingSite: APPROVED_BETA_TARGET.hostingSite,
    hostingTarget: APPROVED_BETA_TARGET.hostingTarget,
    webAppId: APPROVED_BETA_TARGET.webAppId,
    authDomain: APPROVED_BETA_TARGET.authDomain,
    firestoreRegion: APPROVED_BETA_TARGET.firestoreRegion,
    memberApiOrigin: APPROVED_BETA_TARGET.memberApiOrigin,
    testerCount: testers.length,
    testerAliases: Object.freeze(testers.map(({ alias }) => alias)),
    checkedDeviceCount: testers.length,
  })
  write(JSON.stringify(plan))
  return plan
}

export async function runBetaReleaseCli({
  environment,
  args,
  readJson,
  inspectCloud,
  runReleaseGate,
  inspectCloudBuild,
  uploadHosting,
  verifyLiveRoutes,
  readHostingVersions,
  write,
}) {
  const mode = Array.isArray(args) && args.length === 1 ? args[0] : undefined
  if (!['--dry-run', '--apply', '--rollback-dry-run'].includes(mode)) {
    throw new BetaReleaseError(
      'explicit_mode_required',
      'Beta release requires exactly one explicit dry-run, apply, or rollback-dry-run mode.',
    )
  }

  if (mode === '--rollback-dry-run') {
    if (typeof readHostingVersions !== 'function') rollbackUnavailable()
    let versions
    try {
      versions = await readHostingVersions()
    } catch {
      rollbackUnavailable()
    }
    const plan = createBetaRollbackDryRun({
      currentVersion: Array.isArray(versions) ? versions[0] : undefined,
      rollbackVersions: Array.isArray(versions) ? versions.slice(1) : [],
    })
    write(JSON.stringify(plan))
    return plan
  }

  let inventory
  try {
    inventory = readJson(LOCAL_INVENTORY_PATH)
  } catch {
    inventoryInvalid('The gitignored local beta tester inventory is missing or unreadable.')
  }
  const preflight = await runBetaPreflight({
    environment,
    args: ['--dry-run'],
    inventory,
    inspectCloud,
    write: () => undefined,
  })
  let history
  if (mode === '--apply') {
    if (typeof readHostingVersions !== 'function') rollbackUnavailable()
    let versions
    try {
      versions = await readHostingVersions()
    } catch {
      rollbackUnavailable()
    }
    history = prepareBetaHostingHistory({
      currentVersions: versions,
      confirmation: environment?.PEECARE_BETA_FIRST_RELEASE_CONFIRMATION ?? '',
    })
  }
  const hosting = await runBetaHostingRelease({
    mode: mode === '--dry-run' ? 'dry-run' : 'apply',
    runReleaseGate,
    inspectCloudBuild,
    uploadHosting,
    verifyLiveRoutes,
  })
  const result = Object.freeze({
    ...preflight,
    ...hosting,
    ...(history ? { history } : {}),
  })
  write(JSON.stringify(result))
  return result
}

// Browser isolation: the adapter owns browser-specific storage operations while this
// boundary guarantees that every operation is attempted before the context closes.
const BETA_CONTEXT_CLEANUP_OPERATIONS = Object.freeze([
  'clearAuthPersistence',
  'clearIndexedDB',
  'clearCacheStorage',
  'clearServiceWorkerMemberState',
])

export async function runIsolatedBetaTesterJourney({ browser, journey }) {
  const context = await browser.createContext()
  let journeyResult
  let journeyError
  let journeyFailed = false

  try {
    journeyResult = await journey(context)
  } catch (error) {
    journeyFailed = true
    journeyError = error
  }

  let teardownFailed = false
  for (const operation of BETA_CONTEXT_CLEANUP_OPERATIONS) {
    try {
      await context[operation]()
    } catch {
      teardownFailed = true
    }
  }
  try {
    await context.close()
  } catch {
    teardownFailed = true
  }

  if (teardownFailed) {
    throw new BetaReleaseError(
      'browser_context_teardown_failed',
      'Beta tester browser context teardown failed.',
    )
  }
  if (journeyFailed) throw journeyError
  return journeyResult
}

const BETA_TESTER_JOURNEY_METHODS = Object.freeze([
  'getAuthenticatedUid',
  'readAssignedDevice',
  'expectOwnerOverview',
  'expectHistory',
  'expectDailyStats',
  'renameDevice',
  'clearDeviceName',
  'reloadProtectedRoutes',
  'signOut',
])

function smokeFailed(cleanupRequired = false) {
  const failure = new BetaReleaseError(
    'smoke_failed',
    cleanupRequired
      ? 'Beta tester marker cleanup failed.'
      : 'Beta tester journey failed.',
  )
  if (cleanupRequired) failure.cleanupRequired = true
  return failure
}

export async function runBetaTesterJourney({ alias, deviceId, browser }) {
  if (
    typeof alias !== 'string' ||
    !SAFE_ALIAS.test(alias) ||
    typeof deviceId !== 'string' ||
    !DEVELOPMENT_DEVICE_ID.test(deviceId) ||
    browser === null ||
    typeof browser !== 'object' ||
    BETA_TESTER_JOURNEY_METHODS.some((method) => typeof browser[method] !== 'function')
  ) {
    throw smokeFailed()
  }

  let authenticatedUid
  let before
  try {
    ;[authenticatedUid, before] = await Promise.all([
      browser.getAuthenticatedUid(),
      browser.readAssignedDevice(deviceId),
    ])
  } catch {
    throw smokeFailed()
  }
  if (
    typeof authenticatedUid !== 'string' ||
    authenticatedUid.length === 0 ||
    before?.deviceId !== deviceId ||
    before?.ownerUid !== authenticatedUid
  ) {
    throw new BetaReleaseError(
      'tester_device_mismatch',
      'The authenticated tester does not own the assigned development device.',
    )
  }

  try {
    await browser.expectOwnerOverview(deviceId)
    await browser.expectHistory(deviceId)
    await browser.expectDailyStats(deviceId)
    await browser.renameDevice(deviceId, 'PeeCare beta verification')
  } catch {
    throw smokeFailed()
  }

  try {
    await browser.clearDeviceName(deviceId)
  } catch {
    throw smokeFailed(true)
  }

  try {
    const after = await browser.readAssignedDevice(deviceId)
    if (!isDeepStrictEqual(after, before)) throw smokeFailed()
    await browser.reloadProtectedRoutes()
    await browser.signOut()
  } catch (error) {
    if (error instanceof BetaReleaseError) throw error
    throw smokeFailed()
  }

  return Object.freeze({ alias, status: 'passed' })
}

function isExactAssignedDeviceList(value, assignedDeviceId) {
  return Array.isArray(value) && value.length === 1 && value[0] === assignedDeviceId
}

export async function verifySingleTesterOwnershipBoundary({
  assignedDeviceId,
  readOwnedDeviceIds,
  readProtectedViewDeviceIds,
  runDependentSmoke,
}) {
  if (
    typeof assignedDeviceId !== 'string' ||
    !DEVELOPMENT_DEVICE_ID.test(assignedDeviceId) ||
    typeof readOwnedDeviceIds !== 'function' ||
    typeof readProtectedViewDeviceIds !== 'function' ||
    typeof runDependentSmoke !== 'function'
  ) {
    throw smokeFailed()
  }

  let ownedDeviceIds
  let protectedViews
  try {
    ;[ownedDeviceIds, protectedViews] = await Promise.all([
      readOwnedDeviceIds(),
      readProtectedViewDeviceIds(),
    ])
  } catch {
    throw smokeFailed()
  }

  const protectedViewKeys = ['history', 'overview', 'stats']
  if (
    !isExactAssignedDeviceList(ownedDeviceIds, assignedDeviceId) ||
    protectedViews === null ||
    typeof protectedViews !== 'object' ||
    Array.isArray(protectedViews) ||
    !hasExactKeys(protectedViews, protectedViewKeys) ||
    protectedViewKeys.some(
      (view) => !isExactAssignedDeviceList(protectedViews[view], assignedDeviceId),
    )
  ) {
    throw new BetaReleaseError(
      'unexpected_owned_device',
      'Live beta ownership must contain exactly the assigned development device.',
    )
  }

  try {
    await runDependentSmoke()
  } catch {
    throw smokeFailed()
  }
  return Object.freeze({
    status: 'verified',
    deviceCount: 1,
    liveTesterCoverage: 'single-tester',
    multiTesterCoverage: false,
  })
}

export async function runBetaUploadBoundary({ runNonOwnerDenialGate, upload }) {
  if (
    typeof runNonOwnerDenialGate !== 'function' ||
    typeof upload !== 'function'
  ) {
    throw smokeFailed()
  }
  let gate
  try {
    gate = await runNonOwnerDenialGate()
  } catch {
    throw smokeFailed()
  }
  if (gate?.status !== 'passed' || gate.nonOwnerDenied !== true) {
    throw smokeFailed()
  }
  try {
    await upload()
  } catch {
    throw smokeFailed()
  }
  return Object.freeze({
    status: 'uploaded',
    liveTesterCoverage: 'single-tester',
    multiTesterCoverage: false,
  })
}

const LIVE_BETA_ORIGIN = 'https://petcare-c7483.web.app'
const LIVE_BETA_ROUTES = Object.freeze(['/', '/history', '/stats', '/sign-in'])
const BETA_HOSTING_VERSION = /^sites\/petcare-c7483\/versions\/[A-Za-z0-9_-]+$/

function hostingUnavailable() {
  throw new BetaReleaseError(
    'hosting_unavailable',
    'The approved development Hosting live channel is unavailable.',
  )
}

export async function verifyLiveBetaHostingAvailability({ origin, request }) {
  if (origin !== LIVE_BETA_ORIGIN || typeof request !== 'function') {
    hostingUnavailable()
  }
  let responses
  try {
    responses = await Promise.all(
      LIVE_BETA_ROUTES.map((route) =>
        request(`${origin}${route}`, { method: 'GET', redirect: 'error' }),
      ),
    )
  } catch {
    hostingUnavailable()
  }

  let bodies
  try {
    bodies = await Promise.all(responses.map((response) => response.text()))
  } catch {
    hostingUnavailable()
  }
  const shell = bodies[0]
  if (
    typeof shell !== 'string' ||
    !shell.includes('id="app"') ||
    responses.some(
      (response) =>
        response?.ok !== true ||
        response.status === 404 ||
        response.redirected === true ||
        !String(response.headers?.get?.('content-type') ?? '').toLowerCase().includes('text/html'),
    ) ||
    bodies.some((body) => body !== shell)
  ) {
    hostingUnavailable()
  }
  return Object.freeze({ status: 'verified', routes: LIVE_BETA_ROUTES })
}

export async function runBetaHostingRelease({
  mode,
  runReleaseGate,
  inspectCloudBuild,
  uploadHosting,
  verifyLiveRoutes,
}) {
  if (
    !['dry-run', 'apply'].includes(mode) ||
    typeof runReleaseGate !== 'function' ||
    typeof inspectCloudBuild !== 'function' ||
    typeof uploadHosting !== 'function' ||
    typeof verifyLiveRoutes !== 'function'
  ) {
    prerequisiteFailed('Beta Hosting release requires explicit fixed stage adapters.')
  }

  let gate
  try {
    gate = await runReleaseGate()
  } catch {
    prerequisiteFailed('The release quality gate failed.')
  }
  if (gate?.status !== 'passed') prerequisiteFailed('The release quality gate failed.')

  let build
  try {
    build = await inspectCloudBuild()
  } catch {
    prerequisiteFailed('The inspected development cloud build failed.')
  }
  if (build?.status !== 'ready' || !/^sha256:[0-9a-f]{64}$/.test(build.buildHash ?? '')) {
    prerequisiteFailed('The inspected development cloud build failed.')
  }
  if (mode === 'dry-run') {
    return Object.freeze({ status: 'ready', dryRun: true, buildHash: build.buildHash })
  }

  let uploaded
  try {
    uploaded = await uploadHosting({ buildHash: build.buildHash })
  } catch {
    hostingUnavailable()
  }
  if (!BETA_HOSTING_VERSION.test(uploaded?.version ?? '')) hostingUnavailable()

  let availability
  try {
    availability = await verifyLiveRoutes({ hostingVersion: uploaded.version })
  } catch {
    hostingUnavailable()
  }
  if (
    availability?.status !== 'verified' ||
    !isDeepStrictEqual(availability.routes, LIVE_BETA_ROUTES)
  ) {
    hostingUnavailable()
  }
  return Object.freeze({
    status: 'deployed',
    buildHash: build.buildHash,
    hostingVersion: uploaded.version,
    routes: LIVE_BETA_ROUTES,
  })
}

const FIRST_RELEASE_CONFIRMATION =
  'APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK'
const REQUIRED_BETA_RELEASE_CHECKS = Object.freeze([
  'availability',
  'spaAndCache',
  'testerJourney',
  'exactOwnership',
  'memberDataCacheExclusion',
  'protectedRouteReload',
  'nonOwnerDenial',
])
const STABLE_BETA_FAILURE_CODES = Object.freeze([
  'inventory_invalid',
  'cloud_prerequisite_failed',
  'credential_input_unavailable',
  'tester_authentication_failed',
  'tester_device_mismatch',
  'unexpected_owned_device',
  'hosting_unavailable',
  'smoke_failed',
])

function rollbackUnavailable() {
  throw new BetaReleaseError(
    'rollback_unavailable',
    'No exact prior development Hosting version is available for rollback.',
  )
}

export function prepareBetaHostingHistory({ currentVersions, confirmation }) {
  if (!Array.isArray(currentVersions)) rollbackUnavailable()
  if (currentVersions.length === 0) {
    if (confirmation !== FIRST_RELEASE_CONFIRMATION) {
      throw new BetaReleaseError(
        'first_release_confirmation_required',
        'The first development Hosting release requires exact bootstrap confirmation.',
      )
    }
    return Object.freeze({
      bootstrap: true,
      rollbackAvailable: false,
      rollbackVersion: null,
    })
  }
  if (
    currentVersions.length !== 1 ||
    !BETA_HOSTING_VERSION.test(currentVersions[0])
  ) {
    rollbackUnavailable()
  }
  return Object.freeze({
    bootstrap: false,
    rollbackAvailable: true,
    rollbackVersion: currentVersions[0],
  })
}

function validateReleaseChecks(checks) {
  return (
    checks !== null &&
    typeof checks === 'object' &&
    !Array.isArray(checks) &&
    hasExactKeys(checks, REQUIRED_BETA_RELEASE_CHECKS) &&
    REQUIRED_BETA_RELEASE_CHECKS.every((check) => checks[check] === 'passed')
  )
}

export function createBetaReleaseRecord({
  deployment,
  history,
  testerStages,
  checks,
  now,
}) {
  const testerStage = Array.isArray(testerStages) ? testerStages[0] : undefined
  const verifiedAt = typeof now === 'function' ? now() : null
  const historyValid =
    history?.bootstrap === true
      ? history.rollbackAvailable === false && history.rollbackVersion === null
      : history?.bootstrap === false &&
        history.rollbackAvailable === true &&
        BETA_HOSTING_VERSION.test(history.rollbackVersion ?? '') &&
        history.rollbackVersion !== deployment?.hostingVersion
  if (
    deployment?.status !== 'deployed' ||
    !/^sha256:[0-9a-f]{64}$/.test(deployment.buildHash ?? '') ||
    !BETA_HOSTING_VERSION.test(deployment.hostingVersion ?? '') ||
    !historyValid ||
    !Array.isArray(testerStages) ||
    testerStages.length !== 1 ||
    testerStage === null ||
    typeof testerStage !== 'object' ||
    !hasExactKeys(testerStage, ['alias', 'status']) ||
    !SAFE_ALIAS.test(testerStage.alias ?? '') ||
    testerStage.status !== 'passed' ||
    !validateReleaseChecks(checks) ||
    !(verifiedAt instanceof Date) ||
    Number.isNaN(verifiedAt.getTime())
  ) {
    throw smokeFailed()
  }

  const record = {
    status: 'healthy',
    projectId: APPROVED_BETA_TARGET.projectId,
    hostingSite: APPROVED_BETA_TARGET.hostingSite,
    buildHash: deployment.buildHash,
    hostingVersion: deployment.hostingVersion,
    rollbackAvailable: history.rollbackAvailable,
    rollbackVersion: history.rollbackVersion,
    verifiedAt: verifiedAt.toISOString(),
    testerStages: testerStages.map((stage) => Object.freeze({ ...stage })),
    checks: Object.freeze({ ...checks }),
  }
  if (containsProhibitedMaterial(record)) throw smokeFailed()
  return Object.freeze(record)
}

export function createFailedBetaReleaseEvidence({
  hostingVersion,
  rollbackVersion,
  code,
  checks,
}) {
  const validRollback =
    rollbackVersion === null ||
    (BETA_HOSTING_VERSION.test(rollbackVersion ?? '') && rollbackVersion !== hostingVersion)
  const validChecks =
    checks !== null &&
    typeof checks === 'object' &&
    !Array.isArray(checks) &&
    Object.keys(checks).length > 0 &&
    Object.keys(checks).every((key) => REQUIRED_BETA_RELEASE_CHECKS.includes(key)) &&
    Object.values(checks).every((status) => ['passed', 'failed', 'not_run'].includes(status))
  if (
    !BETA_HOSTING_VERSION.test(hostingVersion ?? '') ||
    !validRollback ||
    !STABLE_BETA_FAILURE_CODES.includes(code) ||
    !validChecks
  ) {
    throw smokeFailed()
  }
  const evidence = {
    status: 'failed',
    projectId: APPROVED_BETA_TARGET.projectId,
    hostingSite: APPROVED_BETA_TARGET.hostingSite,
    hostingVersion,
    rollbackVersion,
    code,
    checks: Object.freeze({ ...checks }),
  }
  if (containsProhibitedMaterial(evidence)) throw smokeFailed()
  return Object.freeze(evidence)
}

export function createBetaRollbackDryRun({ currentVersion, rollbackVersions }) {
  if (
    !BETA_HOSTING_VERSION.test(currentVersion ?? '') ||
    !Array.isArray(rollbackVersions) ||
    rollbackVersions.length !== 1 ||
    !BETA_HOSTING_VERSION.test(rollbackVersions[0] ?? '') ||
    rollbackVersions[0] === currentVersion
  ) {
    rollbackUnavailable()
  }
  const rollbackVersion = rollbackVersions[0]
  return Object.freeze({
    status: 'ready',
    dryRun: true,
    projectId: APPROVED_BETA_TARGET.projectId,
    hostingSite: APPROVED_BETA_TARGET.hostingSite,
    currentVersion,
    rollbackVersion,
    reviewedCommand: Object.freeze([
      'curl',
      '--request',
      'POST',
      '--header',
      'Authorization: Bearer $(gcloud auth application-default print-access-token)',
      '--header',
      'Content-Type: application/json',
      '--header',
      `x-goog-user-project: ${APPROVED_BETA_TARGET.projectId}`,
      '--data',
      '{}',
      `https://firebasehosting.googleapis.com/v1beta1/sites/${APPROVED_BETA_TARGET.hostingSite}/releases?versionName=${encodeURIComponent(rollbackVersion)}`,
    ]),
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function createGoogleCloudReadDependencies(projectId) {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] =
    await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
    ])
  const credential = applicationDefault()
  const appName = `peecare-development-web-beta-${projectId}`
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp({ credential, projectId }, appName)
  const firestore = getFirestore(app)

  return Object.freeze({
    async authorizedJson(url) {
      const token = await credential.getAccessToken()
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/json',
          'x-goog-user-project': projectId,
        },
      })
      if (!response.ok) throw new Error('Approved cloud resource could not be read.')
      return response.json()
    },
    async readDevice(deviceId) {
      const snapshot = await firestore.doc(`devices/${deviceId}`).get()
      return Object.freeze({ exists: snapshot.exists, data: snapshot.data() })
    },
    request: fetch,
  })
}

function readLastJsonObject(output) {
  for (const line of String(output ?? '').trim().split('\n').reverse()) {
    try {
      const value = JSON.parse(line)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value
      }
    } catch {
      // Ignore command progress and keep looking for the final JSON result.
    }
  }
  return null
}

function executeCaptured(command, args, environment) {
  return spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  })
}

export async function readLiveBetaHostingVersions(authorizedJson, limit) {
  const payload = await authorizedJson(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${APPROVED_BETA_TARGET.hostingSite}/channels/live/releases?pageSize=${limit}`,
  )
  if (!Array.isArray(payload?.releases)) return Object.freeze([])
  const versions = []
  for (const release of payload.releases) {
    const version = release?.version?.name
    if (BETA_HOSTING_VERSION.test(version ?? '') && !versions.includes(version)) {
      versions.push(version)
    }
    if (versions.length === limit) break
  }
  return Object.freeze(versions)
}

function createHostingCommandAdapters({ environment, authorizedJson, request, mode }) {
  const commandEnvironment = Object.freeze({
    ...environment,
    PEECARE_DEVELOPMENT_PROJECT_ID: APPROVED_BETA_TARGET.projectId,
    PEECARE_DEVELOPMENT_HOSTING_TARGET: APPROVED_BETA_TARGET.hostingTarget,
  })
  const historyLimit = mode === '--rollback-dry-run' ? 2 : 1
  return Object.freeze({
    async runReleaseGate() {
      const result = executeCaptured('npm', ['run', 'check:release'], commandEnvironment)
      return Object.freeze({ status: result.status === 0 ? 'passed' : 'failed' })
    },
    async inspectCloudBuild() {
      const result = executeCaptured(
        process.execPath,
        [resolve(MODULE_DIRECTORY, 'deploy-web.mjs'), '--dry-run'],
        commandEnvironment,
      )
      const plan = result.status === 0 ? readLastJsonObject(result.stdout) : null
      return Object.freeze({
        status: plan?.status === 'ready' ? 'ready' : 'failed',
        buildHash: plan?.buildHash,
      })
    },
    async uploadHosting({ buildHash }) {
      const result = executeCaptured(
        process.execPath,
        [resolve(MODULE_DIRECTORY, 'deploy-web.mjs'), '--apply'],
        commandEnvironment,
      )
      const deployed = result.status === 0 ? readLastJsonObject(result.stdout) : null
      if (deployed?.status !== 'deployed' || deployed.buildHash !== buildHash) {
        hostingUnavailable()
      }
      const versions = await readLiveBetaHostingVersions(authorizedJson, 1)
      return Object.freeze({ version: versions[0] })
    },
    verifyLiveRoutes: ({ hostingVersion: _hostingVersion }) =>
      verifyLiveBetaHostingAvailability({ origin: LIVE_BETA_ORIGIN, request }),
    readHostingVersions: () => readLiveBetaHostingVersions(authorizedJson, historyLimit),
  })
}

async function runCli() {
  try {
    const mode = process.argv.slice(2)[0]
    const dependencies = await createGoogleCloudReadDependencies(
      APPROVED_BETA_TARGET.projectId,
    )
    const inspector = createBetaCloudInspector({
      ...dependencies,
      firebaseRc: readJson(resolve(REPOSITORY_ROOT, '.firebaserc')),
    })
    const hostingAdapters = createHostingCommandAdapters({
      environment: process.env,
      authorizedJson: dependencies.authorizedJson,
      request: dependencies.request,
      mode,
    })
    await runBetaReleaseCli({
      environment: process.env,
      args: process.argv.slice(2),
      readJson,
      inspectCloud: inspector,
      ...hostingAdapters,
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code = error instanceof BetaReleaseError ? error.code : 'cloud_prerequisite_failed'
    process.stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
