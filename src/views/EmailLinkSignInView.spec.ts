import { nextTick, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const flowMocks = vi.hoisted(() => ({
  readPendingEmailLink: vi.fn(),
  clearPendingEmailLink: vi.fn(),
  validateEmailLinkEmail: vi.fn((email: string) => email.trim()),
}))

vi.mock('@/features/auth/email-link-flow', () => ({
  readPendingEmailLink: flowMocks.readPendingEmailLink,
  clearPendingEmailLink: flowMocks.clearPendingEmailLink,
  validateEmailLinkEmail: flowMocks.validateEmailLinkEmail,
}))

import EmailLinkSignInView from './EmailLinkSignInView.vue'
import {
  AUTH_PROVIDER_KEY,
  AuthProviderError,
  type AuthProvider,
} from '@/features/auth/auth-provider'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import type { AuthState } from '@/features/auth/session'

beforeEach(() => {
  vi.clearAllMocks()
})

function createProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    sendEmailSignInLink: vi.fn().mockResolvedValue(undefined),
    completeEmailSignInLink: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function mountCallback(options: {
  readonly provider?: AuthProvider
  readonly state?: Ref<AuthState>
  readonly path?: string
} = {}) {
  const provider = options.provider ?? createProvider()
  const state = options.state ?? ref<AuthState>({ status: 'signed-out' })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>protected shell</div>' } },
      { path: '/history', name: 'history', component: { template: '<div>protected history</div>' } },
      { path: '/sign-in', name: 'sign-in', component: { template: '<div>sign in</div>' } },
      { path: '/auth/email-link', name: 'email-link-sign-in', component: EmailLinkSignInView },
    ],
  })
  await router.push(options.path ?? '/auth/email-link?mode=signIn&oobCode=opaque')
  await router.isReady()
  const push = vi.spyOn(router, 'push')
  const wrapper = mount(EmailLinkSignInView, {
    global: {
      plugins: [router],
      provide: {
        [AUTH_PROVIDER_KEY as symbol]: provider,
        [AUTH_STORE_KEY as symbol]: { state },
      },
    },
  })
  return { wrapper, router, push, provider, state }
}

