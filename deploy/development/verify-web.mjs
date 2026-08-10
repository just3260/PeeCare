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
  'protectedRouteReload',
])
const EXPECTED_OWNER_ROUTES = Object.freeze({
  '/': '/',
  '/history': '/history',
  '/stats': '/stats',
  '/sign-in': '/',
})
const EXPECTED_SIGNED_OUT_ROUTES = Object.freeze({
  '/': '/sign-in',
  '/history': '/sign-in',
  '/stats': '/sign-in',
  '/sign-in': '/sign-in',
})

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasCompleteReleaseEvidence(verification) {
  const spa = verification?.spaAndCache
  const journey = verification?.memberJourney
  const cache = verification?.memberDataCacheExclusion
  const reload = verification?.protectedRouteReload
  return (
    spa?.status === 'verified' &&
    spa.protectedRoute === '/history' &&
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
    reload?.status === 'verified' &&
    sameJson(reload.owner, EXPECTED_OWNER_ROUTES) &&
    sameJson(reload.signedOut, EXPECTED_SIGNED_OUT_ROUTES) &&
    reload.protectedContentLeak === false
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
    !hasCompleteReleaseEvidence(verification) ||
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

const RELOAD_ROUTES = Object.freeze(['/', '/history', '/stats', '/sign-in'])

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
