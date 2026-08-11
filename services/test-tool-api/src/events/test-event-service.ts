import { randomUUID } from 'node:crypto';

import type {
  AuthorizedTestEventSubmission,
  TestEventSubmitter,
  TestToolClock,
} from '../devices/test-device-repository.js';
import type { TestEventRequest } from './test-event-request.js';

const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const UINT32_MAX = 4_294_967_295;

export interface CanonicalEmqxEnvelope {
  readonly topic: string;
  readonly clientId: string;
  readonly username: 'development-test-tool';
  readonly qos: 1;
  readonly retained: false;
  readonly brokerReceivedAtMs: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface IngestionEventClient {
  submit(envelope: CanonicalEmqxEnvelope): Promise<'stored' | 'duplicate'>;
}

export interface EventIdGenerator {
  randomUuid(): string;
}

const SYSTEM_CLOCK: TestToolClock = { nowMs: () => Date.now() };
const CRYPTOGRAPHIC_EVENT_IDS: EventIdGenerator = { randomUuid: () => randomUUID() };

export class CanonicalEventGenerationError extends Error {
  readonly code = 'canonical_event_generation_error' as const;

  constructor() {
    super('The canonical Test Tool event could not be generated.');
    this.name = 'CanonicalEventGenerationError';
    Object.setPrototypeOf(this, CanonicalEventGenerationError.prototype);
  }
}

function isSafeServerTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 253_402_300_799_999;
}

function measurementFields(body: TestEventRequest): Readonly<Record<string, number>> {
  if (body.eventType === 'urination') {
    return {
      flushDurationMs: body.flushDurationMs,
      pumpDurationMs: body.pumpDurationMs,
    };
  }
  return {
    batteryLevelPercent: body.batteryLevelPercent,
    ...(body.batteryVoltageMv === undefined
      ? {}
      : { batteryVoltageMv: body.batteryVoltageMv }),
  };
}

export class TestEventService implements TestEventSubmitter {
  constructor(
    private readonly ingestionClient: IngestionEventClient,
    private readonly clock: TestToolClock = SYSTEM_CLOCK,
    private readonly eventIds: EventIdGenerator = CRYPTOGRAPHIC_EVENT_IDS,
  ) {}

  async submit(submission: AuthorizedTestEventSubmission): Promise<{
    readonly status: 'stored' | 'duplicate';
    readonly eventId: string;
    readonly eventType: TestEventRequest['eventType'];
    readonly deviceId: string;
    readonly sequence: number;
  }> {
    const { device, sequence, body } = submission;
    const nowMs = this.clock.nowMs();
    const uuid = this.eventIds.randomUuid();
    if (
      !TOPIC_SEGMENT_PATTERN.test(device.deviceId) ||
      !TOPIC_SEGMENT_PATTERN.test(device.productModel) ||
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      sequence > UINT32_MAX ||
      !isSafeServerTime(nowMs) ||
      !UUID_V4_PATTERN.test(uuid)
    ) {
      throw new CanonicalEventGenerationError();
    }

    const eventId = `tt:${device.deviceId}:${uuid}`;
    const payload = Object.freeze({
      schemaVersion: 1,
      eventId,
      eventType: body.eventType,
      deviceId: device.deviceId,
      sequence,
      recordedAtMs: nowMs,
      firmwareVersion: '0.0.0-test-tool',
      ...measurementFields(body),
    });
    const eventSegment = body.eventType === 'urination'
      ? 'events/urination'
      : 'status/battery';
    const envelope: CanonicalEmqxEnvelope = Object.freeze({
      topic: `products/${device.productModel}/devices/${device.deviceId}/${eventSegment}`,
      clientId: device.deviceId,
      username: 'development-test-tool',
      qos: 1,
      retained: false,
      brokerReceivedAtMs: nowMs,
      payload,
    });

    const status = await this.ingestionClient.submit(envelope);
    return Object.freeze({
      status,
      eventId,
      eventType: body.eventType,
      deviceId: device.deviceId,
      sequence,
    });
  }
}
