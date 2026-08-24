import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SignInView from './SignInView.vue'
import {
  AUTH_PROVIDER_KEY,
  AuthProviderError,
  type AuthProvider,
} from '@/features/auth/auth-provider'

function createProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    sendEmailSignInLink: vi.fn().mockResolvedValue(undefined),
    completeEmailSignInLink: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>protected shell</div>' } },
      { path: '/history', name: 'history', component: { template: '<div>history</div>' } },
      { path: '/stats', name: 'stats', component: { template: '<div>stats</div>' } },
      { path: '/sign-in', name: 'sign-in', component: SignInView },
    ],
  })
}

async function mountSignIn(provider = createProvider(), initialPath = '/sign-in') {
  const router = createTestRouter()
  router.push(initialPath)
  await router.isReady()
  const push = vi.spyOn(router, 'push')

  const wrapper = mount(SignInView, {
    global: {
      plugins: [router],
      provide: { [AUTH_PROVIDER_KEY as symbol]: provider },
    },
  })
  return { wrapper, router, push, provider }
}

describe('SignInView — Firebase-native first-release surface', () => {
  it('renders exactly Google and Email Link controls without unsupported identity flows', async () => {
    const { wrapper } = await mountSignIn()

    expect(wrapper.get('[data-test="google-sign-in"]').text()).toBe('使用 Google 繼續')
    expect(wrapper.findAll('input[type="email"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="send-email-link"]').text()).toContain('寄送 Email 登入連結')
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Apple|One Tap|密碼|連結帳號|合併帳號/)
  })

  it('starts Google popup authentication from the Google control and opens a safe return path', async () => {
    const provider = createProvider()
    const { wrapper, push } = await mountSignIn(provider, '/sign-in?returnTo=/history')

    await wrapper.get('[data-test="google-sign-in"]').trigger('click')
    await flushPromises()

    expect(provider.signInWithGoogle).toHaveBeenCalledOnce()
    expect(provider.sendEmailSignInLink).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/history')
  })

  it('falls back to home after Google sign-in when returnTo is external', async () => {
    const { wrapper, push } = await mountSignIn(
      createProvider(),
      '/sign-in?returnTo=https://example.test/steal',
    )

    await wrapper.get('[data-test="google-sign-in"]').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/')
  })

  it('starts at most one Google popup when the control is activated twice in the same tick', async () => {
    let resolveGoogle!: () => void
    const provider = createProvider({
      signInWithGoogle: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveGoogle = resolve
        }),
      ),
    })
    const { wrapper } = await mountSignIn(provider)
    const control = wrapper.get('[data-test="google-sign-in"]')

    const first = control.trigger('click')
    const second = control.trigger('click')

    expect(provider.signInWithGoogle).toHaveBeenCalledOnce()
    resolveGoogle()
    await Promise.all([first, second])
    await flushPromises()
  })

  it('does not report authentication failure when only post-sign-in navigation fails', async () => {
    const { wrapper, push } = await mountSignIn(createProvider())
    push.mockRejectedValueOnce(new Error('ROUTER_RAW_FAILURE'))

    await wrapper.get('[data-test="google-sign-in"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('登入已完成')
    expect(wrapper.text()).not.toContain('Google 登入失敗')
    expect(wrapper.text()).not.toContain('ROUTER_RAW_FAILURE')
  })

  it('shows a neutral original-method instruction for a provider collision', async () => {
    const provider = createProvider({
      signInWithGoogle: vi.fn().mockRejectedValue(new AuthProviderError('identity-collision')),
    })
    const { wrapper, push } = await mountSignIn(provider)

    await wrapper.get('[data-test="google-sign-in"]').trigger('click')
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('原本的登入方式')
    expect(wrapper.text()).not.toMatch(/google\.com|member@example\.test|credential/)
  })

  it('shows a retryable neutral message when the popup is unavailable', async () => {
    const provider = createProvider({
      signInWithGoogle: vi
        .fn()
        .mockRejectedValue(new AuthProviderError('google-popup-unavailable')),
    })
    const { wrapper } = await mountSignIn(provider)

    await wrapper.get('[data-test="google-sign-in"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('請再試一次')
  })

  it('masks an untyped raw Google provider error', async () => {
    const provider = createProvider({
      signInWithGoogle: vi
        .fn()
        .mockRejectedValue(new Error('RAW member@example.test provider-token-secret google.com')),
    })
    const { wrapper } = await mountSignIn(provider)

    await wrapper.get('[data-test="google-sign-in"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Google 登入失敗')
    expect(wrapper.text()).not.toMatch(/RAW|member@example\.test|provider-token-secret|google\.com/)
  })

  it.each(['new identity', 'existing identity'])(
    'shows the same non-enumerating confirmation for a %s',
    async () => {
      const provider = createProvider()
      const { wrapper } = await mountSignIn(provider, '/sign-in?returnTo=/stats')

      await wrapper.get('input[type="email"]').setValue(' member@example.test ')
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()

      expect(provider.sendEmailSignInLink).toHaveBeenCalledWith({
        email: 'member@example.test',
        returnTo: '/stats',
      })
      expect(wrapper.get('[data-test="email-link-sent"]').text()).toBe(
        '如果這個 Email 可以登入，我們已寄出登入連結，請前往信箱查看。',
      )
      expect(wrapper.text()).not.toMatch(/新帳號|既有帳號|已註冊|不存在/)
    },
  )

  it.each(['', 'a'.repeat(255)])(
    'rejects invalid Email %j before calling the provider',
    async (email) => {
      const provider = createProvider()
      const { wrapper } = await mountSignIn(provider)

      await wrapper.get('input[type="email"]').setValue(email)
      await wrapper.get('form').trigger('submit.prevent')
      await flushPromises()

      expect(provider.sendEmailSignInLink).not.toHaveBeenCalled()
      expect(wrapper.get('[role="alert"]').text()).toContain('有效的電子郵件')
    },
  )

  it('sends at most one Email Link when the form is submitted twice in the same tick', async () => {
    let resolveSend!: () => void
    const provider = createProvider({
      sendEmailSignInLink: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSend = resolve
        }),
      ),
    })
    const { wrapper } = await mountSignIn(provider)
    await wrapper.get('input[type="email"]').setValue('member@example.test')

    const first = wrapper.get('form').trigger('submit.prevent')
    const second = wrapper.get('form').trigger('submit.prevent')

    expect(provider.sendEmailSignInLink).toHaveBeenCalledOnce()
    resolveSend()
    await Promise.all([first, second])
    await flushPromises()
  })

  it('masks raw Email Link provider failures and remains on sign-in', async () => {
    const provider = createProvider({
      sendEmailSignInLink: vi
        .fn()
        .mockRejectedValue(new Error('RAW member@example.test oobCode=secret')),
    })
    const { wrapper, push } = await mountSignIn(provider)

    await wrapper.get('input[type="email"]').setValue('member@example.test')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('無法寄出登入連結')
    expect(wrapper.text()).not.toContain('RAW')
    expect(wrapper.text()).not.toContain('oobCode')
  })
})
