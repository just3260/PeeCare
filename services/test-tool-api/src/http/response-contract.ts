import type { TestDeviceSummary } from '../app.js';
import type { TestEventRequest } from '../events/test-event-request.js';

const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FORBIDDEN_DISPLAY_NAME_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const UINT32_MAX = 4_294_967_295;

export class ResponseContractError extends Error {
  readonly code = 'response_contract_error' as const;

  constructor() {
    super('An internal response did not match the public contract.');
    this.name = 'ResponseContractError';
    Object.setPrototypeOf(this, ResponseContractError.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalCustomName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    Array.from(value).length <= 30 &&
    !FORBIDDEN_DISPLAY_NAME_CHARACTERS.test(value)
  );
}

export function projectDeviceList(value: unknown): readonly TestDeviceSummary[] {
  if (!Array.isArray(value)) throw new ResponseContractError();
  return value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.deviceId !== 'string' ||
      !TOPIC_SEGMENT_PATTERN.test(candidate.deviceId) ||
      (candidate.displayName !== candidate.deviceId &&
        !isCanonicalCustomName(candidate.displayName))
    ) {
      throw new ResponseContractError();
    }
    return Object.freeze({
      deviceId: candidate.deviceId,
      displayName: candidate.displayName,
    });
  });
}

export interface PublicTestEventResult {
  readonly status: 'stored' | 'duplicate';
  readonly eventId: string;
  readonly eventType: TestEventRequest['eventType'];
  readonly deviceId: string;
  readonly sequence: number;
}

export function projectTestEventResult(
  value: unknown,
  expected: { readonly deviceId: string; readonly eventType: TestEventRequest['eventType'] },
): PublicTestEventResult {
  if (!isRecord(value)) throw new ResponseContractError();
  const eventIdPrefix = `tt:${expected.deviceId}:`;
  const uuid = typeof value.eventId === 'string'
    ? value.eventId.slice(eventIdPrefix.length)
    : '';
  if (
    (value.status !== 'stored' && value.status !== 'duplicate') ||
    value.deviceId !== expected.deviceId ||
    value.eventType !== expected.eventType ||
    typeof value.eventId !== 'string' ||
    !value.eventId.startsWith(eventIdPrefix) ||
    !UUID_V4_PATTERN.test(uuid) ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.sequence as number) > UINT32_MAX
  ) {
    throw new ResponseContractError();
  }

  return Object.freeze({
    status: value.status,
    eventId: value.eventId,
    eventType: expected.eventType,
    deviceId: expected.deviceId,
    sequence: value.sequence as number,
  });
}
