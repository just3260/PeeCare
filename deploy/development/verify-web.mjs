const APPROVED_ORIGIN = 'https://petcare-c7483.web.app'
const SHELL_CACHE_CONTROL = 'public,max-age=0,must-revalidate'
const ASSET_CACHE_CONTROL = 'public,max-age=31536000,immutable'

export class WebVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WebVerificationError'
    this.code = code
  }
}

function normalizeCacheControl(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',')
}

function cacheControlMatches(actual, expected) {
  return normalizeCacheControl(actual) === normalizeCacheControl(expected)
}

function approvedUrl(origin, path) {
  if (origin !== APPROVED_ORIGIN || !path.startsWith('/') || path.startsWith('//')) {
    throw new WebVerificationError(
      'target_mismatch',
      'Web verification is restricted to the approved development Hosting origin and absolute paths.',
    )
  }
  return `${origin}${path}`
}

export async function verifySpaAndCacheBehavior({
  origin,
  protectedRoute,
  hashedAssetPath,
  request,
}) {
  if (!/^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(hashedAssetPath)) {
    throw new WebVerificationError(
      'invalid_hashed_asset',
      'Cache verification requires a content-hashed asset path.',
    )
  }

  const [indexResponse, routeResponse, assetResponse] = await Promise.all([
    request(approvedUrl(origin, '/index.html')),
    request(approvedUrl(origin, protectedRoute)),
    request(approvedUrl(origin, hashedAssetPath)),
  ])
  const [indexBody, routeBody] = await Promise.all([
    indexResponse.text(),
    routeResponse.text(),
  ])

  const shellCache = indexResponse.headers.get('cache-control')
  const routeCache = routeResponse.headers.get('cache-control')
  const assetCache = assetResponse.headers.get('cache-control')
  if (
    !indexResponse.ok ||
    !routeResponse.ok ||
    !assetResponse.ok ||
    !indexBody.includes('id="app"') ||
    routeBody !== indexBody ||
    !cacheControlMatches(shellCache, SHELL_CACHE_CONTROL) ||
    !cacheControlMatches(routeCache, SHELL_CACHE_CONTROL) ||
    !cacheControlMatches(assetCache, ASSET_CACHE_CONTROL)
  ) {
    throw new WebVerificationError(
      'spa_or_cache_verification_failed',
      'Hosted shell rewrite or Cache-Control behavior does not match the development contract.',
    )
  }

  return Object.freeze({
    status: 'verified',
    protectedRoute,
    shellCache: SHELL_CACHE_CONTROL,
    assetCache: ASSET_CACHE_CONTROL,
  })
}

const PROTECTED_NETWORK_URL =
  /^https:\/\/(?:(?:identitytoolkit|securetoken|firestore)\.googleapis\.com|accounts\.google\.com|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app)\//i

export async function verifyMemberDataCacheExclusion({ browser, priorMemberMarkers }) {
  if (
    !Array.isArray(priorMemberMarkers) ||
    priorMemberMarkers.length === 0 ||
    priorMemberMarkers.some(
      (marker) => typeof marker !== 'string' || marker.trim().length === 0,
    )
  ) {
    throw new WebVerificationError(
      'invalid_member_markers',
      'Cache exclusion verification requires non-empty prior-member markers.',
    )
  }

  await browser.signInOwner()
  await browser.expectMemberDataVisible()
  await browser.signOut()
  await browser.goOffline()
  await browser.reload('/')

  const [cacheEntries, offlineState] = await Promise.all([
    browser.inspectCacheStorage(),
    browser.readOfflineState(),
  ])
  const invalidCache =
    !Array.isArray(cacheEntries) ||
    cacheEntries.some((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof entry.url !== 'string'
      ) {
        return true
      }
      const body = typeof entry.body === 'string' ? entry.body : ''
      return (
        PROTECTED_NETWORK_URL.test(entry.url) ||
        priorMemberMarkers.some((marker) => body.includes(marker))
      )
    })
  if (
    invalidCache ||
    offlineState?.shellVisible !== true ||
    offlineState?.protectedContentVisible !== false ||
    offlineState?.route !== '/sign-in'
  ) {
    throw new WebVerificationError(
      'member_data_cache_exclusion_failed',
      'Offline verification found protected network cache data or visible prior-member content.',
    )
  }

  return Object.freeze({
    status: 'verified',
    cachedShellEntries: cacheEntries.length,
    offlineRoute: '/sign-in',
    priorMemberDataVisible: false,
  })
}

