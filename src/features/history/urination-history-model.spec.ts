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
  estimatedUrineMl: 200,
  estimationStatus: 'estimated',
}

describe('parseUrinationHistoryRecord', () => {
  it('creates an immutable record from the persisted estimated-volume contract', () => {
    const record = parseUrinationHistoryRecord({
      documentId: 'evt-000001',
      selectedDeviceId: 'PC-000001',
      data: validRecord,
    })

    expect(record).toEqual(validRecord)
    expect(Object.isFrozen(record)).toBe(true)
  })

  it.each([
    ['no_flow', 0],
    ['out_of_range', 3_000],
  ] as const)('accepts the %s status with its coherent volume', (estimationStatus, estimatedUrineMl) => {
    const record = parseUrinationHistoryRecord({
      documentId: 'evt-000001',
      selectedDeviceId: 'PC-000001',
      data: { ...validRecord, estimationStatus, estimatedUrineMl },
    })

    expect(record).toMatchObject({ estimationStatus, estimatedUrineMl })
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
    ['invalid_estimated_urine_ml', { estimatedUrineMl: null }],
    ['invalid_estimated_urine_ml', { estimatedUrineMl: -1 }],
    ['invalid_estimated_urine_ml', { estimatedUrineMl: 1.5 }],
    ['invalid_volume_status', { estimationStatus: 'pending_calibration' }],
    ['invalid_volume_contract', { estimationStatus: 'no_flow', estimatedUrineMl: 200 }],
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
