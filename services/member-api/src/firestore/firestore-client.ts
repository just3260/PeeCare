import { Firestore } from '@google-cloud/firestore';

export interface FirestoreConfig {
  readonly projectId: string;
  readonly emulatorHost?: string;
}

/** Create the trusted Firestore client; emulator use must be selected explicitly. */
export function createFirestore(config: FirestoreConfig): Firestore {
  return new Firestore({
    projectId: config.projectId,
    ...(config.emulatorHost ? { host: config.emulatorHost, ssl: false } : {}),
  });
}