const APPROVED_TEST_TOOL_API_ORIGIN =
  'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app'
const TEST_TOOL_DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const TEST_TOOL_UUID_V4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const TEST_TOOL_UINT32_MAX = 4_294_967_295
const TEST_TOOL_FORBIDDEN_DISPLAY_NAME = /[\p{Cc}\p{Zl}\p{Zp}]/u
const TEST_TOOL_CONTEXT_METHODS = Object.freeze([
  'startNetworkInspection',
  'signInOwner',
  'visit',
  'expectTesterDataVisible',
  'submitTesterEvent',
  'signOut',
  'goOffline',
  'reload',
  'inspectNetworkRequests',
  'inspectCacheStorage',
  'readOfflineState',
  'close',
])

function testToolCacheExclusionFailure() {
  return new WebVerificationError(
    'test_tool_cache_exclusion_failed',
    'Offline verification found cached Test Tool traffic or visible prior tester data.',
  )
}

function hasExactObjectKeys(value, expectedKeys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function isTestToolDevice(value) {
  return hasExactObjectKeys(value, ['deviceId', 'displayName']) &&
    typeof value.deviceId === 'string' &&
    TEST_TOOL_DEVICE_ID.test(value.deviceId) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim() === value.displayName &&
    Array.from(value.displayName).length > 0 &&
    Array.from(value.displayName).length <= 30 &&
    !TEST_TOOL_FORBIDDEN_DISPLAY_NAME.test(value.displayName)
}

function isUint32(value) {
  return Number.isInteger(value) && value >= 0 && value <= TEST_TOOL_UINT32_MAX
}

function isTestToolRequest(value) {
  if (value?.eventType === 'urination') {
    return hasExactObjectKeys(
      value,
      ['eventType', 'flushDurationMs', 'pumpDurationMs'],
    ) && isUint32(value.flushDurationMs) && isUint32(value.pumpDurationMs)
  }
  if (value?.eventType === 'battery') {
    const keys = value.batteryVoltageMv === undefined
      ? ['eventType', 'batteryLevelPercent']
      : ['eventType', 'batteryLevelPercent', 'batteryVoltageMv']
    return hasExactObjectKeys(value, keys) &&
      [0, 25, 50, 75, 100].includes(value.batteryLevelPercent) &&
      (value.batteryVoltageMv === undefined ||
        (Number.isInteger(value.batteryVoltageMv) &&
          value.batteryVoltageMv >= 0 &&
          value.batteryVoltageMv <= 20_000))
  }
  return false
}

function isTestToolResult(value, deviceId, eventType) {
  if (!hasExactObjectKeys(
    value,
    ['status', 'eventId', 'eventType', 'deviceId', 'sequence'],
  )) return false
  const prefix = `tt:${deviceId}:`
  return (value.status === 'stored' || value.status === 'duplicate') &&
    value.eventType === eventType &&
    value.deviceId === deviceId &&
    typeof value.eventId === 'string' &&
    value.eventId.startsWith(prefix) &&
    TEST_TOOL_UUID_V4.test(value.eventId.slice(prefix.length)) &&
    isUint32(value.sequence)
}

function parseTestToolJourney(device, submission) {
  if (
    !isTestToolDevice(device) ||
    !hasExactObjectKeys(submission, ['request', 'result']) ||
    !isTestToolRequest(submission.request) ||
    !isTestToolResult(
      submission.result,
      device.deviceId,
      submission.request.eventType,
    )
  ) return null
  return Object.freeze({
    device,
    request: submission.request,
    result: submission.result,
    markers: Object.freeze([
      device.deviceId,
      ...(device.displayName === device.deviceId ? [] : [device.displayName]),
      JSON.stringify({ devices: [device] }),
      JSON.stringify(submission.request),
      submission.result.eventId,
      JSON.stringify(submission.result),
    ]),
  })
}

function inspectTestToolNetwork(requests, apiOrigin, deviceId) {
  if (!Array.isArray(requests)) return null
  const apiRequests = []
  for (const request of requests) {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.url !== 'string' ||
      typeof request.method !== 'string' ||
      typeof request.servedFromCache !== 'boolean'
    ) return null
    if (!request.url.startsWith(`${apiOrigin}/`)) continue
    apiRequests.push(request)
  }

  const listUrl = `${apiOrigin}/v1/test-devices`
  const eventUrl = `${apiOrigin}/v1/test-devices/${deviceId}/events`
  if (
    apiRequests.some(
      (request) => request.servedFromCache ||
        !(
          (request.method === 'GET' && request.url === listUrl) ||
          (request.method === 'POST' && request.url === eventUrl)
        ),
    ) ||
    !apiRequests.some((request) => request.method === 'GET' && request.url === listUrl) ||
    !apiRequests.some((request) => request.method === 'POST' && request.url === eventUrl)
  ) return null
  return apiRequests.length
}

