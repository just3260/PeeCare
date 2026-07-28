import { createHash } from 'node:crypto';
import type { ValidatedDeviceEvent } from '../domain/validated-device-event.js';

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`).join(',')}}`;
}

export function canonicalEventHash(event: Pick<ValidatedDeviceEvent, 'topic' | 'clientId' | 'payload'>): string {
  return createHash('sha256').update(stableValue({ topic: event.topic, clientId: event.clientId, payload: event.payload }), 'utf8').digest('hex');
}
