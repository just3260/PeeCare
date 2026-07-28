import { describe, expect, it } from 'vitest'

import {
  UrinationHistoryDataIntegrityError,
  parseUrinationHistoryRecord,
} from './urination-history-model'

const validRecord = {
  eventId: 'evt-000001',
  eventType: 'urination',
  deviceId: 'PC-000001',
  sequence: 42,
  effectiveAtMs: 1_785_168_000_000,
  flushDurationMs: 3_000,
  pumpDurationMs: 5_000,
  estimatedUrineMl: null,
  estimationStatus: 'pending_calibration',
}

describe('parseUrinationHistoryRecord', () => {
  it('creates an immutable record only from the persisted pending-calibration contract', () => {
    const record = parseUrinationHistoryRecord({
      documentId: 'evt-000001',
      selectedDeviceId: 'PC-000001',
      data: validRecord,
    })

    expect(record).toEqual(validRecord)
    expect(Object.isFrozen(record)).toBe(true)
  })

  it('rejects a cross-device document as a typed data-integrity error', () => {
    expect(() =>
      parseUrinationHistoryRecord({
        documentId: 'evt-000001',
        selectedDeviceId: 'PC-000001',
        data: { ...validRecord, deviceId: 'PC-000002' },
      }),
    ).toThrow(UrinationHistoryDataIntegrityError)

    try {
      parseUrinationHistoryRecord({
        documentId: 'evt-000001',
        selectedDeviceId: 'PC-000001',
        data: { ...validRecord, deviceId: 'PC-000002' },
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'device_id_mismatch', documentId: 'evt-000001' })
    }
  })

  it.each([
    ['event_id_mismatch', { eventId: 'different' }],
    ['invalid_event_type', { eventType: 'battery' }],
    ['invalid_sequence', { sequence: -1 }],
    ['invalid_effective_at_ms', { effectiveAtMs: 1.5 }],
    ['invalid_effective_at_ms', { effectiveAtMs: 8_640_000_000_000_001 }],
    ['invalid_flush_duration_ms', { flushDurationMs: -1 }],
    ['invalid_pump_duration_ms', { pumpDurationMs: Number.NaN }],
    ['invalid_volume_contract', { estimatedUrineMl: 12 }],
    ['invalid_volume_contract', { estimationStatus: 'estimated' }],
  ] as const)('rejects a document with %s', (code, override) => {
    expect(() =>
      parseUrinationHistoryRecord({
        documentId: 'evt-000001',
        selectedDeviceId: 'PC-000001',
        data: { ...validRecord, ...override },
      }),
    ).toThrow(expect.objectContaining({ code }))
  })
})
