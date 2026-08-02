// Reactive store for the member device overview.
//
// Responsibilities, kept deliberately narrow:
//   - list only the member's owned devices and hold them in a stable order;
//   - keep exactly one selected device whenever the list is non-empty, and keep
//     that selection stable across reloads;
//   - maintain at most one live Firestore listener for the selected device,
//     always unsubscribing the previous one before switching or disposing;
//   - expose an explicit state (loading / empty / ready / error) and never show
//     a previous device's data after a switch or a read failure.
//
// Firestore access is injected as an {@link OwnedDeviceSource} so the store is
// unit-tested without the SDK or the Emulator. History, stats, presence, and any
// write path are out of scope.

import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import {
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'

import { getFirebaseServices } from '@/platform/firebase/client'
import type { ProtectedResourceRegistry } from '@/features/auth/protected-resource-registry'
import { listOwnedDevices } from './owned-device-repository'
import type { OwnedDevice } from './owned-device-model'
import type {
  MemberDeviceApi,
  RenameDeviceFailureReason,
  RenameDeviceResult,
} from './member-device-api'
import { parseDeviceOverview, type DeviceOverviewProjection } from './device-overview-model'

/** Releases a single live device listener. */
export type DeviceUnsubscribe = () => void

/** Snapshot handlers a device watcher drives. `data` is null when the doc is absent. */
export interface DeviceWatchHandlers {
  readonly onData: (data: unknown | null) => void
  readonly onError: (error: unknown) => void
}

/**
 * The Firestore-facing seam. `list` returns the caller's owned devices; `watch`
 * opens a single live listener on one device document and returns its disposer.
 */
export interface OwnedDeviceSource {
  list(authenticatedUid: string): Promise<OwnedDevice[]>
  watch(deviceId: string, handlers: DeviceWatchHandlers): DeviceUnsubscribe
}

/** The explicit, mutually exclusive states the overview can be in. */
export type DeviceOverviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly projection: DeviceOverviewProjection }
  | { readonly status: 'error' }

export type DeviceRenameState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving'; readonly deviceId: string }
  | {
      readonly status: 'error'
      readonly deviceId: string
      readonly reason: RenameDeviceFailureReason
    }

export interface DeviceOverviewStore {
  /** Owned devices in stable (deviceId-sorted) order. */
  readonly devices: DeepReadonly<Ref<readonly OwnedDevice[]>>
  /** The single selected device id, or null when the member owns none. */
  readonly selectedDeviceId: DeepReadonly<Ref<string | null>>
  /** The current overview state for the selected device. */
  readonly state: DeepReadonly<Ref<DeviceOverviewState>>
  /** State of the single allowed shared-name mutation. */
  readonly renameState: DeepReadonly<Ref<DeviceRenameState>>
  /** Load the owned-device list for the member, then select and watch one. */
  load(authenticatedUid: string): Promise<void>
  /** Switch the selected device, stopping the previous listener first. */
  selectDevice(deviceId: string): void
  /** Rename or clear one owned device through the authenticated Member API. */
  renameDevice(deviceId: string, customName: string | null): Promise<RenameDeviceResult>
  /** Stop the listener and clear all state (used on sign-out). */
  dispose(): void
}

export interface CreateDeviceOverviewStoreOptions {
  readonly source: OwnedDeviceSource
  /** Member mutation boundary, injected when naming is enabled. */
  readonly memberApi?: MemberDeviceApi
  /** Registry so the live listener is torn down on sign-out. Optional. */
  readonly registry?: ProtectedResourceRegistry
}

const LOADING: DeviceOverviewState = { status: 'loading' }
const EMPTY: DeviceOverviewState = { status: 'empty' }
const ERROR: DeviceOverviewState = { status: 'error' }
const RENAME_IDLE: DeviceRenameState = { status: 'idle' }

/** Devices ordered deterministically by id so the selection is stable. */
function inStableOrder(devices: readonly OwnedDevice[]): OwnedDevice[] {
  return [...devices].sort((a, b) => a.deviceId.localeCompare(b.deviceId))
}

/**
 * Choose the selected device: keep the current selection when it is still owned
 * (stable across reloads), otherwise fall back to the first device, or null when
 * the member owns none.
 */
export function chooseSelectedDevice(
  devices: readonly OwnedDevice[],
  current: string | null,
): string | null {
  if (devices.length === 0) {
    return null
  }
  if (current !== null && devices.some((device) => device.deviceId === current)) {
    return current
  }
  return devices[0].deviceId
}

