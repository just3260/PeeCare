import { deriveEffectiveTime, loadValidators, parseTopic, validateEnvelope } from '@peecare/device-events-contract';
import { immutableEvent, type ValidatedDeviceEvent } from '../domain/validated-device-event.js';
import type { EmqxEnvelope } from './emqx-webhook-envelope.js';
const validators = loadValidators() as never;
export function validateWebhookEvent(envelope: EmqxEnvelope, receivedAtMs: number): { ok: true; event: ValidatedDeviceEvent } | { ok: false; code: 'invalid_event' | 'publisher_mismatch' } {
  const validated = validateEnvelope({ topic: envelope.topic, payload: envelope.payload }, validators) as { ok: boolean };
  const topic = parseTopic(envelope.topic) as { deviceId?: string; productModel?: string; eventType?: 'urination' | 'battery' };
  if (!validated.ok || !topic.deviceId || !topic.productModel || !topic.eventType) return { ok: false, code: 'invalid_event' };
  if (envelope.clientId !== topic.deviceId || envelope.payload.deviceId !== topic.deviceId) return { ok: false, code: 'publisher_mismatch' };
  const time = deriveEffectiveTime(envelope.payload.recordedAtMs as number | null, receivedAtMs);
  return { ok: true, event: immutableEvent({ ...envelope, productModel: topic.productModel, deviceId: topic.deviceId, eventType: topic.eventType, receivedAtMs, effectiveAtMs: time.effectiveAtMs, timeSource: time.timeSource, payload: envelope.payload }) };
}
