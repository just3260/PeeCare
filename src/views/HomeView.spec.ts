import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'

import HomeView from './HomeView.vue'
import { routes } from '@/router'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import type { AuthState } from '@/features/auth/session'
import type {
  DeviceOverviewState,
  DeviceOverviewStore,
} from '@/features/devices/device-overview-store'
import type { OwnedDevice } from '@/features/devices/owned-device-model'
import type { DeviceOverviewProjection } from '@/features/devices/device-overview-model'

function device(deviceId: string): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' }
}

const readyProjection: DeviceOverviewProjection = {
  urination: { eventId: 'evt-u', atMs: 1_700_000_000_000, receivedAtMs: 1_700_000_000_100 },
  battery: {
    eventId: 'evt-b',
    levelPercent: 50,
    atMs: 1_700_000_000_200,
    receivedAtMs: 1_700_000_000_300,
    voltageMv: 3840,
  },
  lastReportedAtMs: 1_700_000_000_400,
}

interface FakeStore extends DeviceOverviewStore {
  load: ReturnType<typeof vi.fn>
  selectDevice: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

function makeDeviceStore(options: {
  state: DeviceOverviewState
  devices?: OwnedDevice[]
  selectedDeviceId?: string | null
}): FakeStore {
  return {
    state: ref(options.state),
    devices: ref(options.devices ?? []),
    selectedDeviceId: ref(options.selectedDeviceId ?? null),
    load: vi.fn(),
    selectDevice: vi.fn(),
    dispose: vi.fn(),
  } as unknown as FakeStore
}

function mountHomeView(deviceStore: FakeStore, authState: AuthState = { status: 'signed-in', user: { uid: 'member-001', displayName: null, email: null } }) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const authStore = { state: ref(authState) }
  return mount(HomeView, {
    global: {
      plugins: [router],
      provide: {
        [AUTH_STORE_KEY as symbol]: authStore,
        [DEVICE_OVERVIEW_STORE_KEY as symbol]: deviceStore,
      },
    },
  })
}

describe('HomeView overview states', () => {
  it('renders the loading state', () => {
    const wrapper = mountHomeView(makeDeviceStore({ state: { status: 'loading' } }))
    expect(wrapper.find('[data-test="overview-loading"]').exists()).toBe(true)
  })

  it('renders the empty state when the member owns no devices', () => {
    const wrapper = mountHomeView(makeDeviceStore({ state: { status: 'empty' } }))
    const empty = wrapper.find('[data-test="overview-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('尚無裝置')
  })

  it('guides the empty state to the settings device management', () => {
    const wrapper = mountHomeView(makeDeviceStore({ state: { status: 'empty' } }))
    const guidance = wrapper.get('[data-test="overview-settings-guidance"]')
    expect(guidance.attributes('href')).toBe('/settings')
  })

  it('renders the ready state with status cards and no fabricated measurements', () => {
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: { status: 'ready', projection: readyProjection },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('50%')
    // A single-device member sees no switcher.
    expect(wrapper.find('.device-selector').exists()).toBe(false)
    const text = wrapper.text()
    expect(text).not.toContain('比昨天多 8 mL')
    expect(text).not.toContain('Wi-Fi 正常')
  })

  it('renders the missing-data state as explicit unknown values, not zero', () => {
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: {
          status: 'ready',
          projection: { urination: null, battery: null, lastReportedAtMs: null },
        },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    expect(wrapper.get('[data-test="battery-level"]').text()).toBe('尚無資料')
    expect(wrapper.get('[data-test="urination-time"]').text()).toBe('尚無資料')
  })

  it('shows the device selector when the member owns more than one device', () => {
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: { status: 'ready', projection: readyProjection },
        devices: [device('PC-000001'), device('PC-000002')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    expect(wrapper.find('.device-selector').exists()).toBe(true)
  })

  it('switches devices through the store when a selector option is clicked', async () => {
    const store = makeDeviceStore({
      state: { status: 'ready', projection: readyProjection },
      devices: [device('PC-000001'), device('PC-000002')],
      selectedDeviceId: 'PC-000001',
    })
    const wrapper = mountHomeView(store)

    await wrapper.get('[data-test="device-option-PC-000002"]').trigger('click')

    expect(store.selectDevice).toHaveBeenCalledWith('PC-000002')
  })

  it('renders a retryable error state', async () => {
    const store = makeDeviceStore({ state: { status: 'error' } })
    const wrapper = mountHomeView(store)

    expect(wrapper.find('[data-test="overview-error"]').exists()).toBe(true)
    store.load.mockClear()
    await wrapper.get('[data-test="overview-retry"]').trigger('click')

    // Retry re-syncs the session, which reloads for the signed-in member.
    expect(store.load).toHaveBeenCalledWith('member-001')
  })
})

describe('HomeView session wiring', () => {
  it('loads the owned devices on mount for a signed-in member', () => {
    const store = makeDeviceStore({ state: { status: 'loading' } })
    mountHomeView(store)
    expect(store.load).toHaveBeenCalledWith('member-001')
  })

  it('disposes the device store when the member is signed out', () => {
    const store = makeDeviceStore({ state: { status: 'loading' } })
    mountHomeView(store, { status: 'signed-out' })
    expect(store.dispose).toHaveBeenCalled()
  })
})