export function createDeviceOverviewStore(
  options: CreateDeviceOverviewStoreOptions,
): DeviceOverviewStore {
  const { source, registry, memberApi } = options

  const devices = ref<readonly OwnedDevice[]>([])
  const selectedDeviceId = ref<string | null>(null)
  const state = ref<DeviceOverviewState>(LOADING)
  const renameState = ref<DeviceRenameState>(RENAME_IDLE)

  let unsubscribe: DeviceUnsubscribe | null = null
  let registeredTeardown = false
  let renameInFlight: Promise<RenameDeviceResult> | null = null
  let lifecycle = 0

  function stopListener(): void {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  function startListener(deviceId: string): void {
    // Stop the previous listener BEFORE opening the next so a switch never runs
    // two listeners and never mixes one device's data into another's view.
    stopListener()
    state.value = LOADING
    unsubscribe = source.watch(deviceId, {
      onData(data) {
        // A vanished document is a read-integrity problem, not "no data yet".
        if (data === null || data === undefined) {
          state.value = ERROR
          return
        }
        try {
          state.value = { status: 'ready', projection: parseDeviceOverview({ deviceId, data }) }
        } catch {
          // A partial/malformed projection must not render as a ready card.
          state.value = ERROR
        }
      },
      onError() {
        state.value = ERROR
      },
    })
  }

  function selectDevice(deviceId: string): void {
    selectedDeviceId.value = deviceId
    startListener(deviceId)
  }

  function ensureTeardownRegistered(): void {
    if (registry && !registeredTeardown) {
      registry.register(() => dispose())
      registeredTeardown = true
    }
  }

  async function load(authenticatedUid: string): Promise<void> {
    ensureTeardownRegistered()
    state.value = LOADING
    let owned: readonly OwnedDevice[]
    try {
      owned = await source.list(authenticatedUid)
    } catch {
      stopListener()
      devices.value = []
      selectedDeviceId.value = null
      state.value = ERROR
      return
    }

    const ordered = inStableOrder(owned)
    devices.value = ordered

    const next = chooseSelectedDevice(ordered, selectedDeviceId.value)
    if (next === null) {
      stopListener()
      selectedDeviceId.value = null
      state.value = EMPTY
      return
    }
    selectDevice(next)
  }

  function renameDevice(
    deviceId: string,
    customName: string | null,
  ): Promise<RenameDeviceResult> {
    if (renameInFlight) return renameInFlight

    const operationLifecycle = lifecycle
    renameState.value = { status: 'saving', deviceId }

    const operation = (async (): Promise<RenameDeviceResult> => {
      let result: RenameDeviceResult
      try {
        result = memberApi
          ? await memberApi.renameDevice(deviceId, customName)
          : { ok: false, reason: 'unexpected_error' }
      } catch {
        result = { ok: false, reason: 'unexpected_error' }
      }

      // Sign-out/dispose invalidates the operation. Return its transport result
      // to the original caller, but never republish data into a cleared store.
      if (operationLifecycle !== lifecycle) return result

      if (!result.ok) {
        renameState.value = { status: 'error', deviceId, reason: result.reason }
        return result
      }

      if (
        result.device.deviceId !== deviceId ||
        !devices.value.some((device) => device.deviceId === deviceId)
      ) {
        const invalidResult: RenameDeviceResult = {
          ok: false,
          reason: 'unexpected_error',
        }
        renameState.value = {
          status: 'error',
          deviceId,
          reason: invalidResult.reason,
        }
        return invalidResult
      }

      devices.value = devices.value.map((device) =>
        device.deviceId === deviceId
          ? { ...device, customName: result.device.customName }
          : device,
      )
      renameState.value = RENAME_IDLE
      return result
    })()

    renameInFlight = operation
    void operation.then(() => {
      if (renameInFlight === operation) renameInFlight = null
    })
    return operation
  }

  function dispose(): void {
    lifecycle += 1
    renameInFlight = null
    renameState.value = RENAME_IDLE
    stopListener()
    devices.value = []
    selectedDeviceId.value = null
    state.value = LOADING
  }

  return {
    devices: readonly(devices),
    selectedDeviceId: readonly(selectedDeviceId),
    state: readonly(state),
    renameState: readonly(renameState),
    load,
    selectDevice,
    renameDevice,
    dispose,
  }
}

/**
 * Production {@link OwnedDeviceSource} backed by the local Firebase adapter. It
 * reuses the ownership-constrained device query and opens a single-document
 * listener; a document that stops existing surfaces as null data.
 */
export function createFirestoreDeviceSource(): OwnedDeviceSource {
  function firestore(): Firestore {
    return getFirebaseServices().firestore
  }
  return {
    list(authenticatedUid: string): Promise<OwnedDevice[]> {
      return listOwnedDevices(firestore(), authenticatedUid)
    },
    watch(deviceId: string, handlers: DeviceWatchHandlers): DeviceUnsubscribe {
      const reference = doc(firestore(), 'devices', deviceId)
      return onSnapshot(
        reference,
        (snapshot) => {
          handlers.onData(snapshot.exists() ? (snapshot.data() as DocumentData) : null)
        },
        (error) => handlers.onError(error),
      )
    },
  }
}
