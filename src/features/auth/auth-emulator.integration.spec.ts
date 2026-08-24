// Auth Emulator-backed integration for the passwordless member session flow.
//
// Runs only under vitest.firebase.config.ts. It asks the Emulator to deliver
// Email Links, retrieves those one-time links from the Emulator's local-only
// OOB endpoint, and completes them through the production AuthProvider. Session
// publication remains exclusively driven by the real Firebase observer.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sendSignInLinkToEmail } from 'firebase/auth'

import {
  getLocalFirebaseServices,
  resetLocalFirebaseServices,
} from '../../platform/firebase/local-client'
import type { RawFirebaseEnv } from '../../platform/firebase/config'
import { createAuthStore, createFirebaseAuthObserver } from './auth-store'
import { createFirebaseAuthProvider } from './auth-provider'
import type { AuthState } from './session'

const PROJECT_ID = 'demo-peecare'

function demoEnv(): RawFirebaseEnv {
  return {
    MODE: 'development',
    PROD: false,
    VITE_FIREBASE_USE_EMULATORS: 'true',
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_API_KEY: 'demo-api-key',
    VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
    VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8085',
  }
}

function waitForState(
  store: ReturnType<typeof createAuthStore>,
  predicate: (state: AuthState) => boolean,
  timeoutMs = 10_000,
): Promise<AuthState> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const state = store.state.value as AuthState
      if (predicate(state)) {
        resolve(state)
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for state; last was ${state.status}`))
        return
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

interface EmulatorOobCode {
  readonly email?: string
  readonly oobLink?: string
  readonly requestType?: string
}

async function requestEmailSignInLink(email: string): Promise<string> {
  const { auth } = getLocalFirebaseServices(demoEnv())
  await sendSignInLinkToEmail(auth, email, {
    url: 'http://localhost/auth/email-link?returnTo=%2F',
    handleCodeInApp: true,
  })

  const emulatorHost =
    process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
  const response = await fetch(
    `http://${emulatorHost}/emulator/v1/projects/${PROJECT_ID}/oobCodes`,
  )
  if (!response.ok) {
    throw new Error('Auth Emulator OOB endpoint was unavailable.')
  }

  const payload = (await response.json()) as { readonly oobCodes?: EmulatorOobCode[] }
  const matching = (payload.oobCodes ?? []).filter(
    (entry) =>
      entry.email === email &&
      entry.requestType === 'EMAIL_SIGNIN' &&
      typeof entry.oobLink === 'string' &&
      entry.oobLink.length > 0,
  )
  const latest = matching.at(-1)?.oobLink
  if (latest === undefined) {
    throw new Error('Auth Emulator returned no Email Sign-In OOB code.')
  }
  return latest
}

const emailOne = `member-one-${Date.now()}@peecare.test`
const emailTwo = `member-two-${Date.now()}@peecare.test`
let mountedStore: ReturnType<typeof createAuthStore> | null = null

describe('passwordless member authentication against the Auth Emulator', () => {
  beforeAll(async () => {
    resetLocalFirebaseServices()
    getLocalFirebaseServices(demoEnv())
    await createFirebaseAuthProvider().signOut()
  })

  afterEach(async () => {
    const store = mountedStore
    try {
      await createFirebaseAuthProvider().signOut()
    } finally {
      store?.dispose()
      expect(store?.activeObserverCount() ?? 0).toBe(0)
      mountedStore = null
      resetLocalFirebaseServices()
    }
  })

  afterAll(() => {
    resetLocalFirebaseServices()
  })

  it('completes new and existing Email Link users, switches UID with teardown, and signs out', async () => {
    const store = createAuthStore({ observer: createFirebaseAuthObserver() })
    mountedStore = store
    const provider = createFirebaseAuthProvider()
    store.mount()
    await store.whenResolved()
    expect(store.state.value.status).toBe('signed-out')

    // First completion creates a Firebase User through the Email Link flow.
    await provider.completeEmailSignInLink({
      email: emailOne,
      href: await requestEmailSignInLink(emailOne),
    })
    const first = await waitForState(store, (state) => state.status === 'signed-in')
    const firstUid = first.status === 'signed-in' ? first.user.uid : ''
    expect(firstUid).not.toBe('')

    await provider.signOut()
    await waitForState(store, (state) => state.status === 'signed-out')

    // A second link for the same Email restores the existing Firebase UID.
    await provider.completeEmailSignInLink({
      email: emailOne,
      href: await requestEmailSignInLink(emailOne),
    })
    const existing = await waitForState(store, (state) => state.status === 'signed-in')
    expect(existing.status === 'signed-in' ? existing.user.uid : '').toBe(firstUid)

    // Completing another new identity must tear down the previous UID's data
    // before the observer publishes the replacement session.
    const stopFirst = vi.fn()
    store.registry.register(stopFirst)
    await provider.completeEmailSignInLink({
      email: emailTwo,
      href: await requestEmailSignInLink(emailTwo),
    })
    const second = await waitForState(
      store,
      (state) => state.status === 'signed-in' && state.user.uid !== firstUid,
    )
    expect(stopFirst).toHaveBeenCalledOnce()
    expect(second.status === 'signed-in' ? second.user.uid : '').not.toBe(firstUid)

    const stopSecond = vi.fn()
    store.registry.register(stopSecond)
    await provider.signOut()
    await waitForState(store, (state) => state.status === 'signed-out')
    expect(stopSecond).toHaveBeenCalledOnce()

    expect(store.activeObserverCount()).toBe(1)
  })
})
