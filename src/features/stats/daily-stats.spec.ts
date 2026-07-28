import { beforeEach, describe, expect, it, vi } from 'vitest'

const collection = vi.fn()
const getDocs = vi.fn()
const orderBy = vi.fn()
const query = vi.fn()
const where = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collection(...args),
  getDocs: (...args: unknown[]) => getDocs(...args),
  orderBy: (...args: unknown[]) => orderBy(...args),
  query: (...args: unknown[]) => query(...args),
  where: (...args: unknown[]) => where(...args),
}))

import { loadDailyStats, taipeiFourteenDayRange } from './daily-stats-repository'
import { buildDailyCountSeries } from './daily-series'
import {
  DailyStatsDataIntegrityError,
  parseDailyStatsDocument,
} from './daily-stats-model'

const firestore = { __firestore: true } as never

beforeEach(() => {
  collection.mockReset()
  getDocs.mockReset()
  orderBy.mockReset()
  query.mockReset()
  where.mockReset()
  collection.mockImplementation((_db, ...path: string[]) => ({ __collection: path.join('/') }))
  where.mockImplementation((field, operator, value) => ({ __where: [field, operator, value] }))
  orderBy.mockImplementation((field, direction) => ({ __orderBy: [field, direction] }))
  query.mockImplementation((reference, ...constraints) => ({ reference, constraints }))
})

describe('daily stats repository', () => {
  it('builds the inclusive fourteen-day Asia/Taipei calendar range', () => {
    expect(taipeiFourteenDayRange(new Date('2026-07-28T01:00:00.000Z'))).toEqual({
      startDate: '2026-07-15',
      endDate: '2026-07-28',
    })
  })

  it('queries one device within that range in ascending date order', async () => {
    getDocs.mockResolvedValue({ docs: [] })

    await loadDailyStats(
      firestore,
      'PC-000001',
      taipeiFourteenDayRange(new Date('2026-07-28T01:00:00.000Z')),
    )

    expect(collection).toHaveBeenCalledWith(firestore, 'devices', 'PC-000001', 'dailyStats')
    expect(where).toHaveBeenNthCalledWith(1, 'date', '>=', '2026-07-15')
    expect(where).toHaveBeenNthCalledWith(2, 'date', '<=', '2026-07-28')
    expect(orderBy).toHaveBeenCalledWith('date', 'asc')
  })
})

describe('daily count series', () => {
  it('fills absent days as synthetic zero-count points without exposing pending volume', () => {
    const series = buildDailyCountSeries(
      { startDate: '2026-07-15', endDate: '2026-07-28' },
      [
        { date: '2026-07-15', urinationCount: 1 },
        { date: '2026-07-17', urinationCount: 2 },
      ],
    )

    expect(series).toHaveLength(14)
    expect(series[0]).toEqual({ date: '2026-07-15', urinationCount: 1, synthetic: false })
    expect(series[1]).toEqual({ date: '2026-07-16', urinationCount: 0, synthetic: true })
    expect(series[2]).toEqual({ date: '2026-07-17', urinationCount: 2, synthetic: false })
    expect(series[0]).not.toHaveProperty('volume')
  })
})

const validDailyStats = {
  date: '2026-07-20',
  timeZone: 'Asia/Taipei',
  urinationCount: 2,
  volumeStatus: 'pending_calibration',
  estimatedUrineTotalMl: null,
  estimatedUrineAverageMl: null,
  estimatedUrineMinMl: null,
  estimatedUrineMaxMl: null,
  lastEventAtMs: 1_785_168_000_000,
  updatedAtMs: 1_785_168_060_000,
}

describe('daily stats model', () => {
  it('accepts only the complete persisted pending-calibration aggregate contract', () => {
    expect(parseDailyStatsDocument({ documentId: '2026-07-20', data: validDailyStats })).toEqual(validDailyStats)
  })

  it.each([
    ['document ID', '2026-07-21', {}],
    ['date', '2026-07-20', { date: '2026-07-21' }],
    ['Taipei timezone', '2026-07-20', { timeZone: 'UTC' }],
    ['nonnegative safe-integer count', '2026-07-20', { urinationCount: -1 }],
    ['safe count', '2026-07-20', { urinationCount: Number.MAX_SAFE_INTEGER + 1 }],
    ['pending status', '2026-07-20', { volumeStatus: 'estimated' }],
    ['null total volume', '2026-07-20', { estimatedUrineTotalMl: 0 }],
    ['null average volume', '2026-07-20', { estimatedUrineAverageMl: 0 }],
    ['null minimum volume', '2026-07-20', { estimatedUrineMinMl: 0 }],
    ['null maximum volume', '2026-07-20', { estimatedUrineMaxMl: 0 }],
    ['finite integer last-event metadata', '2026-07-20', { lastEventAtMs: Number.NaN }],
    ['integer update metadata', '2026-07-20', { updatedAtMs: 1.5 }],
  ] as const)('rejects invalid %s as a typed data-integrity error', (_label, documentId, override) => {
    expect(() => parseDailyStatsDocument({
      documentId,
      data: { ...validDailyStats, ...override },
    })).toThrow(DailyStatsDataIntegrityError)
  })

  it('fails corrupt daily data before gap filling can synthesize it as zero', async () => {
    getDocs.mockResolvedValue({
      docs: [{ id: '2026-07-20', data: () => ({ ...validDailyStats, timeZone: 'UTC' }) }],
    })

    await expect(loadDailyStats(
      firestore,
      'PC-000001',
      taipeiFourteenDayRange(new Date('2026-07-28T01:00:00.000Z')),
    )).rejects.toMatchObject({
      name: 'DailyStatsDataIntegrityError',
      code: 'invalid_time_zone',
      documentId: '2026-07-20',
    })
  })
})
