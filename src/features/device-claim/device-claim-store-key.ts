import type { InjectionKey } from 'vue'

import type { DeviceClaimStore } from './device-claim-store'

export const DEVICE_CLAIM_STORE_KEY: InjectionKey<DeviceClaimStore> = Symbol('device-claim-store')
