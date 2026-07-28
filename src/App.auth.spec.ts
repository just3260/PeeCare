import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import App from './App.vue'
import { routes, registerAuthGuard } from './router'
import { createAuthStore, type AuthObserver } from '@/features/auth/auth-store'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY, type AuthProvider } from '@/features/auth/auth-provider'
import type { SessionUser } from '@/features/auth/session'

function createFakeObserver() {
  let handler: ((user: SessionUser | null) => void) | null = null
  return {
    port: {
      subscribe(onUser: (user: SessionUser | null) => void) {
        handler = onUser
        return () => {
          handler = null
        }
      },
    } satisfies AuthObserver,
    emit(user: SessionUser | null) {
      handler?.(user)
    },
  }
}

describe('App — session termination', () => {
  it('stops protected subscriptions and returns to sign-in on sign out', async () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })

    // A fake provider whose signOut mimics Firebase by pushing a null session.
    const provider: AuthProvider = {
      signIn: vi.fn(),
      signOut: vi.fn().mockImplementation(async () => {
        observer.emit(null)
      }),
    }

    const router = createRouter({ history: createMemoryHistory(), routes })
    registerAuthGuard(router, store)

    const wrapper = mount(App, {
      global: {
        plugins: [router],
        provide: {
          [AUTH_STORE_KEY as symbol]: store,
          [AUTH_PROVIDER_KEY as symbol]: provider,
        },
      },
    })

    // Reach the protected shell as member-001.
    observer.emit({ uid: 'member-001', displayName: null, email: null })
    router.push('/')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')

    // Register a protected subscription that must stop on sign-out.
    const stopSubscription = vi.fn()
    store.registry.register(stopSubscription)

    await wrapper.find('[data-test="sign-out"]').trigger('click')
    await flushPromises()

    expect(provider.signOut).toHaveBeenCalledTimes(1)
    expect(stopSubscription).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/sign-in')
  })
})
