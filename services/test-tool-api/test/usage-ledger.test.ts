import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  RateLimitedError,
  SequenceExhaustedError,
  UsageLedgerIntegrityError,
  deriveUsageLedgerDocumentId,
  reserveTestToolUsage,
} from '../src/usage/usage-ledger.js';

const MEMBER_UID = 'raw-member-uid';
const DEVICE_ID = 'PC-DEV-000001';
const NOW_MS = Date.UTC(2026, 7, 11, 12, 0, 0);
const DAY_KEY = '2026-08-11';
const DEVICE_KEY = createHash('sha256').update(`device:${DEVICE_ID}`).digest('hex');

function ledger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    dayKey: DAY_KEY,
    acceptedToday: 1,
    devices: {
      [DEVICE_KEY]: { lastAcceptedAtMs: NOW_MS - 1000, nextSequence: 7 },
    },
    ...overrides,
  };
}

describe('transactional Test Tool usage ledger', () => {
  it('derives the exact SHA-256 project/UID ledger key without retaining raw identity', () => {
    const expected = createHash('sha256')
      .update(`petcare-c7483:${MEMBER_UID}`)
      .digest('hex');

    expect(deriveUsageLedgerDocumentId(MEMBER_UID)).toBe(expected);
    expect(deriveUsageLedgerDocumentId(MEMBER_UID)).toMatch(/^[a-f0-9]{64}$/);
    expect(deriveUsageLedgerDocumentId(MEMBER_UID)).not.toContain(MEMBER_UID);
  });

  it('initializes an absent ledger and reserves sequence zero', () => {
    expect(
      reserveTestToolUsage({ currentData: undefined, deviceId: DEVICE_ID, nowMs: NOW_MS }),
    ).toEqual({
      sequence: 0,
      ledger: {
        schemaVersion: 1,
        dayKey: DAY_KEY,
        acceptedToday: 1,
        devices: {
          [DEVICE_KEY]: { lastAcceptedAtMs: NOW_MS, nextSequence: 1 },
        },
      },
    });
  });

  it('rejects 999 ms since the prior reservation with bounded retry metadata', () => {
    expect(() =>
      reserveTestToolUsage({
        currentData: ledger({
          devices: {
            [DEVICE_KEY]: { lastAcceptedAtMs: NOW_MS - 999, nextSequence: 7 },
          },
        }),
        deviceId: DEVICE_ID,
        nowMs: NOW_MS,
      }),
    ).toThrow(new RateLimitedError(1));
  });

  it('accepts exactly 1000 ms after the prior reservation', () => {
    const reservation = reserveTestToolUsage({
      currentData: ledger(),
      deviceId: DEVICE_ID,
      nowMs: NOW_MS,
    });

    expect(reservation.sequence).toBe(7);
    expect(reservation.ledger).toMatchObject({ acceptedToday: 2 });
    expect(reservation.ledger.devices[DEVICE_KEY]).toEqual({
      lastAcceptedAtMs: NOW_MS,
      nextSequence: 8,
    });
  });

  it('accepts attempt 500 but rejects a 501st attempt until bounded UTC reset', () => {
    const attempt500 = reserveTestToolUsage({
      currentData: ledger({ acceptedToday: 499 }),
      deviceId: DEVICE_ID,
      nowMs: NOW_MS,
    });
    expect(attempt500.ledger.acceptedToday).toBe(500);

    expect(() =>
      reserveTestToolUsage({
        currentData: { ...attempt500.ledger, devices: {} },
        deviceId: 'PC-DEV-000002',
        nowMs: NOW_MS,
      }),
    ).toThrow(RateLimitedError);
    try {
      reserveTestToolUsage({
        currentData: { ...attempt500.ledger, devices: {} },
        deviceId: 'PC-DEV-000002',
        nowMs: NOW_MS,
      });
    } catch (error) {
      expect((error as RateLimitedError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect((error as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(86_400);
    }
  });

  it('resets the daily count on a new UTC day while preserving the next sequence', () => {
    const nextDay = NOW_MS + 12 * 60 * 60 * 1000;
    const reservation = reserveTestToolUsage({
      currentData: ledger({ acceptedToday: 500 }),
      deviceId: DEVICE_ID,
      nowMs: nextDay,
    });

    expect(reservation).toMatchObject({ sequence: 7, ledger: { dayKey: '2026-08-12', acceptedToday: 1 } });
    expect(reservation.ledger.devices[DEVICE_KEY]).toEqual({
      lastAcceptedAtMs: nextDay,
      nextSequence: 8,
    });
  });

  it('accepts uint32 max once and fails closed instead of wrapping it', () => {
    const maxReservation = reserveTestToolUsage({
      currentData: ledger({
        devices: {
          [DEVICE_KEY]: {
            lastAcceptedAtMs: NOW_MS - 1000,
            nextSequence: 4_294_967_295,
          },
        },
      }),
      deviceId: DEVICE_ID,
      nowMs: NOW_MS,
    });
    expect(maxReservation.sequence).toBe(4_294_967_295);
    expect(maxReservation.ledger.devices[DEVICE_KEY]?.nextSequence).toBe(4_294_967_296);

    expect(() =>
      reserveTestToolUsage({
        currentData: {
          ...maxReservation.ledger,
          devices: {
            [DEVICE_KEY]: {
              lastAcceptedAtMs: NOW_MS - 1000,
              nextSequence: 4_294_967_296,
            },
          },
        },
        deviceId: DEVICE_ID,
        nowMs: NOW_MS,
      }),
    ).toThrow(new SequenceExhaustedError());
  });

  it.each([
    ['primitive', 'bad'],
    ['wrong schema version', ledger({ schemaVersion: 2 })],
    ['negative accepted count', ledger({ acceptedToday: -1 })],
    ['oversized accepted count', ledger({ acceptedToday: 501 })],
    ['raw UID field', ledger({ uid: MEMBER_UID })],
    [
      'invalid device state',
      ledger({ devices: { [DEVICE_KEY]: { lastAcceptedAtMs: 'now', nextSequence: 7 } } }),
    ],
  ])('does not silently reset malformed ledger data: %s', (_case, currentData) => {
    expect(() =>
      reserveTestToolUsage({ currentData, deviceId: DEVICE_ID, nowMs: NOW_MS }),
    ).toThrow(new UsageLedgerIntegrityError());
  });

  it('fails closed when the persisted day is in the future', () => {
    expect(() =>
      reserveTestToolUsage({
        currentData: ledger({ dayKey: '2026-08-12', acceptedToday: 500, devices: {} }),
        deviceId: 'PC-DEV-000002',
        nowMs: NOW_MS,
      }),
    ).toThrow(new UsageLedgerIntegrityError());
  });

  it('persists no raw UID, device ID, body, or custom name in the ledger projection', () => {
    const result = reserveTestToolUsage({
      currentData: undefined,
      deviceId: DEVICE_ID,
      nowMs: NOW_MS,
    });
    const serialized = JSON.stringify(result.ledger);

    expect(serialized).not.toContain(MEMBER_UID);
    expect(serialized).not.toContain(DEVICE_ID);
    expect(serialized).not.toMatch(/customName|eventType|battery|urination|payload|body/);
  });
});
