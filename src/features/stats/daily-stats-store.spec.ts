import { describe, expect, it, vi } from 'vitest'

import type { DailyCountPoint } from './daily-series'
import { createDailyStatsSource } from './daily-stats-source'
import { createDailyStatsStore } from './daily-stats-store'

const seriesA: readonly DailyCountPoint[] = [{ date: '2026-07-15', urinationCount: 1, synthetic: false }]
const seriesB: readonly DailyCountPoint[] = [{ date: '2026-07-15', urinationCount: 2, synthetic: false }]

describe('daily stats store', () => {
  it('clears the prior device series before loading the next device', async () => {
    const load = vi.fn((deviceId: string) => Promise.resolve(deviceId === 'A' ? seriesA : seriesB))
    const store = createDailyStatsStore({ source: { load } })

    await store.selectDevice('A')
    const loadingB = store.selectDevice('B')

    expect(store.series.value).toEqual([])
    expect(store.state.value).toEqual({ status: 'loading' })
    await loadingB
    expect(store.selectedDeviceId.value).toBe('B')
    expect(store.series.value).toEqual(seriesB)
    expect(store.state.value).toEqual({ status: 'ready' })
  })

  it('keeps the current device loading and error states distinct', async () => {
    const error = new Error('query failed')
    const store = createDailyStatsStore({ source: { load: vi.fn(() => Promise.reject(error)) } })

    await store.selectDevice('B')

    expect(store.state.value).toEqual({ status: 'error' })
    expect(store.error.value).toBe(error)
    await store.selectDevice(null)
    expect(store.state.value).toEqual({ status: 'no-device' })
  })

  it('returns fourteen synthetic zero points when the selected device has no documents', async () => {
    const source = createDailyStatsSource({
      loadDocuments: vi.fn(() => Promise.resolve([])),
      now: () => new Date('2026-07-28T01:00:00.000Z'),
    })

    const series = await source.load('B')

    expect(series).toHaveLength(14)
    expect(series.every((point) => point.urinationCount === 0 && point.synthetic)).toBe(true)
  })

  it('uses one captured range for both the query and the normalized series', async () => {
    const loadDocuments = vi.fn((_deviceId: string, range: { startDate: string, endDate: string }) => {
      expect(range).toEqual({ startDate: '2026-07-15', endDate: '2026-07-28' })
      return Promise.resolve([{ date: '2026-07-15', urinationCount: 3 }])
    })
    const source = createDailyStatsSource({
      loadDocuments,
      now: () => new Date('2026-07-28T01:00:00.000Z'),
    })

    const series = await source.load('B')

    expect(loadDocuments).toHaveBeenCalledTimes(1)
    expect(series[0]).toEqual({ date: '2026-07-15', urinationCount: 3, synthetic: false })
  })

  it('ignores a prior-device response that returns after the current device', async () => {
    let resolveA: (value: readonly DailyCountPoint[]) => void = () => undefined
    let resolveB: (value: readonly DailyCountPoint[]) => void = () => undefined
    const store = createDailyStatsStore({
      source: {
        load(deviceId) {
          return new Promise((resolve) => {
            if (deviceId === 'A') resolveA = resolve
            else resolveB = resolve
          })
        },
      },
    })

    const loadingA = store.selectDevice('A')
    const loadingB = store.selectDevice('B')
    resolveB(seriesB)
    await loadingB
    resolveA(seriesA)
    await loadingA

    expect(store.selectedDeviceId.value).toBe('B')
    expect(store.series.value).toEqual(seriesB)
    expect(store.state.value).toEqual({ status: 'ready' })
  })
})
