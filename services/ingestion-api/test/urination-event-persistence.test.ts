import { describe, expect, it } from 'vitest';
import { canonicalEventHash } from '../src/persistence/canonical-event-hash.js';
import { buildUrinationEventRecord } from '../src/persistence/urination-event-record.js';
import type { ValidatedDeviceEvent } from '../src/domain/validated-device-event.js';

const event: ValidatedDeviceEvent = {
  eventType: 'urination', productModel: 'pc-mini', deviceId: 'PC-000001',
  topic: 'products/pc-mini/devices/PC-000001/events/urination', clientId: 'PC-000001', username: 'mqtt-user', qos: 1,
  brokerReceivedAtMs: 1785168060000, receivedAtMs: 1785168061000, effectiveAtMs: 1785168000000, timeSource: 'device',
  payload: { schemaVersion: 1, eventId: 'evt-000001', eventType: 'urination', deviceId: 'PC-000001', productModel: 'pc-mini', sequence: 42, recordedAtMs: 1785168000000, firmwareVersion: '1.2.0', flushDurationMs: 3000, pumpDurationMs: 5000 },
};

describe('canonical event identity', () => {
  it('is stable across object key order and transport audit differences', () => {
    const reordered = { ...event, username: 'other', qos: 2, brokerReceivedAtMs: 1, receivedAtMs: 2, payload: { pumpDurationMs: 5000, flushDurationMs: 3000, firmwareVersion: '1.2.0', recordedAtMs: 1785168000000, sequence: 42, productModel: 'pc-mini', deviceId: 'PC-000001', eventType: 'urination', eventId: 'evt-000001', schemaVersion: 1 } };
    expect(canonicalEventHash(event)).toBe('8a6e86defb880f5e6aef920b6229e95a24350fc3b5d7e77cf4eb8532b6bfd045');
    expect(canonicalEventHash(event)).toBe(canonicalEventHash(reordered));
  });
  it('changes when the topic, publisher, or payload changes', () => {
    expect(canonicalEventHash(event)).not.toBe(canonicalEventHash({ ...event, clientId: 'other' }));
    expect(canonicalEventHash(event)).not.toBe(canonicalEventHash({ ...event, payload: { ...event.payload, flushDurationMs: 3001 } }));
  });
});

describe('urination event record', () => {
  it('preserves raw measurements and transport audit with an estimated urine volume', () => {
    // net pump window = 5000 - 3000 = 2000 ms -> 2000 / 100 * 1 = 20 ml
    expect(buildUrinationEventRecord(event, 'hash')).toEqual(expect.objectContaining({
      eventId: 'evt-000001', eventType: 'urination', deviceId: 'PC-000001', productModel: 'pc-mini', sequence: 42,
      recordedAtMs: 1785168000000, flushDurationMs: 3000, pumpDurationMs: 5000, estimatedUrineMl: 20,
      estimationStatus: 'estimated', canonicalHash: 'hash', createdAtMs: 1785168061000,
      transport: { topic: event.topic, clientId: event.clientId, username: event.username, qos: event.qos },
    }));
  });
  it('omits recordedAtMs when the payload does not report it', () => {
    const withoutRecorded = { ...event, payload: { ...event.payload, recordedAtMs: undefined } };
    expect(buildUrinationEventRecord(withoutRecorded, 'hash')).not.toHaveProperty('recordedAtMs');
  });
});