function hasInvalidTestToolCache(entries, apiOrigin, journeyMarkers) {
  return !Array.isArray(entries) || entries.some((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.url !== 'string' ||
      typeof entry.body !== 'string'
    ) return true
    return entry.url.startsWith(`${apiOrigin}/`) ||
      journeyMarkers.some((marker) => entry.body.includes(marker))
  })
}

export async function verifyTestToolDataCacheExclusion({
  browser,
  apiOrigin,
}) {
  if (apiOrigin !== APPROVED_TEST_TOOL_API_ORIGIN) {
    throw testToolCacheExclusionFailure()
  }

  let context
  try {
    context = await browser.createContext({
      session: 'owner',
      storage: 'isolated',
      serviceWorker: 'production',
    })
    if (
      typeof context !== 'object' ||
      context === null ||
      TEST_TOOL_CONTEXT_METHODS.some((method) => typeof context[method] !== 'function')
    ) throw testToolCacheExclusionFailure()
    await context.startNetworkInspection()
    await context.signInOwner()
    await context.visit('/test-tool')
    const device = await context.expectTesterDataVisible()
    if (!isTestToolDevice(device)) throw testToolCacheExclusionFailure()
    const submission = await context.submitTesterEvent({
      deviceId: device.deviceId,
    })
    const journey = parseTestToolJourney(device, submission)
    if (journey === null) throw testToolCacheExclusionFailure()

    await context.signOut()
    await context.goOffline()
    await context.reload('/test-tool')

    const [networkRequests, cacheEntries, offlineState] = await Promise.all([
      context.inspectNetworkRequests(),
      context.inspectCacheStorage(),
      context.readOfflineState(),
    ])
    const apiRequests = inspectTestToolNetwork(
      networkRequests,
      apiOrigin,
      journey.device.deviceId,
    )
    if (
      apiRequests === null ||
      hasInvalidTestToolCache(cacheEntries, apiOrigin, journey.markers) ||
      offlineState?.shellVisible !== true ||
      offlineState?.protectedContentVisible !== false ||
      offlineState?.priorTesterDataVisible !== false ||
      offlineState?.formStateVisible !== false ||
      offlineState?.route !== '/sign-in'
    ) throw testToolCacheExclusionFailure()

    return Object.freeze({
      status: 'verified',
      apiRequests,
      cachedShellEntries: cacheEntries.length,
      offlineRoute: '/sign-in',
      priorTesterDataVisible: false,
    })
  } catch (error) {
    if (
      error instanceof WebVerificationError &&
      error.code === 'test_tool_cache_exclusion_failed'
    ) throw error
    throw testToolCacheExclusionFailure()
  } finally {
    try {
      if (typeof context?.close === 'function') await context.close()
    } catch {
      throw testToolCacheExclusionFailure()
    }
  }
}

const TEST_TOOL_RESTORATION_VERSION =
  /^sites\/petcare-c7483\/versions\/[A-Za-z0-9_-]+$/
const TEST_TOOL_RESTORATION_BUILD_HASH = /^sha256:[0-9a-f]{64}$/
const TEST_TOOL_RESTORATION_DEVICE = /^PC-DEV-[0-9]{6}$/
const SIGNED_OUT_RESTORATION_METHODS = Object.freeze(['directLoad', 'close'])
const AUTHENTICATED_RESTORATION_METHODS = Object.freeze([
  'directLoad',
  'reload',
  'verifyBoundedEventProjection',
  'signOutAndVerifyOfflineCache',
  'close',
])

function testToolRouteRestorationFailure() {
  return new WebVerificationError(
    'test_tool_route_restoration_failed',
    'The exact Hosting version did not satisfy every test-tool route restoration check.',
  )
}

function hasMethods(value, methods) {
  return typeof value === 'object' &&
    value !== null &&
    methods.every((method) => typeof value[method] === 'function')
}

