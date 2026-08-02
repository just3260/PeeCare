import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProtectedResourceRegistry } from '@/features/auth/protected-resource-registry'
import type { OwnedDevice } from './owned-device-model'
import { resolveDeviceDisplayName } from './device-display-name'
import type { MemberDeviceApi, RenameDeviceResult } from './member-device-api'
import {
  chooseSelectedDevice,
  createDeviceOverviewStore,
  type DeviceWatchHandlers,
  type OwnedDeviceSource,
} from './device-overview-store'

function device(deviceId: string, ownerUid = 'member-001'): OwnedDevice {
  return { deviceId, ownerUid, productModel: 'pc-mini', ingestionStatus: 'enabled', customName: null }
}

function memberApi(result: RenameDeviceResult): {
  api: MemberDeviceApi
  renameDevice: ReturnType<typeof vi.fn>
} {
  const renameDevice = vi.fn().mockResolvedValue(result)
  return { api: { renameDevice }, renameDevice }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const completeSnapshot = {
  latestUrinationEventId: 'evt-urination-1',
  latestUrinationAtMs: 1_700_000_000_000,
  latestUrinationReceivedAtMs: 1_700_000_000_100,
  latestUrinationEstimatedUrineMl: 200,
  latestUrinationEstimationStatus: 'estimated',
  latestBatteryEventId: 'evt-battery-1',
  latestBatteryLevelPercent: 50,
  latestBatteryAtMs: 1_700_000_000_200,
  latestBatteryReceivedAtMs: 1_700_000_000_300,
  lastReportedAtMs: 1_700_000_000_400,
}

interface Watcher {
  readonly deviceId: string
  readonly handlers: DeviceWatchHandlers
  stopped: boolean
}

// A controllable source: `list` resolves the configured devices; `watch` records
// each listener and lets a test drive snapshots. `events` captures start/stop
// order so listener-ordering guarantees can be asserted directly.
function createFakeSource(devices: OwnedDevice[]) {
  const watchers: Watcher[] = []
  const events: string[] = []
  const source: OwnedDeviceSource = {
    list: vi.fn(async () => devices),
    watch(deviceId, handlers) {
      const watcher: Watcher = { deviceId, handlers, stopped: false }
      watchers.push(watcher)
      events.push(`start:${deviceId}`)
      return () => {
        watcher.stopped = true
        events.push(`stop:${deviceId}`)
      }
    },
  }
  return { source, watchers, events }
}

describe('chooseSelectedDevice', () => {
  it('selects null when the member owns no devices', () => {
    expect(chooseSelectedDevice([], null)).toBeNull()
  })

  it('selects the only device when the member owns one', () => {
    expect(chooseSelectedDevice([device('PC-000001')], null)).toBe('PC-000001')
  })

  it('selects the first device when two are owned and none is selected yet', () => {
    expect(chooseSelectedDevice([device('PC-000001'), device('PC-000002')], null)).toBe('PC-000001')
  })

  it('keeps the current selection when it is still owned (stable)', () => {
    expect(chooseSelectedDevice([device('PC-000001'), device('PC-000002')], 'PC-000002')).toBe(
      'PC-000002',
    )
  })

  it('falls back to the first device when the current selection is gone', () => {
    expect(chooseSelectedDevice([device('PC-000002')], 'PC-000001')).toBe('PC-000002')
  })
})

describe('device overview store: selection', () => {
  it('shows an empty state and starts no listener when no devices are owned', async () => {
    const { source, watchers } = createFakeSource([])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')

    expect(store.state.value).toEqual({ status: 'empty' })
    expect(store.selectedDeviceId.value).toBeNull()
    expect(store.devices.value).toEqual([])
    expect(watchers).toHaveLength(0)
  })

  it('selects the only owned device and starts one listener', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')

    expect(store.selectedDeviceId.value).toBe('PC-000001')
    expect(watchers).toHaveLength(1)
    expect(watchers[0].deviceId).toBe('PC-000001')
  })

  it('lists two owned devices in stable order and selects the first', async () => {
    const { source } = createFakeSource([device('PC-000002'), device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')

    expect(store.devices.value.map((device) => device.deviceId)).toEqual([
      'PC-000001',
      'PC-000002',
    ])
    expect(store.selectedDeviceId.value).toBe('PC-000001')
  })

  it('keeps a manual selection stable across a reload', async () => {
    const { source } = createFakeSource([device('PC-000001'), device('PC-000002')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    store.selectDevice('PC-000002')
    await store.load('member-001')

    expect(store.selectedDeviceId.value).toBe('PC-000002')
  })

  it('surfaces a read error when listing devices fails', async () => {
    const source: OwnedDeviceSource = {
      list: vi.fn(async () => {
        throw new Error('permission denied')
      }),
      watch: vi.fn(),
    }
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')

    expect(store.state.value).toEqual({ status: 'error' })
    expect(source.watch).not.toHaveBeenCalled()
  })
})

describe('device overview store: single selected-device listener', () => {
  it('stops the previous listener before starting the next on switch', async () => {
    const { source, events } = createFakeSource([device('PC-000001'), device('PC-000002')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    store.selectDevice('PC-000002')

    // The A listener must stop strictly before the B listener starts.
    expect(events).toEqual(['start:PC-000001', 'stop:PC-000001', 'start:PC-000002'])
  })

  it('clears the previous ready data back to loading on switch', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001'), device('PC-000002')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    watchers[0].handlers.onData(completeSnapshot)
    expect(store.state.value.status).toBe('ready')

    store.selectDevice('PC-000002')

    // No stale device-A data may linger while device B's first snapshot is pending.
    expect(store.state.value).toEqual({ status: 'loading' })
  })

  it('tears the listener down through the protected-resource registry on sign-out', async () => {
    const registry = createProtectedResourceRegistry()
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source, registry })

    await store.load('member-001')
    expect(registry.size()).toBe(1)

    registry.disposeAll()

    expect(watchers[0].stopped).toBe(true)
    expect(store.state.value).toEqual({ status: 'loading' })
    expect(store.selectedDeviceId.value).toBeNull()
  })

  it('unsubscribes the listener on dispose', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    store.dispose()

    expect(watchers[0].stopped).toBe(true)
  })
})

describe('device overview store: snapshot states', () => {
  it('becomes ready with the parsed projection on a valid snapshot', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    watchers[0].handlers.onData(completeSnapshot)

    expect(store.state.value).toEqual({
      status: 'ready',
      projection: {
        urination: {
          eventId: 'evt-urination-1',
          atMs: 1_700_000_000_000,
          receivedAtMs: 1_700_000_000_100,
          estimatedUrineMl: 200,
          estimationStatus: 'estimated',
        },
        battery: {
          eventId: 'evt-battery-1',
          levelPercent: 50,
          atMs: 1_700_000_000_200,
          receivedAtMs: 1_700_000_000_300,
          voltageMv: null,
        },
        today: null,
        lastReportedAtMs: 1_700_000_000_400,
      },
    })
  })

  // Spec example: a battery projection update from 50 to 25 is reflected verbatim.
  it('reflects a projection update on the selected device', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    watchers[0].handlers.onData(completeSnapshot)
    watchers[0].handlers.onData({ ...completeSnapshot, latestBatteryLevelPercent: 25 })

    expect(store.state.value).toMatchObject({
      status: 'ready',
      projection: { battery: { levelPercent: 25 } },
    })
  })

  it('enters the error state when a snapshot carries a partial tuple', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    watchers[0].handlers.onData({ latestBatteryLevelPercent: 25 })

    expect(store.state.value).toEqual({ status: 'error' })
  })

  it('enters the error state and clears data when the listener fails', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    watchers[0].handlers.onData(completeSnapshot)
    watchers[0].handlers.onError(new Error('listener failed'))

    expect(store.state.value).toEqual({ status: 'error' })
  })

  it('treats a vanished document as an error, not empty data', async () => {
    const { source, watchers } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source })

    await store.load('member-001')
    watchers[0].handlers.onData(null)

    expect(store.state.value).toEqual({ status: 'error' })
  })
})

