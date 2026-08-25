import { chromium } from 'playwright-core'

const APPROVED_BETA_ORIGIN = 'https://petcare-c7483.web.app'
const NAVIGATION_OPTIONS = Object.freeze({ waitUntil: 'domcontentloaded' })
const FIREBASE_UID_READ_ATTEMPTS = 50
const FIREBASE_UID_READ_DELAY_MS = 100

class PlaywrightBetaBrowserError extends Error {
  constructor(code) {
    super('The static beta browser harness failed.')
    this.name = 'PlaywrightBetaBrowserError'
    this.code = code
  }
}

function browserFailure(code = 'smoke_failed') {
  throw new PlaywrightBetaBrowserError(code)
}

function approvedUrl(path) {
  return new URL(path, APPROVED_BETA_ORIGIN).toString()
}

async function readFirebaseUid() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('firebaseLocalStorageDb')
    request.onerror = () => reject(new Error('auth persistence unavailable'))
    request.onsuccess = () => {
      const database = request.result
      try {
        const transaction = database.transaction('firebaseLocalStorage', 'readonly')
        const values = transaction.objectStore('firebaseLocalStorage').getAll()
        values.onerror = () => {
          database.close()
          reject(new Error('auth persistence unreadable'))
        }
        values.onsuccess = () => {
          const user = values.result
            .map((entry) => entry?.value)
            .find(
              (value) =>
                value !== null &&
                typeof value === 'object' &&
                typeof value.uid === 'string' &&
                value.uid.length > 0 &&
                value.stsTokenManager !== null &&
                typeof value.stsTokenManager === 'object',
            )
          database.close()
          resolve(user?.uid ?? null)
        }
      } catch {
        database.close()
        reject(new Error('auth persistence unreadable'))
      }
    }
  })
}

async function clearFirebaseAuthPersistence() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('firebaseLocalStorageDb')
    request.onerror = () => reject(new Error('auth persistence cleanup failed'))
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('firebaseLocalStorage')) {
        database.close()
        resolve(undefined)
        return
      }
      const transaction = database.transaction('firebaseLocalStorage', 'readwrite')
      transaction.objectStore('firebaseLocalStorage').clear()
      transaction.oncomplete = () => {
        database.close()
        resolve(undefined)
      }
      transaction.onerror = () => {
        database.close()
        reject(new Error('auth persistence cleanup failed'))
      }
      transaction.onabort = transaction.onerror
    }
  })
}

async function clearAllIndexedDatabases() {
  const databases =
    typeof indexedDB.databases === 'function'
      ? await indexedDB.databases()
      : [{ name: 'firebaseLocalStorageDb' }]
  await Promise.all(
    databases
      .map((database) => database.name)
      .filter((name) => typeof name === 'string' && name.length > 0)
      .map(
        (name) =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open(name)
            request.onerror = () => reject(new Error('indexed database cleanup failed'))
            request.onsuccess = () => {
              const database = request.result
              if (database.objectStoreNames.length === 0) {
                database.close()
                resolve(undefined)
                return
              }
              const stores = Array.from(database.objectStoreNames)
              const transaction = database.transaction(stores, 'readwrite')
              for (const store of stores) transaction.objectStore(store).clear()
              transaction.oncomplete = () => {
                database.close()
                resolve(undefined)
              }
              transaction.onerror = () => {
                database.close()
                reject(new Error('indexed database cleanup failed'))
              }
              transaction.onabort = transaction.onerror
            }
          }),
      ),
  )
}

async function clearAllCacheStorage() {
  const keys = await caches.keys()
  const results = await Promise.all(keys.map((key) => caches.delete(key)))
  if (results.some((deleted) => deleted !== true)) {
    throw new Error('cache cleanup failed')
  }
}

async function clearServiceWorkerState() {
  const registrations = await navigator.serviceWorker.getRegistrations()
  const results = await Promise.all(registrations.map((registration) => registration.unregister()))
  if (results.some((unregistered) => unregistered !== true)) {
    throw new Error('service worker cleanup failed')
  }
}

async function ownedDeviceIds(page) {
  await page.goto(approvedUrl('/settings'), NAVIGATION_OPTIONS)
  const devices = page.locator('[data-test="devices-list"] > [data-device-id]')
  await devices.waitFor({ state: 'visible' })
  return devices.evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('data-device-id'))
      .filter((deviceId) => typeof deviceId === 'string' && deviceId.length > 0),
  )
}

