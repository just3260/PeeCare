import type { Firestore } from '@google-cloud/firestore';
import { afterEach, describe, expect, it } from 'vitest';
import { createFirestore } from '../src/firestore/firestore-client.js';
import { FirestoreEventSink } from '../src/firestore/firestore-event-sink.js';
import type { ValidatedDeviceEvent } from '../src/domain/validated-device-event.js';
import { clearDeviceFixtures } from './helpers/device-fixtures.js';

const enabled = { deviceId: 'PC-000001', productModel: 'pc-mini', ingestionStatus: 'enabled' };

// Wraps a Firestore so that the last transactional write (`update`) throws after all
// reads and the event `create` have been staged, simulating an abort before commit.
function firestoreThatAbortsBeforeCommit(firestore: Firestore): Firestore {
  const bind = <T extends object>(target: T, prop: PropertyKey): unknown => {
    const value = (target as Record<PropertyKey, unknown>)[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  };
  return new Proxy(firestore, {
    get(target, prop) {
      if (prop !== 'runTransaction') return bind(target, prop);
      return (updateFn: (tx: object) => unknown, options?: unknown) =>
        (target.runTransaction as (fn: (tx: object) => unknown, options?: unknown) => unknown)(
          transaction =>
            updateFn(
              new Proxy(transaction, {
                get(txTarget, txProp) {
                  if (txProp === 'update') {
                    return () => {
                      throw new Error('injected abort before commit');
                    };
                  }
                  return bind(txTarget, txProp);
                },
              }),
            ),
          options,
        );
    },
  }) as Firestore;
}
type AnyFn = (...args: unknown[]) => unknown;
const bindMember = <T extends object>(target: T, prop: PropertyKey): unknown => {
  const value = (target as Record<PropertyKey, unknown>)[prop];
  return typeof value === 'function' ? (value as AnyFn).bind(target) : value;
};

// Records whether any transactional operation touched a `dailyStats` document,
// so ineligible events can be proven to perform zero aggregate reads or writes.
function firestoreRecordingDailyAccess(firestore: Firestore): { firestore: Firestore; touchedDaily: () => boolean } {
  let touched = false;
  const record = (ref: unknown): void => {
    const path = (ref as { path?: unknown }).path;
    if (typeof path === 'string' && path.includes('/dailyStats/')) touched = true;
  };
  const proxy = new Proxy(firestore, {
    get(target, prop) {
      if (prop !== 'runTransaction') return bindMember(target, prop);
      return (updateFn: (tx: object) => unknown, options?: unknown) =>
        (target.runTransaction as (fn: (tx: object) => unknown, options?: unknown) => unknown)(
          transaction =>
            updateFn(
              new Proxy(transaction, {
                get(txTarget, txProp) {
                  if (['get', 'create', 'update', 'set', 'delete'].includes(txProp as string) && typeof (txTarget as Record<PropertyKey, unknown>)[txProp] === 'function') {
                    return (ref: unknown, ...rest: unknown[]) => {
                      record(ref);
                      return ((txTarget as Record<PropertyKey, AnyFn>)[txProp]).call(txTarget, ref, ...rest);
                    };
                  }
                  return bindMember(txTarget, txProp);
                },
              }),
            ),
          options,
        );
    },
  }) as Firestore;
  return { firestore: proxy, touchedDaily: () => touched };
}

// Asia/Taipei is UTC+8, so these UTC instants select known local calendar days.
const JUL28_START = Date.parse('2026-07-27T16:00:00.000Z'); // 2026-07-28 00:00 Asia/Taipei
const JUL28_LATER = Date.parse('2026-07-28T02:00:00.000Z'); // 2026-07-28 10:00 Asia/Taipei
const LATE_EFFECTIVE = Date.parse('2026-07-27T15:59:00.000Z'); // 2026-07-27 23:59 Asia/Taipei
const LATE_RECEIVED = Date.parse('2026-07-27T16:05:00.000Z'); // 2026-07-28 00:05 Asia/Taipei
const dailyDoc = (firestore: Firestore, dayKey: string) => firestore.doc(`devices/PC-000001/dailyStats/${dayKey}`);

const makeEvent = (overrides: Partial<ValidatedDeviceEvent['payload']> = {}): ValidatedDeviceEvent => ({
  eventType: 'urination', productModel: 'pc-mini', deviceId: 'PC-000001', topic: 'products/pc-mini/devices/PC-000001/events/urination', clientId: 'PC-000001', username: 'mqtt-user', qos: 1, brokerReceivedAtMs: 2000, receivedAtMs: 2100, effectiveAtMs: 1000, timeSource: 'device',
  payload: { schemaVersion: 1, eventId: 'evt-000001', eventType: 'urination', deviceId: 'PC-000001', productModel: 'pc-mini', sequence: 1, firmwareVersion: '1.0.0', flushDurationMs: 3000, pumpDurationMs: 5000, ...overrides },
});
const makeBatteryEvent = (overrides: Partial<ValidatedDeviceEvent['payload']> = {}): ValidatedDeviceEvent => ({
  eventType: 'battery', productModel: 'pc-mini', deviceId: 'PC-000001', topic: 'products/pc-mini/devices/PC-000001/events/battery', clientId: 'PC-000001', username: 'mqtt-user', qos: 1, brokerReceivedAtMs: 2000, receivedAtMs: 2100, effectiveAtMs: 1000, timeSource: 'device',
  payload: { schemaVersion: 1, eventId: 'evt-battery-001', eventType: 'battery', deviceId: 'PC-000001', productModel: 'pc-mini', sequence: 1, recordedAtMs: 1000, firmwareVersion: '1.0.0', batteryLevelPercent: 75, batteryVoltageMv: 3840, ...overrides },
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore event sink', () => {
  const firestore = createFirestore({ projectId: 'demo-peecare', emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
  afterEach(async () => { await clearDeviceFixtures(firestore); });

  it('stores an eligible event and creates its latest projection atomically', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await expect(sink.accept(makeEvent(), { requestId: 'r' })).resolves.toBe('stored');
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).data()).toMatchObject({ estimatedUrineMl: 200, estimationStatus: 'estimated' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({ latestUrinationEventId: 'evt-000001', lastReportedAtMs: 2100, latestUrinationEstimatedUrineMl: 200, latestUrinationEstimationStatus: 'estimated' });
  }, 20_000);

  it('dispatches an eligible battery event through the shared device gate and transaction', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await expect(sink.accept(makeBatteryEvent(), { requestId: 'r' })).resolves.toBe('stored');
    expect((await firestore.doc('devices/PC-000001/events/evt-battery-001').get()).data()).toMatchObject({ eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3840 });
  }, 20_000);

  it('preserves the shared custom name during a real ingestion projection update', async () => {
    await firestore.doc('devices/PC-000001').set({ ...enabled, customName: '主浴室' });
    const sink = new FirestoreEventSink(firestore);

    await expect(sink.accept(makeBatteryEvent(), { requestId: 'named-device' })).resolves.toBe('stored');

    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({
      customName: '主浴室',
      latestBatteryEventId: 'evt-battery-001',
      latestBatteryLevelPercent: 75,
    });
  }, 20_000);

  it('stores a first battery delivery, treats an identical retry as a zero-write duplicate, and preserves a cross-type conflict', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    expect(await sink.accept(makeBatteryEvent(), { requestId: 'first' })).toBe('stored');
    const original = (await firestore.doc('devices/PC-000001/events/evt-battery-001').get()).data();
    expect(await sink.accept(makeBatteryEvent(), { requestId: 'duplicate' })).toBe('duplicate');
    expect((await firestore.doc('devices/PC-000001/events/evt-battery-001').get()).data()).toEqual(original);
    expect(await sink.accept(makeEvent({ eventId: 'evt-battery-001' }), { requestId: 'conflict' })).toBe('event_id_conflict');
    expect((await firestore.doc('devices/PC-000001/events/evt-battery-001').get()).get('eventType')).toBe('battery');
  }, 20_000);

  it('keeps the latest battery projection monotonic, including equal-time event id ties', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept(makeBatteryEvent({ eventId: 'evt-b', batteryLevelPercent: 75, batteryVoltageMv: 3840 }), { requestId: 'first' });
    await sink.accept({ ...makeBatteryEvent({ eventId: 'evt-a', batteryLevelPercent: 25 }), receivedAtMs: 2200, effectiveAtMs: 900 }, { requestId: 'late' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({ latestBatteryEventId: 'evt-b', latestBatteryLevelPercent: 75, lastReportedAtMs: 2200 });
    await sink.accept({ ...makeBatteryEvent({ eventId: 'evt-z', batteryLevelPercent: 100 }), receivedAtMs: 2100, effectiveAtMs: 1000 }, { requestId: 'tie' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({ latestBatteryEventId: 'evt-z', latestBatteryLevelPercent: 100 });
  }, 20_000);

  it('resolves an equal-time tie by event id even when deliveries arrive in reverse order', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept(makeBatteryEvent({ eventId: 'evt-z' }), { requestId: 'z-first' });
    await sink.accept(makeBatteryEvent({ eventId: 'evt-a' }), { requestId: 'a-second' });
    expect((await firestore.doc('devices/PC-000001').get()).get('latestBatteryEventId')).toBe('evt-z');
  }, 20_000);

  it('keeps voltage coherent with the latest snapshot and leaves it unchanged for a late event', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept(makeBatteryEvent({ eventId: 'evt-voltage', batteryVoltageMv: 3840 }), { requestId: 'voltage' });
    await sink.accept({ ...makeBatteryEvent({ eventId: 'evt-voltage-new', batteryVoltageMv: 3810 }), receivedAtMs: 2200, effectiveAtMs: 1100 }, { requestId: 'replace' });
    expect((await firestore.doc('devices/PC-000001').get()).get('latestBatteryVoltageMv')).toBe(3810);
    await sink.accept({ ...makeBatteryEvent({ eventId: 'evt-no-voltage', batteryVoltageMv: undefined }), receivedAtMs: 2300, effectiveAtMs: 1200 }, { requestId: 'clear' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).not.toHaveProperty('latestBatteryVoltageMv');
    await sink.accept({ ...makeBatteryEvent({ eventId: 'evt-late-voltage', batteryVoltageMv: 3700 }), receivedAtMs: 2400, effectiveAtMs: 900 }, { requestId: 'late' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).not.toHaveProperty('latestBatteryVoltageMv');
  }, 20_000);

  it('does not establish or mutate presence fields for battery ingestion', async () => {
    const original = { ...enabled, isOnline: false, lastHeartbeatAtMs: 100, offlineAtMs: 200 };
    await firestore.doc('devices/PC-000001').set(original);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept(makeBatteryEvent(), { requestId: 'battery' });
    const device = (await firestore.doc('devices/PC-000001').get()).data() ?? {};
    expect(device).toMatchObject({ isOnline: false, lastHeartbeatAtMs: 100, offlineAtMs: 200 });
    expect(Object.keys(device).filter(key => /presence|heartbeat|online|offline/i.test(key))).toEqual(['isOnline', 'lastHeartbeatAtMs', 'offlineAtMs']);
    expect(Object.keys(device).filter(key => JSON.stringify(device[key]) !== JSON.stringify(original[key as keyof typeof original])).sort()).toEqual([
      'latestBatteryEventId', 'latestBatteryLevelPercent', 'latestBatteryAtMs', 'latestBatteryReceivedAtMs', 'latestBatteryFirmwareVersion', 'latestBatteryVoltageMv', 'lastReportedAtMs',
    ].sort());
  }, 20_000);

  it.each([
    [undefined, 'unknown_device'],
    [{ ...enabled, ingestionStatus: 'disabled' }, 'device_disabled'],
    [{ ...enabled, productModel: 'pc-pro' }, 'product_model_mismatch'],
  ] as const)('rejects an ineligible device without event writes', async (device, outcome) => {
    if (device) await firestore.doc('devices/PC-000001').set(device);
    const sink = new FirestoreEventSink(firestore);
    await expect(sink.accept(makeEvent(), { requestId: 'r' })).resolves.toBe(outcome);
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).exists).toBe(false);
  }, 20_000);

  it('returns duplicate for an identical retry and conflict for changed input', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    expect(await sink.accept(makeEvent(), { requestId: 'r1' })).toBe('stored');
    expect(await sink.accept(makeEvent(), { requestId: 'r2' })).toBe('duplicate');
    expect(await sink.accept(makeEvent({ flushDurationMs: 3001 }), { requestId: 'r3' })).toBe('event_id_conflict');
  }, 20_000);

  it('leaves no event document or projection change when the transaction aborts before commit', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestoreThatAbortsBeforeCommit(firestore));
    await expect(sink.accept(makeEvent(), { requestId: 'abort' })).rejects.toThrow('injected abort before commit');
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).exists).toBe(false);
    expect((await firestore.doc('devices/PC-000001').get()).data()).toEqual(enabled);
  }, 20_000);

  it('classifies concurrent first deliveries as one stored and one duplicate', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await expect(Promise.all([sink.accept(makeEvent(), { requestId: 'a' }), sink.accept(makeEvent(), { requestId: 'b' })])).resolves.toEqual(expect.arrayContaining(['stored', 'duplicate']));
  }, 20_000);

  it('keeps the latest projection monotonic for late and equal-time events', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept(makeEvent({ eventId: 'evt-b' }), { requestId: 'new' });
    await sink.accept({ ...makeEvent({ eventId: 'evt-a' }), receivedAtMs: 2000, effectiveAtMs: 900 }, { requestId: 'late' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({ latestUrinationEventId: 'evt-b', lastReportedAtMs: 2100 });
    await sink.accept({ ...makeEvent({ eventId: 'evt-z' }), receivedAtMs: 2100, effectiveAtMs: 1000 }, { requestId: 'tie' });
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({ latestUrinationEventId: 'evt-z' });
  }, 20_000);

  it('commits a first urination event and its estimated volume to the Asia/Taipei daily document in one transaction', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await expect(sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_LATER }, { requestId: 'first' })).resolves.toBe('stored');
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).exists).toBe(true);
    expect((await dailyDoc(firestore, '2026-07-28').get()).data()).toEqual({
      date: '2026-07-28', timeZone: 'Asia/Taipei', urinationCount: 1, estimatedUrineTotalMl: 200,
      lastEventAtMs: JUL28_START, updatedAtMs: JUL28_LATER,
    });
  }, 20_000);

  it('leaves neither the event nor the daily document when the transaction aborts before commit', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestoreThatAbortsBeforeCommit(firestore));
    await expect(sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_LATER }, { requestId: 'abort' })).rejects.toThrow('injected abort before commit');
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).exists).toBe(false);
    expect((await dailyDoc(firestore, '2026-07-28').get()).exists).toBe(false);
  }, 20_000);

  it('counts and sums two distinct urination events on the same day', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept({ ...makeEvent({ eventId: 'evt-000001' }), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'one' });
    expect((await dailyDoc(firestore, '2026-07-28').get()).get('urinationCount')).toBe(1);
    await sink.accept({ ...makeEvent({ eventId: 'evt-000002' }), effectiveAtMs: JUL28_LATER, receivedAtMs: JUL28_LATER }, { requestId: 'two' });
    expect((await dailyDoc(firestore, '2026-07-28').get()).data()).toMatchObject({
      urinationCount: 2, estimatedUrineTotalMl: 400,
      lastEventAtMs: JUL28_LATER, updatedAtMs: JUL28_LATER,
    });
  }, 20_000);

  it('performs zero daily reads or writes and leaves the daily document unchanged for a duplicate delivery', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    await new FirestoreEventSink(firestore).accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'first' });
    const original = (await dailyDoc(firestore, '2026-07-28').get()).data();
    const spy = firestoreRecordingDailyAccess(firestore);
    expect(await new FirestoreEventSink(spy.firestore).accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'dup' })).toBe('duplicate');
    expect(spy.touchedDaily()).toBe(false);
    expect((await dailyDoc(firestore, '2026-07-28').get()).data()).toEqual(original);
  }, 20_000);

  it('performs zero daily reads or writes for an eventId conflict', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    await new FirestoreEventSink(firestore).accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'first' });
    const original = (await dailyDoc(firestore, '2026-07-28').get()).data();
    const spy = firestoreRecordingDailyAccess(firestore);
    expect(await new FirestoreEventSink(spy.firestore).accept({ ...makeEvent({ flushDurationMs: 9999 }), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'conflict' })).toBe('event_id_conflict');
    expect(spy.touchedDaily()).toBe(false);
    expect((await dailyDoc(firestore, '2026-07-28').get()).data()).toEqual(original);
  }, 20_000);

  it('never creates a daily urination document for a stored battery event', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const spy = firestoreRecordingDailyAccess(firestore);
    expect(await new FirestoreEventSink(spy.firestore).accept({ ...makeBatteryEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'battery' })).toBe('stored');
    expect(spy.touchedDaily()).toBe(false);
    expect((await dailyDoc(firestore, '2026-07-28').get()).exists).toBe(false);
  }, 20_000);

  it.each([
    [undefined, 'unknown_device'],
    [{ ...enabled, ingestionStatus: 'disabled' }, 'device_disabled'],
    [{ ...enabled, productModel: 'pc-pro' }, 'product_model_mismatch'],
  ] as const)('performs zero daily reads or writes for a rejected device', async (device, outcome) => {
    if (device) await firestore.doc('devices/PC-000001').set(device);
    const spy = firestoreRecordingDailyAccess(firestore);
    expect(await new FirestoreEventSink(spy.firestore).accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'reject' })).toBe(outcome);
    expect(spy.touchedDaily()).toBe(false);
    expect((await dailyDoc(firestore, '2026-07-28').get()).exists).toBe(false);
  }, 20_000);

  it('counts two concurrent distinct urination events to a final count of 2', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await Promise.all([
      sink.accept({ ...makeEvent({ eventId: 'evt-000001' }), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'a' }),
      sink.accept({ ...makeEvent({ eventId: 'evt-000002' }), effectiveAtMs: JUL28_LATER, receivedAtMs: JUL28_LATER }, { requestId: 'b' }),
    ]);
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).exists).toBe(true);
    expect((await firestore.doc('devices/PC-000001/events/evt-000002').get()).exists).toBe(true);
    expect((await dailyDoc(firestore, '2026-07-28').get()).get('urinationCount')).toBe(2);
  }, 20_000);

  it('counts two concurrent identical deliveries to a final count of 1', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    const results = await Promise.all([
      sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'a' }),
      sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'b' }),
    ]);
    expect(results).toEqual(expect.arrayContaining(['stored', 'duplicate']));
    expect((await dailyDoc(firestore, '2026-07-28').get()).get('urinationCount')).toBe(1);
  }, 20_000);

  it('aborts with an integrity error and zero writes when the existing daily document is corrupt', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const corrupt = {
      date: '2026-07-28', timeZone: 'Asia/Taipei', urinationCount: -1, estimatedUrineTotalMl: 200,
      lastEventAtMs: 1, updatedAtMs: 1,
    };
    await dailyDoc(firestore, '2026-07-28').set(corrupt);
    const sink = new FirestoreEventSink(firestore);
    await expect(sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_LATER }, { requestId: 'corrupt' })).resolves.toBe('aggregation_integrity_error');
    expect((await firestore.doc('devices/PC-000001/events/evt-000001').get()).exists).toBe(false);
    expect((await dailyDoc(firestore, '2026-07-28').get()).data()).toEqual(corrupt);
  }, 20_000);

  it('mirrors the daily aggregate onto the device today projection', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept({ ...makeEvent({ eventId: 'evt-000001' }), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'one' });
    await sink.accept({ ...makeEvent({ eventId: 'evt-000002' }), effectiveAtMs: JUL28_LATER, receivedAtMs: JUL28_LATER }, { requestId: 'two' });
    const daily = (await dailyDoc(firestore, '2026-07-28').get()).data() ?? {};
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({
      todayDate: daily.date, todayUrinationCount: daily.urinationCount, todayEstimatedUrineTotalMl: daily.estimatedUrineTotalMl,
    });
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({
      todayDate: '2026-07-28', todayUrinationCount: 2, todayEstimatedUrineTotalMl: 400,
    });
  }, 20_000);

  it('never writes the today projection for a battery event', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept({ ...makeBatteryEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'battery' });
    const device = (await firestore.doc('devices/PC-000001').get()).data() ?? {};
    expect(device).not.toHaveProperty('todayDate');
    expect(device).not.toHaveProperty('todayUrinationCount');
    expect(device).not.toHaveProperty('todayEstimatedUrineTotalMl');
  }, 20_000);

  it('leaves the today projection unchanged for a duplicate delivery', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'first' });
    const original = (await firestore.doc('devices/PC-000001').get()).data();
    expect(await sink.accept({ ...makeEvent(), effectiveAtMs: JUL28_START, receivedAtMs: JUL28_START }, { requestId: 'dup' })).toBe('duplicate');
    expect((await firestore.doc('devices/PC-000001').get()).data()).toEqual(original);
  }, 20_000);

  it('keeps the today projection on its later day when a late event lands on an earlier day', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept({ ...makeEvent({ eventId: 'evt-000001' }), effectiveAtMs: JUL28_LATER, receivedAtMs: JUL28_LATER }, { requestId: 'today' });
    await sink.accept({ ...makeEvent({ eventId: 'evt-000002' }), effectiveAtMs: LATE_EFFECTIVE, receivedAtMs: LATE_RECEIVED }, { requestId: 'late' });
    expect((await dailyDoc(firestore, '2026-07-27').get()).get('urinationCount')).toBe(1);
    expect((await firestore.doc('devices/PC-000001').get()).data()).toMatchObject({
      todayDate: '2026-07-28', todayUrinationCount: 1, todayEstimatedUrineTotalMl: 200,
    });
  }, 20_000);

  it('attributes a late cross-midnight event to its effective day and advances only updatedAtMs', async () => {
    await firestore.doc('devices/PC-000001').set(enabled);
    const sink = new FirestoreEventSink(firestore);
    await sink.accept({ ...makeEvent({ eventId: 'evt-000001' }), effectiveAtMs: LATE_EFFECTIVE, receivedAtMs: LATE_RECEIVED }, { requestId: 'late' });
    expect((await dailyDoc(firestore, '2026-07-27').get()).data()).toMatchObject({
      date: '2026-07-27', urinationCount: 1, lastEventAtMs: LATE_EFFECTIVE, updatedAtMs: LATE_RECEIVED,
    });
    expect((await dailyDoc(firestore, '2026-07-28').get()).exists).toBe(false);
  }, 20_000);
});
