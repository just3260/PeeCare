import { describe, expect, it } from 'vitest';
import { createFirestore } from '../src/firestore/firestore-client.js';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore Emulator connection', () => {
  it('uses the server SDK client against the configured Emulator', async () => {
    const firestore = createFirestore({ projectId: 'demo-peecare', emulatorHost: process.env.FIRESTORE_EMULATOR_HOST });
    await expect(firestore.doc('smoke/connection').get()).resolves.toMatchObject({ exists: false });
    await firestore.terminate();
  }, 20_000);
});
