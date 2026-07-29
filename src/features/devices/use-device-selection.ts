import { computed, inject, type ComputedRef } from 'vue'

import { DEVICE_OVERVIEW_STORE_KEY } from './device-overview-store-key'
import type { OwnedDevice } from './owned-device-model'

/**
 * Shared wiring for the device switcher. Home, History, and Stats all present the
 * same {@link DeviceSelector} dropdown when the member owns more than one device,
 * so the injection and derived state live here rather than being copied per view.
 *
 * The store is a shared singleton: switching here updates `selectedDeviceId`,
 * which each view already watches to resync its own data. Optional chaining keeps
 * the composable safe when a view mounts without the store (tests, cold routes).
 */
export interface DeviceSelection {
  /** Owned devices in the store's stable order. */
  readonly devices: ComputedRef<readonly OwnedDevice[]>
  /** The currently selected device id, or null when none is owned. */
  readonly selectedDeviceId: ComputedRef<string | null>
  /** True only when the switcher is worth showing (more than one device). */
  readonly hasMultipleDevices: ComputedRef<boolean>
  /** Switch the selected device through the shared store. */
  selectDevice(deviceId: string): void
}

export function useDeviceSelection(): DeviceSelection {
  const deviceStore = inject(DEVICE_OVERVIEW_STORE_KEY, null)

  const devices = computed<readonly OwnedDevice[]>(() => deviceStore?.devices?.value ?? [])
  const selectedDeviceId = computed(() => deviceStore?.selectedDeviceId?.value ?? null)
  const hasMultipleDevices = computed(() => devices.value.length > 1)

  function selectDevice(deviceId: string): void {
    deviceStore?.selectDevice(deviceId)
  }

  return { devices, selectedDeviceId, hasMultipleDevices, selectDevice }
}
