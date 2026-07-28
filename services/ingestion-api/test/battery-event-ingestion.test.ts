import { describe, expect, it } from 'vitest';
import type { ValidatedDeviceEvent } from '../src/domain/validated-device-event.js';
import { buildBatteryEventRecord } from '../src/persistence/battery-event-record.js';

const batteryEvent = (batteryLevelPercent: 0 | 25 | 50 | 75 | 100, batteryVoltageMv?: number): ValidatedDeviceEvent => ({
  eventType: 'battery', productModel: 'pc-mini', deviceId: 'PC-000001',
  topic: 'products/pc-mini/devices/PC-000001/events/battery', clientId: 'PC-000001', username: 'mqtt-user', qos: 1,
  brokerReceivedAtMs: 1785168060000, receivedAtMs: 1785168061000, effectiveAtMs: 1785168000000, timeSource: 'device',
  payload: { schemaVersion: 1, eventId: 'evt-battery-001', eventType: 'battery', deviceId: 'PC-000001', productModel: 'pc-mini', sequence: 43, recordedAtMs: 1785168000000, firmwareVersion: '1.2.0', batteryLevelPercent, ...(batteryVoltageMv === undefined ? {} : { batteryVoltageMv }) },
});

describe('battery event record', () => {
  it.each([0, 25, 50, 75, 100] as const)('preserves the validated five-level value %i', batteryLevelPercent => {
    expect(buildBatteryEventRecord(batteryEvent(batteryLevelPercent), 'hash')).toMatchObject({ eventType: 'battery', batteryLevelPercent });
  });

  it('preserves voltage only when the payload provides it', () => {
    expect(buildBatteryEventRecord(batteryEvent(75, 3840), 'hash')).toMatchObject({ batteryVoltageMv: 3840 });
    expect(buildBatteryEventRecord(batteryEvent(25), 'hash')).not.toHaveProperty('batteryVoltageMv');
  });

  it('contains common fields but no urination-only fields', () => {
    const record = buildBatteryEventRecord(batteryEvent(50), 'hash');
    expect(record).toMatchObject({ eventId: 'evt-battery-001', deviceId: 'PC-000001', productModel: 'pc-mini', sequence: 43, recordedAtMs: 1785168000000, canonicalHash: 'hash', transport: { topic: 'products/pc-mini/devices/PC-000001/events/battery', clientId: 'PC-000001', username: 'mqtt-user', qos: 1 } });
    for (const field of ['flushDurationMs', 'pumpDurationMs', 'estimatedUrineMl', 'estimationStatus']) expect(record).not.toHaveProperty(field);
  });

  it('omits a null common recordedAtMs as the normalized record representation', () => {
    const event = batteryEvent(50);
    event.payload.recordedAtMs = null;
    expect(buildBatteryEventRecord(event, 'hash')).not.toHaveProperty('recordedAtMs');
  });
});
