import { AggregationIntegrityError } from './aggregation-error.js';

export const DAILY_TIME_ZONE = 'Asia/Taipei';

/**
 * Stable daily aggregate shape. Holds the two figures the home overview needs:
 * the urination count for the Asia/Taipei day and the summed calibrated urine
 * volume (`estimatedUrineTotalMl`, in millilitres). Metadata timestamps only
 * ever move forward so out-of-order processing never rolls them back.
 */
export interface DailyUrinationRecord {
  date: string;
  timeZone: typeof DAILY_TIME_ZONE;
  urinationCount: number;
  estimatedUrineTotalMl: number;
  lastEventAtMs: number;
  updatedAtMs: number;
}

/** A single event's contributed volume must be a non-negative finite number. */
function assertVolume(estimatedUrineMl: number): void {
  if (typeof estimatedUrineMl !== 'number' || !Number.isFinite(estimatedUrineMl) || estimatedUrineMl < 0) {
    throw new AggregationIntegrityError('estimatedUrineMl must be a non-negative finite number');
  }
}

/** Builds the first daily document for a day, starting the count at 1. */
export function buildInitialDailyRecord(
  dayKey: string,
  effectiveAtMs: number,
  receivedAtMs: number,
  estimatedUrineMl: number,
): DailyUrinationRecord {
  assertVolume(estimatedUrineMl);
  return {
    date: dayKey,
    timeZone: DAILY_TIME_ZONE,
    urinationCount: 1,
    estimatedUrineTotalMl: estimatedUrineMl,
    lastEventAtMs: effectiveAtMs,
    updatedAtMs: receivedAtMs,
  };
}

/**
 * Increments an existing valid record: count + 1 and the event's volume added
 * to the running total, with `lastEventAtMs` and `updatedAtMs` taken as the max
 * of the current value and the new event so out-of-order processing never rolls
 * metadata backwards.
 */
export function buildDailyIncrement(
  existing: DailyUrinationRecord,
  effectiveAtMs: number,
  receivedAtMs: number,
  estimatedUrineMl: number,
): DailyUrinationRecord {
  assertVolume(estimatedUrineMl);
  const nextCount = existing.urinationCount + 1;
  if (!Number.isSafeInteger(nextCount)) {
    throw new AggregationIntegrityError('daily urinationCount increment overflows the safe integer range');
  }
  const nextTotal = existing.estimatedUrineTotalMl + estimatedUrineMl;
  if (!Number.isFinite(nextTotal)) {
    throw new AggregationIntegrityError('daily estimatedUrineTotalMl increment is not finite');
  }
  return {
    ...existing,
    urinationCount: nextCount,
    estimatedUrineTotalMl: nextTotal,
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
  const total = doc.estimatedUrineTotalMl;
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    throw new AggregationIntegrityError('daily document estimatedUrineTotalMl is not a non-negative finite number');
  }
  return doc as unknown as DailyUrinationRecord;
}
