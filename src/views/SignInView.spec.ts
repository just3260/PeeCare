import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

import SignInView from './SignInView.vue'
import { AUTH_PROVIDER_KEY, type AuthProvider } from '@/features/auth/auth-provider'

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>protected shell</div>' } },
      { path: '/history', name: 'history', component: { template: '<div>history</div>' } },
      { path: '/sign-in', name: 'sign-in', component: SignInView },
    ],
  })
}

async function mountSignIn(provider: AuthProvider, initialPath = '/sign-in') {
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
  return { wrapper, router, push }
}

describe('SignInView — provider-neutral sign in', () => {
  it('completes local sign in and opens the protected shell', async () => {
    const provider: AuthProvider = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn() }
    const { wrapper, push } = await mountSignIn(provider)

    await wrapper.find('input[type="email"]').setValue('member@peecare.test')
    await wrapper.find('input[type="password"]').setValue('correct-horse')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(provider.signIn).toHaveBeenCalledWith({
      email: 'member@peecare.test',
      password: 'correct-horse',
    })
    expect(push).toHaveBeenCalledWith('/')
  })

  it('rejects an external returnTo and navigates to the home shell', async () => {
    const provider: AuthProvider = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn() }
    const { wrapper, push } = await mountSignIn(
      provider,
      '/sign-in?returnTo=https://example.test/steal',
    )

    await wrapper.find('input[type="email"]').setValue('member@peecare.test')
    await wrapper.find('input[type="password"]').setValue('correct-horse')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/')
  })

  it('preserves a safe same-app returnTo after sign in', async () => {
    const provider: AuthProvider = { signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn() }
    const { wrapper, push } = await mountSignIn(provider, '/sign-in?returnTo=/history')

    await wrapper.find('input[type="email"]').setValue('member@peecare.test')
    await wrapper.find('input[type="password"]').setValue('correct-horse')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/history')
  })

  it('reports a non-sensitive failure and stays on the sign-in view', async () => {
    const provider: AuthProvider = {
      signIn: vi.fn().mockRejectedValue(new Error('auth/wrong-password RAW_SECRET_DETAIL')),
      signOut: vi.fn(),
    }
    const { wrapper, push } = await mountSignIn(provider)

    await wrapper.find('input[type="email"]').setValue('member@peecare.test')
    await wrapper.find('input[type="password"]').setValue('super-secret-pw')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // Redirect must not happen on failure.
    expect(push).not.toHaveBeenCalled()

    const text = wrapper.text()
    // A human-facing, non-sensitive error is shown.
    expect(text).toContain('登入失敗')
    // Neither the raw provider error nor the entered password may leak.
    expect(text).not.toContain('RAW_SECRET_DETAIL')
    expect(text).not.toContain('super-secret-pw')
  })
})