function createContextAdapter(page, browserContext, browser) {
  let authenticatedUid = null
  let authenticatedUidPromise = null

  async function resolveAuthenticatedUid() {
    if (authenticatedUid !== null) return authenticatedUid
    authenticatedUidPromise ??= (async () => {
      for (let attempt = 0; attempt < FIREBASE_UID_READ_ATTEMPTS; attempt += 1) {
        const uid = await page.evaluate(readFirebaseUid)
        if (typeof uid === 'string' && uid.length > 0) return uid
        if (attempt + 1 < FIREBASE_UID_READ_ATTEMPTS) {
          await page.waitForTimeout(FIREBASE_UID_READ_DELAY_MS)
        }
      }
      browserFailure('tester_authentication_failed')
    })()
    try {
      authenticatedUid = await authenticatedUidPromise
      return authenticatedUid
    } finally {
      authenticatedUidPromise = null
    }
  }

  async function exactAssignedDevice(deviceId) {
    const uid = await resolveAuthenticatedUid()
    const deviceIds = await ownedDeviceIds(page)
    if (
      typeof uid !== 'string' ||
      uid.length === 0 ||
      deviceIds.length !== 1 ||
      deviceIds[0] !== deviceId
    ) {
      browserFailure(deviceIds.length === 1 ? 'tester_device_mismatch' : 'unexpected_owned_device')
    }
    authenticatedUid = uid
    return Object.freeze({ deviceId, ownerUid: uid })
  }

  async function saveDeviceName(deviceId, value) {
    await page.goto(approvedUrl('/settings'), NAVIGATION_OPTIONS)
    const device = page.locator(`[data-device-id="${deviceId}"]`)
    await device.waitFor({ state: 'visible' })
    await page
      .locator(`[data-device-id="${deviceId}"] [data-test="device-edit"]`)
      .click()
    const input = page.locator('[data-test="device-name-input"]')
    await input.fill(value)
    await page.locator('[data-test="device-save"]').click()
    await input.waitFor({ state: 'hidden' })
    await page.reload(NAVIGATION_OPTIONS)
    await page
      .locator(`[data-device-id="${deviceId}"] [data-test="device-edit"]`)
      .click()
    await input.waitFor({ state: 'visible' })
    const expectedEditorValue = value.length === 0 ? deviceId : value
    if ((await input.inputValue()) !== expectedEditorValue) browserFailure()
    await page.locator('[data-test="device-cancel"]').click()
    await input.waitFor({ state: 'hidden' })
  }

  return Object.freeze({
    async visitHostedSignIn() {
      await page.goto(approvedUrl('/sign-in'), NAVIGATION_OPTIONS)
      await page.locator('[data-test="send-email-link"]').waitFor({ state: 'visible' })
    },
    async submitEmailLinkRequest(email) {
      await page.locator('input[type="email"]').fill(email)
      await page.locator('[data-test="send-email-link"]').click()
      await page.locator('[data-test="email-link-sent"]').waitFor({ state: 'visible' })
    },
    async openEmailLinkCallback(credentials) {
      await page.goto(credentials.emailLink, NAVIGATION_OPTIONS)
    },
    async completeEmailLinkCallback(credentials) {
      await page.waitForURL(
        (url) =>
          url.origin === APPROVED_BETA_ORIGIN &&
          ['/auth/email-link', '/', '/history', '/stats', '/settings'].includes(url.pathname),
      )
      const reentry = page.locator('[data-test="email-reentry"]')
      if ((await reentry.count()) === 1) {
        await reentry.locator('input[type="email"]').fill(credentials.email)
        await reentry.locator('button[type="submit"]').click()
      }
      await page.waitForURL(
        (url) =>
          url.origin === APPROVED_BETA_ORIGIN &&
          !['/auth/email-link', '/sign-in'].includes(url.pathname),
      )
    },
    async getAuthenticatedUid() {
      return resolveAuthenticatedUid()
    },
    readAssignedDevice: exactAssignedDevice,
    async expectOwnerOverview(deviceId) {
      await exactAssignedDevice(deviceId)
      await page.goto(approvedUrl('/'), NAVIGATION_OPTIONS)
      await page.locator('[data-test="hero-title"]').waitFor({ state: 'visible' })
    },
    async expectHistory(deviceId) {
      await exactAssignedDevice(deviceId)
      await page.goto(approvedUrl('/history'), NAVIGATION_OPTIONS)
      await page
        .locator('[data-test="history-list"], [data-test="history-empty"]')
        .waitFor({ state: 'visible' })
    },
    async expectDailyStats(deviceId) {
      await exactAssignedDevice(deviceId)
      await page.goto(approvedUrl('/stats'), NAVIGATION_OPTIONS)
      await page.locator('[data-test="daily-count-table"]').waitFor({ state: 'visible' })
    },
    renameDevice: saveDeviceName,
    clearDeviceName: (deviceId) => saveDeviceName(deviceId, ''),
    async reloadProtectedRoutes() {
      for (const path of ['/', '/history', '/stats', '/settings']) {
        await page.goto(approvedUrl(path), NAVIGATION_OPTIONS)
        await page.reload(NAVIGATION_OPTIONS)
        if (new URL(page.url()).pathname !== path) browserFailure()
      }
    },
    async signOut() {
      await page.goto(approvedUrl('/settings'), NAVIGATION_OPTIONS)
      await page.locator('[data-test="settings-sign-out"]').click()
      await page.waitForURL((url) => url.origin === APPROVED_BETA_ORIGIN && url.pathname === '/sign-in')
    },
    clearAuthPersistence: () => page.evaluate(clearFirebaseAuthPersistence),
    clearIndexedDB: () => page.evaluate(clearAllIndexedDatabases),
    clearCacheStorage: () => page.evaluate(clearAllCacheStorage),
    clearServiceWorkerMemberState: () => page.evaluate(clearServiceWorkerState),
    async close() {
      let contextFailure = false
      try {
        await browserContext.close()
      } catch {
        contextFailure = true
      }
      try {
        await browser.close()
      } catch {
        contextFailure = true
      }
      if (contextFailure) browserFailure('browser_context_teardown_failed')
    },
  })
}

export function createPlaywrightBetaBrowser() {
  return Object.freeze({
    async createContext() {
      const browser = await chromium.launch({ channel: 'chrome', headless: true })
      try {
        const browserContext = await browser.newContext({
          acceptDownloads: false,
          serviceWorkers: 'allow',
        })
        const page = await browserContext.newPage()
        return createContextAdapter(page, browserContext, browser)
      } catch (error) {
        await browser.close().catch(() => undefined)
        throw error
      }
    },
  })
}
