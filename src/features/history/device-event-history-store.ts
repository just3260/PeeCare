import { readonly, ref, type DeepReadonly, type Ref } from 'vue'

import type { UrinationHistoryRecord } from './urination-history-model'

/** Opaque Firestore document cursor; it is only supplied back to the source. */
export type HistoryCursor = object

export interface UrinationHistoryPage {
  readonly items: readonly UrinationHistoryRecord[]
  readonly cursor: HistoryCursor | null
  readonly hasMore: boolean
}

/** Injectable read seam so history state is testable without Firestore. */
export interface UrinationHistorySource {
  loadPage(deviceId: string, cursor?: HistoryCursor | null): Promise<UrinationHistoryPage>
}

export type DeviceEventHistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'ready' }
  | { readonly status: 'end' }
  | { readonly status: 'error' }

export interface DeviceEventHistoryStore {
  readonly selectedDeviceId: DeepReadonly<Ref<string | null>>
  readonly generation: DeepReadonly<Ref<number>>
  readonly items: DeepReadonly<Ref<readonly UrinationHistoryRecord[]>>
  readonly cursor: DeepReadonly<Ref<HistoryCursor | null>>
  readonly error: DeepReadonly<Ref<unknown | null>>
  readonly state: DeepReadonly<Ref<DeviceEventHistoryState>>
  selectDevice(deviceId: string | null): Promise<void>
  loadMore(): Promise<void>
}

export function createDeviceEventHistoryStore(options: {
  readonly source: UrinationHistorySource
}): DeviceEventHistoryStore {
  const selectedDeviceId = ref<string | null>(null)
  const generation = ref(0)
  const items = ref<readonly UrinationHistoryRecord[]>([])
  const cursor = ref<HistoryCursor | null>(null)
  const error = ref<unknown | null>(null)
  const state = ref<DeviceEventHistoryState>({ status: 'empty' })
  let hasMore = false

  async function loadPage(reset: boolean): Promise<void> {
    const deviceId = selectedDeviceId.value
    if (!deviceId) {
      state.value = { status: 'empty' }
      return
    }
    const requestGeneration = ++generation.value
    state.value = { status: 'loading' }
    error.value = null
    try {
      const page = await options.source.loadPage(deviceId, reset ? null : cursor.value)
      if (requestGeneration !== generation.value || deviceId !== selectedDeviceId.value) {
        return
      }
      items.value = reset ? page.items : [...items.value, ...page.items]
      cursor.value = page.cursor
      hasMore = page.hasMore
      state.value = items.value.length === 0 ? { status: 'empty' } : hasMore ? { status: 'ready' } : { status: 'end' }
    } catch (caught) {
      if (requestGeneration !== generation.value || deviceId !== selectedDeviceId.value) {
        return
      }
      error.value = caught
      state.value = { status: 'error' }
    }
  }

  async function selectDevice(deviceId: string | null): Promise<void> {
    selectedDeviceId.value = deviceId
    // Reset synchronously, before the next request begins, so device A data is
    // impossible to display while device B is loading.
    items.value = []
    cursor.value = null
    error.value = null
    hasMore = false
    if (!deviceId) {
      state.value = { status: 'empty' }
      return
    }
    await loadPage(true)
  }

  async function loadMore(): Promise<void> {
    if (!selectedDeviceId.value || !hasMore) {
      return
    }
    await loadPage(false)
  }

  return {
    selectedDeviceId: readonly(selectedDeviceId),
    generation: readonly(generation),
    items: readonly(items),
    cursor: readonly(cursor),
    error: readonly(error),
    state: readonly(state),
    selectDevice,
    loadMore,
  }
}
