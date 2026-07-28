import { describe, expect, it } from 'vitest';
import { toAsiaTaipeiDayKey } from '../src/aggregation/asia-taipei-day-key.js';
import {
  assertValidDailyDocument,
  buildDailyIncrement,
  buildInitialDailyRecord,
  type DailyUrinationRecord,
} from '../src/aggregation/daily-urination-record.js';
import { AggregationIntegrityError } from '../src/aggregation/aggregation-error.js';

// Asia/Taipei is a fixed UTC+8 offset with no daylight saving, so the local
// calendar date always equals the UTC date of the instant shifted by 8 hours.
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const taipeiDateFromOffset = (ms: number): string => new Date(ms + EIGHT_HOURS_MS).toISOString().slice(0, 10);

describe('Fixed Asia Taipei day key', () => {
  it.each([
    ['2026-07-27T15:59:59.999Z', '2026-07-27'],
    ['2026-07-27T16:00:00.000Z', '2026-07-28'],
  ])('resolves the midnight boundary for %s', (instant, expected) => {
    expect(toAsiaTaipeiDayKey(Date.parse(instant))).toBe(expected);
  });

  it('ignores host timezone by deriving the date from the fixed Asia/Taipei offset', () => {
    for (const instant of ['2026-01-01T00:00:00.000Z', '2026-07-27T15:59:59.999Z', '2026-07-27T16:00:00.000Z', '2026-12-31T16:00:00.000Z']) {
      const ms = Date.parse(instant);
      expect(toAsiaTaipeiDayKey(ms)).toBe(taipeiDateFromOffset(ms));
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, -0.5])(
    'rejects the illegal epoch %s as an invariant violation',
    (value) => {
      expect(() => toAsiaTaipeiDayKey(value)).toThrow(AggregationIntegrityError);
    },
  );
});

describe('Pending calibration daily record shape', () => {
  it('creates a first-event record with count 1 and four null volume fields', () => {
    expect(buildInitialDailyRecord('2026-07-28', 1785168000000, 1785168060000)).toEqual({
      date: '2026-07-28',
      timeZone: 'Asia/Taipei',
      urinationCount: 1,
      volumeStatus: 'pending_calibration',
      estimatedUrineTotalMl: null,
      estimatedUrineAverageMl: null,
      estimatedUrineMinMl: null,
      estimatedUrineMaxMl: null,
      lastEventAtMs: 1785168000000,
      updatedAtMs: 1785168060000,
    });
  });

  it('never derives a numeric volume from durations', () => {
    const record = buildInitialDailyRecord('2026-07-28', 1785168000000, 1785168060000);
    for (const field of ['estimatedUrineTotalMl', 'estimatedUrineAverageMl', 'estimatedUrineMinMl', 'estimatedUrineMaxMl'] as const) {
      expect(record[field]).toBeNull();
    }
    expect(record.volumeStatus).toBe('pending_calibration');
  });
});

describe('Monotonic daily metadata', () => {
  const base: DailyUrinationRecord = {
    date: '2026-07-28', timeZone: 'Asia/Taipei', urinationCount: 1, volumeStatus: 'pending_calibration',
    estimatedUrineTotalMl: null, estimatedUrineAverageMl: null, estimatedUrineMinMl: null, estimatedUrineMaxMl: null,
    lastEventAtMs: 1000, updatedAtMs: 2000,
  };

  it('advances both timestamps for an in-order event', () => {
    expect(buildDailyIncrement(base, 1500, 2500)).toMatchObject({ urinationCount: 2, lastEventAtMs: 1500, updatedAtMs: 2500 });
  });

  it('keeps lastEventAtMs for a late effective time but still increments the count', () => {
    expect(buildDailyIncrement(base, 900, 3000)).toMatchObject({ urinationCount: 2, lastEventAtMs: 1000, updatedAtMs: 3000 });
  });

  it('advances updatedAtMs to the later receive time while lastEventAtMs holds', () => {
    expect(buildDailyIncrement(base, 800, 2500)).toMatchObject({ lastEventAtMs: 1000, updatedAtMs: 2500 });
  });

  it('increments a count one below the maximum safe integer', () => {
    const record = buildDailyIncrement({ ...base, urinationCount: Number.MAX_SAFE_INTEGER - 1 }, 1500, 2500);
    expect(record.urinationCount).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects an increment that would overflow the safe integer range', () => {
    expect(() => buildDailyIncrement({ ...base, urinationCount: Number.MAX_SAFE_INTEGER }, 1500, 2500)).toThrow(AggregationIntegrityError);
  });
});

describe('Daily document integrity guard', () => {
  const valid: DailyUrinationRecord = {
    date: '2026-07-28', timeZone: 'Asia/Taipei', urinationCount: 3, volumeStatus: 'pending_calibration',
    estimatedUrineTotalMl: null, estimatedUrineAverageMl: null, estimatedUrineMinMl: null, estimatedUrineMaxMl: null,
    lastEventAtMs: 1000, updatedAtMs: 2000,
  };

  it('returns the validated record for a well-formed document', () => {
    expect(assertValidDailyDocument({ ...valid }, '2026-07-28')).toEqual(valid);
  });

  it.each([
    ['missing document', undefined],
    ['mismatched date', { ...valid, date: '2026-07-27' }],
    ['non-Taipei timezone', { ...valid, timeZone: 'UTC' }],
    ['negative count', { ...valid, urinationCount: -1 }],
    ['non-integer count', { ...valid, urinationCount: 2.5 }],
    ['count at the maximum safe integer', { ...valid, urinationCount: Number.MAX_SAFE_INTEGER }],
    ['non-numeric count', { ...valid, urinationCount: '3' }],
    ['wrong volume status', { ...valid, volumeStatus: 'calibrated' }],
    ['non-null total', { ...valid, estimatedUrineTotalMl: 0 }],
    ['non-null average', { ...valid, estimatedUrineAverageMl: 0 }],
    ['non-null min', { ...valid, estimatedUrineMinMl: 0 }],
    ['non-null max', { ...valid, estimatedUrineMaxMl: 0 }],
  ])('reports aggregation_integrity_error for %s', (_label, doc) => {
    expect(() => assertValidDailyDocument(doc, '2026-07-28')).toThrow(AggregationIntegrityError);
  });
});
