// Authoritative member session store for the Web MVP.
//
// The store derives session state solely from a Firebase auth observer — never
// from local storage or the route. It runs at most one observer for the mounted
// application and, before it publishes a signed-out state or a different UID, it
// tears down every protected resource so the previous member's data cannot leak
// into the next session.

import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import { onAuthStateChanged, type User } from 'firebase/auth'

import { getLocalFirebaseServices } from '@/platform/firebase/client'
import {
  createProtectedResourceRegistry,
  type ProtectedResourceRegistry,
} from './protected-resource-registry'
import type { AuthState, SessionUser } from './session'

/** Source of authentication changes. Abstracted so tests can drive the store. */
export interface AuthObserver {
  /** Subscribe to auth changes; returns an unsubscribe function. */
  subscribe(onUser: (user: SessionUser | null) => void): () => void
}

export interface AuthStore {
  /** Reactive, read-only session state. */
  readonly state: DeepReadonly<Ref<AuthState>>
  /** Teardown ledger for protected resources tied to the current session. */
  readonly registry: ProtectedResourceRegistry
  /** Start the single observer (idempotent). */
  mount(): void
  /** Detach the observer and tear down every protected resource. */
  dispose(): void
  /** How many observers are currently active (0 or 1). */
  activeObserverCount(): number
  /** Resolves once the observer reports for the first time (state leaves loading). */
  whenResolved(): Promise<void>
}

export interface CreateAuthStoreOptions {
  readonly observer?: AuthObserver
  readonly registry?: ProtectedResourceRegistry
}

const LOADING: AuthState = { status: 'loading' }

/** Map a Firebase user to the minimal display identity the app exposes. */
function toSessionUser(user: User): SessionUser {
  return { uid: user.uid, displayName: user.displayName, email: user.email }
}

/**
 * Firebase-backed observer. It obtains Auth from the existing single-app adapter
 * and never initializes a second Firebase app.
 */
export function createFirebaseAuthObserver(): AuthObserver {
  return {
    subscribe(onUser: (user: SessionUser | null) => void): () => void {
      const { auth } = getLocalFirebaseServices()
      return onAuthStateChanged(auth, (user) => {
        onUser(user ? toSessionUser(user) : null)
      })
    },
  }
}

export function createAuthStore(options: CreateAuthStoreOptions = {}): AuthStore {
  const observer = options.observer ?? createFirebaseAuthObserver()
  const registry = options.registry ?? createProtectedResourceRegistry()

  const state = ref<AuthState>(LOADING)
  let unsubscribe: (() => void) | null = null
  let currentUid: string | null = null

  let resolveInitial: (() => void) | null = null
  let resolvedPromise: Promise<void> | null = null

  function ensureResolvedPromise(): Promise<void> {
    if (!resolvedPromise) {
      resolvedPromise = new Promise<void>((resolve) => {
        resolveInitial = resolve
      })
    }
    return resolvedPromise
  }

  function publish(user: SessionUser | null): void {
    const nextUid = user?.uid ?? null
    // Tear down the previous session's resources before exposing a signed-out
    // state or a different member's UID. The same UID reporting again (e.g. a
    // token refresh) keeps its live resources.
    if (nextUid !== currentUid) {
      registry.disposeAll()
    }
    currentUid = nextUid
    state.value = user ? { status: 'signed-in', user } : { status: 'signed-out' }

    if (resolveInitial) {
      resolveInitial()
      resolveInitial = null
    }
  }

  return {
    state: readonly(state),
    registry,
    mount(): void {
      if (unsubscribe) return
      ensureResolvedPromise()
      unsubscribe = observer.subscribe(publish)
    },
    dispose(): void {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      registry.disposeAll()
      currentUid = null
      state.value = LOADING
      resolvedPromise = null
      resolveInitial = null
    },
    activeObserverCount(): number {
      return unsubscribe ? 1 : 0
    },
    whenResolved(): Promise<void> {
      return ensureResolvedPromise()
    },
  }
}
