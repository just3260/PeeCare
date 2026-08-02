import { describe, it, expect } from 'vitest';

import { buildTodayUrinationProjection } from '../src/aggregation/today-urination-projection.js';
import { DAILY_TIME_ZONE, type DailyUrinationRecord } from '../src/aggregation/daily-urination-record.js';

function dailyRecord(date: string, urinationCount: number, estimatedUrineTotalMl: number): DailyUrinationRecord {
  return {
    date,
    timeZone: DAILY_TIME_ZONE,
    urinationCount,
    estimatedUrineTotalMl,
    lastEventAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_100,
  };
}

describe('buildTodayUrinationProjection', () => {
  it('writes the projection when the device has no todayDate yet', () => {
    expect(buildTodayUrinationProjection(undefined, dailyRecord('2026-07-28', 3, 550))).toEqual({
      todayDate: '2026-07-28',
      todayUrinationCount: 3,
      todayEstimatedUrineTotalMl: 550,
    });
  });

  it('writes the projection when the event belongs to the already projected day', () => {
    expect(buildTodayUrinationProjection('2026-07-28', dailyRecord('2026-07-28', 3, 550))).toEqual({
      todayDate: '2026-07-28',
      todayUrinationCount: 3,
      todayEstimatedUrineTotalMl: 550,
    });
  });

  it('overwrites the projection when the event belongs to a later day', () => {
    expect(buildTodayUrinationProjection('2026-07-28', dailyRecord('2026-07-29', 1, 200))).toEqual({
      todayDate: '2026-07-29',
      todayUrinationCount: 1,
      todayEstimatedUrineTotalMl: 200,
    });
  });

  it('leaves the projection untouched when a late event belongs to an earlier day', () => {
    expect(buildTodayUrinationProjection('2026-07-28', dailyRecord('2026-07-27', 5, 900))).toEqual({});
  });

  it('treats a non-string existing todayDate as absent', () => {
    expect(buildTodayUrinationProjection(null, dailyRecord('2026-07-28', 2, 300))).toEqual({
      todayDate: '2026-07-28',
      todayUrinationCount: 2,
      todayEstimatedUrineTotalMl: 300,
    });
  });
});