describe('EmailLinkSignInView — public callback completion', () => {
  it('completes from same-browser pending state and waits for the observer before navigating', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce({
      version: 1,
      email: 'member@example.test',
      returnTo: '/history',
      requestedAtMs: Date.now(),
    })
    const state = ref<AuthState>({ status: 'signed-out' })
    const { wrapper, provider, router, push } = await mountCallback({ state })
    await flushPromises()

    expect(provider.completeEmailSignInLink).toHaveBeenCalledWith({
      email: 'member@example.test',
      href: expect.stringContaining('/auth/email-link?mode=signIn&oobCode=opaque'),
    })
    expect(flowMocks.clearPendingEmailLink).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/auth/email-link')
    expect(wrapper.text()).not.toContain('protected history')

    state.value = {
      status: 'signed-in',
      user: { uid: 'member-001', displayName: null, email: null },
    }
    await nextTick()
    await flushPromises()

    expect(flowMocks.clearPendingEmailLink).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith('/history')
  })

  it('requires a new observer emission instead of trusting a pre-existing signed-in session', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce({
      version: 1,
      email: 'member@example.test',
      returnTo: '/history',
      requestedAtMs: Date.now(),
    })
    const state = ref<AuthState>({
      status: 'signed-in',
      user: { uid: 'member-before', displayName: null, email: null },
    })
    const { push } = await mountCallback({ state })
    await flushPromises()

    expect(push).not.toHaveBeenCalled()

    state.value = {
      status: 'signed-in',
      user: { uid: 'member-after', displayName: null, email: null },
    }
    await nextTick()
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/history')
  })

  it('cancels observer waiting on unmount and never navigates from the stale callback', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce({
      version: 1,
      email: 'member@example.test',
      returnTo: '/history',
      requestedAtMs: Date.now(),
    })
    const state = ref<AuthState>({ status: 'signed-out' })
    const { wrapper, push } = await mountCallback({ state })
    await flushPromises()
    expect(flowMocks.clearPendingEmailLink).toHaveBeenCalledOnce()

    wrapper.unmount()
    state.value = {
      status: 'signed-in',
      user: { uid: 'member-later', displayName: null, email: null },
    }
    await nextTick()
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
  })

  it('does not create an observer wait after unmounting during Firebase completion', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce({
      version: 1,
      email: 'member@example.test',
      returnTo: '/history',
      requestedAtMs: Date.now(),
    })
    let resolveCompletion!: () => void
    const provider = createProvider({
      completeEmailSignInLink: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveCompletion = resolve
        }),
      ),
    })
    const { wrapper, push } = await mountCallback({ provider })
    await flushPromises()
    const timerSpy = vi.spyOn(window, 'setTimeout')

    wrapper.unmount()
    resolveCompletion()
    await flushPromises()

    try {
      expect(flowMocks.clearPendingEmailLink).toHaveBeenCalledOnce()
      expect(timerSpy).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    } finally {
      timerSpy.mockRestore()
    }
  })

  it('bounds observer waiting and reports a neutral state-confirmation failure', async () => {
    vi.useFakeTimers()
    try {
      flowMocks.readPendingEmailLink.mockReturnValueOnce({
        version: 1,
        email: 'member@example.test',
        returnTo: '/history',
        requestedAtMs: Date.now(),
      })
      const { wrapper, push } = await mountCallback()
      await flushPromises()

      await vi.advanceTimersByTimeAsync(10_000)
      await flushPromises()

      expect(push).not.toHaveBeenCalled()
      expect(wrapper.get('[role="alert"]').text()).toContain('無法確認登入狀態')
      expect(wrapper.text()).not.toContain('member@example.test')
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires Email re-entry on another device and completes with the current link only', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce(null)
    const state = ref<AuthState>({ status: 'signed-out' })
    const { wrapper, provider, push } = await mountCallback({
      state,
      path: '/auth/email-link?mode=signIn&oobCode=opaque&returnTo=/history',
    })

    expect(provider.completeEmailSignInLink).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="email-reentry"]').exists()).toBe(true)
    await wrapper.get('input[type="email"]').setValue(' member@example.test ')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(provider.completeEmailSignInLink).toHaveBeenCalledWith({
      email: 'member@example.test',
      href: expect.stringContaining('oobCode=opaque'),
    })
    expect(push).not.toHaveBeenCalled()

    state.value = {
      status: 'signed-in',
      user: { uid: 'member-001', displayName: null, email: null },
    }
    await nextTick()
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/history')
  })

  it('re-resolves an unsafe cross-device returnTo before navigation', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce(null)
    const state = ref<AuthState>({ status: 'signed-out' })
    const { wrapper, push } = await mountCallback({
      state,
      path:
        '/auth/email-link?mode=signIn&oobCode=opaque&returnTo=' +
        encodeURIComponent('https://evil.example/steal'),
    })

    await wrapper.get('input[type="email"]').setValue('member@example.test')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    state.value = {
      status: 'signed-in',
      user: { uid: 'member-001', displayName: null, email: null },
    }
    await nextTick()
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/')
  })

  it.each(['email-link-invalid', 'email-link-completion-failed'] as const)(
    'clears pending state and offers a neutral retry for %s',
    async (code) => {
      flowMocks.readPendingEmailLink.mockReturnValueOnce({
        version: 1,
        email: 'member@example.test',
        returnTo: '/history',
        requestedAtMs: Date.now(),
      })
      const provider = createProvider({
        completeEmailSignInLink: vi.fn().mockRejectedValue(new AuthProviderError(code)),
      })
      const { wrapper, push } = await mountCallback({ provider })
      await flushPromises()

      expect(flowMocks.clearPendingEmailLink).toHaveBeenCalledOnce()
      expect(push).not.toHaveBeenCalled()
      expect(wrapper.get('[role="alert"]').text()).toContain('登入連結無效或已失效')
      expect(wrapper.get('[data-test="retry-sign-in"]').attributes('href')).toBe('/sign-in')
      expect(wrapper.text()).not.toContain('member@example.test')
    },
  )

  it('keeps an Email Link identity collision neutral without naming or merging providers', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce({
      version: 1,
      email: 'member@example.test',
      returnTo: '/history',
      requestedAtMs: Date.now(),
    })
    const provider = createProvider({
      completeEmailSignInLink: vi
        .fn()
        .mockRejectedValue(new AuthProviderError('identity-collision')),
    })
    const { wrapper, push } = await mountCallback({ provider })
    await flushPromises()

    expect(flowMocks.clearPendingEmailLink).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('原本的登入方式')
    expect(wrapper.text()).not.toMatch(/google\.com|member@example\.test|merge|link/)
  })

  it('keeps a direct non-link callback public with zero completion calls and no protected content', async () => {
    flowMocks.readPendingEmailLink.mockReturnValueOnce(null)
    const provider = createProvider()
    const { wrapper } = await mountCallback({
      provider,
      path: '/auth/email-link?notAnEmailLink=true',
    })
    await flushPromises()

    expect(provider.completeEmailSignInLink).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toMatch(/protected shell|protected history/)
    expect(wrapper.get('[data-test="retry-sign-in"]').attributes('href')).toBe('/sign-in')
  })
})
