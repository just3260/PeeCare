import { createHash } from 'node:crypto';

import { APPROVED_PROJECT_ID } from '../config.js';

const UINT32_MAX = 4_294_967_295;
const EXHAUSTED_NEXT_SEQUENCE = UINT32_MAX + 1;
const DAILY_ATTEMPT_LIMIT = 500;
const MINIMUM_INTERVAL_MS = 1000;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const DEVICE_KEY_PATTERN = /^[a-f0-9]{64}$/;

export interface UsageDeviceState {
  readonly lastAcceptedAtMs: number;
  readonly nextSequence: number;
}

export interface UsageLedger {
  readonly schemaVersion: 1;
  readonly dayKey: string;
  readonly acceptedToday: number;
  readonly devices: Readonly<Record<string, UsageDeviceState>>;
}

export interface UsageReservation {
  readonly sequence: number;
  readonly ledger: UsageLedger;
}

export class RateLimitedError extends Error {
  readonly code = 'rate_limited' as const;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('The Test Tool request rate is limited.');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = Math.max(
      1,
      Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(retryAfterSeconds) || 1),
    );
    Object.setPrototypeOf(this, RateLimitedError.prototype);
  }
}

export class SequenceExhaustedError extends Error {
  readonly code = 'sequence_exhausted' as const;

  constructor() {
    super('The Test Tool sequence is exhausted.');
    this.name = 'SequenceExhaustedError';
    Object.setPrototypeOf(this, SequenceExhaustedError.prototype);
  }
}

export class UsageLedgerIntegrityError extends Error {
  readonly code = 'usage_ledger_integrity_error' as const;

  constructor() {
    super('The Test Tool usage ledger is invalid.');
    this.name = 'UsageLedgerIntegrityError';
    Object.setPrototypeOf(this, UsageLedgerIntegrityError.prototype);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function deriveUsageLedgerDocumentId(memberUid: string): string {
  return sha256(`${APPROVED_PROJECT_ID}:${memberUid}`);
}

function deriveDeviceKey(deviceId: string): string {
  return sha256(`device:${deviceId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isUtcDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseLedger(data: unknown): UsageLedger {
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ['schemaVersion', 'dayKey', 'acceptedToday', 'devices']) ||
    data.schemaVersion !== 1 ||
    !isUtcDayKey(data.dayKey) ||
    !isSafeIntegerInRange(data.acceptedToday, 0, DAILY_ATTEMPT_LIMIT) ||
    !isRecord(data.devices)
  ) {
    throw new UsageLedgerIntegrityError();
  }

  const devices: Record<string, UsageDeviceState> = {};
  for (const [key, rawState] of Object.entries(data.devices)) {
    if (
      !DEVICE_KEY_PATTERN.test(key) ||
      !isRecord(rawState) ||
      !hasExactKeys(rawState, ['lastAcceptedAtMs', 'nextSequence']) ||
      !isSafeIntegerInRange(rawState.lastAcceptedAtMs, 0, Number.MAX_SAFE_INTEGER) ||
      !isSafeIntegerInRange(rawState.nextSequence, 0, EXHAUSTED_NEXT_SEQUENCE)
    ) {
      throw new UsageLedgerIntegrityError();
    }
    devices[key] = {
      lastAcceptedAtMs: rawState.lastAcceptedAtMs,
      nextSequence: rawState.nextSequence,
    };
  }

  return {
    schemaVersion: 1,
    dayKey: data.dayKey,
    acceptedToday: data.acceptedToday,
    devices,
  };
}

function utcDayKey(nowMs: number): string {
  // Four-digit UTC years keep the persisted YYYY-MM-DD contract canonical.
  if (!isSafeIntegerInRange(nowMs, 0, 253_402_300_799_999)) {
    throw new UsageLedgerIntegrityError();
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

function retryUntilNextUtcDay(nowMs: number, dayKey: string): number {
  const nextDayMs = Date.parse(`${dayKey}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  return Math.ceil((nextDayMs - nowMs) / 1000);
}

export function reserveTestToolUsage({
  currentData,
  deviceId,
  nowMs,
}: {
  readonly currentData: unknown | undefined;
  readonly deviceId: string;
  readonly nowMs: number;
}): UsageReservation {
  const currentDayKey = utcDayKey(nowMs);
  const current = currentData === undefined
    ? { schemaVersion: 1 as const, dayKey: currentDayKey, acceptedToday: 0, devices: {} }
    : parseLedger(currentData);
  if (current.dayKey > currentDayKey) throw new UsageLedgerIntegrityError();
  const acceptedToday = current.dayKey === currentDayKey ? current.acceptedToday : 0;

  if (acceptedToday >= DAILY_ATTEMPT_LIMIT) {
    throw new RateLimitedError(retryUntilNextUtcDay(nowMs, currentDayKey));
  }

  const deviceKey = deriveDeviceKey(deviceId);
  const deviceState = current.devices[deviceKey];
  if (deviceState && nowMs - deviceState.lastAcceptedAtMs < MINIMUM_INTERVAL_MS) {
    throw new RateLimitedError(
      (deviceState.lastAcceptedAtMs + MINIMUM_INTERVAL_MS - nowMs) / 1000,
    );
  }

  const sequence = deviceState?.nextSequence ?? 0;
  if (sequence > UINT32_MAX) throw new SequenceExhaustedError();

  return {
    sequence,
    ledger: {
      schemaVersion: 1,
      dayKey: currentDayKey,
      acceptedToday: acceptedToday + 1,
      devices: {
        ...current.devices,
        [deviceKey]: {
          lastAcceptedAtMs: nowMs,
          nextSequence: sequence + 1,
        },
      },
    },
  };
}
