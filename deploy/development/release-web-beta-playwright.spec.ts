import { describe, expect, it, vi } from 'vitest'

const playwright = vi.hoisted(() => ({ launch: vi.fn() }))

vi.mock('playwright-core', () => ({
  chromium: { launch: playwright.launch },
}))

import { createPlaywrightBetaBrowser } from './release-web-beta-playwright.mjs'

function fixture({
  deviceIds = ['PC-DEV-000001'],
  persistDeviceName = true,
  rejectNavigationDuringUidRead = false,
  uidReadResults = ['owner-private-uid'],
} = {}) {
  const locators = new Map<string, Record<string, ReturnType<typeof vi.fn>>>()
  let persistedDeviceName = ''
  let draftDeviceName = ''
  const locator = (selector: string) => {
    if (!locators.has(selector)) {
      const record = {
        click: vi.fn(async () => undefined),
        fill: vi.fn(async () => undefined),
        waitFor: vi.fn(async () => undefined),
        evaluateAll: vi.fn(async () => deviceIds),
        count: vi.fn(async () => 1),
        getAttribute: vi.fn(async () => null),
        inputValue: vi.fn(async () => persistedDeviceName || 'PC-DEV-000001'),
        locator: vi.fn((nestedSelector: string) => locator(`${selector} ${nestedSelector}`)),
      }
      if (selector === '[data-test="device-name-input"]') {
        record.fill = vi.fn(async (value: string) => {
          draftDeviceName = value
        })
      }
      if (selector.endsWith('[data-test="device-edit"]')) {
        record.click = vi.fn(async () => {
          draftDeviceName = persistedDeviceName
        })
      }
      if (selector === '[data-test="device-save"]') {
        record.click = vi.fn(async () => {
          if (persistDeviceName) persistedDeviceName = draftDeviceName
        })
      }
      locators.set(selector, record)
    }
    return locators.get(selector)
  }
  let currentUrl = 'https://petcare-c7483.web.app/'
  let uidReadPending = false
  const pendingUidReadResults = [...uidReadResults]
  const page = {
    goto: vi.fn(async (url: string) => {
      if (url.endsWith('/settings') && uidReadPending) {
        throw new Error('navigation destroyed the UID evaluation context')
      }
      currentUrl = url
    }),
    reload: vi.fn(async () => undefined),
    locator: vi.fn(locator),
    waitForURL: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async (operation: { name?: string }) => {
      if (operation.name !== 'readFirebaseUid') return undefined
      uidReadPending = true
      if (rejectNavigationDuringUidRead) await Promise.resolve()
      uidReadPending = false
      return pendingUidReadResults.shift() ?? null
    }),
    url: vi.fn(() => currentUrl),
  }
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  }
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  }
  playwright.launch.mockResolvedValue(browser)
  return { browser, context, page, locator, locators }
}

