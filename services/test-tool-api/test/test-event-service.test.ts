import { describe, expect, it, vi } from 'vitest';

import {
  CanonicalEventGenerationError,
  TestEventService,
  type IngestionEventClient,
} from '../src/events/test-event-service.js';

const UUID_1 = '123e4567-e89b-42d3-a456-426614174000';
const UUID_2 = '123e4567-e89b-42d3-a456-426614174001';
const NOW_MS = 1_786_449_600_000;

function client(outcome: 'stored' | 'duplicate' = 'stored'):
  IngestionEventClient & { submit: ReturnType<typeof vi.fn> } {
  return { submit: vi.fn(async () => outcome) };
}

describe('canonical Test Tool event service', () => {
  it('generates the exact urination envelope from the specification example', async () => {
    const ingestion = client('stored');
    const service = new TestEventService(
      ingestion,
      { nowMs: () => NOW_MS },
      { randomUuid: () => UUID_1 },
    );

    await expect(
      service.submit({
        device: { deviceId: 'PC-BETA-0001', productModel: 'pc-mini' },
        sequence: 17,
        body: { eventType: 'urination', flushDurationMs: 3000, pumpDurationMs: 5000 },
      }),
    ).resolves.toEqual({
      status: 'stored',
      eventId: `tt:PC-BETA-0001:${UUID_1}`,
      eventType: 'urination',
      deviceId: 'PC-BETA-0001',
      sequence: 17,
    });
    expect(ingestion.submit).toHaveBeenCalledWith({
      topic: 'products/pc-mini/devices/PC-BETA-0001/events/urination',
      clientId: 'PC-BETA-0001',
      username: 'development-test-tool',
      qos: 1,
      retained: false,
      brokerReceivedAtMs: NOW_MS,
      payload: {
        schemaVersion: 1,
        eventId: `tt:PC-BETA-0001:${UUID_1}`,
        eventType: 'urination',
        deviceId: 'PC-BETA-0001',
        sequence: 17,
        recordedAtMs: NOW_MS,
        firmwareVersion: '0.0.0-test-tool',
        flushDurationMs: 3000,
        pumpDurationMs: 5000,
      },
    });
  });

  it('generates the exact battery envelope with optional voltage', async () => {
    const ingestion = client('duplicate');
    const service = new TestEventService(
      ingestion,
      { nowMs: () => NOW_MS },
      { randomUuid: () => UUID_1 },
    );

    await expect(
      service.submit({
        device: { deviceId: 'PC-BETA-0001', productModel: 'pc-mini' },
        sequence: 18,
        body: { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3975 },
      }),
    ).resolves.toEqual({
      status: 'duplicate',
      eventId: `tt:PC-BETA-0001:${UUID_1}`,
      eventType: 'battery',
      deviceId: 'PC-BETA-0001',
      sequence: 18,
    });
    expect(ingestion.submit).toHaveBeenCalledWith({
      topic: 'products/pc-mini/devices/PC-BETA-0001/status/battery',
      clientId: 'PC-BETA-0001',
      username: 'development-test-tool',
      qos: 1,
      retained: false,
      brokerReceivedAtMs: NOW_MS,
      payload: {
        schemaVersion: 1,
        eventId: `tt:PC-BETA-0001:${UUID_1}`,
        eventType: 'battery',
        deviceId: 'PC-BETA-0001',
        sequence: 18,
        recordedAtMs: NOW_MS,
        firmwareVersion: '0.0.0-test-tool',
        batteryLevelPercent: 75,
        batteryVoltageMv: 3975,
      },
    });
  });

  it('generates a fresh cryptographic identity for every accepted submission', async () => {
    const ingestion = client();
    const randomUuid = vi.fn().mockReturnValueOnce(UUID_1).mockReturnValueOnce(UUID_2);
    const service = new TestEventService(
      ingestion,
      { nowMs: () => NOW_MS },
      { randomUuid },
    );
    const submission = {
      device: { deviceId: 'PC-BETA-0001', productModel: 'pc-mini' },
      sequence: 18,
      body: { eventType: 'battery' as const, batteryLevelPercent: 75 as const },
    };

    const first = await service.submit(submission);
    const second = await service.submit({ ...submission, sequence: 19 });

    expect(first.eventId).not.toBe(second.eventId);
    expect(first.eventId).toBe(`tt:PC-BETA-0001:${UUID_1}`);
    expect(second.eventId).toBe(`tt:PC-BETA-0001:${UUID_2}`);
    expect(randomUuid).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['invalid UUID', { nowMs: () => NOW_MS }, { randomUuid: () => 'chosen-id' }],
    ['negative clock', { nowMs: () => -1 }, { randomUuid: () => UUID_1 }],
    ['fractional clock', { nowMs: () => 1.5 }, { randomUuid: () => UUID_1 }],
  ])('fails before ingestion for unsafe server dependency: %s', async (_case, clock, ids) => {
    const ingestion = client();
    const service = new TestEventService(ingestion, clock, ids);

    await expect(
      service.submit({
        device: { deviceId: 'PC-BETA-0001', productModel: 'pc-mini' },
        sequence: 18,
        body: { eventType: 'battery', batteryLevelPercent: 75 },
      }),
    ).rejects.toMatchObject(new CanonicalEventGenerationError());
    expect(ingestion.submit).not.toHaveBeenCalled();
  });
});
