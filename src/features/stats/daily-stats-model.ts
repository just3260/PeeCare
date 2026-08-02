export const DAILY_STATS_TIME_ZONE = 'Asia/Taipei'

/**
 * A daily aggregate that is safe to use when constructing the count series.
 * `estimatedUrineTotalMl` is the summed calibrated volume ingestion writes for
 * that day; documents from the superseded pending-calibration shape carry a null
 * total and are therefore rejected rather than backfilled.
 */
export interface DailyStatsDocument {
  readonly date: string
  readonly timeZone: typeof DAILY_STATS_TIME_ZONE
  readonly urinationCount: number
  readonly estimatedUrineTotalMl: number
  readonly lastEventAtMs: number
  readonly updatedAtMs: number
}

export type DailyStatsDataIntegrityCode =
  | 'date_mismatch'
  | 'invalid_time_zone'
  | 'invalid_urination_count'
  | 'invalid_estimated_urine_total_ml'
  | 'invalid_last_event_at_ms'
  | 'invalid_updated_at_ms'

/** Raised when a persisted daily aggregate is unsafe to render. */
export class DailyStatsDataIntegrityError extends Error {
  readonly code: DailyStatsDataIntegrityCode
  readonly documentId: string

  constructor(code: DailyStatsDataIntegrityCode, documentId: string, message: string) {
    super(message)
    this.name = 'DailyStatsDataIntegrityError'
    this.code = code
    this.documentId = documentId
    Object.setPrototypeOf(this, DailyStatsDataIntegrityError.prototype)
  }
}

export interface ParseDailyStatsDocumentInput {
  readonly documentId: string
  readonly data: unknown
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Validates the full persisted daily aggregate contract before any missing days
 * can be represented as synthetic zero-count points.
 */
export function parseDailyStatsDocument(
  input: ParseDailyStatsDocumentInput,
): DailyStatsDocument {
  const record = (typeof input.data === 'object' && input.data !== null ? input.data : {}) as Record<string, unknown>
  const fail = (code: DailyStatsDataIntegrityCode, message: string): never => {
    throw new DailyStatsDataIntegrityError(code, input.documentId, message)
  }

  if (record.date !== input.documentId) {
    return fail('date_mismatch', `Daily stats document "${input.documentId}" declares a different date.`)
  }
  if (record.timeZone !== DAILY_STATS_TIME_ZONE) {
    return fail('invalid_time_zone', `Daily stats document "${input.documentId}" has an invalid time zone.`)
  }
  if (!isNonNegativeSafeInteger(record.urinationCount)) {
    return fail('invalid_urination_count', `Daily stats document "${input.documentId}" has an invalid count.`)
  }
  if (!isNonNegativeFinite(record.estimatedUrineTotalMl)) {
    return fail('invalid_estimated_urine_total_ml', `Daily stats document "${input.documentId}" has an invalid summed volume.`)
  }
  if (!isFiniteInteger(record.lastEventAtMs)) {
    return fail('invalid_last_event_at_ms', `Daily stats document "${input.documentId}" has invalid last-event metadata.`)
  }
  if (!isFiniteInteger(record.updatedAtMs)) {
    return fail('invalid_updated_at_ms', `Daily stats document "${input.documentId}" has invalid update metadata.`)
  }

  return Object.freeze({
    date: input.documentId,
    timeZone: DAILY_STATS_TIME_ZONE,
    urinationCount: record.urinationCount,
    estimatedUrineTotalMl: record.estimatedUrineTotalMl,
    lastEventAtMs: record.lastEventAtMs,
    updatedAtMs: record.updatedAtMs,
  })
}
