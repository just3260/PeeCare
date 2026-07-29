import type { Firestore } from '@google-cloud/firestore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createFirestore } from '../src/firestore/firestore-client.js';
import { FirestoreEventSink } from '../src/firestore/firestore-event-sink.js';

const DEVICE_ID = 'PC-000001';
const enabled = { deviceId: DEVICE_ID, productModel: 'pc-mini', ingestionStatus: 'enabled' };
const RECEIVED_FIRST = 1785168061000;
const RECEIVED_REDELIVERY = 1785168070000;
const RECEIVED_LATE = 1785168090000;

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1, eventId: 'evt-000001', eventType: 'urination', deviceId: DEVICE_ID, sequence: 42,
  recordedAtMs: 1785168000000, firmwareVersion: '1.2.0', flushDurationMs: 3000, pumpDurationMs: 5000, ...overrides,
});
const envelope = (payloadOverrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  topic: 'products/pc-mini/devices/PC-000001/events/urination', clientId: DEVICE_ID, username: 'mqtt-user',
  qos: 1, retained: false, brokerReceivedAtMs: 1785168060000, payload: payload(payloadOverrides),
});
const batteryPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1, eventId: 'evt-battery-001', eventType: 'battery', deviceId: DEVICE_ID, sequence: 43,
  recordedAtMs: 1785168000000, firmwareVersion: '1.2.0', batteryLevelPercent: 75, batteryVoltageMv: 3975, ...overrides,
});
const batteryEnvelope = (payloadOverrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  topic: 'products/pc-mini/devices/PC-000001/status/battery', clientId: DEVICE_ID, username: 'mqtt-user',
  qos: 1, retained: false, brokerReceivedAtMs: 1785168060000, payload: batteryPayload(payloadOverrides),
});
const request = (body: unknown) => ({
  method: 'POST' as const, url: '/v1/emqx/events',
  headers: { authorization: 'Bearer current-secret', 'content-type': 'application/json' }, payload: body,
});

