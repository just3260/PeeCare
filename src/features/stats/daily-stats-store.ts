import { readonly, ref, type DeepReadonly, type Ref } from 'vue'

import type { DailyCountPoint } from './daily-series'

export type DailyStatsState =
  | { readonly status: 'no-device' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'error' }

/** Injectable query seam, keeping Firestore out of state tests and views. */
export interface DailyStatsSource {
  load(deviceId: string): Promise<readonly DailyCountPoint[]>
}

export interface DailyStatsStore {
  readonly selectedDeviceId: DeepReadonly<Ref<string | null>>
  readonly generation: DeepReadonly<Ref<number>>
  readonly series: DeepReadonly<Ref<readonly DailyCountPoint[]>>
  readonly error: DeepReadonly<Ref<unknown | null>>
  readonly state: DeepReadonly<Ref<DailyStatsState>>
  selectDevice(deviceId: string | null): Promise<void>
}

export function createDailyStatsStore(options: { readonly source: DailyStatsSource }): DailyStatsStore {
  const selectedDeviceId = ref<string | null>(null)
  const generation = ref(0)
  const series = ref<readonly DailyCountPoint[]>([])
  const error = ref<unknown | null>(null)
  const state = ref<DailyStatsState>({ status: 'no-device' })

  async function selectDevice(deviceId: string | null): Promise<void> {
    selectedDeviceId.value = deviceId
    const requestGeneration = ++generation.value
    // Clear synchronously: no prior device statistics can appear during a load.
    series.value = []
    error.value = null
    if (!deviceId) {
      state.value = { status: 'no-device' }
      return
    }

    state.value = { status: 'loading' }
    try {
      const nextSeries = await options.source.load(deviceId)
      if (requestGeneration !== generation.value || deviceId !== selectedDeviceId.value) return
      series.value = nextSeries
      state.value = { status: 'ready' }
    } catch (caught) {
      if (requestGeneration !== generation.value || deviceId !== selectedDeviceId.value) return
      error.value = caught
      state.value = { status: 'error' }
    }
  }

  return {
    selectedDeviceId: readonly(selectedDeviceId),
    generation: readonly(generation),
    series: readonly(series),
    error: readonly(error),
    state: readonly(state),
    selectDevice,
  }
}