describe('device overview store: shared device rename', () => {
  it('updates only the matching device after canonical API success without changing order or selection', async () => {
    const { source } = createFakeSource([device('PC-000002'), device('PC-000001')])
    const { api, renameDevice } = memberApi({
      ok: true,
      device: { deviceId: 'PC-000002', customName: '主浴室', displayName: '主浴室' },
    })
    const store = createDeviceOverviewStore({ source, memberApi: api })
    await store.load('member-001')
    store.selectDevice('PC-000002')

    await expect(store.renameDevice('PC-000002', ' 主浴室 ')).resolves.toEqual({
      ok: true,
      device: { deviceId: 'PC-000002', customName: '主浴室', displayName: '主浴室' },
    })

    expect(renameDevice).toHaveBeenCalledWith('PC-000002', ' 主浴室 ')
    expect(store.devices.value.map(({ deviceId, customName }) => ({ deviceId, customName }))).toEqual([
      { deviceId: 'PC-000001', customName: null },
      { deviceId: 'PC-000002', customName: '主浴室' },
    ])
    expect(store.selectedDeviceId.value).toBe('PC-000002')
    expect(store.renameState.value).toEqual({ status: 'idle' })
  })

  it('commits null from a clear response so display name falls back to deviceId', async () => {
    const named = { ...device('PC-000001'), customName: '主浴室' }
    const { source } = createFakeSource([named])
    const { api } = memberApi({
      ok: true,
      device: { deviceId: 'PC-000001', customName: null, displayName: 'PC-000001' },
    })
    const store = createDeviceOverviewStore({ source, memberApi: api })
    await store.load('member-001')

    await store.renameDevice('PC-000001', null)

    expect(store.devices.value[0].customName).toBeNull()
    expect(resolveDeviceDisplayName(store.devices.value[0])).toBe('PC-000001')
  })

  it.each([
    'unauthorized',
    'device_not_found',
    'persistence_unavailable',
    'unexpected_error',
  ] as const)('keeps committed devices unchanged on %s failure', async (reason) => {
    const named = { ...device('PC-000001'), customName: '原名稱' }
    const { source } = createFakeSource([named])
    const { api } = memberApi({ ok: false, reason })
    const store = createDeviceOverviewStore({ source, memberApi: api })
    await store.load('member-001')

    await store.renameDevice('PC-000001', '新名稱')

    expect(store.devices.value).toEqual([named])
    expect(store.renameState.value).toEqual({ status: 'error', deviceId: 'PC-000001', reason })
  })

  it('exposes saving state and suppresses a duplicate while one rename is in flight', async () => {
    const pending = deferred<RenameDeviceResult>()
    const renameDevice = vi.fn().mockReturnValue(pending.promise)
    const { source } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({ source, memberApi: { renameDevice } })
    await store.load('member-001')

    const first = store.renameDevice('PC-000001', '主浴室')
    const duplicate = store.renameDevice('PC-000001', '另一個名稱')

    expect(store.renameState.value).toEqual({ status: 'saving', deviceId: 'PC-000001' })
    expect(renameDevice).toHaveBeenCalledOnce()
    pending.resolve({
      ok: true,
      device: { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室' },
    })
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { ok: true, device: { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室' } },
      { ok: true, device: { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室' } },
    ])
    expect(store.devices.value[0].customName).toBe('主浴室')
  })

  it('rejects a success response for a different device without changing committed state', async () => {
    const original = device('PC-000001')
    const { source } = createFakeSource([original, device('PC-000002')])
    const { api } = memberApi({
      ok: true,
      device: { deviceId: 'PC-000002', customName: '錯誤更新', displayName: '錯誤更新' },
    })
    const store = createDeviceOverviewStore({ source, memberApi: api })
    await store.load('member-001')

    await expect(store.renameDevice('PC-000001', '主浴室')).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
    expect(store.devices.value[0]).toEqual(original)
    expect(store.devices.value[1].customName).toBeNull()
  })

  it('does not apply a rename response that arrives after dispose', async () => {
    const pending = deferred<RenameDeviceResult>()
    const { source } = createFakeSource([device('PC-000001')])
    const store = createDeviceOverviewStore({
      source,
      memberApi: { renameDevice: vi.fn().mockReturnValue(pending.promise) },
    })
    await store.load('member-001')

    const rename = store.renameDevice('PC-000001', '主浴室')
    store.dispose()
    pending.resolve({
      ok: true,
      device: { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室' },
    })
    await rename

    expect(store.devices.value).toEqual([])
    expect(store.renameState.value).toEqual({ status: 'idle' })
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
