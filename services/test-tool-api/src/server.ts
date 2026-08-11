import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { pathToFileURL } from 'node:url';

import {
  buildApp,
  type TestToolApiAppOptions,
  type TestToolApiDependencies,
} from './app.js';
import { readProductionConfig, type TestToolApiConfig } from './config.js';
import {
  FirestoreTestToolRepository,
} from './devices/test-device-repository.js';
import { TestEventService } from './events/test-event-service.js';
import { createIngestionClient } from './ingestion/ingestion-client.js';
import { FirebaseIdTokenVerifier } from './security/firebase-id-token-verifier.js';

export interface StartableTestToolApi {
  listen(options: { readonly host: string; readonly port: number }): Promise<unknown>;
}

export function createProductionRuntimeDependencies(
  config: TestToolApiConfig,
): TestToolApiDependencies {
  // Reopen and validate the mounted file before any Firebase side effect. The
  // file may have changed since configuration preflight.
  const ingestionClient = createIngestionClient({
    ingestionOrigin: config.ingestionOrigin,
    ingestionSecretFile: config.ingestionSecretFile,
  });
  const firebaseApp = initializeApp({
    projectId: config.projectId,
    credential: applicationDefault(),
  });
  return {
    tokenVerifier: new FirebaseIdTokenVerifier(getAuth(firebaseApp)),
    repository: new FirestoreTestToolRepository(
      new Firestore({ projectId: config.projectId }),
      new TestEventService(ingestionClient),
    ),
  };
}

export async function startTestToolApiServer<TApp extends StartableTestToolApi>({
  environment,
  createRuntimeDependencies,
  buildApplication,
}: {
  readonly environment: NodeJS.ProcessEnv;
  readonly createRuntimeDependencies: (
    config: TestToolApiConfig,
  ) => TestToolApiDependencies;
  readonly buildApplication: (options: TestToolApiAppOptions) => TApp;
}): Promise<TApp> {
  const config = readProductionConfig(environment);
  const dependencies = createRuntimeDependencies(config);
  const app = buildApplication({
    dependencies,
    allowedOrigin: config.allowedOrigin,
    enabled: config.enabled,
    logger: true,
  });
  await app.listen({ host: '0.0.0.0', port: config.port });
  return app;
}

async function runCli(): Promise<void> {
  const app = await startTestToolApiServer({
    environment: process.env,
    createRuntimeDependencies: createProductionRuntimeDependencies,
    buildApplication: buildApp,
  });

  function shutdown(): void {
    void app.close().catch(() => {
      app.log.error('Test Tool API shutdown failed');
      process.exitCode = 1;
    });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
