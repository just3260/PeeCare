import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, type Ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import DeviceConnectView from './DeviceConnectView.vue'
import type {
  DeviceClaimState,
  DeviceClaimStore,
} from '@/features/device-claim/device-claim-store'
import { DEVICE_CLAIM_STORE_KEY } from '@/features/device-claim/device-claim-store-key'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import type { AuthState } from '@/features/auth/session'
import { DEVICE_OVERVIEW_STORE_KEY } from '@/features/devices/device-overview-store-key'
import type { DeviceOverviewStore } from '@/features/devices/device-overview-store'

function createStore(initial: DeviceClaimState = { status: 'idle' }): DeviceClaimStore {
  return {
    state: ref(initial),
    createSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn(),
    dispose: vi.fn(),
  }
}

async function mountConnect(
  store: DeviceClaimStore,
  initialPath = '/connect',
  integration: {
    readonly authStore?: unknown
    readonly deviceStore?: Pick<DeviceOverviewStore, 'load'>
  } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/connect', component: DeviceConnectView },
    ],
  })
  await router.push(initialPath)
  await router.isReady()

  const wrapper = mount(DeviceConnectView, {
    global: {
      plugins: [router],
      provide: {
        [DEVICE_CLAIM_STORE_KEY as symbol]: store,
        ...(integration.authStore === undefined
          ? {}
          : { [AUTH_STORE_KEY as symbol]: integration.authStore }),
        ...(integration.deviceStore === undefined
          ? {}
          : { [DEVICE_OVERVIEW_STORE_KEY as symbol]: integration.deviceStore }),
      },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('DeviceConnectView', () => {
  it('selects one QR device for confirmation without implicitly creating a session', async () => {
    const store = createStore()
    const { wrapper } = await mountConnect(store, '/connect?deviceId=68E274BD2A58')

    expect(store.restoreSession).toHaveBeenCalledOnce()
    expect(store.createSession).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="selected-device-id"]').text()).toContain('68E274BD2A58')
    expect(wrapper.get('[data-test="confirm-device"]').attributes('type')).toBe('button')
  })

  it('re-parses a new connect query when Vue Router reuses the same component', async () => {
    const store = createStore()
    const { wrapper, router } = await mountConnect(store, '/connect?deviceId=68E274BD2A58')

    await router.push('/connect?deviceId=001122334455')
    await flushPromises()

    expect(wrapper.get('[data-test="selected-device-id"]').text()).toContain('001122334455')
    expect(wrapper.text()).not.toContain('68E274BD2A58')
    await wrapper.get('[data-test="confirm-device"]').trigger('click')
    expect(store.createSession).toHaveBeenCalledWith('001122334455')
  })

  it('rejects duplicate QR query values and does not create a session', async () => {
    const store = createStore()
    const { wrapper } = await mountConnect(
      store,
      '/connect?deviceId=68E274BD2A58&deviceId=001122334455',
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('一個裝置 ID')
    expect(wrapper.find('[data-test="selected-device-id"]').exists()).toBe(false)
    expect(store.createSession).not.toHaveBeenCalled()
  })

  it.each(['code', 'token', 'uid'])(
    'rejects and never renders forbidden %s query data',
    async (key) => {
      const store = createStore()
      const secret = 'sensitive-query-value'
      const { wrapper } = await mountConnect(
        store,
        `/connect?deviceId=68E274BD2A58&${key}=${secret}`,
      )

      expect(wrapper.find('[data-test="selected-device-id"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain(secret)
      expect(store.createSession).not.toHaveBeenCalled()
    },
  )

  it('normalizes manual input, then waits for explicit confirmation', async () => {
    const store = createStore()
    const { wrapper } = await mountConnect(store)

    await wrapper.get('input[name="deviceId"]').setValue(' 68e274bd2a58 ')
    await wrapper.get('[data-test="select-device-form"]').trigger('submit')

    expect(wrapper.get('[data-test="selected-device-id"]').text()).toContain('68E274BD2A58')
    expect(store.createSession).not.toHaveBeenCalled()

    await wrapper.get('[data-test="confirm-device"]').trigger('click')
    expect(store.createSession).toHaveBeenCalledOnce()
    expect(store.createSession).toHaveBeenCalledWith('68E274BD2A58')
  })

  it.each(['68E274BD2A5', '68E274BD2A5G'])(
    'rejects invalid manual device ID %s',
    async (deviceId) => {
      const store = createStore()
      const { wrapper } = await mountConnect(store)

      await wrapper.get('input[name="deviceId"]').setValue(deviceId)
      await wrapper.get('[data-test="select-device-form"]').trigger('submit')

      expect(wrapper.get('[role="alert"]').text()).toContain('12 碼')
      expect(store.createSession).not.toHaveBeenCalled()
    },
  )

  it('shows the one-time Pair Code only when the pending state still contains it', async () => {
    const withCode = createStore({
      status: 'pending',
      sessionId: 'session-001',
      deviceId: '68E274BD2A58',
      pairCode: '00123456',
      expiresAtMs: 2_000_000,
    })
    const { wrapper: codeWrapper } = await mountConnect(withCode)

    expect(codeWrapper.get('[data-test="pair-code"]').text()).toContain('00123456')

    const restored = createStore({
      status: 'pending',
      sessionId: 'session-001',
      deviceId: '68E274BD2A58',
      pairCode: null,
      expiresAtMs: 2_000_000,
    })
    const { wrapper: restoredWrapper } = await mountConnect(restored)

    expect(restoredWrapper.find('[data-test="pair-code"]').exists()).toBe(false)
    expect(restoredWrapper.get('[data-test="reissue-code"]').text()).toContain('重新產生')
  })

  it('requires an explicit reissue after reload lost the one-time code', async () => {
    const store = createStore({
      status: 'pending',
      sessionId: 'session-001',
      deviceId: '68E274BD2A58',
      pairCode: null,
      expiresAtMs: 2_000_000,
    })
    const { wrapper } = await mountConnect(store)

    expect(store.restoreSession).toHaveBeenCalledOnce()
    expect(store.createSession).not.toHaveBeenCalled()

    await wrapper.get('[data-test="reissue-code"]').trigger('click')
    expect(store.createSession).toHaveBeenCalledWith('68E274BD2A58')
  })

  it('reloads owned devices and returns home only after authoritative claimed state', async () => {
    const store = createStore({
      status: 'pending',
      sessionId: 'session-001',
      deviceId: '68E274BD2A58',
      pairCode: null,
      expiresAtMs: 2_000_000,
    })
    const deviceStore = { load: vi.fn().mockResolvedValue(undefined) }
    const { router } = await mountConnect(store, '/connect', {
      authStore: {
        state: ref({
          status: 'signed-in',
          user: { uid: 'member-001', displayName: null, email: null },
        }),
      },
      deviceStore,
    })

    expect(deviceStore.load).not.toHaveBeenCalled()
    ;(store.state as Ref<DeviceClaimState>).value = {
      status: 'claimed',
      sessionId: 'session-001',
      deviceId: '68E274BD2A58',
      expiresAtMs: 2_000_000,
    }
    await flushPromises()

    expect(deviceStore.load).toHaveBeenCalledOnce()
    expect(deviceStore.load).toHaveBeenCalledWith('member-001')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it.each(['expired', 'failed', 'conflict', 'replaced'] as const)(
    'shows a neutral restart for terminal %s without reloading devices',
    async (claimStatus) => {
      const store = createStore({
        status: 'terminal',
        sessionId: 'session-001',
        deviceId: '68E274BD2A58',
        claimStatus,
        expiresAtMs: 2_000_000,
      })
      const deviceStore = { load: vi.fn().mockResolvedValue(undefined) }
      const { wrapper, router } = await mountConnect(store, '/connect', {
        authStore: {
          state: ref({
            status: 'signed-in',
            user: { uid: 'member-001', displayName: null, email: null },
          }),
        },
        deviceStore,
      })

      expect(wrapper.get('[role="alert"]').text()).toContain('重新開始')
      expect(wrapper.text()).not.toContain(claimStatus)
      expect(deviceStore.load).not.toHaveBeenCalled()
      expect(router.currentRoute.value.path).toBe('/connect')
      await wrapper.get('button').trigger('click')
      expect(store.restart).toHaveBeenCalledOnce()
    },
  )

  it.each(['sign-out', 'unmount'] as const)(
    'does not navigate after a claimed reload is invalidated by %s',
    async (invalidation) => {
      let finishLoad!: () => void
      const load = vi.fn(() => new Promise<void>((resolve) => { finishLoad = resolve }))
      const store = createStore({
        status: 'pending',
        sessionId: 'session-001',
        deviceId: '68E274BD2A58',
        pairCode: null,
        expiresAtMs: 2_000_000,
      })
      const authState = ref<AuthState>({
        status: 'signed-in',
        user: { uid: 'member-001', displayName: null, email: null },
      })
      const { wrapper, router } = await mountConnect(store, '/connect', {
        authStore: { state: authState },
        deviceStore: { load },
      })
      const push = vi.spyOn(router, 'push')

      ;(store.state as Ref<DeviceClaimState>).value = {
        status: 'claimed',
        sessionId: 'session-001',
        deviceId: '68E274BD2A58',
        expiresAtMs: 2_000_000,
      }
      await Promise.resolve()
      expect(load).toHaveBeenCalledOnce()

      if (invalidation === 'sign-out') authState.value = { status: 'signed-out' }
      else wrapper.unmount()
      finishLoad()
      await flushPromises()

      expect(push).not.toHaveBeenCalledWith('/')
      if (invalidation === 'sign-out') {
        expect(router.currentRoute.value.path).toBe('/connect')
      }
    },
  )
})
