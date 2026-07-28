import { AggregationIntegrityError } from './aggregation-error.js';

export const DAILY_TIME_ZONE = 'Asia/Taipei';
export const DAILY_VOLUME_STATUS = 'pending_calibration';

const VOLUME_FIELDS = ['estimatedUrineTotalMl', 'estimatedUrineAverageMl', 'estimatedUrineMinMl', 'estimatedUrineMaxMl'] as const;

/**
 * Stable daily aggregate shape. Volume fields stay null until a calibration
 * formula exists, so readers can distinguish "not yet calibrated" from zero.
 */
export interface DailyUrinationRecord {
  date: string;
  timeZone: typeof DAILY_TIME_ZONE;
  urinationCount: number;
  volumeStatus: typeof DAILY_VOLUME_STATUS;
  estimatedUrineTotalMl: null;
  estimatedUrineAverageMl: null;
  estimatedUrineMinMl: null;
  estimatedUrineMaxMl: null;
  lastEventAtMs: number;
  updatedAtMs: number;
}

/** Builds the first daily document for a day, starting the count at 1. */
export function buildInitialDailyRecord(dayKey: string, effectiveAtMs: number, receivedAtMs: number): DailyUrinationRecord {
  return {
    date: dayKey,
    timeZone: DAILY_TIME_ZONE,
    urinationCount: 1,
    volumeStatus: DAILY_VOLUME_STATUS,
    estimatedUrineTotalMl: null,
    estimatedUrineAverageMl: null,
    estimatedUrineMinMl: null,
    estimatedUrineMaxMl: null,
    lastEventAtMs: effectiveAtMs,
    updatedAtMs: receivedAtMs,
  };
}

/**
 * Increments an existing valid record: count + 1, with `lastEventAtMs` and
 * `updatedAtMs` taken as the max of the current value and the new event so
 * out-of-order processing never rolls metadata backwards.
 */
export function buildDailyIncrement(existing: DailyUrinationRecord, effectiveAtMs: number, receivedAtMs: number): DailyUrinationRecord {
  const nextCount = existing.urinationCount + 1;
  if (!Number.isSafeInteger(nextCount)) {
    throw new AggregationIntegrityError('daily urinationCount increment overflows the safe integer range');
  }
  return {
    ...existing,
    urinationCount: nextCount,
    lastEventAtMs: Math.max(existing.lastEventAtMs, effectiveAtMs),
    updatedAtMs: Math.max(existing.updatedAtMs, receivedAtMs),
  };
}

/**
 * Fail-closed guard for an existing daily document before it is incremented.
 * Any deviation from the schema aborts with an integrity error rather than
 * silently repairing unknown data.
 */
export function assertValidDailyDocument(data: unknown, dayKey: string): DailyUrinationRecord {
  if (!data || typeof data !== 'object') {
    throw new AggregationIntegrityError('daily document is missing or not an object');
  }
  const doc = data as Record<string, unknown>;
  if (doc.date !== dayKey) {
    throw new AggregationIntegrityError('daily document date does not match its day key');
  }
  if (doc.timeZone !== DAILY_TIME_ZONE) {
    throw new AggregationIntegrityError('daily document timezone is not Asia/Taipei');
  }
  const count = doc.urinationCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) {
    throw new AggregationIntegrityError('daily document urinationCount is not a safe non-negative integer below the maximum');
  }
  if (doc.volumeStatus !== DAILY_VOLUME_STATUS) {
    throw new AggregationIntegrityError('daily document volumeStatus is not pending_calibration');
  }
  for (const field of VOLUME_FIELDS) {
    if (doc[field] !== null) {
      throw new AggregationIntegrityError(`daily document ${field} is not null`);
    }
  }
  return doc as unknown as DailyUrinationRecord;
}
