import type { InjectionKey } from 'vue'

import type { DeviceEventHistoryStore } from './device-event-history-store'

export const DEVICE_EVENT_HISTORY_STORE_KEY: InjectionKey<DeviceEventHistoryStore> =
  Symbol('device-event-history-store')
