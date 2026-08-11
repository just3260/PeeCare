import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  createHostingReleaseRecord,
  verifyExactTestToolRouteRestoration,
  verifyProtectedRouteReloadMatrix,
  verifyMemberDataCacheExclusion,
  verifyTestToolDataCacheExclusion,
  verifyMemberSmokeJourney,
  verifySpaAndCacheBehavior,
} from './verify-web.mjs'

describe('exact live test-tool route restoration', () => {
  const deployment = {
    buildHash: `sha256:${'c'.repeat(64)}`,
    hostingVersion: 'sites/petcare-c7483/versions/restoration-001',
  }
  const assignedDeviceId = 'PC-DEV-000001'

  function restorationBrowser() {
    const signedOut = {
      directLoad: vi.fn(async () => ({
        route: '/sign-in',
        routeName: 'sign-in',
        returnTo: '/test-tool',
        protectedContentVisible: false,
        testToolContentVisible: false,
      })),
      close: vi.fn(async () => undefined),
    }
    const authenticated = {
      directLoad: vi.fn(async () => ({
        route: '/test-tool',
        routeName: 'test-tool',
        eligibleDeviceIds: [assignedDeviceId],
      })),
      reload: vi.fn(async () => ({
        route: '/test-tool',
        routeName: 'test-tool',
        eligibleDeviceIds: [assignedDeviceId],
      })),
      verifyBoundedEventProjection: vi.fn(async () => ({
        status: 'verified',
        bounded: true,
        webProjection: true,
      })),
      signOutAndVerifyOfflineCache: vi.fn(async () => ({
        route: '/sign-in',
        protectedContentVisible: false,
        priorTesterDataVisible: false,
        formStateVisible: false,
        cacheExclusion: true,
      })),
      close: vi.fn(async () => undefined),
    }
    return {
      signedOut,
      authenticated,
      browser: {
        createContext: vi.fn(async ({ session }) =>
          session === 'signed-out' ? signedOut : authenticated,
        ),
      },
    }
  }

  it('binds every restoration check to one Hosting version and build hash', async () => {
    const { browser, signedOut, authenticated } = restorationBrowser()

    await expect(verifyExactTestToolRouteRestoration({
      browser,
      deployment,
      assignedDeviceId,
    })).resolves.toEqual({
      status: 'verified',
      hostingVersion: deployment.hostingVersion,
      buildHash: deployment.buildHash,
      checks: {
        signedOutReturnPath: 'passed',
        authenticatedDirectOpen: 'passed',
        authenticatedReload: 'passed',
        eligibleDeviceBoundary: 'passed',
        eventProjection: 'passed',
        cacheExclusion: 'passed',
      },
    })
    expect(browser.createContext.mock.calls).toEqual([
      [{
        session: 'signed-out',
        storage: 'isolated',
        hostingVersion: deployment.hostingVersion,
        buildHash: deployment.buildHash,
      }],
      [{
        session: 'owner',
        storage: 'isolated',
        hostingVersion: deployment.hostingVersion,
        buildHash: deployment.buildHash,
      }],
    ])
    expect(signedOut.directLoad).toHaveBeenCalledWith('/test-tool')
    expect(authenticated.directLoad).toHaveBeenCalledWith('/test-tool')
    expect(authenticated.reload).toHaveBeenCalledWith('/test-tool')
    expect(authenticated.verifyBoundedEventProjection).toHaveBeenCalledWith({
      deviceId: assignedDeviceId,
    })
    expect(JSON.stringify(await verifyExactTestToolRouteRestoration({
      browser: restorationBrowser().browser,
      deployment,
      assignedDeviceId,
    }))).not.toContain(assignedDeviceId)
    expect(signedOut.close).toHaveBeenCalledOnce()
    expect(authenticated.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['home fallback', 'signedOut', 'directLoad', { route: '/', routeName: 'home', returnTo: null, protectedContentVisible: false, testToolContentVisible: false }],
    ['lost return path', 'signedOut', 'directLoad', { route: '/sign-in', routeName: 'sign-in', returnTo: '/', protectedContentVisible: false, testToolContentVisible: false }],
    ['unexpected device', 'authenticated', 'directLoad', { route: '/test-tool', routeName: 'test-tool', eligibleDeviceIds: ['PC-DEV-999999'] }],
    ['failed projection', 'authenticated', 'verifyBoundedEventProjection', { status: 'failed', bounded: true, webProjection: false }],
    ['unsafe offline cache', 'authenticated', 'signOutAndVerifyOfflineCache', { route: '/test-tool', protectedContentVisible: true, priorTesterDataVisible: true, formStateVisible: true, cacheExclusion: false }],
  ])('fails closed for %s', async (_case, contextName, method, result) => {
    const fixture = restorationBrowser()
    fixture[contextName][method].mockResolvedValue(result)

    await expect(verifyExactTestToolRouteRestoration({
      browser: fixture.browser,
      deployment,
      assignedDeviceId,
    })).rejects.toMatchObject({ code: 'test_tool_route_restoration_failed' })
    expect(fixture.signedOut.close).toHaveBeenCalledOnce()
    expect(fixture.authenticated.close).toHaveBeenCalledOnce()
  })

  it('fails closed when either isolated context cannot be torn down', async () => {
    const fixture = restorationBrowser()
    fixture.authenticated.close.mockImplementation(() => {
      throw new Error('sensitive teardown detail')
    })

    await expect(verifyExactTestToolRouteRestoration({
      browser: fixture.browser,
      deployment,
      assignedDeviceId,
    })).rejects.toMatchObject({
      code: 'test_tool_route_restoration_failed',
      message: expect.not.stringContaining('sensitive teardown detail'),
    })
  })
})

describe('development Hosting SPA and cache verification', () => {
  it('commits the SPA rewrite, shell revalidation, and immutable hashed-asset headers', () => {
    const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting

    expect(hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }])
    expect(hosting.headers).toEqual([
      {
        source: '/{,history,stats,test-tool,sign-in,index.html}',
        headers: [{ key: 'Cache-Control', value: 'public,max-age=0,must-revalidate' }],
      },
      {
        source: '/assets/**',
        headers: [{ key: 'Cache-Control', value: 'public,max-age=31536000,immutable' }],
      },
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'public,max-age=0,must-revalidate' }],
      },
    ])
  })

  it('verifies that a direct /test-tool reload serves the shell with revalidation while hashed assets are immutable', async () => {
    const shell = '<!doctype html><div id="app"></div>'
    const request = vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      if (path.startsWith('/assets/')) {
        return new Response('asset', {
          headers: { 'Cache-Control': 'public,max-age=31536000,immutable' },
        })
      }
      return new Response(shell, {
        headers: { 'Cache-Control': 'public,max-age=0,must-revalidate' },
      })
    })

    const result = await verifySpaAndCacheBehavior({
      origin: 'https://petcare-c7483.web.app',
      protectedRoute: '/test-tool',
      hashedAssetPath: '/assets/index-a1b2c3d4.js',
      request,
    })

    expect(request).toHaveBeenCalledWith('https://petcare-c7483.web.app/index.html')
    expect(request).toHaveBeenCalledWith('https://petcare-c7483.web.app/test-tool')
    expect(result).toEqual({
      status: 'verified',
      protectedRoute: '/test-tool',
      shellCache: 'public,max-age=0,must-revalidate',
      assetCache: 'public,max-age=31536000,immutable',
    })
  })

  it('fails when a direct route is cached or does not return the same app shell', async () => {
    const request = vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      if (path === '/index.html') {
        return new Response('<div id="app"></div>', {
          headers: { 'Cache-Control': 'public,max-age=0,must-revalidate' },
        })
      }
      if (path.startsWith('/assets/')) {
        return new Response('asset', {
          headers: { 'Cache-Control': 'public,max-age=31536000,immutable' },
        })
      }
      return new Response('<h1>404</h1>', {
        headers: { 'Cache-Control': 'public,max-age=3600' },
      })
    })

    await expect(
      verifySpaAndCacheBehavior({
        origin: 'https://petcare-c7483.web.app',
        protectedRoute: '/test-tool',
        hashedAssetPath: '/assets/index-a1b2c3d4.js',
        request,
      }),
    ).rejects.toMatchObject({ code: 'spa_or_cache_verification_failed' })
  })
})

