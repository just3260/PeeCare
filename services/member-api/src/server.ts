import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { pathToFileURL } from 'node:url';

import {
  buildApp,
  type MemberApiAppOptions,
  type MemberApiDependencies,
} from './app.js';
import { readProductionConfig, type MemberApiConfig } from './config.js';
import { DeviceNameService } from './devices/device-name-service.js';
import { createFirestore } from './firestore/firestore-client.js';
import { FirestoreDeviceNameRepository } from './firestore/device-name-repository.js';
import { FirebaseIdTokenVerifier } from './security/firebase-id-token-verifier.js';
import { closeMemberApi } from './shutdown.js';

export interface StartableMemberApi {
  listen(options: { readonly host: string; readonly port: number }): Promise<unknown>;
}

export function createProductionRuntimeDependencies(
  config: MemberApiConfig,
): MemberApiDependencies {
  const firebaseApp = initializeApp({
    projectId: config.projectId,
    credential: applicationDefault(),
  });
  const firestore = createFirestore(config.firestore);
  return {
    tokenVerifier: new FirebaseIdTokenVerifier(getAuth(firebaseApp)),
    deviceNameService: new DeviceNameService(
      new FirestoreDeviceNameRepository(firestore),
    ),
  };
}

export async function startMemberApiServer<TApp extends StartableMemberApi>({
  environment,
  createRuntimeDependencies,
  buildApplication,
}: {
  readonly environment: NodeJS.ProcessEnv;
  readonly createRuntimeDependencies: (
    config: MemberApiConfig,
  ) => MemberApiDependencies;
  readonly buildApplication: (options: MemberApiAppOptions) => TApp;
}): Promise<TApp> {
  const config = readProductionConfig(environment);
  const dependencies = createRuntimeDependencies(config);
  const app = buildApplication({
    dependencies,
    allowedOrigin: config.allowedOrigin,
    logger: true,
  });
  await app.listen({ host: '0.0.0.0', port: config.port });
  return app;
}

async function runCli(): Promise<void> {
  const app = await startMemberApiServer({
    environment: process.env,
    createRuntimeDependencies: createProductionRuntimeDependencies,
    buildApplication: buildApp,
  });

  function shutdown(): void {
    void closeMemberApi(app, () => {
      app.log.error('Member API shutdown failed');
      process.exitCode = 1;
    });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
