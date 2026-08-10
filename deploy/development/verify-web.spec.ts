import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  createHostingReleaseRecord,
  verifyProtectedRouteReloadMatrix,
  verifyMemberDataCacheExclusion,
  verifyMemberSmokeJourney,
  verifySpaAndCacheBehavior,
} from './verify-web.mjs'

describe('development Hosting SPA and cache verification', () => {
  it('commits the SPA rewrite, shell revalidation, and immutable hashed-asset headers', () => {
    const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting

    expect(hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }])
    expect(hosting.headers).toEqual([
      {
        source: '/{,history,stats,sign-in,index.html}',
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

  it('verifies that a direct /history reload serves the shell with revalidation while hashed assets are immutable', async () => {
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
      protectedRoute: '/history',
      hashedAssetPath: '/assets/index-a1b2c3d4.js',
      request,
    })

    expect(request).toHaveBeenCalledWith('https://petcare-c7483.web.app/index.html')
    expect(request).toHaveBeenCalledWith('https://petcare-c7483.web.app/history')
    expect(result).toEqual({
      status: 'verified',
      protectedRoute: '/history',
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
        protectedRoute: '/history',
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
          protectedRoute: '/history',
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
        protectedRouteReload: {
          status: 'verified',
          owner: {
            '/': '/',
            '/history': '/history',
            '/stats': '/stats',
            '/sign-in': '/',
          },
          signedOut: {
            '/': '/sign-in',
            '/history': '/sign-in',
            '/stats': '/sign-in',
            '/sign-in': '/sign-in',
          },
          protectedContentLeak: false,
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
        protectedRouteReload: 'passed',
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

  it('direct-loads all four routes as Owner and signed-out visitor with exact restore/guard behavior', async () => {
    const { browser, owner, signedOut } = routeBrowser()

    const result = await verifyProtectedRouteReloadMatrix({ browser })

    const expectedLoads = [['/'], ['/history'], ['/stats'], ['/sign-in']]
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
        '/sign-in': '/',
      },
      signedOut: {
        '/': '/sign-in',
        '/history': '/sign-in',
        '/stats': '/sign-in',
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
