// Auth Emulator-backed integration for the member session skeleton.
//
// Runs only under vitest.firebase.config.ts via `firebase emulators:exec`, which
// starts a fresh Auth Emulator on 127.0.0.1:9099. It exercises the real Firebase
// observer through getLocalFirebaseServices(): sign in, UID switch (with resource
// teardown ordering), and sign out.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createUserWithEmailAndPassword } from 'firebase/auth'

import { getLocalFirebaseServices, resetLocalFirebaseServices } from '../../platform/firebase/client'
import type { RawFirebaseEnv } from '../../platform/firebase/config'
import { createAuthStore, createFirebaseAuthObserver } from './auth-store'
import { createFirebaseAuthProvider } from './auth-provider'
import type { AuthState } from './session'

function demoEnv(): RawFirebaseEnv {
  return {
    MODE: 'development',
    PROD: false,
    VITE_FIREBASE_USE_EMULATORS: 'true',
    VITE_FIREBASE_PROJECT_ID: 'demo-peecare',
    VITE_FIREBASE_API_KEY: 'demo-api-key',
    VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
    VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8085',
  }
}

/** Wait until the store's session state satisfies the predicate. */
function waitForState(
  store: ReturnType<typeof createAuthStore>,
  predicate: (state: AuthState) => boolean,
  timeoutMs = 10000,
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

const PASSWORD = 'emulator-pass-1234'
const emailOne = `member-one-${Date.now()}@peecare.test`
const emailTwo = `member-two-${Date.now()}@peecare.test`

describe('member authentication against the Auth Emulator', () => {
  beforeAll(async () => {
    resetLocalFirebaseServices()
    // Prime the single cached app so the observer/provider defaults reuse it.
    const { auth } = getLocalFirebaseServices(demoEnv())
    await createUserWithEmailAndPassword(auth, emailOne, PASSWORD)
    const provider = createFirebaseAuthProvider()
    await provider.signOut()
    await createUserWithEmailAndPassword(auth, emailTwo, PASSWORD)
    await provider.signOut()
  })

  afterAll(async () => {
    await createFirebaseAuthProvider().signOut()
    resetLocalFirebaseServices()
  })

  it('signs in, switches UID with resource teardown, and signs out', async () => {
    const store = createAuthStore({ observer: createFirebaseAuthObserver() })
    const provider = createFirebaseAuthProvider()
    store.mount()

    // Resolve the initial (signed-out) session.
    await store.whenResolved()

    // Sign in as the first member.
    await provider.signIn({ email: emailOne, password: PASSWORD })
    const first = await waitForState(store, (s) => s.status === 'signed-in')
    const firstUid = first.status === 'signed-in' ? first.user.uid : ''
    expect(firstUid).not.toBe('')

    // Register a protected subscription tied to the first member.
    const stopFirst = vi.fn()
    store.registry.register(stopFirst)

    // Switch to the second member: the first member's resources must be gone.
    await provider.signIn({ email: emailTwo, password: PASSWORD })
    const second = await waitForState(
      store,
      (s) => s.status === 'signed-in' && s.user.uid !== firstUid,
    )
    expect(stopFirst).toHaveBeenCalledTimes(1)
    expect(second.status === 'signed-in' ? second.user.uid : '').not.toBe(firstUid)

    // Sign out: the session ends and second member's resources are torn down.
    const stopSecond = vi.fn()
    store.registry.register(stopSecond)
    await provider.signOut()
    await waitForState(store, (s) => s.status === 'signed-out')
    expect(stopSecond).toHaveBeenCalledTimes(1)

    store.dispose()
    expect(store.activeObserverCount()).toBe(0)
  })
})
