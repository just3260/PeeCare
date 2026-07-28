import type { ValidatedDeviceEvent } from '../domain/validated-device-event.js';

type BatteryPayload = {
  schemaVersion: number;
  eventId: string;
  sequence: number;
  recordedAtMs?: number | null;
  firmwareVersion: string;
  batteryLevelPercent: 0 | 25 | 50 | 75 | 100;
  batteryVoltageMv?: number;
};

export function buildBatteryEventRecord(event: ValidatedDeviceEvent, canonicalHash: string): Record<string, unknown> {
  const payload = event.payload as unknown as BatteryPayload;
  return {
    eventId: payload.eventId, eventType: 'battery', deviceId: event.deviceId, productModel: event.productModel,
    schemaVersion: payload.schemaVersion, sequence: payload.sequence,
    ...(typeof payload.recordedAtMs === 'number' ? { recordedAtMs: payload.recordedAtMs } : {}),
    brokerReceivedAtMs: event.brokerReceivedAtMs, receivedAtMs: event.receivedAtMs,
    effectiveAtMs: event.effectiveAtMs, timeSource: event.timeSource, firmwareVersion: payload.firmwareVersion,
    batteryLevelPercent: payload.batteryLevelPercent,
    ...(typeof payload.batteryVoltageMv === 'number' ? { batteryVoltageMv: payload.batteryVoltageMv } : {}),
    canonicalHash, createdAtMs: event.receivedAtMs,
    transport: { topic: event.topic, clientId: event.clientId, username: event.username, qos: event.qos },
  };
}
