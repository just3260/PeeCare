import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { ref } from 'vue'

import SettingsView from './SettingsView.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY, type AuthProvider } from '@/features/auth/auth-provider'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import type { AuthState } from '@/features/auth/session'
import type { OwnedDevice } from '@/features/devices/owned-device-model'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' }
}

const SIGNED_IN: AuthState = {
  status: 'signed-in',
  user: { uid: 'member-001', displayName: null, email: 'member@example.com' },
}

function stubRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/sign-in', component: { template: '<div />' } },
      { path: '/settings', component: { template: '<div />' } },
    ],
  })
}

async function mountSettings(options: {
  deviceState?: { status: string }
  devices?: OwnedDevice[]
  authState?: AuthState
  provider?: AuthProvider
  router?: Router
} = {}) {
  const router = options.router ?? stubRouter()
  await router.push('/settings')
  await router.isReady()

  return mount(SettingsView, {
    global: {
      plugins: [router],
      provide: {
        [AUTH_STORE_KEY as symbol]: { state: ref(options.authState ?? SIGNED_IN) },
        [AUTH_PROVIDER_KEY as symbol]:
          options.provider ?? ({ signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) } as AuthProvider),
        [DEVICE_OVERVIEW_STORE_KEY as symbol]: {
          state: ref(options.deviceState ?? { status: 'empty' }),
          devices: ref(options.devices ?? []),
          load: vi.fn(),
        },
      },
    },
  })
}

describe('SettingsView device management section', () => {
  it('renders the loading state', async () => {
    const wrapper = await mountSettings({ deviceState: { status: 'loading' } })
    expect(wrapper.get('[data-test="devices-loading"]').text()).toBe('載入中…')
  })

  it('renders the error state', async () => {
    const wrapper = await mountSettings({ deviceState: { status: 'error' } })
    expect(wrapper.get('[data-test="devices-error"]').text()).toBe('無法載入裝置資料')
  })

  it('renders the empty state when the member owns no devices', async () => {
    const wrapper = await mountSettings({ deviceState: { status: 'empty' }, devices: [] })
    expect(wrapper.get('[data-test="devices-empty"]').text()).toBe('尚無綁定裝置')
  })

  it('lists owned devices when the member has devices', async () => {
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001'), device('PC-000002')],
    })
    const list = wrapper.get('[data-test="devices-list"]')
    expect(list.text()).toContain('PC-000001')
    expect(list.text()).toContain('PC-000002')
  })
})

describe('SettingsView account section', () => {
  it('displays the signed-in member email', async () => {
    const wrapper = await mountSettings({ authState: SIGNED_IN })
    expect(wrapper.get('[data-test="account-email"]').text()).toContain('member@example.com')
  })

  it('terminates the session through the injected provider on sign-out', async () => {
    const provider: AuthProvider = { signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) }
    const router = stubRouter()
    const wrapper = await mountSettings({ provider, router })

    await wrapper.get('[data-test="settings-sign-out"]').trigger('click')
    await flushPromises()

    expect(provider.signOut).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/sign-in')
  })
})

describe('SettingsView placeholder sections', () => {
  it('presents notification preferences as read-only with no active controls', async () => {
    const wrapper = await mountSettings()
    const section = wrapper.get('[data-test="settings-notifications"]')

    // Placeholder only: no interactive switch or enabled control claims activity.
    expect(section.findAll('input, button, [role="switch"]')).toHaveLength(0)
  })

  it('presents an about section with a read-only version string', async () => {
    const wrapper = await mountSettings()
    const section = wrapper.get('[data-test="settings-about"]')

    expect(section.text()).toMatch(/\d+\.\d+\.\d+/)
    expect(section.findAll('input, button, [role="switch"]')).toHaveLength(0)
  })
})
