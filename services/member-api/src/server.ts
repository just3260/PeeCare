import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Firestore } from '@google-cloud/firestore';
import { createSecretKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  buildApp,
  type MemberApiAppOptions,
  type MemberApiDependencies,
  type MemberTokenVerifier,
} from './app.js';
import { ClaimService } from './claims/claim-service.js';
import { createPairCodeProtector } from './claims/pair-code.js';
import { readProductionConfig, type MemberApiConfig } from './config.js';
import { DeviceNameService } from './devices/device-name-service.js';
import { FirestoreDeviceClaimRepository } from './firestore/device-claim-repository.js';
import { createFirestore } from './firestore/firestore-client.js';
import { FirestoreDeviceNameRepository } from './firestore/device-name-repository.js';
import { EmqxClaimAuthenticator } from './security/emqx-claim-auth.js';
import { FirebaseIdTokenVerifier } from './security/firebase-id-token-verifier.js';
import { closeMemberApi } from './shutdown.js';

export interface StartableMemberApi {
  listen(options: { readonly host: string; readonly port: number }): Promise<unknown>;
}

export function composeMemberApiRuntimeDependencies({
  config,
  tokenVerifier,
  firestore,
}: {
  readonly config: MemberApiConfig;
  readonly tokenVerifier: MemberTokenVerifier;
  readonly firestore: Firestore;
}): MemberApiDependencies {
  const pairCodeProtector = createPairCodeProtector({
    codeKeyVersion: config.claim.pairCodeHmacKeyVersion,
    hmacKey: createSecretKey(Buffer.from(config.claim.pairCodeHmacKey, 'utf8')),
  });
  const claimRepository = new FirestoreDeviceClaimRepository(
    firestore,
    pairCodeProtector,
  );
  const claimService = new ClaimService({ repository: claimRepository });

  return {
    tokenVerifier,
    deviceNameService: new DeviceNameService(
      new FirestoreDeviceNameRepository(firestore),
    ),
    claimService,
    emqxClaimAuthenticator: new EmqxClaimAuthenticator(config.claim.webhookSecret),
    emqxClaimSharedUsername: config.claim.sharedMqttUsername,
  };
}

export function createProductionRuntimeDependencies(
  config: MemberApiConfig,
): MemberApiDependencies {
  const firebaseApp = initializeApp({
    projectId: config.projectId,
    credential: applicationDefault(),
  });
  const firestore = createFirestore(config.firestore);
  return composeMemberApiRuntimeDependencies({
    config,
    tokenVerifier: new FirebaseIdTokenVerifier(getAuth(firebaseApp)),
    firestore,
  });
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
