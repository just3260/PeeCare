import { describe, it, expect } from 'vitest';

import {
  buildInitialDailyRecord,
  buildDailyIncrement,
  assertValidDailyDocument,
  DAILY_TIME_ZONE,
} from '../src/aggregation/daily-urination-record.js';

describe('buildInitialDailyRecord', () => {
  it('starts a new day at count 1 seeded with the event volume', () => {
    const record = buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, 120);
    expect(record).toEqual({
      date: '2026-07-28',
      timeZone: DAILY_TIME_ZONE,
      urinationCount: 1,
      estimatedUrineTotalMl: 120,
      lastEventAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_000_100,
    });
  });

  it('rejects a negative event volume', () => {
    expect(() => buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, -1)).toThrow();
  });
});

describe('buildDailyIncrement', () => {
  it('increments count, sums volume, and advances metadata forward only', () => {
    const base = buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, 120);
    const next = buildDailyIncrement(base, 1_700_000_050_000, 1_700_000_050_500, 80);
    expect(next.urinationCount).toBe(2);
    expect(next.estimatedUrineTotalMl).toBe(200);
    expect(next.lastEventAtMs).toBe(1_700_000_050_000);
    expect(next.updatedAtMs).toBe(1_700_000_050_500);
  });

  it('sums volume but does not roll metadata backward for out-of-order events', () => {
    const base = buildInitialDailyRecord('2026-07-28', 1_700_000_050_000, 1_700_000_050_500, 120);
    const next = buildDailyIncrement(base, 1_700_000_000_000, 1_700_000_000_100, 80);
    expect(next.urinationCount).toBe(2);
    expect(next.estimatedUrineTotalMl).toBe(200);
    expect(next.lastEventAtMs).toBe(1_700_000_050_000);
    expect(next.updatedAtMs).toBe(1_700_000_050_500);
  });
});

describe('assertValidDailyDocument', () => {
  it('accepts a well-formed record', () => {
    const record = buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, 120);
    expect(assertValidDailyDocument(record, '2026-07-28')).toEqual(record);
  });

  it('rejects a document whose day key differs', () => {
    const record = buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, 120);
    expect(() => assertValidDailyDocument(record, '2026-07-29')).toThrow();
  });

  it('rejects a non-object document', () => {
    expect(() => assertValidDailyDocument(null, '2026-07-28')).toThrow();
  });

  it('rejects a document with a fractional count', () => {
    const bad = { ...buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, 120), urinationCount: 1.5 };
    expect(() => assertValidDailyDocument(bad, '2026-07-28')).toThrow();
  });

  it('rejects a document with a negative total volume', () => {
    const bad = { ...buildInitialDailyRecord('2026-07-28', 1_700_000_000_000, 1_700_000_000_100, 120), estimatedUrineTotalMl: -5 };
    expect(() => assertValidDailyDocument(bad, '2026-07-28')).toThrow();
  });
});
