import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { DeviceNameService } from './devices/device-name-service.js';
import { createFirestore } from './firestore/firestore-client.js';
import { FirestoreDeviceNameRepository } from './firestore/device-name-repository.js';
import { FirebaseIdTokenVerifier } from './security/firebase-id-token-verifier.js';
import { closeMemberApi } from './shutdown.js';

const config = readConfig();
const firebaseApp = initializeApp({
  projectId: config.projectId,
  credential: applicationDefault(),
});
const firestore = createFirestore(config.firestore);
const app = buildApp({
  dependencies: {
    tokenVerifier: new FirebaseIdTokenVerifier(getAuth(firebaseApp)),
    deviceNameService: new DeviceNameService(new FirestoreDeviceNameRepository(firestore)),
  },
  allowedOrigin: config.allowedOrigin,
  logger: true,
});

await app.listen({ host: '0.0.0.0', port: config.port });

function shutdown(): void {
  void closeMemberApi(app, () => {
    app.log.error('Member API shutdown failed');
    process.exitCode = 1;
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