describe('member data cache exclusion', () => {
  function safeBrowser() {
    return {
      signInOwner: vi.fn(async () => undefined),
      expectMemberDataVisible: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      goOffline: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      inspectCacheStorage: vi.fn(async () => [
        { url: 'https://petcare-c7483.web.app/index.html', body: '<div id="app"></div>' },
        { url: 'https://petcare-c7483.web.app/assets/index-a1b2c3d4.js', body: 'app shell' },
      ]),
      readOfflineState: vi.fn(async () => ({
        shellVisible: true,
        protectedContentVisible: false,
        route: '/sign-in',
      })),
    }
  }

  it('signs out, reopens offline, and verifies that only shell assets remain visible/cached', async () => {
    const browser = safeBrowser()

    const result = await verifyMemberDataCacheExclusion({
      browser,
      priorMemberMarkers: ['PC-000001', '42 ml'],
    })

    expect(browser.signInOwner).toHaveBeenCalledOnce()
    expect(browser.expectMemberDataVisible).toHaveBeenCalledOnce()
    expect(browser.signOut).toHaveBeenCalledOnce()
    expect(browser.goOffline).toHaveBeenCalledOnce()
    expect(browser.reload).toHaveBeenCalledWith('/')
    expect(result).toEqual({
      status: 'verified',
      cachedShellEntries: 2,
      offlineRoute: '/sign-in',
      priorMemberDataVisible: false,
    })
  })

  it.each([
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
    'https://securetoken.googleapis.com/v1/token',
    'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel',
    'https://accounts.google.com/gsi/client',
    'https://peecare-member-development.example.run.app/v1/devices/PC-000001/display-name',
  ])('fails when Cache Storage contains protected network response %s', async (url) => {
    const browser = safeBrowser()
    browser.inspectCacheStorage.mockResolvedValue([{ url, body: '{}' }])

    await expect(
      verifyMemberDataCacheExclusion({ browser, priorMemberMarkers: ['PC-000001'] }),
    ).rejects.toMatchObject({ code: 'member_data_cache_exclusion_failed' })
  })

  it('fails when an offline shell or cached asset reveals prior member data', async () => {
    const browser = safeBrowser()
    browser.inspectCacheStorage.mockResolvedValue([
      {
        url: 'https://petcare-c7483.web.app/index.html',
        body: '<div id="app">PC-000001</div>',
      },
    ])

    await expect(
      verifyMemberDataCacheExclusion({ browser, priorMemberMarkers: ['PC-000001'] }),
    ).rejects.toMatchObject({ code: 'member_data_cache_exclusion_failed' })
  })
})

