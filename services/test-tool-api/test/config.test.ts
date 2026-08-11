import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  APPROVED_INGESTION_ORIGIN,
  APPROVED_PROJECT_ID,
  APPROVED_WEB_ORIGIN,
  readProductionConfig,
} from '../src/config.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function secretFile(contents = 'mounted-development-secret\n'): string {
  const directory = mkdtempSync(join(tmpdir(), 'peecare-test-tool-config-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'ingestion-secret');
  writeFileSync(path, contents, { mode: 0o400 });
  chmodSync(path, 0o400);
  return path;
}

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GOOGLE_CLOUD_PROJECT: APPROVED_PROJECT_ID,
    PEECARE_WEB_ORIGIN: APPROVED_WEB_ORIGIN,
    PEECARE_INGESTION_ORIGIN: APPROVED_INGESTION_ORIGIN,
    PEECARE_INGESTION_SECRET_FILE: secretFile(),
    PEECARE_TEST_TOOL_ENABLED: 'true',
    PORT: '8080',
    ...overrides,
  };
}

describe('Test Tool API production configuration', () => {
  it('returns only the validated runtime contract without secret contents', () => {
    const env = productionEnv();

    const config = readProductionConfig(env);

    expect(config).toEqual({
      environment: 'production',
      projectId: APPROVED_PROJECT_ID,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      ingestionOrigin: APPROVED_INGESTION_ORIGIN,
      ingestionSecretFile: env.PEECARE_INGESTION_SECRET_FILE,
      enabled: true,
      port: 8080,
    });
    expect(JSON.stringify(config)).not.toContain('mounted-development-secret');
  });

  it.each([
    ['NODE_ENV', { NODE_ENV: undefined }],
    ['project', { GOOGLE_CLOUD_PROJECT: undefined }],
    ['Web origin', { PEECARE_WEB_ORIGIN: undefined }],
    ['Ingestion origin', { PEECARE_INGESTION_ORIGIN: undefined }],
    ['secret file', { PEECARE_INGESTION_SECRET_FILE: undefined }],
  ])('rejects missing %s', (_case, override) => {
    expect(() => readProductionConfig(productionEnv(override))).toThrow();
  });

  it.each([
    ['wrong project', { GOOGLE_CLOUD_PROJECT: 'peecare-staging' }],
    ['Web origin subdomain', { PEECARE_WEB_ORIGIN: 'https://beta.petcare-c7483.web.app' }],
    ['Web origin path', { PEECARE_WEB_ORIGIN: `${APPROVED_WEB_ORIGIN}/test-tool` }],
    ['Web origin credentials', { PEECARE_WEB_ORIGIN: 'https://u:p@petcare-c7483.web.app' }],
    ['HTTP Web origin', { PEECARE_WEB_ORIGIN: 'http://petcare-c7483.web.app' }],
    [
      'wrong Ingestion service',
      { PEECARE_INGESTION_ORIGIN: 'https://peecare-ingestion-staging-348528459946.asia-east1.run.app' },
    ],
    [
      'Ingestion origin path',
      { PEECARE_INGESTION_ORIGIN: `${APPROVED_INGESTION_ORIGIN}/v1/emqx/events` },
    ],
    ['HTTP Ingestion origin', { PEECARE_INGESTION_ORIGIN: APPROVED_INGESTION_ORIGIN.replace('https:', 'http:') }],
    ['zero port', { PORT: '0' }],
    ['non-integer port', { PORT: '8080.5' }],
    ['out-of-range port', { PORT: '65536' }],
  ])('rejects %s without reflecting its value', (_case, override) => {
    expect(() => readProductionConfig(productionEnv(override))).toThrow();
  });

  it.each([
    ['Firestore Emulator', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }],
    ['Auth Emulator', { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }],
    ['service-account key', { GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/firebase.json' }],
    ['direct current secret', { EMQX_WEBHOOK_SECRET_CURRENT: 'secret' }],
    ['direct previous secret', { EMQX_WEBHOOK_SECRET_PREVIOUS: '' }],
  ])('rejects unsafe %s coupling', (_case, override) => {
    expect(() => readProductionConfig(productionEnv(override))).toThrow();
  });

  it.each([undefined, '', 'false', 'TRUE', '1', ' true '])(
    'fails the enable switch closed for %j',
    (enabled) => {
      expect(
        readProductionConfig(productionEnv({ PEECARE_TEST_TOOL_ENABLED: enabled })).enabled,
      ).toBe(false);
    },
  );

  it('defaults to the Cloud Run application port', () => {
    expect(readProductionConfig(productionEnv({ PORT: undefined })).port).toBe(8080);
  });

  it('accepts the exact owner-only read-only mode produced by Cloud Run', () => {
    const path = secretFile();
    chmodSync(path, 0o400);

    expect(
      readProductionConfig(
        productionEnv({ PEECARE_INGESTION_SECRET_FILE: path }),
      ).ingestionSecretFile,
    ).toBe(path);
  });

  it('rejects a relative secret path', () => {
    expect(() =>
      readProductionConfig(productionEnv({ PEECARE_INGESTION_SECRET_FILE: 'secret.txt' })),
    ).toThrow('secret file');
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \n\t'],
    ['non-ASCII', '密碼'],
    ['embedded whitespace', 'secret with spaces'],
  ])('rejects a %s mounted secret', (_case, contents) => {
    expect(() =>
      readProductionConfig(
        productionEnv({ PEECARE_INGESTION_SECRET_FILE: secretFile(contents) }),
      ),
    ).toThrow('secret file');
  });

  it.each([0o600, 0o640, 0o644, 0o666])(
    'rejects mounted secret mode %s instead of exact 0400',
    (mode) => {
      const path = secretFile();
      chmodSync(path, mode);
      expect(() =>
        readProductionConfig(productionEnv({ PEECARE_INGESTION_SECRET_FILE: path })),
      ).toThrow('0400');
    },
  );

  it('rejects a symlink even when its target is an operator-only secret file', () => {
    const target = secretFile();
    const link = `${target}-link`;
    symlinkSync(target, link);

    expect(() =>
      readProductionConfig(productionEnv({ PEECARE_INGESTION_SECRET_FILE: link })),
    ).toThrow('secret file');
  });

  it('does not include the unsafe value in a configuration error', () => {
    const unsafe = 'https://attacker.invalid/private-value';

    expect(() => readProductionConfig(productionEnv({ PEECARE_WEB_ORIGIN: unsafe }))).toThrow(
      /^PEECARE_WEB_ORIGIN is not approved\.$/,
    );
  });
});
