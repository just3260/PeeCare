import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProtectedResourceRegistry } from '@/features/auth/protected-resource-registry'
import type { OwnedDevice } from './owned-device-model'
import {
  chooseSelectedDevice,
  createDeviceOverviewStore,
  type DeviceWatchHandlers,
  type OwnedDeviceSource,
} from './device-overview-store'

function device(deviceId: string, ownerUid = 'member-001'): OwnedDevice {
  return { deviceId, ownerUid, productModel: 'pc-mini', ingestionStatus: 'enabled' }
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

beforeEach(() => {
  vi.clearAllMocks()
})
