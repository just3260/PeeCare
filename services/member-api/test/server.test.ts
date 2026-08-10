import { describe, expect, it, vi } from 'vitest';

import type { MemberApiDependencies } from '../src/app.js';
import { startMemberApiServer } from '../src/server.js';

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
    PEECARE_WEB_ORIGIN: 'https://petcare-c7483.web.app',
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

describe('Member API server startup boundary', () => {
  it.each([
    ['missing project', { GOOGLE_CLOUD_PROJECT: undefined }],
    ['non-production mode', { NODE_ENV: 'development' }],
    ['service-account key', { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }],
    ['Firestore Emulator', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }],
    ['Ingestion secret', { EMQX_WEBHOOK_SECRET_CURRENT: 'secret' }],
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
    });
    expect(buildApplication).toHaveBeenCalledWith({
      dependencies: runtimeDependencies,
      allowedOrigin: 'https://petcare-c7483.web.app',
      logger: true,
    });
    expect(listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 8080 });
  });
});
