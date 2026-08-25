import { describe, expect, it } from 'vitest';

import {
  MEMBER_API_DEPLOYMENT_CONTRACT,
  readConfig,
  readProductionConfig,
} from '../src/config.js';

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GOOGLE_CLOUD_PROJECT: 'peecare-development',
    PEECARE_WEB_ORIGIN: 'https://app.peecare.test',
    PEECARE_CLAIM_WEBHOOK_SECRET: 'claim-webhook-secret-not-for-production',
    PEECARE_PAIR_CODE_HMAC_KEY: 'pair-code-hmac-key-with-32-bytes-minimum',
    PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '7',
    PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'approved-legacy-device',
    PORT: '8080',
    ...overrides,
  };
}

describe('Member API runtime configuration', () => {
  it('defaults the local runtime to the dedicated Member API port', () => {
    expect(
      readConfig(
        productionEnv({
          NODE_ENV: 'development',
          GOOGLE_CLOUD_PROJECT: 'demo-peecare',
          PEECARE_WEB_ORIGIN: 'http://127.0.0.1:5173',
          PORT: undefined,
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
          FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        }),
      ).port,
    ).toBe(8087);
  });

  it('returns the complete production runtime contract', () => {
    expect(readConfig(productionEnv())).toEqual({
      environment: 'production',
      projectId: 'peecare-development',
      allowedOrigin: 'https://app.peecare.test',
      port: 8080,
      firestore: { projectId: 'peecare-development' },
      claim: {
        webhookSecret: 'claim-webhook-secret-not-for-production',
        pairCodeHmacKey: 'pair-code-hmac-key-with-32-bytes-minimum',
        pairCodeHmacKeyVersion: '7',
        sharedMqttUsername: 'approved-legacy-device',
      },
    });
  });

  it.each([
    ['project', { GOOGLE_CLOUD_PROJECT: undefined }],
    ['origin', { PEECARE_WEB_ORIGIN: undefined }],
    ['Claim webhook secret', { PEECARE_CLAIM_WEBHOOK_SECRET: undefined }],
    ['Pair Code HMAC key', { PEECARE_PAIR_CODE_HMAC_KEY: undefined }],
    ['Pair Code HMAC key version', { PEECARE_PAIR_CODE_HMAC_KEY_VERSION: undefined }],
    ['Claim shared MQTT username', { PEECARE_CLAIM_SHARED_MQTT_USERNAME: undefined }],
  ])('rejects missing %s before constructing runtime clients', (_field, override) => {
    expect(() => readConfig(productionEnv(override))).toThrow('required');
  });

  it.each([
    ['Claim webhook secret', { PEECARE_CLAIM_WEBHOOK_SECRET: '' }],
    ['Pair Code HMAC key', { PEECARE_PAIR_CODE_HMAC_KEY: '' }],
    ['Pair Code HMAC key version', { PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '' }],
    ['Claim shared MQTT username', { PEECARE_CLAIM_SHARED_MQTT_USERNAME: '' }],
  ])('rejects empty %s before constructing runtime clients', (_field, override) => {
    expect(() => readConfig(productionEnv(override))).toThrow('required');
  });

  it.each(['0', '-1', '1.0', 'latest', '01', ' 7']) (
    'rejects invalid Pair Code HMAC key version %j',
    (pairCodeHmacKeyVersion) => {
      expect(() =>
        readConfig(
          productionEnv({ PEECARE_PAIR_CODE_HMAC_KEY_VERSION: pairCodeHmacKeyVersion }),
        ),
      ).toThrow('positive numeric');
    },
  );

  it('rejects equal Claim webhook and Pair Code HMAC credentials', () => {
    const reusedCredential = 'reused-claim-credential-with-32-bytes';
    expect(() =>
      readConfig(
        productionEnv({
          PEECARE_CLAIM_WEBHOOK_SECRET: reusedCredential,
          PEECARE_PAIR_CODE_HMAC_KEY: reusedCredential,
        }),
      ),
    ).toThrow('must be independent');
  });

  it('rejects a Pair Code HMAC key shorter than 32 UTF-8 bytes', () => {
    expect(() =>
      readConfig(productionEnv({ PEECARE_PAIR_CODE_HMAC_KEY: 'too-short' })),
    ).toThrow('32 bytes');
  });

  it.each(['has whitespace', ' leading', 'trailing ', 'line\nbreak']) (
    'rejects invalid Claim webhook secret %j',
    (webhookSecret) => {
      expect(() =>
        readConfig(productionEnv({ PEECARE_CLAIM_WEBHOOK_SECRET: webhookSecret })),
      ).toThrow('token');
    },
  );

  it.each(['contains space', '-leading-dash', 'a'.repeat(129)]) (
    'rejects invalid Claim shared MQTT username %j',
    (sharedMqttUsername) => {
      expect(() =>
        readConfig(
          productionEnv({ PEECARE_CLAIM_SHARED_MQTT_USERNAME: sharedMqttUsername }),
        ),
      ).toThrow('legacy identity');
    },
  );

  it.each([
    ['invalid project', { GOOGLE_CLOUD_PROJECT: 'INVALID_PROJECT' }],
    ['five-character project', { GOOGLE_CLOUD_PROJECT: 'abcde' }],
    ['project ending in a hyphen', { GOOGLE_CLOUD_PROJECT: 'abcde-' }],
    ['31-character project', { GOOGLE_CLOUD_PROJECT: `a${'b'.repeat(30)}` }],
    ['origin with path', { PEECARE_WEB_ORIGIN: 'https://app.peecare.test/path' }],
    ['origin with credentials', { PEECARE_WEB_ORIGIN: 'https://u:p@app.peecare.test' }],
    ['non-HTTP origin', { PEECARE_WEB_ORIGIN: 'javascript:alert(1)' }],
    ['zero port', { PORT: '0' }],
    ['out-of-range port', { PORT: '65536' }],
  ])('rejects %s fail closed', (_case, override) => {
    expect(() => readConfig(productionEnv(override))).toThrow();
  });

  it.each(['abcdef', `a${'b'.repeat(29)}`])('accepts valid project ID boundary %s', (projectId) => {
    expect(readConfig(productionEnv({ GOOGLE_CLOUD_PROJECT: projectId })).projectId).toBe(projectId);
  });

  it.each(['prod', 'Production', 'staging', ''])('rejects unknown NODE_ENV value %j', (nodeEnv) => {
    expect(() => readConfig(productionEnv({ NODE_ENV: nodeEnv }))).toThrow('NODE_ENV');
  });

  it.each(['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) (
    'rejects production %s before client initialization',
    (key) => {
      expect(() => readConfig(productionEnv({ [key]: '127.0.0.1:8085' }))).toThrow(
        'production',
      );
    },
  );

  it.each(['EMQX_WEBHOOK_SECRET_CURRENT', 'EMQX_WEBHOOK_SECRET_PREVIOUS', 'EMQX_WEBHOOK_SECRET']) (
    'rejects ingestion secret coupling through %s even when empty',
    (key) => {
      expect(() => readConfig(productionEnv({ [key]: '' }))).toThrow('ingestion secret');
    },
  );

  it('rejects service-account key configuration so production uses ADC', () => {
    expect(() =>
      readConfig(
        productionEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/key.json' }),
      ),
    ).toThrow('Application Default Credentials');
  });

  it('does not accept the legacy GCLOUD_PROJECT alias', () => {
    expect(() =>
      readConfig(
        productionEnv({
          GOOGLE_CLOUD_PROJECT: undefined,
          GCLOUD_PROJECT: 'petcare-c7483',
        }),
      ),
    ).toThrow('GOOGLE_CLOUD_PROJECT');
  });

  it.each([undefined, 'development', 'test', 'staging'])(
    'requires NODE_ENV=production at the deployed server boundary: %j',
    (nodeEnv) => {
      expect(() =>
        readProductionConfig(productionEnv({ NODE_ENV: nodeEnv })),
      ).toThrow('NODE_ENV=production');
    },
  );

  it('accepts only the exact production application environment contract', () => {
    expect(readProductionConfig(productionEnv())).toEqual({
      environment: 'production',
      projectId: 'peecare-development',
      allowedOrigin: 'https://app.peecare.test',
      port: 8080,
      firestore: { projectId: 'peecare-development' },
      claim: {
        webhookSecret: 'claim-webhook-secret-not-for-production',
        pairCodeHmacKey: 'pair-code-hmac-key-with-32-bytes-minimum',
        pairCodeHmacKeyVersion: '7',
        sharedMqttUsername: 'approved-legacy-device',
      },
    });
  });

  it('accepts explicit loopback Emulators only outside production', () => {
    expect(
      readConfig(
        productionEnv({
          NODE_ENV: 'development',
          GOOGLE_CLOUD_PROJECT: 'demo-peecare',
          PEECARE_WEB_ORIGIN: 'http://127.0.0.1:5173',
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
          FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        }),
      ),
    ).toEqual({
      environment: 'local',
      projectId: 'demo-peecare',
      allowedOrigin: 'http://127.0.0.1:5173',
      port: 8080,
      firestore: { projectId: 'demo-peecare', emulatorHost: '127.0.0.1:8085' },
      claim: {
        webhookSecret: 'claim-webhook-secret-not-for-production',
        pairCodeHmacKey: 'pair-code-hmac-key-with-32-bytes-minimum',
        pairCodeHmacKeyVersion: '7',
        sharedMqttUsername: 'approved-legacy-device',
      },
    });
  });

  it.each(['localhost:8085', '0.0.0.0:8085', '127.0.0.1:0', '127.0.0.1:65536']) (
    'rejects unsafe local Emulator host %s',
    (emulatorHost) => {
      expect(() =>
        readConfig(
          productionEnv({
            NODE_ENV: 'development',
            FIRESTORE_EMULATOR_HOST: emulatorHost,
          }),
        ),
      ).toThrow('loopback');
    },
  );

  it('publishes the scale-to-zero deployment handoff without a shared identity', () => {
    expect(MEMBER_API_DEPLOYMENT_CONTRACT).toEqual({
      billing: 'request-based',
      minimumInstances: 0,
      requiresDedicatedServiceAccount: true,
      locationPolicy: 'firestore-compatible',
    });
  });
});
