import type { InjectionKey } from 'vue'

import type { DeviceOverviewStore } from './device-overview-store'

// Kept in its own module so views can inject the store without importing the
// Firebase-backed implementation, mirroring the auth store key convention.
export const DEVICE_OVERVIEW_STORE_KEY: InjectionKey<DeviceOverviewStore> =
  Symbol('device-overview-store')
