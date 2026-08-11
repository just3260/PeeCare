import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import TestToolView from './TestToolView.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { createProtectedResourceRegistry } from '@/features/auth/protected-resource-registry'
import { TEST_TOOL_API_KEY } from '@/features/test-tool/test-tool-api-key'
import type {
  TestToolApi,
  TestToolApiFailureReason,
  TestToolDeviceListResult,
  TestToolEventSubmissionResult,
} from '@/features/test-tool/test-tool-api'

afterEach(() => {
  document.body.innerHTML = ''
})

function api(options: {
  listResult?: TestToolDeviceListResult
  eventResult?: TestToolEventSubmissionResult
} = {}) {
  return {
    listDevices: vi.fn().mockResolvedValue(
      options.listResult ?? { ok: true, devices: [] },
    ),
    submitEvent: vi.fn().mockResolvedValue(
      options.eventResult ?? {
        ok: true,
        result: {
          status: 'stored',
          eventId:
            'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
          eventType: 'urination',
          deviceId: 'PC-DEV-000001',
          sequence: 17,
        },
      },
    ),
  } satisfies TestToolApi
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function mountView(
  testApi: TestToolApi,
  registry = createProtectedResourceRegistry(),
) {
  return mount(TestToolView, {
    attachTo: document.body,
    global: {
      provide: {
        [TEST_TOOL_API_KEY as symbol]: testApi,
        [AUTH_STORE_KEY as symbol]: { registry },
      },
      stubs: { AppHeader: true },
    },
  })
}

const eligibleDevices = [
  { deviceId: 'PC-DEV-000001', displayName: '浴室測試機' },
  { deviceId: 'PC-DEV-000002', displayName: 'PC-DEV-000002' },
]

describe('TestToolView device loading and privacy boundary', () => {
  it('loads only API-confirmed eligible devices and renders a loading state first', async () => {
    const pending = deferred<TestToolDeviceListResult>()
    const testApi = api()
    vi.mocked(testApi.listDevices).mockReturnValue(pending.promise)
    const wrapper = mountView(testApi)

    expect(wrapper.get('[data-test="test-tool-loading"]').text()).toContain('載入')
    expect(testApi.listDevices).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-test="test-tool-form"]').exists()).toBe(false)

    pending.resolve({ ok: true, devices: eligibleDevices })
    await flushPromises()

    expect(wrapper.findAll('[data-test="test-device-option"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('浴室測試機')
    expect(wrapper.text()).toContain('PC-DEV-000002')
  })

  it('renders an empty state with no event controls when the API returns no devices', async () => {
    const testApi = api()
    const wrapper = mountView(testApi)
    await flushPromises()

    expect(wrapper.get('[data-test="test-tool-empty"]').text()).toContain('沒有可用')
    expect(wrapper.find('[data-test="test-tool-form"]').exists()).toBe(false)
    expect(testApi.submitEvent).not.toHaveBeenCalled()
  })

  it('renders a sanitized retryable load error without identity or independent sign-in UI', async () => {
    const testApi = api({ listResult: { ok: false, reason: 'unauthorized' } })
    const wrapper = mountView(testApi)
    await flushPromises()

    expect(wrapper.get('[data-test="test-tool-load-error"]').text()).toContain('無法載入')
    expect(wrapper.find('input[type="email"]').exists()).toBe(false)
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/member-001|@|firebase-id-token/)

    vi.mocked(testApi.listDevices).mockResolvedValue({ ok: true, devices: eligibleDevices })
    await wrapper.get('[data-test="test-tool-retry"]').trigger('click')
    await flushPromises()
    expect(testApi.listDevices).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="test-tool-form"]').exists()).toBe(true)
  })

  it('contains no generic proxy, URL, header, topic, project, or product controls', async () => {
    const wrapper = mountView(api({ listResult: { ok: true, devices: eligibleDevices } }))
    await flushPromises()

    for (const name of ['url', 'method', 'headers', 'authorization', 'topic', 'projectId', 'productModel']) {
      expect(wrapper.find(`[name="${name}"]`).exists()).toBe(false)
    }
  })

  it('clears protected state and ignores a device response that arrives after session teardown', async () => {
    const pending = deferred<TestToolDeviceListResult>()
    const registry = createProtectedResourceRegistry()
    const testApi = api()
    vi.mocked(testApi.listDevices).mockReturnValue(pending.promise)
    const wrapper = mountView(testApi, registry)

    registry.disposeAll()
    pending.resolve({ ok: true, devices: eligibleDevices })
    await flushPromises()

    expect(wrapper.text()).not.toContain('PC-DEV-000001')
    expect(wrapper.text()).not.toContain('浴室測試機')
    expect(wrapper.find('[data-test="test-tool-form"]').exists()).toBe(false)
  })

  it('unregisters its session teardown when the route unmounts', async () => {
    const registry = createProtectedResourceRegistry()
    const wrapper = mountView(api(), registry)
    await flushPromises()

    expect(registry.size()).toBe(1)
    wrapper.unmount()

    expect(registry.size()).toBe(0)
  })
})

