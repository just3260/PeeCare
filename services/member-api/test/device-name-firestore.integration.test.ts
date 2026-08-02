import type { Firestore, Transaction } from '@google-cloud/firestore';
import { afterEach, describe, expect, it } from 'vitest';

import { DeviceNameService } from '../src/devices/device-name-service.js';
import { createFirestore } from '../src/firestore/firestore-client.js';
import {
  DeviceNotFoundError,
  FirestoreDeviceNameRepository,
} from '../src/firestore/device-name-repository.js';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const firestore = emulatorHost
  ? createFirestore({ projectId: 'demo-peecare', emulatorHost })
  : null;

const DEVICE_ID = 'PC-NAME-0001';
const MISSING_DEVICE_ID = 'PC-NAME-MISSING';
const DEVICE_PATH = `devices/${DEVICE_ID}`;

function serviceFor(database: Firestore): DeviceNameService {
  return new DeviceNameService(new FirestoreDeviceNameRepository(database));
}

async function seedDevice(overrides: Record<string, unknown> = {}): Promise<void> {
  await firestore!.doc(DEVICE_PATH).set({
    deviceId: DEVICE_ID,
    ownerUid: 'member-001',
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
    latestBatteryEventId: 'evt-battery-001',
    latestBatteryLevelPercent: 75,
    lastReportedAtMs: 1_700_000_000_000,
    ...overrides,
  });
  await firestore!.doc(`${DEVICE_PATH}/events/evt-1`).set({ eventId: 'evt-1' });
  await firestore!.doc(`${DEVICE_PATH}/dailyStats/2026-08-02`).set({ urinationCount: 2 });
}

function firestoreThatAbortsThenChangesOwner(database: Firestore): {
  readonly firestore: Firestore;
  attempts(): number;
} {
  let attemptCount = 0;
  let ownerChange: Promise<unknown> | null = null;
  const wrapped = new Proxy(database, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (property !== 'runTransaction') {
        return typeof member === 'function' ? member.bind(target) : member;
      }
      return (updateFunction: (transaction: Transaction) => Promise<unknown>) =>
        target.runTransaction(async (transaction) => {
          attemptCount += 1;
          const currentAttempt = attemptCount;
          const wrappedTransaction = new Proxy(transaction, {
            get(transactionTarget, transactionProperty) {
              const transactionMember = Reflect.get(
                transactionTarget,
                transactionProperty,
                transactionTarget,
              ) as unknown;
              if (transactionProperty === 'get') {
                return async (...args: Parameters<Transaction['get']>) => {
                  if (currentAttempt > 1 && ownerChange) {
                    await ownerChange;
                  }
                  return transactionTarget.get(...args);
                };
              }
              if (transactionProperty === 'update' && currentAttempt === 1) {
                return () => {
                  // The external write waits for this attempt's lock to release.
                  // Throwing ABORTED makes the real SDK retry; the next get waits
                  // until ownership has actually changed in the Emulator.
                  ownerChange = target.doc(DEVICE_PATH).update({ ownerUid: 'member-002' });
                  throw Object.assign(new Error('injected concurrent abort'), { code: 10 });
                };
              }
              return typeof transactionMember === 'function'
                ? transactionMember.bind(transactionTarget)
                : transactionMember;
            },
          });
          return updateFunction(wrappedTransaction);
        });
    },
  }) as Firestore;
  return { firestore: wrapped, attempts: () => attemptCount };
}

describe.skipIf(!firestore)('Firestore device-name transaction', () => {
  afterEach(async () => {
    await Promise.all([
      firestore!.recursiveDelete(firestore!.doc(DEVICE_PATH)),
      firestore!.recursiveDelete(firestore!.doc(`devices/${MISSING_DEVICE_ID}`)),
    ]);
  });

  it('lets the current owner rename while preserving registry fields and child documents', async () => {
    await seedDevice();

    await expect(
      serviceFor(firestore!).updateDisplayName({
        memberUid: 'member-001',
        deviceId: DEVICE_ID,
        customName: '  主浴室  ',
      }),
    ).resolves.toEqual({
      deviceId: DEVICE_ID,
      customName: '主浴室',
      displayName: '主浴室',
    });

    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual({
      deviceId: DEVICE_ID,
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      latestBatteryEventId: 'evt-battery-001',
      latestBatteryLevelPercent: 75,
      lastReportedAtMs: 1_700_000_000_000,
      customName: '主浴室',
    });
    expect((await firestore!.doc(`${DEVICE_PATH}/events/evt-1`).get()).exists).toBe(true);
    expect((await firestore!.doc(`${DEVICE_PATH}/dailyStats/2026-08-02`).get()).exists).toBe(true);
  });

  it('clears idempotently and returns the immutable device id as displayName', async () => {
    await seedDevice({ customName: '主浴室' });
    const command = { memberUid: 'member-001', deviceId: DEVICE_ID, customName: null } as const;

    await expect(serviceFor(firestore!).updateDisplayName(command)).resolves.toEqual({
      deviceId: DEVICE_ID,
      customName: null,
      displayName: DEVICE_ID,
    });
    await expect(serviceFor(firestore!).updateDisplayName(command)).resolves.toEqual({
      deviceId: DEVICE_ID,
      customName: null,
      displayName: DEVICE_ID,
    });
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).not.toHaveProperty('customName');
  });

  it('makes foreign-owned and missing devices indistinguishable and writes neither', async () => {
    await seedDevice({ customName: '原名稱' });
    const service = serviceFor(firestore!);

    await expect(
      service.updateDisplayName({
        memberUid: 'member-002',
        deviceId: DEVICE_ID,
        customName: '越權名稱',
      }),
    ).rejects.toMatchObject(new DeviceNotFoundError());
    await expect(
      service.updateDisplayName({
        memberUid: 'member-002',
        deviceId: MISSING_DEVICE_ID,
        customName: '探測名稱',
      }),
    ).rejects.toMatchObject(new DeviceNotFoundError());

    expect((await firestore!.doc(DEVICE_PATH).get()).get('customName')).toBe('原名稱');
    expect((await firestore!.doc(`devices/${MISSING_DEVICE_ID}`).get()).exists).toBe(false);
  });

  it('rechecks authorization when ownership changes during the transaction', async () => {
    await seedDevice({ customName: '原名稱' });
    const concurrent = firestoreThatAbortsThenChangesOwner(firestore!);

    await expect(
      serviceFor(concurrent.firestore).updateDisplayName({
        memberUid: 'member-001',
        deviceId: DEVICE_ID,
        customName: '過期 owner 的名稱',
      }),
    ).rejects.toMatchObject(new DeviceNotFoundError());
    expect(concurrent.attempts()).toBeGreaterThanOrEqual(2);
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toMatchObject({
      ownerUid: 'member-002',
      customName: '原名稱',
    });
  });
});
