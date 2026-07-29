import { describe, expect, it, vi } from 'vitest'

import type { UrinationHistoryRecord } from './urination-history-model'
import {
  createDeviceEventHistoryStore,
  type UrinationHistoryPage,
  type UrinationHistorySource,
} from './device-event-history-store'

const event: UrinationHistoryRecord = Object.freeze({
  eventId: 'evt-000001', eventType: 'urination', deviceId: 'PC-000001', sequence: 1,
  effectiveAtMs: 1_785_168_000_000, flushDurationMs: 3_000, pumpDurationMs: 5_000,
  estimatedUrineMl: 200, estimationStatus: 'estimated',
})

describe('device event history store', () => {
  it('clears the prior device items, cursor, and error before beginning the next query', async () => {
    const source: UrinationHistorySource = {
      loadPage: vi
        .fn()
        .mockResolvedValueOnce({ items: [event], cursor: { id: 'cursor-A' }, hasMore: true })
        .mockRejectedValueOnce(new Error('network failed'))
        .mockResolvedValueOnce({ items: [], cursor: null, hasMore: false }),
    }
    const store = createDeviceEventHistoryStore({ source })

    await store.selectDevice('PC-000001')
    await store.loadMore()
    expect(store.items.value).toEqual([event])
    expect(store.cursor.value).toEqual({ id: 'cursor-A' })
    expect(store.error.value).toBeInstanceOf(Error)

    const switchToB = store.selectDevice('PC-000002')

    expect(store.items.value).toEqual([])
    expect(store.cursor.value).toBeNull()
    expect(store.error.value).toBeNull()
    expect(store.state.value.status).toBe('loading')
    await switchToB
  })

  it('ignores a slower prior-device response after a device switch', async () => {
    let resolveA!: (page: { items: readonly UrinationHistoryRecord[]; cursor: object | null; hasMore: boolean }) => void
    const source: UrinationHistorySource = {
      loadPage: vi.fn((deviceId): Promise<UrinationHistoryPage> => deviceId === 'PC-000001'
        ? new Promise((resolve) => { resolveA = resolve })
        : Promise.resolve({ items: [{ ...event, eventId: 'evt-B', deviceId: 'PC-000002' }], cursor: null, hasMore: false })),
    }
    const store = createDeviceEventHistoryStore({ source })

    const loadingA = store.selectDevice('PC-000001')
    await store.selectDevice('PC-000002')
    resolveA({ items: [event], cursor: { id: 'cursor-A' }, hasMore: true })
    await loadingA

    expect(store.items.value.map((item) => item.eventId)).toEqual(['evt-B'])
    expect(store.cursor.value).toBeNull()
    expect(store.state.value).toEqual({ status: 'end' })
  })

  it('ignores a slower retry after a newer retry begins', async () => {
    let resolveFirstRetry!: (page: { items: readonly UrinationHistoryRecord[]; cursor: object | null; hasMore: boolean }) => void
    const source: UrinationHistorySource = {
      loadPage: vi.fn()
        .mockResolvedValueOnce({ items: [event], cursor: { id: 'cursor-1' }, hasMore: true })
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstRetry = resolve }))
        .mockResolvedValueOnce({ items: [{ ...event, eventId: 'evt-new' }], cursor: null, hasMore: false }),
    }
    const store = createDeviceEventHistoryStore({ source })
    await store.selectDevice('PC-000001')

    const slowRetry = store.loadMore()
    const latestRetry = store.loadMore()
    await latestRetry
    resolveFirstRetry({ items: [{ ...event, eventId: 'evt-old' }], cursor: null, hasMore: false })
    await slowRetry

    expect(store.items.value.map((item) => item.eventId)).toEqual(['evt-000001', 'evt-new'])
    expect(store.state.value).toEqual({ status: 'end' })
  })
})
