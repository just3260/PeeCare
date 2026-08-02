import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { ref, type Ref } from 'vue'

import SettingsView from './SettingsView.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY, type AuthProvider } from '@/features/auth/auth-provider'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import type { AuthState } from '@/features/auth/session'
import type { OwnedDevice } from '@/features/devices/owned-device-model'
import type { DeviceRenameState } from '@/features/devices/device-overview-store'
import type { RenameDeviceResult } from '@/features/devices/member-device-api'

function device(deviceId: string, customName: string | null = null): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled', customName }
}

const SIGNED_IN: AuthState = {
  status: 'signed-in',
  user: { uid: 'member-001', displayName: null, email: 'member@example.com' },
}

afterEach(() => {
  document.body.innerHTML = ''
})

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
  renameState?: Ref<DeviceRenameState>
  renameDevice?: (deviceId: string, customName: string | null) => Promise<RenameDeviceResult>
} = {}) {
  const router = options.router ?? stubRouter()
  await router.push('/settings')
  await router.isReady()

  return mount(SettingsView, {
    attachTo: document.body,
    global: {
      plugins: [router],
      provide: {
        [AUTH_STORE_KEY as symbol]: { state: ref(options.authState ?? SIGNED_IN) },
        [AUTH_PROVIDER_KEY as symbol]:
          options.provider ?? ({ signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) } as AuthProvider),
        [DEVICE_OVERVIEW_STORE_KEY as symbol]: {
          state: ref(options.deviceState ?? { status: 'empty' }),
          devices: ref(options.devices ?? []),
          renameState: options.renameState ?? ref<DeviceRenameState>({ status: 'idle' }),
          renameDevice: options.renameDevice ?? vi.fn().mockResolvedValue({ ok: false, reason: 'unexpected_error' }),
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

  it('shows the resolved name with an immutable serial sublabel on every row', async () => {
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001', '主浴室'), device('PC-000002')],
    })

    expect(wrapper.get('[data-device-id="PC-000001"] [data-test="device-name"]').text()).toBe('主浴室')
    expect(wrapper.get('[data-device-id="PC-000001"] [data-test="device-serial"]').text()).toBe('裝置序號：PC-000001')
    expect(wrapper.get('[data-device-id="PC-000002"] [data-test="device-name"]').text()).toBe('PC-000002')
    expect(wrapper.get('[data-device-id="PC-000002"] [data-test="device-serial"]').text()).toBe('裝置序號：PC-000002')
  })

  it('edits one row at a time, focusing and selecting its current custom name', async () => {
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001', '主浴室'), device('PC-000002')],
    })

    await wrapper.get('[data-device-id="PC-000001"] [data-test="device-edit"]').trigger('click')

    const input = wrapper.get('[data-test="device-name-input"]').element as HTMLInputElement
    expect(input.value).toBe('主浴室')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3])
    expect(wrapper.get('[data-device-id="PC-000002"] [data-test="device-edit"]').attributes('disabled')).toBeDefined()
  })

  it('focuses and selects the deviceId fallback when an unnamed device enters edit mode', async () => {
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001')],
    })

    await wrapper.get('[data-test="device-edit"]').trigger('click')

    const input = wrapper.get('[data-test="device-name-input"]').element as HTMLInputElement
    expect(input.value).toBe('PC-000001')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9])
  })

  it.each(['button', 'enter'] as const)('saves a trimmed name with %s and exits edit mode', async (trigger) => {
    const renameDevice = vi.fn().mockResolvedValue({
      ok: true,
      device: { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室' },
    })
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001')],
      renameDevice,
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue('  主浴室  ')

    if (trigger === 'button') {
      await wrapper.get('[data-test="device-save"]').trigger('click')
    } else {
      await wrapper.get('[data-test="device-name-input"]').trigger('keydown.enter')
    }
    await flushPromises()

    expect(renameDevice).toHaveBeenCalledOnce()
    expect(renameDevice).toHaveBeenCalledWith('PC-000001', '主浴室')
    expect(wrapper.find('[data-test="device-name-input"]').exists()).toBe(false)
  })

  it('sends null when saving a whitespace-only draft', async () => {
    const renameDevice = vi.fn().mockResolvedValue({
      ok: true,
      device: { deviceId: 'PC-000001', customName: null, displayName: 'PC-000001' },
    })
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001', '主浴室')],
      renameDevice,
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue('   ')

    await wrapper.get('[data-test="device-save"]').trigger('click')
    await flushPromises()

    expect(renameDevice).toHaveBeenCalledWith('PC-000001', null)
    expect(wrapper.find('[data-test="device-name-input"]').exists()).toBe(false)
  })

  it.each(['button', 'escape'] as const)('cancels with %s without calling the API', async (trigger) => {
    const renameDevice = vi.fn()
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001', '原名稱')],
      renameDevice,
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue('未儲存')

    if (trigger === 'button') {
      await wrapper.get('[data-test="device-cancel"]').trigger('click')
    } else {
      await wrapper.get('[data-test="device-name-input"]').trigger('keydown.esc')
    }

    expect(renameDevice).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="device-name-input"]').exists()).toBe(false)
  })

  it('keeps the draft open when focus moves outside the editor', async () => {
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001', '原名稱')],
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue('草稿')

    await wrapper.get('[data-test="device-name-input"]').trigger('blur')

    expect((wrapper.get('[data-test="device-name-input"]').element as HTMLInputElement).value).toBe('草稿')
  })

  it.each(['x'.repeat(31), '主\u0001浴室'])('rejects invalid client draft %j with zero API calls', async (draft) => {
    const renameDevice = vi.fn()
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001')],
      renameDevice,
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue(draft)

    await wrapper.get('[data-test="device-save"]').trigger('click')

    expect(renameDevice).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="device-name-error"]').text()).not.toContain(draft)
    expect((wrapper.get('[data-test="device-name-input"]').element as HTMLInputElement).value).toBe(draft)
  })

  it('locks the editor and suppresses duplicate save while the request is pending', async () => {
    let settle!: (result: RenameDeviceResult) => void
    const renameDevice = vi.fn().mockReturnValue(new Promise<RenameDeviceResult>((resolve) => { settle = resolve }))
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001')],
      renameDevice,
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue('主浴室')

    await wrapper.get('[data-test="device-save"]').trigger('click')
    await wrapper.get('[data-test="device-save"]').trigger('click')

    expect(renameDevice).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-test="device-name-input"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="device-cancel"]').attributes('disabled')).toBeDefined()
    settle({
      ok: true,
      device: { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室' },
    })
    await flushPromises()
    expect(wrapper.find('[data-test="device-name-input"]').exists()).toBe(false)
  })

  it('retains the draft on failure and shows a non-sensitive error', async () => {
    const renameDevice = vi.fn().mockResolvedValue({ ok: false, reason: 'persistence_unavailable' })
    const wrapper = await mountSettings({
      deviceState: { status: 'ready' },
      devices: [device('PC-000001', '原名稱')],
      renameDevice,
    })
    await wrapper.get('[data-test="device-edit"]').trigger('click')
    await wrapper.get('[data-test="device-name-input"]').setValue('敏感草稿')

    await wrapper.get('[data-test="device-save"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[data-test="device-name-input"]').element as HTMLInputElement).value).toBe('敏感草稿')
    expect(wrapper.get('[data-test="device-name-error"]').text()).toContain('稍後再試')
    expect(wrapper.get('[data-test="device-name-error"]').text()).not.toContain('敏感草稿')
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
