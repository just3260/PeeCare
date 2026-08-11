import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, getApps } from 'firebase-admin/app';

import type { TestToolApiDependencies } from '../src/app.js';
import {
  APPROVED_INGESTION_ORIGIN,
  APPROVED_PROJECT_ID,
  APPROVED_WEB_ORIGIN,
  readProductionConfig,
} from '../src/config.js';
import {
  createProductionRuntimeDependencies,
  startTestToolApiServer,
} from '../src/server.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function secretFile(contents = 'mounted-secret\n'): string {
  const directory = mkdtempSync(join(tmpdir(), 'peecare-test-tool-server-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'secret');
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

function dependencies(): TestToolApiDependencies {
  return {
    tokenVerifier: { verifyAuthorizationHeader: vi.fn() },
    repository: { listTestDevices: vi.fn(), submitTestEvent: vi.fn() },
  };
}

describe('Test Tool API server startup boundary', () => {
  it('revalidates a replaced secret before initializing Firebase', async () => {
    await Promise.all(getApps().map((app) => deleteApp(app)));
    const path = secretFile();
    const config = readProductionConfig(
      productionEnv({ PEECARE_INGESTION_SECRET_FILE: path }),
    );
    chmodSync(path, 0o600);
    writeFileSync(path, '密碼', { mode: 0o600 });
    chmodSync(path, 0o400);

    expect(() => createProductionRuntimeDependencies(config)).toThrow();
    expect(getApps()).toHaveLength(0);
  });

  it.each(['密碼', 'secret with spaces'])(
    'rejects an unsafe mounted secret before Firebase, app construction, or listen',
    async (contents) => {
      const createRuntimeDependencies = vi.fn(() => dependencies());
      const listen = vi.fn();
      const buildApplication = vi.fn(() => ({ listen }));

      await expect(
        startTestToolApiServer({
          environment: productionEnv({ PEECARE_INGESTION_SECRET_FILE: secretFile(contents) }),
          createRuntimeDependencies,
          buildApplication,
        }),
      ).rejects.toBeInstanceOf(Error);

      expect(createRuntimeDependencies).not.toHaveBeenCalled();
      expect(buildApplication).not.toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing project', { GOOGLE_CLOUD_PROJECT: undefined }],
    ['non-production mode', { NODE_ENV: 'development' }],
    ['foreign Web origin', { PEECARE_WEB_ORIGIN: 'https://attacker.invalid' }],
    ['foreign Ingestion origin', { PEECARE_INGESTION_ORIGIN: 'https://attacker.invalid' }],
    ['service-account key', { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }],
    ['Firestore Emulator', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }],
    ['missing secret file', { PEECARE_INGESTION_SECRET_FILE: '/does/not/exist' }],
  ])(
    'fails on %s before Firebase, app construction, or listen',
    async (_case, override) => {
      const createRuntimeDependencies = vi.fn(() => dependencies());
      const listen = vi.fn();
      const buildApplication = vi.fn(() => ({ listen }));

      await expect(
        startTestToolApiServer({
          environment: productionEnv(override),
          createRuntimeDependencies,
          buildApplication,
        }),
      ).rejects.toBeInstanceOf(Error);

      expect(createRuntimeDependencies).not.toHaveBeenCalled();
      expect(buildApplication).not.toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
    },
  );

  it('creates Firebase dependencies only after validation and listens on the platform port', async () => {
    const runtimeDependencies = dependencies();
    const createRuntimeDependencies = vi.fn(() => runtimeDependencies);
    const listen = vi.fn(async () => 'http://0.0.0.0:8080');
    const app = { listen };
    const buildApplication = vi.fn(() => app);
    const environment = productionEnv();

    await expect(
      startTestToolApiServer({
        environment,
        createRuntimeDependencies,
        buildApplication,
      }),
    ).resolves.toBe(app);

    expect(createRuntimeDependencies).toHaveBeenCalledWith({
      environment: 'production',
      projectId: APPROVED_PROJECT_ID,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      ingestionOrigin: APPROVED_INGESTION_ORIGIN,
      ingestionSecretFile: environment.PEECARE_INGESTION_SECRET_FILE,
      enabled: true,
      port: 8080,
    });
    expect(buildApplication).toHaveBeenCalledWith({
      dependencies: runtimeDependencies,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
      logger: true,
    });
    expect(listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 8080 });
  });

  it('starts in fail-closed disabled mode while keeping health available', async () => {
    const runtimeDependencies = dependencies();
    const createRuntimeDependencies = vi.fn(() => runtimeDependencies);
    const listen = vi.fn(async () => undefined);
    const buildApplication = vi.fn(() => ({ listen }));

    await startTestToolApiServer({
      environment: productionEnv({ PEECARE_TEST_TOOL_ENABLED: undefined }),
      createRuntimeDependencies,
      buildApplication,
    });

    expect(buildApplication).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(listen).toHaveBeenCalledOnce();
  });
});
