import { describe, expect, it } from 'vitest';
import { createFirestore } from '../src/firestore/firestore-client.js';
import { deviceFixtures, resetAndSeedDevices } from './helpers/device-fixtures.js';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('deterministic device fixtures', () => {
  it('resets and seeds the same device registry documents on every run', async () => {
    const firestore = createFirestore({ projectId: 'demo-peecare', emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
    await resetAndSeedDevices(firestore);
    const first = (await firestore.collection('devices').get()).docs.map(doc => doc.data());
    await resetAndSeedDevices(firestore);
    const second = (await firestore.collection('devices').get()).docs.map(doc => doc.data());
    expect(first).toEqual(deviceFixtures); expect(second).toEqual(deviceFixtures);
    await firestore.terminate();
  }, 20_000);
});
