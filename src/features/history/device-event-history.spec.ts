import { beforeEach, describe, expect, it, vi } from 'vitest'

const collection = vi.fn()
const getDocs = vi.fn()
const limit = vi.fn()
const orderBy = vi.fn()
const query = vi.fn()
const startAfter = vi.fn()
const where = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collection(...args),
  getDocs: (...args: unknown[]) => getDocs(...args),
  limit: (...args: unknown[]) => limit(...args),
  orderBy: (...args: unknown[]) => orderBy(...args),
  query: (...args: unknown[]) => query(...args),
  startAfter: (...args: unknown[]) => startAfter(...args),
  where: (...args: unknown[]) => where(...args),
}))

import { loadUrinationPage } from './device-event-history-repository'

const firestore = { __firestore: true } as never

function eventDocument(eventId: string, effectiveAtMs: number) {
  return {
    id: eventId,
    data: () => ({
      eventId,
      eventType: 'urination',
      deviceId: 'PC-000001',
      sequence: 1,
      effectiveAtMs,
      flushDurationMs: 3_000,
      pumpDurationMs: 5_000,
      estimatedUrineMl: 200,
      estimationStatus: 'estimated',
    }),
  }
}

beforeEach(() => {
  collection.mockReset()
  getDocs.mockReset()
  limit.mockReset()
  orderBy.mockReset()
  query.mockReset()
  startAfter.mockReset()
  where.mockReset()
  collection.mockImplementation((_db, ...path: string[]) => ({ __collection: path.join('/') }))
  where.mockImplementation((field, operator, value) => ({ __where: [field, operator, value] }))
  orderBy.mockImplementation((field, direction) => ({ __orderBy: [field, direction] }))
  limit.mockImplementation((count) => ({ __limit: count }))
  query.mockImplementation((reference, ...constraints) => ({ reference, constraints }))
})

describe('loadUrinationPage', () => {
  it('queries only 25 urination events in stable newest-first order', async () => {
    getDocs.mockResolvedValue({
      docs: [eventDocument('event-B', 1_700_000_000_000), eventDocument('event-A', 1_700_000_000_000)],
    })

    const page = await loadUrinationPage(firestore, 'PC-000001')

    expect(collection).toHaveBeenCalledWith(firestore, 'devices', 'PC-000001', 'events')
    expect(where).toHaveBeenCalledWith('eventType', '==', 'urination')
    expect(orderBy).toHaveBeenNthCalledWith(1, 'effectiveAtMs', 'desc')
    expect(orderBy).toHaveBeenNthCalledWith(2, 'eventId', 'desc')
    expect(limit).toHaveBeenCalledWith(25)
    expect(page.items.map((item) => item.eventId)).toEqual(['event-B', 'event-A'])
    expect(page.items.map((item) => item.effectiveAtMs)).toEqual([
      1_700_000_000_000,
      1_700_000_000_000,
    ])
  })

  it('skips an unrenderable legacy document instead of failing the whole page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const legacy = {
      id: 'event-legacy',
      data: () => ({
        eventId: 'event-legacy', eventType: 'urination', deviceId: 'PC-000001', sequence: 1,
        effectiveAtMs: 1_700_000_000_000, flushDurationMs: 3_000, pumpDurationMs: 5_000,
        estimatedUrineMl: null, estimationStatus: 'pending_calibration',
      }),
    }
    getDocs.mockResolvedValue({ docs: [eventDocument('event-B', 1_700_000_000_000), legacy] })

    const page = await loadUrinationPage(firestore, 'PC-000001')

    expect(page.items.map((item) => item.eventId)).toEqual(['event-B'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event-legacy'), expect.anything())
    warn.mockRestore()
  })

  it('continues a 30-record history from the final document without duplicates', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) =>
      eventDocument(`event-${30 - index}`, 1_700_000_000_000 - index),
    )
    const secondPage = Array.from({ length: 5 }, (_, index) =>
      eventDocument(`event-${5 - index}`, 1_699_999_999_975 - index),
    )
    startAfter.mockImplementation((document) => ({ __startAfter: document }))
    getDocs.mockResolvedValueOnce({ docs: firstPage }).mockResolvedValueOnce({ docs: secondPage })

    const initial = await loadUrinationPage(firestore, 'PC-000001')
    const continuation = await loadUrinationPage(firestore, 'PC-000001', initial.cursor)

    expect(initial.items).toHaveLength(25)
    expect(initial.hasMore).toBe(true)
    expect(continuation.items).toHaveLength(5)
    expect(continuation.hasMore).toBe(false)
    expect(startAfter).toHaveBeenCalledWith(firstPage.at(-1))
    expect(continuation.items.map((item) => item.eventId)).not.toContain(firstPage.at(-1)?.id)
  })
})
