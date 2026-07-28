import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

import { routes, registerAuthGuard, type AuthGuardStore } from './index'
import type { AuthState } from '@/features/auth/session'

/** A minimal, controllable stand-in for the auth store's guard surface. */
function createGuardStore(initial: AuthState) {
  const holder = { value: initial }
  let releaseInitial: (() => void) | null = null
  const store: AuthGuardStore = {
    state: holder,
    whenResolved: () =>
      releaseInitial
        ? new Promise<void>((resolve) => {
            releaseInitial = resolve
          })
        : Promise.resolve(),
  }
  return {
    store,
    set(next: AuthState) {
      holder.value = next
    },
    /** Make the next whenResolved() pending until release() is called. */
    defer() {
      releaseInitial = () => undefined
    },
    release() {
      const fn = releaseInitial
      releaseInitial = null
      fn?.()
    },
  }
}

function createGuardedRouter(store: AuthGuardStore): Router {
  const router = createRouter({ history: createMemoryHistory(), routes })
  registerAuthGuard(router, store)
  return router
}

describe('protected member navigation', () => {
  it('redirects a signed-out visitor to the sign-in view without protected content', async () => {
    const { store } = createGuardStore({ status: 'signed-out' })
    const router = createGuardedRouter(store)

    router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('sign-in')
    expect(router.currentRoute.value.path).toBe('/sign-in')
  })

  it('lets a signed-in member reach the protected home route', async () => {
    const { store } = createGuardStore({
      status: 'signed-in',
      user: { uid: 'member-001', displayName: null, email: null },
    })
    const router = createGuardedRouter(store)

    router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('waits for the initial session before resolving a protected route', async () => {
    const control = createGuardStore({ status: 'signed-out' })
    const router = createGuardedRouter(control.store)
    // Settle on the public sign-in route first (session resolves immediately).
    router.push('/sign-in')
    await router.isReady()

    // Now hold the next session resolution and attempt the protected route.
    control.defer()
    control.set({ status: 'loading' })
    let done = false
    const navigation = router.push('/').then(
      () => {
        done = true
      },
      () => {
        done = true
      },
    )
    await Promise.resolve()

    // The guard is still waiting for the initial session; nothing has advanced.
    expect(done).toBe(false)
    expect(router.currentRoute.value.path).toBe('/sign-in')

    // The observer now reports a signed-in member; the protected route resolves.
    control.set({
      status: 'signed-in',
      user: { uid: 'member-001', displayName: null, email: null },
    })
    control.release()
    await navigation

    expect(done).toBe(true)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('carries the attempted path as a safe returnTo query', async () => {
    const { store } = createGuardStore({ status: 'signed-out' })
    const router = createGuardedRouter(store)

    router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.query.returnTo).toBe('/')
  })
})
