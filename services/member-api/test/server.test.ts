import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';

import type { MemberApiDependencies } from '../src/app.js';
import { ClaimService } from '../src/claims/claim-service.js';
import type { MemberApiConfig } from '../src/config.js';
import { DeviceNameService } from '../src/devices/device-name-service.js';
import { EmqxClaimAuthenticator } from '../src/security/emqx-claim-auth.js';
import {
  composeMemberApiRuntimeDependencies,
  startMemberApiServer,
} from '../src/server.js';

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
    PEECARE_WEB_ORIGIN: 'https://petcare-c7483.web.app',
    PEECARE_CLAIM_WEBHOOK_SECRET: 'claim-webhook-secret-not-for-production',
    PEECARE_PAIR_CODE_HMAC_KEY: 'pair-code-hmac-key-with-32-bytes-minimum',
    PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '7',
    PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'approved-legacy-device',
    PORT: '8080',
    ...overrides,
  };
}

function dependencies(): MemberApiDependencies {
  return {
    tokenVerifier: { verifyAuthorizationHeader: vi.fn() },
    deviceNameService: { updateDisplayName: vi.fn() },
  };
}

function productionConfig(): MemberApiConfig {
  return {
    environment: 'production',
    projectId: 'petcare-c7483',
    allowedOrigin: 'https://petcare-c7483.web.app',
    port: 8080,
    firestore: { projectId: 'petcare-c7483' },
    claim: {
      webhookSecret: 'claim-webhook-secret-not-for-production',
      pairCodeHmacKey: 'pair-code-hmac-key-with-32-bytes-minimum',
      pairCodeHmacKeyVersion: '7',
      sharedMqttUsername: 'approved-legacy-device',
    },
  };
}

describe('Member API server startup boundary', () => {
  it('composes one Claim service for both mutually exclusive route adapters', () => {
    const tokenVerifier = { verifyAuthorizationHeader: vi.fn() };
    const firestore = {} as Firestore;

    const runtime = composeMemberApiRuntimeDependencies({
      config: productionConfig(),
      tokenVerifier,
      firestore,
    });

    expect(runtime).toEqual({
      tokenVerifier,
      deviceNameService: expect.any(DeviceNameService),
      claimService: expect.any(ClaimService),
      emqxClaimAuthenticator: expect.any(EmqxClaimAuthenticator),
      emqxClaimSharedUsername: 'approved-legacy-device',
    });

    const authenticator = runtime.emqxClaimAuthenticator;
    expect(authenticator).toBeDefined();
    expect(() =>
      authenticator?.assertBodyCredential(
        'Bearer claim-webhook-secret-not-for-production',
      ),
    ).not.toThrow();
    expect(() =>
      authenticator?.assertBodyCredential(
        'Bearer pair-code-hmac-key-with-32-bytes-minimum',
      ),
    ).toThrow();
  });

  it.each([
    ['missing project', { GOOGLE_CLOUD_PROJECT: undefined }],
    ['non-production mode', { NODE_ENV: 'development' }],
    ['service-account key', { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }],
    ['Firestore Emulator', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }],
    ['Ingestion secret', { EMQX_WEBHOOK_SECRET_CURRENT: 'secret' }],
    ['missing Claim webhook secret', { PEECARE_CLAIM_WEBHOOK_SECRET: undefined }],
    ['empty Pair Code HMAC key', { PEECARE_PAIR_CODE_HMAC_KEY: '' }],
    ['equal Claim credentials', {
      PEECARE_CLAIM_WEBHOOK_SECRET: 'reused-claim-credential-with-32-bytes',
      PEECARE_PAIR_CODE_HMAC_KEY: 'reused-claim-credential-with-32-bytes',
    }],
    ['invalid Pair Code HMAC key version', { PEECARE_PAIR_CODE_HMAC_KEY_VERSION: 'latest' }],
    ['invalid Claim shared MQTT username', { PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'not allowed' }],
  ])('fails on %s before Firebase, Firestore, app construction, or listen', async (_case, override) => {
    const createRuntimeDependencies = vi.fn(() => dependencies());
    const listen = vi.fn();
    const buildApplication = vi.fn(() => ({ listen }));

    await expect(
      startMemberApiServer({
        environment: productionEnv(override),
        createRuntimeDependencies,
        buildApplication,
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(createRuntimeDependencies).not.toHaveBeenCalled();
    expect(buildApplication).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it('creates runtime dependencies only after validation and listens on the platform port', async () => {
    const runtimeDependencies = dependencies();
    const createRuntimeDependencies = vi.fn(() => runtimeDependencies);
    const listen = vi.fn(async () => 'http://0.0.0.0:8080');
    const app = { listen };
    const buildApplication = vi.fn(() => app);

    await expect(
      startMemberApiServer({
        environment: productionEnv(),
        createRuntimeDependencies,
        buildApplication,
      }),
    ).resolves.toBe(app);

    expect(createRuntimeDependencies).toHaveBeenCalledWith({
      environment: 'production',
      projectId: 'petcare-c7483',
      allowedOrigin: 'https://petcare-c7483.web.app',
      port: 8080,
      firestore: { projectId: 'petcare-c7483' },
      claim: {
        webhookSecret: 'claim-webhook-secret-not-for-production',
        pairCodeHmacKey: 'pair-code-hmac-key-with-32-bytes-minimum',
        pairCodeHmacKeyVersion: '7',
        sharedMqttUsername: 'approved-legacy-device',
      },
    });
    expect(buildApplication).toHaveBeenCalledWith({
      dependencies: runtimeDependencies,
      allowedOrigin: 'https://petcare-c7483.web.app',
      logger: true,
    });
    expect(listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 8080 });
  });
});
