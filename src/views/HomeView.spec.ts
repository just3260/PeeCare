import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, nextTick, ref } from 'vue'
import type { Ref } from 'vue'

import AppHeader from '@/components/AppHeader.vue'
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

function device(deviceId: string, customName: string | null = null): OwnedDevice {
  return { deviceId, ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled', customName }
}

// 2026-07-28T02:00:00.000Z is 2026-07-28 10:00 in Asia/Taipei, so a projection
// dated 2026-07-28 is current and one dated 2026-07-27 has gone stale.
const NOW_MS = Date.parse('2026-07-28T02:00:00.000Z')

function freezeNow(): void {
  vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

const WifiConnectionGuideDialogStub = defineComponent({
  name: 'WifiConnectionGuideDialog',
  props: {
    open: { type: Boolean, required: true },
  },
  emits: ['close'],
  template: `
    <div v-if="open" role="dialog" data-test="wifi-guide-dialog">
      <button type="button" data-test="wifi-guide-dialog-close" @click="$emit('close')">
        關閉 Wi-Fi 連線說明
      </button>
    </div>
  `,
})

const WIFI_GUIDE_KEY_PREFIX = 'peecare:wifi-connection-guide:auto-shown:'

function wifiGuideKey(uid: string): string {
  return `${WIFI_GUIDE_KEY_PREFIX}${uid}`
}

function signedIn(uid = 'member-001'): AuthState {
  return { status: 'signed-in', user: { uid, displayName: null, email: null } }
}

const readyProjection: DeviceOverviewProjection = {
  urination: {
    eventId: 'evt-u',
    atMs: 1_700_000_000_000,
    receivedAtMs: 1_700_000_000_100,
    estimatedUrineMl: 120,
    estimationStatus: 'estimated',
  },
  battery: {
    eventId: 'evt-b',
    levelPercent: 50,
    atMs: 1_700_000_000_200,
    receivedAtMs: 1_700_000_000_300,
    voltageMv: 3840,
  },
  today: { date: '2026-07-28', urinationCount: 3, estimatedUrineTotalMl: 550 },
  lastReportedAtMs: 1_700_000_000_400,
}

interface FakeStore
  extends Omit<
    DeviceOverviewStore,
    'state' | 'devices' | 'selectedDeviceId' | 'load' | 'selectDevice' | 'dispose'
  > {
  state: Ref<DeviceOverviewState>
  devices: Ref<OwnedDevice[]>
  selectedDeviceId: Ref<string | null>
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

function mountHomeView(deviceStore: FakeStore, authState: AuthState = signedIn()) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const authStore = { state: ref(authState) }
  return mount(HomeView, {
    global: {
      plugins: [router],
      provide: {
        [AUTH_STORE_KEY as symbol]: authStore,
        [DEVICE_OVERVIEW_STORE_KEY as symbol]: deviceStore,
      },
      stubs: {
        WifiConnectionGuideDialog: WifiConnectionGuideDialogStub,
      },
    },
  })
}

async function closeWifiGuide(wrapper: ReturnType<typeof mountHomeView>): Promise<void> {
  await wrapper.get('[data-test="wifi-guide-dialog-close"]').trigger('click')
}

describe('HomeView Wi-Fi connection guide', () => {
  it('automatically opens once for a signed-in member whose device state becomes empty', async () => {
    const store = makeDeviceStore({ state: { status: 'loading' } })
    const wrapper = mountHomeView(store)

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)

    store.state.value = { status: 'empty' }
    await nextTick()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    expect(window.sessionStorage.getItem(wifiGuideKey('member-001'))).toBe('1')
  })

  it('does not open or record a marker for loading, ready, or error device states', async () => {
    const stores = [
      makeDeviceStore({ state: { status: 'loading' } }),
      makeDeviceStore({
        state: { status: 'ready', projection: readyProjection },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
      makeDeviceStore({ state: { status: 'error' } }),
    ]

    for (const store of stores) {
      const wrapper = mountHomeView(store)
      await flushPromises()

      expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
      expect(window.sessionStorage.getItem(wifiGuideKey('member-001'))).toBeNull()
      wrapper.unmount()
    }
  })

  it('does not open or record a marker for an empty state without a signed-in member', async () => {
    const wrapper = mountHomeView(
      makeDeviceStore({ state: { status: 'empty' } }),
      { status: 'signed-out' },
    )
    await flushPromises()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('deduplicates repeated empty states and remounts for the same UID in one tab session', async () => {
    const store = makeDeviceStore({ state: { status: 'empty' } })
    const wrapper = mountHomeView(store)
    await flushPromises()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    await closeWifiGuide(wrapper)

    store.state.value = { status: 'loading' }
    await nextTick()
    store.state.value = { status: 'empty' }
    await nextTick()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
    wrapper.unmount()

    const remounted = mountHomeView(makeDeviceStore({ state: { status: 'empty' } }))
    await flushPromises()
    expect(remounted.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
  })

  it('tracks automatic presentation separately for different member UIDs', async () => {
    window.sessionStorage.setItem(wifiGuideKey('member-001'), '1')

    const wrapper = mountHomeView(
      makeDeviceStore({ state: { status: 'empty' } }),
      signedIn('member-002'),
    )
    await flushPromises()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    expect(window.sessionStorage.getItem(wifiGuideKey('member-001'))).toBe('1')
    expect(window.sessionStorage.getItem(wifiGuideKey('member-002'))).toBe('1')
  })

  it('marks a manual opening during loading so a later empty state does not auto-open', async () => {
    const store = makeDeviceStore({ state: { status: 'loading' } })
    const wrapper = mountHomeView(store)

    await wrapper.get('button[aria-label="開啟 Wi-Fi 連線說明"]').trigger('click')

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    expect(window.sessionStorage.getItem(wifiGuideKey('member-001'))).toBe('1')

    await closeWifiGuide(wrapper)
    store.state.value = { status: 'empty' }
    await nextTick()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
  })

  it('uses in-memory deduplication when reading sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    const store = makeDeviceStore({ state: { status: 'empty' } })
    const wrapper = mountHomeView(store)
    await flushPromises()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    await closeWifiGuide(wrapper)

    store.state.value = { status: 'loading' }
    await nextTick()
    store.state.value = { status: 'empty' }
    await nextTick()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="開啟 Wi-Fi 連線說明"]').trigger('click')
    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
  })

  it('uses in-memory deduplication when writing sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const store = makeDeviceStore({ state: { status: 'empty' } })
    const wrapper = mountHomeView(store)
    await flushPromises()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    await closeWifiGuide(wrapper)

    store.state.value = { status: 'loading' }
    await nextTick()
    store.state.value = { status: 'empty' }
    await nextTick()

    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="開啟 Wi-Fi 連線說明"]').trigger('click')
    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
  })

  it('keeps the accessible home help action available for repeated manual openings', async () => {
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: { status: 'ready', projection: readyProjection },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
    )
    const helpButton = wrapper.get('button[aria-label="開啟 Wi-Fi 連線說明"]')

    await helpButton.trigger('click')
    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
    await closeWifiGuide(wrapper)
    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(false)

    await helpButton.trigger('click')
    expect(wrapper.find('[data-test="wifi-guide-dialog"]').exists()).toBe(true)
  })

  it('does not add the home-only help action to other AppHeader consumers', () => {
    const wrapper = mount(AppHeader)

    expect(wrapper.find('button[aria-label="開啟 Wi-Fi 連線說明"]').exists()).toBe(false)
  })

  it('renders explicitly provided header actions without changing the default brand content', () => {
    const wrapper = mount(AppHeader, {
      slots: {
        actions: '<button type="button" data-test="header-action">說明</button>',
      },
    })

    expect(wrapper.get('[data-test="header-action"]').text()).toBe('說明')
    expect(wrapper.get('.app-header__brand').text()).toContain('PeeCare')
  })
})

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
    freezeNow()
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: { status: 'ready', projection: readyProjection },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    // The latest-urination card is filled from the validated projection tuple.
    expect(wrapper.get('[data-test="card-latest-volume"]').text()).toContain('120')
    // The status card leads with the battery level from the validated tuple.
    expect(wrapper.get('[data-test="card-battery"]').text()).toContain('50')
    // A reporting device reads as connected in the card footer.
    expect(wrapper.get('[data-test="card-status"]').text()).toBe('Wi-Fi 連線中')
    // Today's totals come from the registry projection for the current day.
    expect(wrapper.get('[data-test="card-today-volume"]').text()).toContain('550')
    expect(wrapper.get('[data-test="card-today-count"]').text()).toContain('3')
    expect(wrapper.get('[data-test="hero-title"]').text()).toContain('3')
    expect(wrapper.get('[data-test="hero-today-volume"]').text()).toContain('550')
    // The comparison footers still have no data behind them.
    expect(wrapper.get('[data-test="card-today-volume-footer"]').text()).toContain('N/A')
    expect(wrapper.get('[data-test="card-today-count-footer"]').text()).toContain('N/A')
    // A single-device member sees no switcher.
    expect(wrapper.find('.device-selector').exists()).toBe(false)
    const text = wrapper.text()
    expect(text).not.toContain('比昨天多 8 mL')
    expect(text).not.toContain('Wi-Fi 正常')
  })

  it('renders the missing-data state as explicit unknown values, not zero', () => {
    freezeNow()
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: {
          status: 'ready',
          projection: { urination: null, battery: null, today: null, lastReportedAtMs: null },
        },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    expect(wrapper.get('[data-test="card-latest-volume"]').text()).toContain('N/A')
    expect(wrapper.get('[data-test="card-latest-time"]').text()).toBe('--:--')
    // A device that has never stored a urination event has unknown totals, not zero.
    expect(wrapper.get('[data-test="card-today-volume"]').text()).toContain('N/A')
    expect(wrapper.get('[data-test="card-today-count"]').text()).toContain('N/A')
    expect(wrapper.get('[data-test="hero-title"]').text()).toContain('N/A')
    expect(wrapper.get('[data-test="hero-today-volume"]').text()).toContain('N/A')
    // A device with no battery tuple shows an explicit unknown, not zero.
    expect(wrapper.get('[data-test="card-battery"]').text()).toContain('N/A')
    // Without any report instant the device is not claimed to be online.
    expect(wrapper.get('[data-test="card-status"]').text()).toBe('Wi-Fi 待機中')
    expect(wrapper.get('[data-test="hero-status"]').text()).toContain('待機中')
  })

  // Spec: ingestion updates the projection on every stored urination event, so a
  // projection left on an earlier day means nothing has been recorded today.
  it('renders a projection left on the previous day as zero for today', () => {
    freezeNow()
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: {
          status: 'ready',
          projection: {
            ...readyProjection,
            today: { date: '2026-07-27', urinationCount: 3, estimatedUrineTotalMl: 550 },
          },
        },
        devices: [device('PC-000001')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    expect(wrapper.get('[data-test="card-today-volume"]').text()).toContain('0')
    expect(wrapper.get('[data-test="card-today-count"]').text()).toContain('0')
    expect(wrapper.get('[data-test="hero-title"]').text()).toContain('0')
    expect(wrapper.get('[data-test="hero-today-volume"]').text()).toContain('0')
    expect(wrapper.get('[data-test="card-today-volume"]').text()).not.toContain('550')
    expect(wrapper.get('[data-test="card-today-count"]').text()).not.toContain('3')
  })

  it('shows the device selector when the member owns more than one device', () => {
    const wrapper = mountHomeView(
      makeDeviceStore({
        state: { status: 'ready', projection: readyProjection },
        devices: [device('PC-000001', '主浴室'), device('PC-000002')],
        selectedDeviceId: 'PC-000001',
      }),
    )

    expect(wrapper.find('.device-selector').exists()).toBe(true)
    expect(wrapper.get('[data-test="device-select"]').findAll('option').map((option) => option.text())).toEqual([
      '主浴室',
      'PC-000002',
    ])
  })

  it('switches devices through the store when a selector option is clicked', async () => {
    const store = makeDeviceStore({
      state: { status: 'ready', projection: readyProjection },
      devices: [device('PC-000001'), device('PC-000002')],
      selectedDeviceId: 'PC-000001',
    })
    const wrapper = mountHomeView(store)

    await wrapper.get('[data-test="device-select"]').setValue('PC-000002')

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