function hasExactEligibleDevice(state, assignedDeviceId) {
  return state?.route === '/test-tool' &&
    state.routeName === 'test-tool' &&
    Array.isArray(state.eligibleDeviceIds) &&
    state.eligibleDeviceIds.length === 1 &&
    state.eligibleDeviceIds[0] === assignedDeviceId
}

export async function verifyExactTestToolRouteRestoration({
  browser,
  deployment,
  assignedDeviceId,
}) {
  if (
    typeof browser?.createContext !== 'function' ||
    !TEST_TOOL_RESTORATION_BUILD_HASH.test(deployment?.buildHash ?? '') ||
    !TEST_TOOL_RESTORATION_VERSION.test(deployment?.hostingVersion ?? '') ||
    !TEST_TOOL_RESTORATION_DEVICE.test(assignedDeviceId ?? '')
  ) throw testToolRouteRestorationFailure()

  const contextOptions = Object.freeze({
    storage: 'isolated',
    hostingVersion: deployment.hostingVersion,
    buildHash: deployment.buildHash,
  })
  let signedOutContext
  let authenticatedContext
  let result
  let failed = false
  try {
    signedOutContext = await browser.createContext({
      session: 'signed-out',
      ...contextOptions,
    })
    authenticatedContext = await browser.createContext({
      session: 'owner',
      ...contextOptions,
    })
    if (
      !hasMethods(signedOutContext, SIGNED_OUT_RESTORATION_METHODS) ||
      !hasMethods(authenticatedContext, AUTHENTICATED_RESTORATION_METHODS)
    ) throw testToolRouteRestorationFailure()

    const signedOut = await signedOutContext.directLoad('/test-tool')
    if (
      signedOut?.route !== '/sign-in' ||
      signedOut.routeName !== 'sign-in' ||
      signedOut.returnTo !== '/test-tool' ||
      signedOut.protectedContentVisible !== false ||
      signedOut.testToolContentVisible !== false
    ) throw testToolRouteRestorationFailure()

    const directOpen = await authenticatedContext.directLoad('/test-tool')
    if (!hasExactEligibleDevice(directOpen, assignedDeviceId)) {
      throw testToolRouteRestorationFailure()
    }
    const reload = await authenticatedContext.reload('/test-tool')
    if (!hasExactEligibleDevice(reload, assignedDeviceId)) {
      throw testToolRouteRestorationFailure()
    }
    const projection = await authenticatedContext.verifyBoundedEventProjection({
      deviceId: assignedDeviceId,
    })
    if (
      projection?.status !== 'verified' ||
      projection.bounded !== true ||
      projection.webProjection !== true
    ) throw testToolRouteRestorationFailure()

    const offline = await authenticatedContext.signOutAndVerifyOfflineCache()
    if (
      offline?.route !== '/sign-in' ||
      offline.protectedContentVisible !== false ||
      offline.priorTesterDataVisible !== false ||
      offline.formStateVisible !== false ||
      offline.cacheExclusion !== true
    ) throw testToolRouteRestorationFailure()

    result = Object.freeze({
      status: 'verified',
      hostingVersion: deployment.hostingVersion,
      buildHash: deployment.buildHash,
      checks: Object.freeze({
        signedOutReturnPath: 'passed',
        authenticatedDirectOpen: 'passed',
        authenticatedReload: 'passed',
        eligibleDeviceBoundary: 'passed',
        eventProjection: 'passed',
        cacheExclusion: 'passed',
      }),
    })
  } catch {
    failed = true
  }

  const closeContext = (context) => Promise.resolve().then(() => context?.close?.())
  const cleanup = await Promise.allSettled([
    closeContext(signedOutContext),
    closeContext(authenticatedContext),
  ])
  if (failed || cleanup.some(({ status }) => status === 'rejected')) {
    throw testToolRouteRestorationFailure()
  }
  return result
}

const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844, isMobile: true })
const MEMBER_SMOKE_FLOWS = Object.freeze([
  'sign-in',
  'owned-device-overview',
  'history',
  'daily-stats',
  'non-owner-denial',
  'sign-out',
])

function memberSmokeFailure() {
  return new WebVerificationError(
    'member_smoke_failed',
    'The development member smoke journey did not satisfy every protected flow.',
  )
}

