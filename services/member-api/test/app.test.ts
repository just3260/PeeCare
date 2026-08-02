import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildApp,
  type MemberApiAppOptions,
  type MemberApiDependencies,
} from '../src/app.js';
import { InvalidCustomNameError } from '../src/devices/custom-name.js';
import { DeviceNotFoundError } from '../src/firestore/device-name-repository.js';
import { PersistenceUnavailableError } from '../src/http/errors.js';
import {
  FirebaseIdTokenVerifier,
  MemberAuthenticationError,
} from '../src/security/firebase-id-token-verifier.js';

const ALLOWED_ORIGIN = 'https://app.peecare.test';

function createDependencies(): MemberApiDependencies {
  return {
    tokenVerifier: {
      verifyAuthorizationHeader: vi.fn(async () => {
        throw new Error('token verifier must not be called by an unregistered route');
      }),
    },
    deviceNameService: {
      updateDisplayName: vi.fn(async () => {
        throw new Error('device-name service must not be called by an unregistered route');
      }),
    },
  };
}

describe('Member API application boundary', () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp() {
    const dependencies = createDependencies();
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);
    return { app, dependencies };
  }

  it('returns the canonical health response', async () => {
    const { app } = createApp();

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for an unknown route', async () => {
    const { app } = createApp();

    const response = await app.inject({ method: 'GET', url: '/not-registered' });

    expect(response.statusCode).toBe(404);
  });

  it('does not register or delegate the ingestion endpoint', async () => {
    const { app, dependencies } = createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/emqx/events',
      headers: { authorization: 'Bearer ingestion-secret' },
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(dependencies.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(dependencies.deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'Basic malformed-token'],
    ['expired', 'Bearer expired-token'],
    ['revoked', 'Bearer revoked-token'],
    ['invalid', 'Bearer invalid-token'],
  ])('returns the same unauthorized response for a %s token without invoking the service', async (
    _case,
    authorization,
  ) => {
    const firebaseAuth = {
      verifyIdToken: vi.fn(async (token: string) => {
        throw Object.assign(new Error('Firebase must not leak this detail'), {
          code:
            token === 'expired-token'
              ? 'auth/id-token-expired'
              : token === 'revoked-token'
                ? 'auth/id-token-revoked'
                : 'auth/argument-error',
        });
      }),
    };
    const dependencies: MemberApiDependencies = {
      ...createDependencies(),
      tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
    };
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: authorization === undefined ? undefined : { authorization },
      payload: { customName: '主浴室' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: 'unauthorized',
        requestId: expect.any(String),
      },
    });
    expect(dependencies.deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  function createAuthorizedApp(options: {
    serviceResult?: { deviceId: string; customName: string | null; displayName: string };
    serviceError?: Error;
    logSink?: (entry: unknown) => void;
    logger?: MemberApiAppOptions['logger'];
  } = {}) {
    const tokenVerifier = {
      verifyAuthorizationHeader: vi.fn(async () => ({ uid: 'member-001' })),
    };
    const deviceNameService = {
      updateDisplayName: options.serviceError
        ? vi.fn(async () => Promise.reject(options.serviceError))
        : vi.fn(async () =>
            (options.serviceResult ?? {
              deviceId: 'PC-000001',
              customName: '主浴室',
              displayName: '主浴室',
            })),
    };
    const app = buildApp({
      dependencies: { tokenVerifier, deviceNameService },
      allowedOrigin: ALLOWED_ORIGIN,
      logSink: options.logSink,
      logger: options.logger,
    });
    apps.push(app);
    return { app, tokenVerifier, deviceNameService };
  }

  function expectCanonicalError(response: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>, code: string) {
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.json()).toEqual({
      error: { code, requestId: response.headers['x-request-id'] },
    });
  }

  it('returns the canonical saved-name response and delegates exactly once', async () => {
    const { app, tokenVerifier, deviceNameService } = createAuthorizedApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      payload: { customName: '主浴室' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deviceId: 'PC-000001',
      customName: '主浴室',
      displayName: '主浴室',
    });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(tokenVerifier.verifyAuthorizationHeader).toHaveBeenCalledExactlyOnceWith(
      'Bearer valid-token',
    );
    expect(deviceNameService.updateDisplayName).toHaveBeenCalledExactlyOnceWith({
      memberUid: 'member-001',
      deviceId: 'PC-000001',
      customName: '主浴室',
    });
  });

  it('returns the canonical cleared-name response exactly', async () => {
    const { app } = createAuthorizedApp({
      serviceResult: { deviceId: 'PC-000001', customName: null, displayName: 'PC-000001' },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: { authorization: 'Bearer valid-token' },
      payload: { customName: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deviceId: 'PC-000001',
      customName: null,
      displayName: 'PC-000001',
    });
  });

  it.each([
    ['missing property', {}],
    ['extra property', { customName: '主浴室', ownerUid: 'member-999' }],
    ['wrong property type', { customName: 123 }],
    ['array body', [{ customName: '主浴室' }]],
    ['null body', 'null'],
  ])('rejects an invalid exact request shape: %s', async (_case, payload) => {
    const { app, deviceNameService } = createAuthorizedApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', '/v1/devices//display-name'],
    ['invalid first character', '/v1/devices/_PC-000001/display-name'],
    ['encoded slash', '/v1/devices/PC-000001%2Fchild/display-name'],
    ['129 characters', `/v1/devices/${'P'.repeat(129)}/display-name`],
    ['257 characters', `/v1/devices/${'P'.repeat(257)}/display-name`],
    ['malformed percent encoding', '/v1/devices/PC-%ZZ/display-name'],
  ])('rejects an unsafe device identifier: %s', async (_case, url) => {
    const { app, tokenVerifier, deviceNameService } = createAuthorizedApp();
    const response = await app.inject({
      method: 'PATCH',
      url,
      headers: { authorization: 'Bearer valid-token' },
      payload: { customName: '主浴室' },
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_device_id');
    expect(tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/jsonx'])('rejects Content-Type %s', async (contentType) => {
    const { app, deviceNameService } = createAuthorizedApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': contentType,
      },
      payload: '{"customName":"主浴室"}',
    });

    expect(response.statusCode).toBe(415);
    expectCanonicalError(response, 'unsupported_media_type');
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const { app, deviceNameService } = createAuthorizedApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      payload: '{"customName":',
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'malformed_json');
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it('rejects a JSON body larger than 8 KiB', async () => {
    const { app, deviceNameService } = createAuthorizedApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: { authorization: 'Bearer valid-token' },
      payload: { customName: '大'.repeat(8192) },
    });

    expect(response.statusCode).toBe(413);
    expectCanonicalError(response, 'body_too_large');
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST', 'DELETE'] as const)('returns method_not_allowed for %s', async (method) => {
    const { app, deviceNameService } = createAuthorizedApp();
    const response = await app.inject({
      method,
      url: '/v1/devices/PC-000001/display-name',
    });

    expect(response.statusCode).toBe(405);
    expectCanonicalError(response, 'method_not_allowed');
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it.each([
    [new InvalidCustomNameError(), 400, 'invalid_custom_name'],
    [new DeviceNotFoundError(), 404, 'device_not_found'],
    [new PersistenceUnavailableError(), 503, 'persistence_unavailable'],
    [new Error('private persistence detail'), 500, 'internal_error'],
  ] as const)('maps a service failure to its stable response', async (error, status, code) => {
    const { app, deviceNameService } = createAuthorizedApp({ serviceError: error });
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: { authorization: 'Bearer valid-token' },
      payload: { customName: '主浴室' },
    });

    expect(response.statusCode).toBe(status);
    expectCanonicalError(response, code);
    expect(deviceNameService.updateDisplayName).toHaveBeenCalledTimes(1);
    expect(response.body).not.toContain('private persistence detail');
  });

  it('permits the configured Web origin preflight for the PATCH endpoint', async () => {
    const { app, tokenVerifier, deviceNameService } = createAuthorizedApp();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe('PATCH');
    expect(response.headers['access-control-allow-headers']).toBe('authorization, content-type');
    expect(response.headers.vary).toContain('Origin');
    expect(tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it('does not emit CORS permission for a foreign origin', async () => {
    const { app } = createAuthorizedApp();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'PATCH',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers.vary).toContain('Origin');
  });

  it('does not trust an allowed origin as authentication', async () => {
    const dependencies: MemberApiDependencies = {
      tokenVerifier: {
        verifyAuthorizationHeader: vi.fn(async () => {
          throw new MemberAuthenticationError();
        }),
      },
      deviceNameService: { updateDisplayName: vi.fn() },
    };
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      payload: { customName: '主浴室' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(dependencies.deviceNameService.updateDisplayName).not.toHaveBeenCalled();
  });

  it('logs sanitized success and failure outcomes correlated by request ID', async () => {
    const successLogs: unknown[] = [];
    const success = createAuthorizedApp({ logSink: (entry) => successLogs.push(entry) });
    const successResponse = await success.app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        authorization: 'Bearer raw-secret-token',
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      payload: { customName: '私密浴室名稱' },
    });

    const failureLogs: unknown[] = [];
    const failure = createAuthorizedApp({
      serviceError: new Error('private Firestore detail'),
      logSink: (entry) => failureLogs.push(entry),
    });
    const failureResponse = await failure.app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        authorization: 'Bearer another-secret-token',
        'content-type': 'application/json',
      },
      payload: { customName: '另一個私密名稱' },
    });

    expect(successLogs).toContainEqual({
      requestId: successResponse.headers['x-request-id'],
      statusCode: 200,
      outcome: 'request_complete',
    });
    expect(failureLogs).toContainEqual({
      requestId: failureResponse.headers['x-request-id'],
      statusCode: 500,
      outcome: 'request_complete',
    });
    const serializedLogs = JSON.stringify([...successLogs, ...failureLogs]);
    for (const sensitive of [
      'raw-secret-token',
      'another-secret-token',
      'Authorization',
      'authorization',
      'customName',
      '私密浴室名稱',
      '另一個私密名稱',
      'private Firestore detail',
    ]) {
      expect(serializedLogs).not.toContain(sensitive);
    }
  });

  it('keeps the production logger stream free of request and error secrets', async () => {
    const lines: string[] = [];
    const logger = {
      level: 'info',
      stream: { write: (line: string) => lines.push(line) },
    };
    const success = createAuthorizedApp({ logger });
    const successResponse = await success.app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        authorization: 'Bearer production-secret-token',
        'content-type': 'application/json',
      },
      payload: { customName: 'production 私密名稱' },
    });
    const failure = createAuthorizedApp({
      logger,
      serviceError: new Error('production private Firestore detail'),
    });
    const failureResponse = await failure.app.inject({
      method: 'PATCH',
      url: '/v1/devices/PC-000001/display-name',
      headers: {
        authorization: 'Bearer failure-secret-token',
        'content-type': 'application/json',
      },
      payload: { customName: 'failure 私密名稱' },
    });

    const serialized = lines.join('');
    expect(serialized).toContain(successResponse.headers['x-request-id'] as string);
    expect(serialized).toContain(failureResponse.headers['x-request-id'] as string);
    expect(serialized).toContain('"statusCode":200');
    expect(serialized).toContain('"statusCode":500');
    for (const sensitive of [
      'production-secret-token',
      'failure-secret-token',
      'authorization',
      'customName',
      'production 私密名稱',
      'failure 私密名稱',
      'production private Firestore detail',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it.each([
    '',
    'javascript:alert(1)',
    'https://user:password@app.peecare.test',
    'https://app.peecare.test/path',
    'https://app.peecare.test?query=1',
  ])('rejects an unsafe configured origin %j', (allowedOrigin) => {
    expect(() => buildApp({ dependencies: createDependencies(), allowedOrigin })).toThrow(
      'allowed Web origin',
    );
  });
});
