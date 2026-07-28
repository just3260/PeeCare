import { Firestore } from '@google-cloud/firestore';
import type { FirestoreConfig } from '../config.js';

/** Creates the trusted server client; the SDK honors FIRESTORE_EMULATOR_HOST. */
export function createFirestore(config: FirestoreConfig): Firestore {
  return new Firestore({
    projectId: config.projectId,
    ...(config.emulatorHost ? { host: config.emulatorHost, ssl: false } : {}),
  });
}