export async function verifyMemberSmokeJourney({ browser }) {
  try {
    const actualViewport = await browser.setViewport(MOBILE_VIEWPORT)
    if (
      actualViewport?.width !== MOBILE_VIEWPORT.width ||
      actualViewport?.height !== MOBILE_VIEWPORT.height ||
      actualViewport?.isMobile !== true
    ) {
      throw memberSmokeFailure()
    }

    await browser.visit('/sign-in')
    await browser.signInDevelopmentMember()
    await browser.visit('/')
    await browser.expectOwnedDeviceOverview()
    await browser.visit('/history')
    await browser.expectHistory()
    await browser.visit('/stats')
    await browser.expectDailyStats()

    const denial = await browser.verifyNonOwnerDenied()
    if (denial?.denied !== true || denial?.protectedContentVisible !== false) {
      throw memberSmokeFailure()
    }

    await browser.signOut()
    if ((await browser.readRoute()) !== '/sign-in') throw memberSmokeFailure()

    return Object.freeze({
      status: 'verified',
      viewport: MOBILE_VIEWPORT,
      flows: MEMBER_SMOKE_FLOWS,
    })
  } catch (error) {
    if (
      error instanceof WebVerificationError &&
      error.code === 'member_smoke_failed'
    ) {
      throw error
    }
    throw memberSmokeFailure()
  }
}

const HOSTING_VERSION_PATTERN =
  /^sites\/petcare-c7483\/versions\/[A-Za-z0-9_-]+$/
const REQUIRED_RELEASE_CHECKS = Object.freeze([
  'spaAndCache',
  'memberJourney',
  'memberDataCacheExclusion',
  'testToolDataCacheExclusion',
  'protectedRouteReload',
  'testToolRouteRestoration',
])
const REQUIRED_TEST_TOOL_RESTORATION_CHECKS = Object.freeze([
  'signedOutReturnPath',
  'authenticatedDirectOpen',
  'authenticatedReload',
  'eligibleDeviceBoundary',
  'eventProjection',
  'cacheExclusion',
])
const EXPECTED_OWNER_ROUTES = Object.freeze({
  '/': '/',
  '/history': '/history',
  '/stats': '/stats',
  '/test-tool': '/test-tool',
  '/sign-in': '/',
})
const EXPECTED_SIGNED_OUT_ROUTES = Object.freeze({
  '/': '/sign-in',
  '/history': '/sign-in',
  '/stats': '/sign-in',
  '/test-tool': '/sign-in',
  '/sign-in': '/sign-in',
})

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasCompleteReleaseEvidence(verification, deployment, hostingRelease) {
  const spa = verification?.spaAndCache
  const journey = verification?.memberJourney
  const cache = verification?.memberDataCacheExclusion
  const testToolCache = verification?.testToolDataCacheExclusion
  const reload = verification?.protectedRouteReload
  const restoration = verification?.testToolRouteRestoration
  return (
    spa?.status === 'verified' &&
    spa.protectedRoute === '/test-tool' &&
    spa.shellCache === SHELL_CACHE_CONTROL &&
    spa.assetCache === ASSET_CACHE_CONTROL &&
    journey?.status === 'verified' &&
    sameJson(journey.viewport, MOBILE_VIEWPORT) &&
    sameJson(journey.flows, MEMBER_SMOKE_FLOWS) &&
    cache?.status === 'verified' &&
    Number.isSafeInteger(cache.cachedShellEntries) &&
    cache.cachedShellEntries > 0 &&
    cache.offlineRoute === '/sign-in' &&
    cache.priorMemberDataVisible === false &&
    hasExactObjectKeys(testToolCache, [
      'status',
      'apiRequests',
      'cachedShellEntries',
      'offlineRoute',
      'priorTesterDataVisible',
    ]) &&
    testToolCache.status === 'verified' &&
    Number.isSafeInteger(testToolCache.apiRequests) &&
    testToolCache.apiRequests >= 2 &&
    Number.isSafeInteger(testToolCache.cachedShellEntries) &&
    testToolCache.cachedShellEntries > 0 &&
    testToolCache.offlineRoute === '/sign-in' &&
    testToolCache.priorTesterDataVisible === false &&
    reload?.status === 'verified' &&
    sameJson(reload.owner, EXPECTED_OWNER_ROUTES) &&
    sameJson(reload.signedOut, EXPECTED_SIGNED_OUT_ROUTES) &&
    reload.protectedContentLeak === false &&
    hasExactObjectKeys(restoration, [
      'status',
      'hostingVersion',
      'buildHash',
      'checks',
    ]) &&
    restoration.status === 'verified' &&
    restoration.hostingVersion === hostingRelease?.version &&
    restoration.buildHash === deployment?.buildHash &&
    hasExactObjectKeys(restoration.checks, REQUIRED_TEST_TOOL_RESTORATION_CHECKS) &&
    REQUIRED_TEST_TOOL_RESTORATION_CHECKS.every(
      (check) => restoration.checks[check] === 'passed',
    )
  )
}

