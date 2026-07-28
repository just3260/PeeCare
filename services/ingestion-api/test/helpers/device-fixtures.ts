import type { Firestore } from '@google-cloud/firestore';

export const deviceFixtures = Object.freeze([
  { deviceId: 'PC-000001', productModel: 'pc-mini', ingestionStatus: 'enabled' },
  { deviceId: 'PC-000002', productModel: 'pc-mini', ingestionStatus: 'disabled' },
  { deviceId: 'PC-000003', productModel: 'pc-pro', ingestionStatus: 'enabled' },
] as const);

export async function clearDeviceFixtures(firestore: Firestore): Promise<void> {
  for (const fixture of deviceFixtures) {
    const deviceRef = firestore.doc(`devices/${fixture.deviceId}`);
    for (const subcollection of ['events', 'dailyStats']) {
      const docs = await deviceRef.collection(subcollection).listDocuments();
      for (let start = 0; start < docs.length; start += 400) {
        const batch = firestore.batch();
        for (const ref of docs.slice(start, start + 400)) batch.delete(ref);
        await batch.commit();
      }
    }
    await deviceRef.delete();
  }
}

export async function resetAndSeedDevices(firestore: Firestore): Promise<void> {
  await clearDeviceFixtures(firestore);
  const batch = firestore.batch();
  for (const fixture of deviceFixtures) batch.set(firestore.doc(`devices/${fixture.deviceId}`), fixture);
  await batch.commit();
}