describe('TestToolView typed event forms', () => {
  it.each(['button', 'keyboard'] as const)(
    'submits a validated urination event with %s',
    async (trigger) => {
      const testApi = api({ listResult: { ok: true, devices: eligibleDevices } })
      const wrapper = mountView(testApi)
      await flushPromises()
      await wrapper.get('[data-test="flush-duration"]').setValue('1500')
      await wrapper.get('[data-test="pump-duration"]').setValue('2500')

      if (trigger === 'button') {
        await wrapper.get('[data-test="urination-submit"]').trigger('click')
      } else {
        await wrapper.get('[data-test="pump-duration"]').trigger('keydown.enter')
      }
      await flushPromises()

      expect(testApi.submitEvent).toHaveBeenCalledWith('PC-DEV-000001', {
        eventType: 'urination',
        flushDurationMs: 1_500,
        pumpDurationMs: 2_500,
      })
      expect(wrapper.get('[data-test="test-tool-success"]').text()).toContain('序號 17')
      expect(wrapper.get('[data-test="test-tool-success"]').text()).toContain('stored')
    },
  )

  it('selects another eligible device and submits an exact battery request', async () => {
    const testApi = api({
      listResult: { ok: true, devices: eligibleDevices },
      eventResult: {
        ok: true,
        result: {
          status: 'duplicate',
          eventId: 'tt:PC-DEV-000002:1b59ef13-fc86-4c17-95d4-8556ed098d32',
          eventType: 'battery',
          deviceId: 'PC-DEV-000002',
          sequence: 18,
        },
      },
    })
    const wrapper = mountView(testApi)
    await flushPromises()
    await wrapper.get('[data-test="test-device-select"]').setValue('PC-DEV-000002')
    await wrapper.get('[data-test="event-type-battery"]').setValue(true)
    await wrapper.get('[data-test="battery-level"]').setValue('75')
    await wrapper.get('[data-test="battery-voltage"]').setValue('3900')
    await wrapper.get('[data-test="battery-form"]').trigger('submit')
    await flushPromises()

    expect(testApi.submitEvent).toHaveBeenCalledWith('PC-DEV-000002', {
      eventType: 'battery',
      batteryLevelPercent: 75,
      batteryVoltageMv: 3_900,
    })
    expect(wrapper.get('[data-test="test-tool-success"]').text()).toContain('duplicate')
    expect(wrapper.get('[data-test="test-tool-success"]').text()).toContain('序號 18')
  })

  it.each([
    ['negative duration', 'urination', '-1', '20'],
    ['decimal duration', 'urination', '1.5', '20'],
    ['uint32 overflow', 'urination', '4294967296', '20'],
    ['invalid voltage', 'battery', '75', '20001'],
  ])('rejects %s with zero API calls', async (_case, type, first, second) => {
    const testApi = api({ listResult: { ok: true, devices: eligibleDevices } })
    const wrapper = mountView(testApi)
    await flushPromises()

    if (type === 'urination') {
      await wrapper.get('[data-test="flush-duration"]').setValue(first)
      await wrapper.get('[data-test="pump-duration"]').setValue(second)
      await wrapper.get('[data-test="urination-form"]').trigger('submit')
    } else {
      await wrapper.get('[data-test="event-type-battery"]').setValue(true)
      await wrapper.get('[data-test="battery-level"]').setValue(first)
      await wrapper.get('[data-test="battery-voltage"]').setValue(second)
      await wrapper.get('[data-test="battery-form"]').trigger('submit')
    }

    expect(testApi.submitEvent).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="test-tool-validation-error"]').attributes('role')).toBe('alert')
  })

  it('locks controls and suppresses duplicate submission while sending', async () => {
    const pending = deferred<TestToolEventSubmissionResult>()
    const testApi = api({ listResult: { ok: true, devices: eligibleDevices } })
    vi.mocked(testApi.submitEvent).mockReturnValue(pending.promise)
    const wrapper = mountView(testApi)
    await flushPromises()
    await wrapper.get('[data-test="flush-duration"]').setValue('1')
    await wrapper.get('[data-test="pump-duration"]').setValue('2')

    await wrapper.get('[data-test="urination-form"]').trigger('submit')
    await wrapper.get('[data-test="urination-form"]').trigger('submit')

    expect(testApi.submitEvent).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-test="test-tool-sending"]').text()).toContain('送出')
    expect(wrapper.get('[data-test="test-device-select"]').attributes('disabled')).toBeDefined()

    pending.resolve({
      ok: true,
      result: {
        status: 'stored',
        eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
        eventType: 'urination',
        deviceId: 'PC-DEV-000001',
        sequence: 17,
      },
    })
    await flushPromises()
    expect(wrapper.find('[data-test="test-tool-sending"]').exists()).toBe(false)
  })

  it('clears form/result state and ignores a submission response after session teardown', async () => {
    const pending = deferred<TestToolEventSubmissionResult>()
    const registry = createProtectedResourceRegistry()
    const testApi = api({ listResult: { ok: true, devices: eligibleDevices } })
    vi.mocked(testApi.submitEvent).mockReturnValue(pending.promise)
    const wrapper = mountView(testApi, registry)
    await flushPromises()
    await wrapper.get('[data-test="flush-duration"]').setValue('1500')
    await wrapper.get('[data-test="pump-duration"]').setValue('2500')
    await wrapper.get('[data-test="urination-form"]').trigger('submit')

    registry.disposeAll()
    pending.resolve({
      ok: true,
      result: {
        status: 'stored',
        eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
        eventType: 'urination',
        deviceId: 'PC-DEV-000001',
        sequence: 17,
      },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('PC-DEV-000001')
    expect(wrapper.text()).not.toContain('1b59ef13-fc86-4c17-95d4-8556ed098d32')
    expect(wrapper.find('[data-test="test-tool-success"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="test-tool-form"]').exists()).toBe(false)
  })

  it.each([
    ['urination flush', 'urination', 'flush-duration'],
    ['urination pump', 'urination', 'pump-duration'],
    ['battery level', 'battery', 'battery-level'],
    ['battery voltage', 'battery', 'battery-voltage'],
  ] as const)('clears a prior result when editing %s', async (_name, type, selector) => {
    const testApi = api({ listResult: { ok: true, devices: eligibleDevices } })
    const wrapper = mountView(testApi)
    await flushPromises()

    if (type === 'urination') {
      await wrapper.get('[data-test="flush-duration"]').setValue('1')
      await wrapper.get('[data-test="pump-duration"]').setValue('2')
      await wrapper.get('[data-test="urination-form"]').trigger('submit')
    } else {
      await wrapper.get('[data-test="event-type-battery"]').setValue(true)
      await wrapper.get('[data-test="battery-form"]').trigger('submit')
    }
    await flushPromises()
    expect(wrapper.find('[data-test="test-tool-success"]').exists()).toBe(true)

    const nextValue = selector === 'battery-level' ? '50' : '3'
    await wrapper.get(`[data-test="${selector}"]`).setValue(nextValue)

    expect(wrapper.find('[data-test="test-tool-success"]').exists()).toBe(false)
  })

  it.each([
    ['unauthorized', '登入狀態'],
    ['test_device_not_found', '裝置'],
    ['rate_limited', '稍後'],
    ['ingestion_unavailable', '暫時'],
    ['unexpected_error', '無法送出'],
  ] as const)('shows a sanitized %s failure state', async (reason, message) => {
    const testApi = api({
      listResult: { ok: true, devices: eligibleDevices },
      eventResult: { ok: false, reason: reason as TestToolApiFailureReason },
    })
    const wrapper = mountView(testApi)
    await flushPromises()
    await wrapper.get('[data-test="flush-duration"]').setValue('1')
    await wrapper.get('[data-test="pump-duration"]').setValue('2')
    await wrapper.get('[data-test="urination-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="test-tool-submit-error"]').text()).toContain(message)
    expect(wrapper.get('[data-test="test-tool-submit-error"]').text()).not.toMatch(
      /firebase|Bearer|ownerUid|member-001/,
    )
  })
})
