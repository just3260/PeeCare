const UINT32_MAX = 4_294_967_295;
const BATTERY_LEVEL_TIERS = new Set([0, 25, 50, 75, 100]);

export interface UrinationTestEventRequest {
  readonly eventType: 'urination';
  readonly flushDurationMs: number;
  readonly pumpDurationMs: number;
}

export interface BatteryTestEventRequest {
  readonly eventType: 'battery';
  readonly batteryLevelPercent: 0 | 25 | 50 | 75 | 100;
  readonly batteryVoltageMv?: number;
}

export type TestEventRequest = UrinationTestEventRequest | BatteryTestEventRequest;

export class InvalidTestEventRequestError extends Error {
  readonly code = 'invalid_request' as const;

  constructor() {
    super('The event request is invalid.');
    this.name = 'InvalidTestEventRequestError';
    Object.setPrototypeOf(this, InvalidTestEventRequestError.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && allowed.every((key) => keys.includes(key));
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= UINT32_MAX;
}

function fail(): never {
  throw new InvalidTestEventRequestError();
}

/** Return a fresh allowlisted projection so no caller-controlled field can cross the boundary. */
export function parseTestEventRequest(body: unknown): TestEventRequest {
  if (!isRecord(body)) return fail();

  if (body.eventType === 'urination') {
    if (
      !hasExactKeys(body, ['eventType', 'flushDurationMs', 'pumpDurationMs']) ||
      !isUint32(body.flushDurationMs) ||
      !isUint32(body.pumpDurationMs)
    ) {
      return fail();
    }
    return {
      eventType: 'urination',
      flushDurationMs: body.flushDurationMs,
      pumpDurationMs: body.pumpDurationMs,
    };
  }

  if (body.eventType === 'battery') {
    const keys = Object.keys(body);
    const hasVoltage = Object.prototype.hasOwnProperty.call(body, 'batteryVoltageMv');
    const exactKeys = hasVoltage
      ? hasExactKeys(body, ['eventType', 'batteryLevelPercent', 'batteryVoltageMv'])
      : hasExactKeys(body, ['eventType', 'batteryLevelPercent']);
    if (
      !exactKeys ||
      !BATTERY_LEVEL_TIERS.has(body.batteryLevelPercent as number) ||
      (hasVoltage &&
        (!Number.isInteger(body.batteryVoltageMv) ||
          (body.batteryVoltageMv as number) < 0 ||
          (body.batteryVoltageMv as number) > 20_000))
    ) {
      return fail();
    }
    return {
      eventType: 'battery',
      batteryLevelPercent: body.batteryLevelPercent as BatteryTestEventRequest['batteryLevelPercent'],
      ...(hasVoltage ? { batteryVoltageMv: body.batteryVoltageMv as number } : {}),
    };
  }

  return fail();
}
