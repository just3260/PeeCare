/** An immutable, validated urination event safe to expose to history UI code. */
export interface UrinationHistoryRecord {
  readonly eventId: string
  readonly eventType: 'urination'
  readonly deviceId: string
  readonly sequence: number
  readonly effectiveAtMs: number
  readonly flushDurationMs: number
  readonly pumpDurationMs: number
  readonly estimatedUrineMl: null
  readonly estimationStatus: 'pending_calibration'
}

export type UrinationHistoryDataIntegrityCode =
  | 'event_id_mismatch'
  | 'device_id_mismatch'
  | 'invalid_event_type'
  | 'invalid_sequence'
  | 'invalid_effective_at_ms'
  | 'invalid_flush_duration_ms'
  | 'invalid_pump_duration_ms'
  | 'invalid_volume_contract'

/** Raised when an immutable event document cannot safely be rendered as history. */
export class UrinationHistoryDataIntegrityError extends Error {
  readonly code: UrinationHistoryDataIntegrityCode
  readonly documentId: string

  constructor(code: UrinationHistoryDataIntegrityCode, documentId: string, message: string) {
    super(message)
    this.name = 'UrinationHistoryDataIntegrityError'
    this.code = code
    this.documentId = documentId
    Object.setPrototypeOf(this, UrinationHistoryDataIntegrityError.prototype)
  }
}

export interface ParseUrinationHistoryRecordInput {
  readonly documentId: string
  readonly selectedDeviceId: string
  readonly data: unknown
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
}

/**
 * Validate the persisted immutable-event contract at the Firestore boundary.
 * A malformed document is never partially rendered or silently ignored.
 */
export function parseUrinationHistoryRecord(
  input: ParseUrinationHistoryRecordInput,
): UrinationHistoryRecord {
  const record = (typeof input.data === 'object' && input.data !== null ? input.data : {}) as Record<
    string,
    unknown
  >
  const fail = (code: UrinationHistoryDataIntegrityCode, message: string): never => {
    throw new UrinationHistoryDataIntegrityError(code, input.documentId, message)
  }

  if (record.eventId !== input.documentId) {
    return fail('event_id_mismatch', `Event document "${input.documentId}" declares a different eventId.`)
  }
  if (record.deviceId !== input.selectedDeviceId) {
    return fail('device_id_mismatch', `Event "${input.documentId}" does not belong to the selected device.`)
  }
  if (record.eventType !== 'urination') {
    return fail('invalid_event_type', `Event "${input.documentId}" is not a urination event.`)
  }
  if (!isNonNegativeInteger(record.sequence)) {
    return fail('invalid_sequence', `Event "${input.documentId}" has an invalid sequence.`)
  }
  if (!isNonNegativeInteger(record.effectiveAtMs)) {
    return fail('invalid_effective_at_ms', `Event "${input.documentId}" has an invalid effective time.`)
  }
  if (!isNonNegativeInteger(record.flushDurationMs)) {
    return fail('invalid_flush_duration_ms', `Event "${input.documentId}" has an invalid flush duration.`)
  }
  if (!isNonNegativeInteger(record.pumpDurationMs)) {
    return fail('invalid_pump_duration_ms', `Event "${input.documentId}" has an invalid pump duration.`)
  }
  if (record.estimatedUrineMl !== null || record.estimationStatus !== 'pending_calibration') {
    return fail('invalid_volume_contract', `Event "${input.documentId}" violates the pending-calibration volume contract.`)
  }

  return Object.freeze({
    eventId: input.documentId,
    eventType: 'urination',
    deviceId: input.selectedDeviceId,
    sequence: record.sequence,
    effectiveAtMs: record.effectiveAtMs,
    flushDurationMs: record.flushDurationMs,
    pumpDurationMs: record.pumpDurationMs,
    estimatedUrineMl: null,
    estimationStatus: 'pending_calibration',
  })
}