// Rejects every transaction with a transient Firestore error so the sink reports `unavailable`.
function firestoreThatFailsTransiently(firestore: Firestore): Firestore {
  return new Proxy(firestore, {
    get(target, prop) {
      if (prop === 'runTransaction') return () => Promise.reject(Object.assign(new Error('unavailable'), { code: 14 }));
      const value = (target as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Firestore;
}

async function purgeDevice(firestore: Firestore): Promise<void> {
  for (const sub of ['events', 'dailyStats']) {
    const docs = await firestore.collection(`devices/${DEVICE_ID}/${sub}`).listDocuments();
    await Promise.all(docs.map(doc => doc.delete()));
  }
  await firestore.doc(`devices/${DEVICE_ID}`).delete();
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('EMQX request to Firestore end to end', () => {
  const firestore = createFirestore({ projectId: 'demo-peecare', emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
  const sink = new FirestoreEventSink(firestore);

  beforeEach(async () => { await purgeDevice(firestore); await firestore.doc(`devices/${DEVICE_ID}`).set(enabled); });
  afterEach(async () => { await purgeDevice(firestore); });

  it('stores an immutable urination event and its single pending-calibration daily count without a battery projection', async () => {
    const app = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink });
    const response = await app.inject(request(envelope()));
    await app.close();

    expect(response.statusCode).toBe(201);
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-000001`).get()).data()).toMatchObject({
      eventType: 'urination', flushDurationMs: 3000, pumpDurationMs: 5000, estimatedUrineMl: 200,
      estimationStatus: 'estimated', receivedAtMs: RECEIVED_FIRST, createdAtMs: RECEIVED_FIRST,
    });
    const device = (await firestore.doc(`devices/${DEVICE_ID}`).get()).data() ?? {};
    expect(device).toMatchObject({
      latestUrinationEventId: 'evt-000001', lastReportedAtMs: RECEIVED_FIRST,
      latestUrinationEstimatedUrineMl: 200, latestUrinationEstimationStatus: 'estimated',
    });
    expect(Object.keys(device).some(key => /battery/i.test(key))).toBe(false);
    const dailyDocs = await firestore.collection(`devices/${DEVICE_ID}/dailyStats`).listDocuments();
    expect(dailyDocs.length).toBe(1);
    expect((await dailyDocs[0].get()).data()).toEqual({
      date: '2026-07-28', timeZone: 'Asia/Taipei', urinationCount: 1, volumeStatus: 'pending_calibration',
      estimatedUrineTotalMl: null, estimatedUrineAverageMl: null, estimatedUrineMinMl: null, estimatedUrineMaxMl: null,
      lastEventAtMs: 1785168000000, updatedAtMs: RECEIVED_FIRST,
    });
  }, 30_000);

  it('maps a corrupt daily document to a sanitized 500 without any partial event or count write', async () => {
    const corrupt = {
      date: '2026-07-28', timeZone: 'Asia/Taipei', urinationCount: -1, volumeStatus: 'pending_calibration',
      estimatedUrineTotalMl: null, estimatedUrineAverageMl: null, estimatedUrineMinMl: null, estimatedUrineMaxMl: null,
      lastEventAtMs: 1, updatedAtMs: 1,
    };
    await firestore.doc(`devices/${DEVICE_ID}/dailyStats/2026-07-28`).set(corrupt);
    const app = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink });
    const response = await app.inject(request(envelope()));
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'aggregation_integrity_error', requestId: expect.any(String) } });
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-000001`).get()).exists).toBe(false);
    expect((await firestore.doc(`devices/${DEVICE_ID}/dailyStats/2026-07-28`).get()).data()).toEqual(corrupt);
  }, 30_000);

  it('treats an identical redelivery as a duplicate without rewriting the event', async () => {
    const first = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink });
    expect((await first.inject(request(envelope()))).statusCode).toBe(201);
    await first.close();

    const retry = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_REDELIVERY, sink });
    const response = await retry.inject(request(envelope()));
    await retry.close();

    expect(response.statusCode).toBe(200);
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-000001`).get()).data()).toMatchObject({ createdAtMs: RECEIVED_FIRST, receivedAtMs: RECEIVED_FIRST });
    expect((await firestore.doc(`devices/${DEVICE_ID}`).get()).get('lastReportedAtMs')).toBe(RECEIVED_FIRST);
  }, 30_000);

  it('rejects a reused event id with changed payload as a conflict and preserves the original', async () => {
    const first = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink });
    expect((await first.inject(request(envelope()))).statusCode).toBe(201);
    await first.close();

    const conflicting = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_REDELIVERY, sink });
    const response = await conflicting.inject(request(envelope({ flushDurationMs: 3001 })));
    await conflicting.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('event_id_conflict');
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-000001`).get()).get('flushDurationMs')).toBe(3000);
  }, 30_000);

  it('stores a late event but keeps the latest urination projection monotonic', async () => {
    const first = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink });
    expect((await first.inject(request(envelope()))).statusCode).toBe(201);
    await first.close();

    const late = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_LATE, sink });
    const response = await late.inject(request(envelope({ eventId: 'evt-000000', recordedAtMs: 1785167000000 })));
    await late.close();

    expect(response.statusCode).toBe(201);
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-000000`).get()).exists).toBe(true);
    expect((await firestore.doc(`devices/${DEVICE_ID}`).get()).data()).toMatchObject({ latestUrinationEventId: 'evt-000001', lastReportedAtMs: RECEIVED_LATE });
  }, 30_000);

  it('maps a transient Firestore failure to 503 without creating an event', async () => {
    const app = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink: new FirestoreEventSink(firestoreThatFailsTransiently(firestore)) });
    const response = await app.inject(request(envelope()));
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('persistence_unavailable');
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-000001`).get()).exists).toBe(false);
  }, 30_000);

  it('runs valid EMQX battery deliveries through the durable path without changing urination behavior', async () => {
    const first = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_FIRST, sink });
    expect((await first.inject(request(batteryEnvelope()))).statusCode).toBe(201);
    await first.close();
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-battery-001`).get()).data()).toMatchObject({ eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3975 });

    const retry = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_REDELIVERY, sink });
    expect((await retry.inject(request(batteryEnvelope()))).statusCode).toBe(200);
    await retry.close();

    const late = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_LATE, sink });
    expect((await late.inject(request(batteryEnvelope({ eventId: 'evt-battery-late', batteryLevelPercent: 25, batteryVoltageMv: undefined, recordedAtMs: 1785167000000 })))).statusCode).toBe(201);
    await late.close();
    expect((await firestore.doc(`devices/${DEVICE_ID}`).get()).data()).toMatchObject({ latestBatteryEventId: 'evt-battery-001', latestBatteryVoltageMv: 3975, lastReportedAtMs: RECEIVED_LATE });

    const conflict = buildApp({ currentSecret: 'current-secret', now: () => RECEIVED_LATE, sink });
    expect((await conflict.inject(request(envelope({ eventId: 'evt-battery-001' })))).statusCode).toBe(409);
    await conflict.close();
    expect((await firestore.doc(`devices/${DEVICE_ID}/events/evt-battery-001`).get()).get('eventType')).toBe('battery');
  }, 30_000);
});
