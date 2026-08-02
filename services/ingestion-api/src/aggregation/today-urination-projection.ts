import type { DailyUrinationRecord } from './daily-urination-record.js';

/**
 * The three registry fields mirroring the current day's aggregate. They are
 * written together or not at all, so readers can treat them as one tuple.
 */
export interface TodayUrinationProjection {
  todayDate: string;
  todayUrinationCount: number;
  todayEstimatedUrineTotalMl: number;
}

/**
 * Decides the today projection to merge into the `devices/{deviceId}` update
 * for a stored urination event. Values are taken verbatim from the daily record
 * written in the same transaction, so the projection never drifts from the
 * authoritative `dailyStats` document.
 *
 * A late event must not roll the projection back to an earlier day: the record
 * only wins when its day key is not earlier than the projected one. `yyyy-MM-dd`
 * is fixed width with Latin digits, so lexicographic order is chronological
 * order and no date parsing is needed. An existing value that is not a string
 * carries no usable day, so it is treated as absent and gets overwritten.
 *
 * Returns an empty object when the projection must stay untouched. Pure: it
 * never touches Firestore.
 */
export function buildTodayUrinationProjection(
  existingTodayDate: unknown,
  record: DailyUrinationRecord,
): TodayUrinationProjection | Record<string, never> {
  if (typeof existingTodayDate === 'string' && record.date < existingTodayDate) {
    return {};
  }
  return {
    todayDate: record.date,
    todayUrinationCount: record.urinationCount,
    todayEstimatedUrineTotalMl: record.estimatedUrineTotalMl,
  };
}
