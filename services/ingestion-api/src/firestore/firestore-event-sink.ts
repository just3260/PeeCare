import { FieldValue, type DocumentReference, type Firestore } from '@google-cloud/firestore';
import type { ValidatedDeviceEvent } from '../domain/validated-device-event.js';
import { canonicalEventHash } from '../persistence/canonical-event-hash.js';
import { buildUrinationEventRecord } from '../persistence/urination-event-record.js';
import { buildBatteryEventRecord } from '../persistence/battery-event-record.js';
import { toAsiaTaipeiDayKey } from '../aggregation/asia-taipei-day-key.js';
import {
  assertValidDailyDocument,
  buildDailyIncrement,
  buildInitialDailyRecord,
  type DailyUrinationRecord,
} from '../aggregation/daily-urination-record.js';
import { AggregationIntegrityError } from '../aggregation/aggregation-error.js';
import type { EventSink, SinkOutcome } from '../sinks/event-sink.js';

type DeviceRegistry = {
  deviceId?: unknown; productModel?: unknown; ingestionStatus?: unknown;
  latestUrinationAtMs?: unknown; latestUrinationReceivedAtMs?: unknown; latestUrinationEventId?: unknown;
  latestBatteryAtMs?: unknown; latestBatteryReceivedAtMs?: unknown; latestBatteryEventId?: unknown;
  lastReportedAtMs?: unknown;
};
type EventPayload = { eventId?: unknown; firmwareVersion?: unknown; batteryLevelPercent?: unknown; batteryVoltageMv?: unknown };

function compareTuple(left: [number, number, string], right: [number, number, string]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
}

function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === 4 || code === 10 || code === 14 || code === 'deadline-exceeded' || code === 'unavailable';
}

function eventIdFor(event: ValidatedDeviceEvent): string {
  const eventId = (event.payload as EventPayload).eventId;
  if (typeof eventId !== 'string') throw new Error('event id violates validated event invariant');
  return eventId;
}

function buildEventRecord(event: ValidatedDeviceEvent, canonicalHash: string): Record<string, unknown> {
  switch (event.eventType) {
    case 'urination': return buildUrinationEventRecord(event, canonicalHash);
    case 'battery': return buildBatteryEventRecord(event, canonicalHash);
  }
}

function latestTuple(device: DeviceRegistry, prefix: 'Urination' | 'Battery'): [number, number, string] | undefined {
  const at = device[`latest${prefix}AtMs`];
  const received = device[`latest${prefix}ReceivedAtMs`];
  const eventId = device[`latest${prefix}EventId`];
  return typeof at === 'number' && typeof received === 'number' && typeof eventId === 'string' ? [at, received, eventId] : undefined;
}

function batteryProjection(event: ValidatedDeviceEvent, device: DeviceRegistry, eventId: string): Record<string, string | number | FieldValue> {
  const payload = event.payload as EventPayload;
  if (![0, 25, 50, 75, 100].includes(payload.batteryLevelPercent as number) || (payload.batteryVoltageMv !== undefined && (!Number.isInteger(payload.batteryVoltageMv) || typeof payload.batteryVoltageMv !== 'number'))) {
    throw new Error('battery payload violates validated event invariant');
  }
  const projection: Record<string, string | number | FieldValue> = { lastReportedAtMs: Math.max(typeof device.lastReportedAtMs === 'number' ? device.lastReportedAtMs : 0, event.receivedAtMs) };
  const nextTuple: [number, number, string] = [event.effectiveAtMs, event.receivedAtMs, eventId];
  const currentTuple = latestTuple(device, 'Battery');
  if (!currentTuple || compareTuple(nextTuple, currentTuple) > 0) Object.assign(projection, {
    latestBatteryEventId: eventId, latestBatteryLevelPercent: payload.batteryLevelPercent,
    latestBatteryAtMs: event.effectiveAtMs, latestBatteryReceivedAtMs: event.receivedAtMs,
    latestBatteryFirmwareVersion: payload.firmwareVersion,
    latestBatteryVoltageMv: typeof payload.batteryVoltageMv === 'number' ? payload.batteryVoltageMv : FieldValue.delete(),
  });
  return projection;
}

function urinationProjection(event: ValidatedDeviceEvent, device: DeviceRegistry, eventId: string): Record<string, string | number | FieldValue> {
  const payload = event.payload as EventPayload;
  const currentTuple = latestTuple(device, 'Urination');
  const nextTuple: [number, number, string] = [event.effectiveAtMs, event.receivedAtMs, eventId];
  const projection: Record<string, string | number | FieldValue> = { lastReportedAtMs: Math.max(typeof device.lastReportedAtMs === 'number' ? device.lastReportedAtMs : 0, event.receivedAtMs) };
  if (!currentTuple || compareTuple(nextTuple, currentTuple) > 0) Object.assign(projection, {
    latestUrinationEventId: eventId, latestUrinationAtMs: event.effectiveAtMs,
    latestUrinationReceivedAtMs: event.receivedAtMs, ...(typeof payload.firmwareVersion === 'string' ? { latestUrinationFirmwareVersion: payload.firmwareVersion } : {}),
  });
  return projection;
}

export class FirestoreEventSink implements EventSink {
  constructor(private readonly firestore: Firestore) {}

  async accept(event: ValidatedDeviceEvent, _requestContext: { requestId: string }): Promise<SinkOutcome> {
    const eventId = eventIdFor(event);
    const deviceRef = this.firestore.doc(`devices/${event.deviceId}`);
    const eventRef = deviceRef.collection('events').doc(eventId);
    const canonicalHash = canonicalEventHash(event);
    try {
      return await this.firestore.runTransaction(async transaction => {
        const deviceSnapshot = await transaction.get(deviceRef);
        const eventSnapshot = await transaction.get(eventRef);
        const device = deviceSnapshot.data() as DeviceRegistry | undefined;
        if (!device) return 'unknown_device';
        if (device.deviceId !== event.deviceId) return 'unknown_device';
        if (device.ingestionStatus !== 'enabled') return 'device_disabled';
        if (device.productModel !== event.productModel) return 'product_model_mismatch';
        if (eventSnapshot.exists) return eventSnapshot.get('canonicalHash') === canonicalHash ? 'duplicate' : 'event_id_conflict';

        // Only a first-time urination event reads and writes the daily aggregate;
        // the read happens before any write so the increment is transactional.
        let dailyWrite: { ref: DocumentReference; record: DailyUrinationRecord } | undefined;
        if (event.eventType === 'urination') {
          const dayKey = toAsiaTaipeiDayKey(event.effectiveAtMs);
          const dailyRef = deviceRef.collection('dailyStats').doc(dayKey);
          const dailySnapshot = await transaction.get(dailyRef);
          const record = dailySnapshot.exists
            ? buildDailyIncrement(assertValidDailyDocument(dailySnapshot.data(), dayKey), event.effectiveAtMs, event.receivedAtMs)
            : buildInitialDailyRecord(dayKey, event.effectiveAtMs, event.receivedAtMs);
          dailyWrite = { ref: dailyRef, record };
        }

        const projection = event.eventType === 'battery'
          ? batteryProjection(event, device, eventId)
          : urinationProjection(event, device, eventId);
        transaction.create(eventRef, buildEventRecord(event, canonicalHash));
        transaction.update(deviceRef, projection);
        if (dailyWrite) transaction.set(dailyWrite.ref, dailyWrite.record);
        return 'stored';
      });
    } catch (error) {
      if (error instanceof AggregationIntegrityError) return 'aggregation_integrity_error';
      if (isTransient(error)) return 'unavailable';
      throw error;
    }
  }
}