describe('static Playwright beta browser harness', () => {
  it('launches system Chrome with an ephemeral artifact-free context and completes Email Link authentication', async () => {
    const test = fixture()
    const browser = createPlaywrightBetaBrowser()
    const context = await browser.createContext()
    const credentials = {
      email: 'beta.operator@example.test',
      emailLink:
        'https://petcare-c7483.firebaseapp.com/__/auth/action?mode=signIn&oobCode=one-time-code',
    }

    await context.visitHostedSignIn()
    await context.submitEmailLinkRequest(credentials.email)
    await context.openEmailLinkCallback(credentials)
    await context.completeEmailLinkCallback(credentials)

    expect(playwright.launch).toHaveBeenCalledWith({ channel: 'chrome', headless: true })
    expect(test.browser.newContext).toHaveBeenCalledWith({
      acceptDownloads: false,
      serviceWorkers: 'allow',
    })
    expect(test.page.goto).toHaveBeenNthCalledWith(
      1,
      'https://petcare-c7483.web.app/sign-in',
      { waitUntil: 'domcontentloaded' },
    )
    expect(test.locator('input[type="email"]')?.fill).toHaveBeenCalledWith(
      credentials.email,
    )
    expect(test.locator('[data-test="send-email-link"]')?.click).toHaveBeenCalledOnce()
    expect(test.locator('[data-test="email-link-sent"]')?.waitFor).toHaveBeenCalledWith({
      state: 'visible',
    })
    expect(test.page.goto).toHaveBeenNthCalledWith(2, credentials.emailLink, {
      waitUntil: 'domcontentloaded',
    })
    expect(test.page.waitForURL).toHaveBeenCalled()
  })

  it('returns only the exact assigned device and refuses an extra owned device', async () => {
    const accepted = fixture()
    const acceptedContext = await createPlaywrightBetaBrowser().createContext()

    await expect(
      acceptedContext.readAssignedDevice('PC-DEV-000001'),
    ).resolves.toEqual({
      deviceId: 'PC-DEV-000001',
      ownerUid: 'owner-private-uid',
    })

    const ambiguous = fixture({ deviceIds: ['PC-DEV-000001', 'PC-DEV-000002'] })
    const ambiguousContext = await createPlaywrightBetaBrowser().createContext()
    await expect(
      ambiguousContext.readAssignedDevice('PC-DEV-000001'),
    ).rejects.toMatchObject({ code: 'unexpected_owned_device' })
    expect(ambiguous.page.goto).toHaveBeenCalledWith(
      'https://petcare-c7483.web.app/settings',
      { waitUntil: 'domcontentloaded' },
    )
  })

  it('single-flights UID resolution before settings navigation', async () => {
    const test = fixture({ rejectNavigationDuringUidRead: true })
    const context = await createPlaywrightBetaBrowser().createContext()

    await expect(
      Promise.all([
        context.getAuthenticatedUid(),
        context.readAssignedDevice('PC-DEV-000001'),
      ]),
    ).resolves.toEqual([
      'owner-private-uid',
      { deviceId: 'PC-DEV-000001', ownerUid: 'owner-private-uid' },
    ])
    expect(test.page.evaluate).toHaveBeenCalledOnce()
  })

  it('waits for Firebase Auth persistence before resolving the authenticated UID', async () => {
    const test = fixture({ uidReadResults: [null, 'owner-private-uid'] })
    const context = await createPlaywrightBetaBrowser().createContext()

    await expect(context.getAuthenticatedUid()).resolves.toBe('owner-private-uid')
    expect(test.page.evaluate).toHaveBeenCalledTimes(2)
    expect(test.page.waitForTimeout).toHaveBeenCalledOnce()
  })

  it('fails when a rename acknowledgment does not persist after reload', async () => {
    fixture({ persistDeviceName: false })
    const context = await createPlaywrightBetaBrowser().createContext()

    await expect(
      context.renameDevice('PC-DEV-000001', 'PeeCare beta verification'),
    ).rejects.toMatchObject({ code: 'smoke_failed' })
  })

  it('covers overview, history, stats, rename-clear, protected reload, sign-out, and teardown', async () => {
    const test = fixture()
    const context = await createPlaywrightBetaBrowser().createContext()

    await context.expectOwnerOverview('PC-DEV-000001')
    await context.expectHistory('PC-DEV-000001')
    await context.expectDailyStats('PC-DEV-000001')
    await context.renameDevice('PC-DEV-000001', 'PeeCare beta verification')
    await context.clearDeviceName('PC-DEV-000001')
    await context.reloadProtectedRoutes()
    await context.signOut()
    await context.clearAuthPersistence()
    await context.clearIndexedDB()
    await context.clearCacheStorage()
    await context.clearServiceWorkerMemberState()
    await context.close()

    expect(test.page.goto.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        'https://petcare-c7483.web.app/',
        'https://petcare-c7483.web.app/history',
        'https://petcare-c7483.web.app/stats',
        'https://petcare-c7483.web.app/settings',
      ]),
    )
    expect(test.locator('[data-device-id="PC-DEV-000001"] [data-test="device-edit"]')?.click)
      .toHaveBeenCalled()
    expect(test.locator('[data-test="device-name-input"]')?.fill).toHaveBeenNthCalledWith(
      1,
      'PeeCare beta verification',
    )
    expect(test.locator('[data-test="device-name-input"]')?.fill).toHaveBeenNthCalledWith(2, '')
    expect(test.locator('[data-test="settings-sign-out"]')?.click).toHaveBeenCalledOnce()
    expect(test.page.evaluate.mock.calls.map(([operation]) => operation.name)).toEqual(
      expect.arrayContaining([
        'clearFirebaseAuthPersistence',
        'clearAllIndexedDatabases',
        'clearAllCacheStorage',
        'clearServiceWorkerState',
      ]),
    )
    expect(test.context.close).toHaveBeenCalledOnce()
    expect(test.browser.close).toHaveBeenCalledOnce()
  })
})