describe('test-tool data cache exclusion', () => {
  const apiOrigin =
    'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app'
  const device = { deviceId: 'PC-DEV-000001', displayName: '浴室測試機' }
  const request = {
    eventType: 'urination',
    flushDurationMs: 1_500,
    pumpDurationMs: 2_500,
  }
  const result = {
    status: 'stored',
    eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
    eventType: 'urination',
    deviceId: 'PC-DEV-000001',
    sequence: 17,
  }

  function safeBrowser() {
    const context = {
      startNetworkInspection: vi.fn(async () => undefined),
      signInOwner: vi.fn(async () => undefined),
      visit: vi.fn(async () => undefined),
      expectTesterDataVisible: vi.fn(async () => device),
      submitTesterEvent: vi.fn(async () => ({ request, result })),
      signOut: vi.fn(async () => undefined),
      goOffline: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      inspectNetworkRequests: vi.fn(async () => [
        {
          url: `${apiOrigin}/v1/test-devices`,
          method: 'GET',
          servedFromCache: false,
        },
        {
          url: `${apiOrigin}/v1/test-devices/PC-DEV-000001/events`,
          method: 'POST',
          servedFromCache: false,
        },
      ]),
      inspectCacheStorage: vi.fn(async () => [
        { url: 'https://petcare-c7483.web.app/index.html', body: '<div id="app"></div>' },
        { url: 'https://petcare-c7483.web.app/assets/index-a1b2c3d4.js', body: 'app shell' },
      ]),
      readOfflineState: vi.fn(async () => ({
        shellVisible: true,
        protectedContentVisible: false,
        priorTesterDataVisible: false,
        formStateVisible: false,
        route: '/sign-in',
      })),
      close: vi.fn(async () => undefined),
    }
    return {
      context,
      browser: {
        createContext: vi.fn(async () => context),
      },
    }
  }

  it('uses network-only tester API traffic, signs out, and reloads /test-tool offline with no prior data', async () => {
    const { browser, context } = safeBrowser()

    const result = await verifyTestToolDataCacheExclusion({
      browser,
      apiOrigin,
    })

    expect(browser.createContext).toHaveBeenCalledWith({
      session: 'owner',
      storage: 'isolated',
      serviceWorker: 'production',
    })
    expect(context.visit).toHaveBeenCalledWith('/test-tool')
    expect(context.submitTesterEvent).toHaveBeenCalledWith({ deviceId: device.deviceId })
    expect(context.signOut).toHaveBeenCalledOnce()
    expect(context.goOffline).toHaveBeenCalledOnce()
    expect(context.reload).toHaveBeenCalledWith('/test-tool')
    expect(context.startNetworkInspection.mock.invocationCallOrder[0]).toBeLessThan(
      context.signInOwner.mock.invocationCallOrder[0],
    )
    expect(context.close).toHaveBeenCalledOnce()
    expect(result).toEqual({
      status: 'verified',
      apiRequests: 2,
      cachedShellEntries: 2,
      offlineRoute: '/sign-in',
      priorTesterDataVisible: false,
    })
  })

  it.each([
    ['cached API response', { cacheUrl: `${apiOrigin}/v1/test-devices`, cacheBody: '{}' }],
    ['device marker in cache body', { cacheUrl: 'https://petcare-c7483.web.app/index.html', cacheBody: device.deviceId }],
    ['event marker in cache body', { cacheUrl: 'https://petcare-c7483.web.app/assets/app.js', cacheBody: result.eventId }],
    ['submitted form in cache body', { cacheUrl: 'https://petcare-c7483.web.app/assets/app.js', cacheBody: JSON.stringify(request) }],
    ['canonical result in cache body', { cacheUrl: 'https://petcare-c7483.web.app/assets/app.js', cacheBody: JSON.stringify(result) }],
  ])('rejects %s', async (_name, fixture) => {
    const { browser, context } = safeBrowser()
    context.inspectCacheStorage.mockResolvedValue([
      { url: fixture.cacheUrl, body: fixture.cacheBody },
    ])

    await expect(verifyTestToolDataCacheExclusion({
      browser,
      apiOrigin,
    })).rejects.toMatchObject({ code: 'test_tool_cache_exclusion_failed' })
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('rejects tester API traffic served from a service-worker cache', async () => {
    const { browser, context } = safeBrowser()
    context.inspectNetworkRequests.mockResolvedValue([
      {
        url: `${apiOrigin}/v1/test-devices`,
        method: 'GET',
        servedFromCache: true,
      },
      {
        url: `${apiOrigin}/v1/test-devices/PC-DEV-000001/events`,
        method: 'POST',
        servedFromCache: false,
      },
    ])

    await expect(verifyTestToolDataCacheExclusion({
      browser,
      apiOrigin,
    })).rejects.toMatchObject({ code: 'test_tool_cache_exclusion_failed' })
  })

  it('fails closed for an unapproved origin or unreadable cache bodies', async () => {
    const { browser, context } = safeBrowser()
    await expect(verifyTestToolDataCacheExclusion({
      browser,
      apiOrigin: 'https://other.example.run.app',
    })).rejects.toMatchObject({ code: 'test_tool_cache_exclusion_failed' })

    context.inspectCacheStorage.mockResolvedValue([
      { url: 'https://petcare-c7483.web.app/index.html', body: null as unknown as string },
    ])
    await expect(verifyTestToolDataCacheExclusion({
      browser,
      apiOrigin,
    })).rejects.toMatchObject({ code: 'test_tool_cache_exclusion_failed' })
  })

  it.each([
    ['extra device field', { visible: { ...device, ownerUid: 'must-not-enter-verifier' } }],
    ['wrong result device', { submission: { request, result: { ...result, deviceId: 'PC-DEV-OTHER' } } }],
    ['wrong result event type', { submission: { request, result: { ...result, eventType: 'battery' } } }],
  ])('rejects journey evidence with %s', async (_name, override) => {
    const { browser, context } = safeBrowser()
    if (override.visible) context.expectTesterDataVisible.mockResolvedValue(override.visible)
    if (override.submission) context.submitTesterEvent.mockResolvedValue(override.submission)

    await expect(verifyTestToolDataCacheExclusion({ browser, apiOrigin })).rejects.toMatchObject({
      code: 'test_tool_cache_exclusion_failed',
    })
    if (override.visible) expect(context.submitTesterEvent).not.toHaveBeenCalled()
  })

  it('rejects a context missing mandatory cleanup before sign-in or mutation', async () => {
    const { browser, context } = safeBrowser()
    const { close: _missing, ...withoutClose } = context
    browser.createContext.mockResolvedValue(withoutClose as typeof context)

    await expect(verifyTestToolDataCacheExclusion({ browser, apiOrigin })).rejects.toMatchObject({
      code: 'test_tool_cache_exclusion_failed',
    })
    expect(context.signInOwner).not.toHaveBeenCalled()
    expect(context.submitTesterEvent).not.toHaveBeenCalled()
  })

  it('binds the observed POST path to the eligible device from this journey', async () => {
    const { browser, context } = safeBrowser()
    context.inspectNetworkRequests.mockResolvedValue([
      { url: `${apiOrigin}/v1/test-devices`, method: 'GET', servedFromCache: false },
      {
        url: `${apiOrigin}/v1/test-devices/PC-DEV-OTHER/events`,
        method: 'POST',
        servedFromCache: false,
      },
    ])

    await expect(verifyTestToolDataCacheExclusion({ browser, apiOrigin })).rejects.toMatchObject({
      code: 'test_tool_cache_exclusion_failed',
    })
  })

  it.each([
    { protectedContentVisible: true },
    { priorTesterDataVisible: true },
    { formStateVisible: true },
    { route: '/test-tool' },
  ])('rejects unsafe offline state %j', async (override) => {
    const { browser, context } = safeBrowser()
    context.readOfflineState.mockResolvedValue({
      shellVisible: true,
      protectedContentVisible: false,
      priorTesterDataVisible: false,
      formStateVisible: false,
      route: '/sign-in',
      ...override,
    })

    await expect(verifyTestToolDataCacheExclusion({
      browser,
      apiOrigin,
    })).rejects.toMatchObject({ code: 'test_tool_cache_exclusion_failed' })
  })
})

describe('development member smoke journey', () => {
  function smokeBrowser() {
    return {
      setViewport: vi.fn(async (viewport) => viewport),
      visit: vi.fn(async () => undefined),
      signInDevelopmentMember: vi.fn(async () => undefined),
      expectOwnedDeviceOverview: vi.fn(async () => undefined),
      expectHistory: vi.fn(async () => undefined),
      expectDailyStats: vi.fn(async () => undefined),
      verifyNonOwnerDenied: vi.fn(async () => ({
        denied: true,
        protectedContentVisible: false,
      })),
      signOut: vi.fn(async () => undefined),
      readRoute: vi.fn(async () => '/sign-in'),
    }
  }

  it('verifies the complete development member journey at the fixed mobile viewport', async () => {
    const browser = smokeBrowser()

    const result = await verifyMemberSmokeJourney({ browser })

    expect(browser.setViewport).toHaveBeenCalledWith({
      width: 390,
      height: 844,
      isMobile: true,
    })
    expect(browser.visit.mock.calls).toEqual([
      ['/sign-in'],
      ['/'],
      ['/history'],
      ['/stats'],
    ])
    expect(result).toEqual({
      status: 'verified',
      viewport: { width: 390, height: 844, isMobile: true },
      flows: [
        'sign-in',
        'owned-device-overview',
        'history',
        'daily-stats',
        'non-owner-denial',
        'sign-out',
      ],
    })
  })

  it('fails closed when non-owner data is visible', async () => {
    const browser = smokeBrowser()
    browser.verifyNonOwnerDenied.mockResolvedValue({
      denied: false,
      protectedContentVisible: true,
    })

    await expect(verifyMemberSmokeJourney({ browser })).rejects.toMatchObject({
      code: 'member_smoke_failed',
    })
    expect(browser.signOut).not.toHaveBeenCalled()
  })

  it('fails when sign-out does not return to the sign-in route', async () => {
    const browser = smokeBrowser()
    browser.readRoute.mockResolvedValue('/stats')

    await expect(verifyMemberSmokeJourney({ browser })).rejects.toMatchObject({
      code: 'member_smoke_failed',
    })
  })
})

describe('Hosting release record', () => {
  function verifiedInputs() {
    return {
      deployment: {
        status: 'deployed',
        projectId: 'petcare-c7483',
        hostingTarget: 'development',
        hostingSite: 'petcare-c7483',
        buildHash: `sha256:${'a'.repeat(64)}`,
        firebaseApiKey: 'must-not-be-recorded',
      },
      hostingRelease: {
        version: 'sites/petcare-c7483/versions/abc123',
        rollbackVersion: 'sites/petcare-c7483/versions/prior456',
        accessToken: 'must-not-be-recorded',
      },
      verification: {
        spaAndCache: {
          status: 'verified',
          protectedRoute: '/test-tool',
          shellCache: 'public,max-age=0,must-revalidate',
          assetCache: 'public,max-age=31536000,immutable',
        },
        memberJourney: {
          status: 'verified',
          viewport: { width: 390, height: 844, isMobile: true },
          flows: [
            'sign-in',
            'owned-device-overview',
            'history',
            'daily-stats',
            'non-owner-denial',
            'sign-out',
          ],
        },
        memberDataCacheExclusion: {
          status: 'verified',
          cachedShellEntries: 8,
          offlineRoute: '/sign-in',
          priorMemberDataVisible: false,
        },
        testToolDataCacheExclusion: {
          status: 'verified',
          apiRequests: 2,
          cachedShellEntries: 8,
          offlineRoute: '/sign-in',
          priorTesterDataVisible: false,
        },
        protectedRouteReload: {
          status: 'verified',
          owner: {
            '/': '/',
            '/history': '/history',
            '/stats': '/stats',
            '/test-tool': '/test-tool',
            '/sign-in': '/',
          },
          signedOut: {
            '/': '/sign-in',
            '/history': '/sign-in',
            '/stats': '/sign-in',
            '/test-tool': '/sign-in',
            '/sign-in': '/sign-in',
          },
          protectedContentLeak: false,
        },
        testToolRouteRestoration: {
          status: 'verified',
          hostingVersion: 'sites/petcare-c7483/versions/abc123',
          buildHash: `sha256:${'a'.repeat(64)}`,
          checks: {
            signedOutReturnPath: 'passed',
            authenticatedDirectOpen: 'passed',
            authenticatedReload: 'passed',
            eligibleDeviceBoundary: 'passed',
            eventProjection: 'passed',
            cacheExclusion: 'passed',
          },
        },
      },
      now: () => new Date('2026-08-11T02:30:00.000Z'),
    }
  }

  it('records exact deployed and rollback versions only after every verification passes', () => {
    const output: string[] = []

    const record = createHostingReleaseRecord({
      ...verifiedInputs(),
      write: (line) => output.push(line),
    })

    expect(record).toEqual({
      status: 'healthy',
      projectId: 'petcare-c7483',
      hostingTarget: 'development',
      hostingSite: 'petcare-c7483',
      buildHash: `sha256:${'a'.repeat(64)}`,
      hostingVersion: 'sites/petcare-c7483/versions/abc123',
      rollbackVersion: 'sites/petcare-c7483/versions/prior456',
      verifiedAt: '2026-08-11T02:30:00.000Z',
      smoke: {
        spaAndCache: 'passed',
        memberJourney: 'passed',
        memberDataCacheExclusion: 'passed',
        testToolDataCacheExclusion: 'passed',
        protectedRouteReload: 'passed',
        testToolRouteRestoration: 'passed',
      },
    })
    expect(JSON.parse(output[0])).toEqual(record)
    expect(output[0]).not.toMatch(/api.?key|access.?token|credential|password|secret/i)
  })

  it.each([
    ['failed deployment', { deployment: { status: 'ready' } }],
    ['wrong target', { deployment: { hostingTarget: 'production' } }],
    ['invalid build hash', { deployment: { buildHash: 'latest' } }],
    ['invalid Hosting version', { hostingRelease: { version: 'abc123' } }],
    [
      'same rollback version',
      {
        hostingRelease: {
          rollbackVersion: 'sites/petcare-c7483/versions/abc123',
        },
      },
    ],
    [
      'failed smoke check',
      { verification: { memberJourney: { status: 'failed' } } },
    ],
    [
      'status-only smoke evidence',
      { verification: { protectedRouteReload: { status: 'verified' } } },
    ],
    [
      'missing test-tool cache evidence',
      { verification: { testToolDataCacheExclusion: undefined } },
    ],
    [
      'failed test-tool cache evidence',
      { verification: { testToolDataCacheExclusion: { status: 'failed' } } },
    ],
    [
      'status-only test-tool cache evidence',
      { verification: { testToolDataCacheExclusion: { status: 'verified' } } },
    ],
    [
      'extra test-tool cache evidence field',
      {
        verification: {
          testToolDataCacheExclusion: {
            status: 'verified',
            apiRequests: 2,
            cachedShellEntries: 8,
            offlineRoute: '/sign-in',
            priorTesterDataVisible: false,
            rawDeviceId: 'must-not-be-recorded',
          },
        },
      },
    ],
    [
      'test-tool restoration bound to another build',
      {
        verification: {
          testToolRouteRestoration: {
            ...verifiedInputs().verification.testToolRouteRestoration,
            buildHash: `sha256:${'b'.repeat(64)}`,
          },
        },
      },
    ],
    [
      'test-tool restoration bound to another Hosting version',
      {
        verification: {
          testToolRouteRestoration: {
            ...verifiedInputs().verification.testToolRouteRestoration,
            hostingVersion: 'sites/petcare-c7483/versions/other',
          },
        },
      },
    ],
    [
      'incomplete test-tool restoration checks',
      {
        verification: {
          testToolRouteRestoration: {
            ...verifiedInputs().verification.testToolRouteRestoration,
            checks: { signedOutReturnPath: 'passed' },
          },
        },
      },
    ],
  ])('refuses a healthy record for %s', (_case, overrides) => {
    const base = verifiedInputs()
    const input = {
      ...base,
      deployment: { ...base.deployment, ...overrides.deployment },
      hostingRelease: { ...base.hostingRelease, ...overrides.hostingRelease },
      verification: { ...base.verification, ...overrides.verification },
      write: vi.fn(),
    }

    expect(() => createHostingReleaseRecord(input)).toThrowError(
      expect.objectContaining({ code: 'release_record_rejected' }),
    )
    expect(input.write).not.toHaveBeenCalled()
  })
})

describe('protected route reload matrix', () => {
  function routeBrowser() {
    const owner = {
      directLoad: vi.fn(async (path: string) => ({
        shellVisible: true,
        route: path === '/sign-in' ? '/' : path,
        protectedContentVisible: true,
      })),
      close: vi.fn(async () => undefined),
    }
    const signedOut = {
      directLoad: vi.fn(async (path: string) => ({
        shellVisible: true,
        route: '/sign-in',
        protectedContentVisible: false,
        requestedPath: path,
      })),
      close: vi.fn(async () => undefined),
    }
    return {
      owner,
      signedOut,
      browser: {
        createContext: vi.fn(async ({ session }) =>
          session === 'owner' ? owner : signedOut,
        ),
      },
    }
  }

  it('direct-loads every protected route including the tester tool with exact restore/guard behavior', async () => {
    const { browser, owner, signedOut } = routeBrowser()

    const result = await verifyProtectedRouteReloadMatrix({ browser })

    const expectedLoads = [['/'], ['/history'], ['/stats'], ['/test-tool'], ['/sign-in']]
    expect(owner.directLoad.mock.calls).toEqual(expectedLoads)
    expect(signedOut.directLoad.mock.calls).toEqual(expectedLoads)
    expect(owner.close).toHaveBeenCalledOnce()
    expect(signedOut.close).toHaveBeenCalledOnce()
    expect(result).toEqual({
      status: 'verified',
      owner: {
        '/': '/',
        '/history': '/history',
        '/stats': '/stats',
        '/test-tool': '/test-tool',
        '/sign-in': '/',
      },
      signedOut: {
        '/': '/sign-in',
        '/history': '/sign-in',
        '/stats': '/sign-in',
        '/test-tool': '/sign-in',
        '/sign-in': '/sign-in',
      },
      protectedContentLeak: false,
    })
  })

  it('fails when a signed-out direct load renders protected stats content', async () => {
    const { browser, signedOut } = routeBrowser()
    signedOut.directLoad.mockImplementation(async (path: string) => ({
      shellVisible: true,
      route: '/sign-in',
      protectedContentVisible: path === '/stats',
    }))

    await expect(verifyProtectedRouteReloadMatrix({ browser })).rejects.toMatchObject({
      code: 'protected_route_reload_failed',
    })
    expect(signedOut.close).toHaveBeenCalledOnce()
  })

  it('fails when an Owner direct reload does not restore the requested route', async () => {
    const { browser, owner } = routeBrowser()
    owner.directLoad.mockImplementation(async (path: string) => ({
      shellVisible: true,
      route: path === '/history' ? '/' : path === '/sign-in' ? '/' : path,
      protectedContentVisible: true,
    }))

    await expect(verifyProtectedRouteReloadMatrix({ browser })).rejects.toMatchObject({
      code: 'protected_route_reload_failed',
    })
    expect(owner.close).toHaveBeenCalledOnce()
  })
})