function rejectReleaseRecord() {
  throw new WebVerificationError(
    'release_record_rejected',
    'A healthy Hosting release record requires an exact deployment, rollback target, and all smoke checks.',
  )
}

export function createHostingReleaseRecord({
  deployment,
  hostingRelease,
  verification,
  now,
  write,
}) {
  if (
    deployment?.status !== 'deployed' ||
    deployment.projectId !== 'petcare-c7483' ||
    deployment.hostingTarget !== 'development' ||
    deployment.hostingSite !== 'petcare-c7483' ||
    !/^sha256:[0-9a-f]{64}$/.test(deployment.buildHash ?? '') ||
    !HOSTING_VERSION_PATTERN.test(hostingRelease?.version ?? '') ||
    !HOSTING_VERSION_PATTERN.test(hostingRelease?.rollbackVersion ?? '') ||
    hostingRelease.version === hostingRelease.rollbackVersion ||
    !hasCompleteReleaseEvidence(verification, deployment, hostingRelease) ||
    typeof now !== 'function' ||
    typeof write !== 'function'
  ) {
    rejectReleaseRecord()
  }

  const verifiedAt = now()
  if (!(verifiedAt instanceof Date) || Number.isNaN(verifiedAt.getTime())) {
    rejectReleaseRecord()
  }

  const smoke = Object.freeze(
    Object.fromEntries(REQUIRED_RELEASE_CHECKS.map((check) => [check, 'passed'])),
  )
  const record = Object.freeze({
    status: 'healthy',
    projectId: 'petcare-c7483',
    hostingTarget: 'development',
    hostingSite: 'petcare-c7483',
    buildHash: deployment.buildHash,
    hostingVersion: hostingRelease.version,
    rollbackVersion: hostingRelease.rollbackVersion,
    verifiedAt: verifiedAt.toISOString(),
    smoke,
  })
  write(JSON.stringify(record))
  return record
}

const RELOAD_ROUTES = Object.freeze([
  '/',
  '/history',
  '/stats',
  '/test-tool',
  '/sign-in',
])

function protectedRouteReloadFailure() {
  return new WebVerificationError(
    'protected_route_reload_failed',
    'Protected-route direct loads did not preserve Owner routes or fully guard signed-out content.',
  )
}

async function inspectReloadContext(context, session) {
  const routes = {}
  for (const path of RELOAD_ROUTES) {
    const snapshot = await context.directLoad(path)
    const expectedRoute =
      session === 'owner'
        ? path === '/sign-in'
          ? '/'
          : path
        : '/sign-in'
    const expectedProtectedContent = session === 'owner'
    if (
      snapshot?.shellVisible !== true ||
      snapshot?.route !== expectedRoute ||
      snapshot?.protectedContentVisible !== expectedProtectedContent
    ) {
      throw protectedRouteReloadFailure()
    }
    routes[path] = snapshot.route
  }
  return Object.freeze(routes)
}

export async function verifyProtectedRouteReloadMatrix({ browser }) {
  let ownerContext
  let signedOutContext
  try {
    ownerContext = await browser.createContext({ session: 'owner' })
    signedOutContext = await browser.createContext({ session: 'signed-out' })
    const [owner, signedOut] = await Promise.all([
      inspectReloadContext(ownerContext, 'owner'),
      inspectReloadContext(signedOutContext, 'signed-out'),
    ])
    return Object.freeze({
      status: 'verified',
      owner,
      signedOut,
      protectedContentLeak: false,
    })
  } catch (error) {
    if (
      error instanceof WebVerificationError &&
      error.code === 'protected_route_reload_failed'
    ) {
      throw error
    }
    throw protectedRouteReloadFailure()
  } finally {
    await Promise.allSettled([
      ownerContext?.close?.(),
      signedOutContext?.close?.(),
    ])
  }
}
