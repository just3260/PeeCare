import type { ValidatedDeviceEvent } from '../domain/validated-device-event.js';
import { estimateUrineVolume } from './urine-volume-estimate.js';

type UrinationPayload = {
  schemaVersion: number; eventId: string; sequence: number; recordedAtMs?: number | null;
  firmwareVersion: string; flushDurationMs: number; pumpDurationMs: number;
};

export function buildUrinationEventRecord(event: ValidatedDeviceEvent, canonicalHash: string): Record<string, unknown> {
  const payload = event.payload as unknown as UrinationPayload;
  const { estimatedUrineMl, estimationStatus } = estimateUrineVolume(payload.flushDurationMs, payload.pumpDurationMs);
  return {
    eventId: payload.eventId, eventType: 'urination', deviceId: event.deviceId, productModel: event.productModel,
    schemaVersion: payload.schemaVersion, sequence: payload.sequence,
    ...(typeof payload.recordedAtMs === 'number' ? { recordedAtMs: payload.recordedAtMs } : {}),
    brokerReceivedAtMs: event.brokerReceivedAtMs, receivedAtMs: event.receivedAtMs, effectiveAtMs: event.effectiveAtMs,
    timeSource: event.timeSource, firmwareVersion: payload.firmwareVersion, flushDurationMs: payload.flushDurationMs,
    pumpDurationMs: payload.pumpDurationMs, estimatedUrineMl, estimationStatus, canonicalHash,
    createdAtMs: event.receivedAtMs, transport: { topic: event.topic, clientId: event.clientId, username: event.username, qos: event.qos },
  };
}
