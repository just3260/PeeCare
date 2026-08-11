import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import {
  createApplicationRoutes,
  registerAuthGuard,
  type AuthGuardStore,
} from './index'
import { TEST_TOOL_API_KEY } from '@/features/test-tool/test-tool-api-key'
import type { TestToolApi } from '@/features/test-tool/test-tool-api'

describe('protected tester route rendering boundary', () => {
  it('renders and loads the tester tool on a signed-in direct route', async () => {
    const api: TestToolApi = {
      listDevices: vi.fn().mockResolvedValue({ ok: true, devices: [] }),
      submitEvent: vi.fn(),
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: createApplicationRoutes({ testToolEnabled: true }),
    })
    const store: AuthGuardStore = {
      state: {
        value: {
          status: 'signed-in',
          user: { uid: 'member-001', displayName: null, email: null },
        },
      },
      whenResolved: () => Promise.resolve(),
    }
    registerAuthGuard(router, store)
    const wrapper = mount(RouterView, {
      global: {
        plugins: [router],
        provide: { [TEST_TOOL_API_KEY as symbol]: api },
        stubs: { AppHeader: true },
      },
    })

    await router.push('/test-tool')
    await router.isReady()
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/test-tool')
    expect(api.listDevices).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-test="test-tool-view"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="test-tool-empty"]').text()).toContain('沒有可用')
  })

  it('makes zero API calls and renders no tester data for a signed-out direct load', async () => {
    const api: TestToolApi = {
      listDevices: vi.fn(),
      submitEvent: vi.fn(),
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: createApplicationRoutes({ testToolEnabled: true }),
    })
    const store: AuthGuardStore = {
      state: { value: { status: 'signed-out' } },
      whenResolved: () => Promise.resolve(),
    }
    registerAuthGuard(router, store)
    const wrapper = mount(RouterView, {
      global: {
        plugins: [router],
        provide: { [TEST_TOOL_API_KEY as symbol]: api },
      },
    })

    await router.push('/test-tool')
    await router.isReady()
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/sign-in')
    expect(api.listDevices).not.toHaveBeenCalled()
    expect(api.submitEvent).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="test-tool-view"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="test-tool-form"]').exists()).toBe(false)
  })
})
