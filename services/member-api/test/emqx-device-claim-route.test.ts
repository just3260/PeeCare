import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildApp,
  type MemberApiDependencies,
  type MemberApiLogEntry,
} from '../src/app.js';
import type { ApplyDeviceClaimBindCommand } from '../src/claims/claim-service.js';
import {
  emqxDeviceClaimRoutes,
  type EmqxDeviceClaimRouteDependencies,
} from '../src/claims/emqx-device-claim-route.js';
import type { ApplyClaimBindOutcome } from '../src/firestore/device-claim-repository.js';
import { PersistenceUnavailableError } from '../src/http/errors.js';
import { EmqxClaimAuthenticator } from '../src/security/emqx-claim-auth.js';

const ROUTE = '/v1/emqx/device-claims';
const CLAIM_SECRET = 'claim-webhook-secret';
const SHARED_USERNAME = 'approved-legacy-device';
const PAIR_CODE = '12345678';
const DEVICE_ID = '68E274BD2A58';

function canonicalEvent() {
  return {
    topic: 'peecare/device/1/bind',
    clientId: 'approved-legacy-client',
    username: SHARED_USERNAME,
    qos: 0,
    retained: false,
    brokerReceivedAtMs: 1_786_982_400_123,
    payload: {
      device_id: DEVICE_ID,
      pair_code: PAIR_CODE,
    },
  };
}

function canonicalWrapper(event: unknown = canonicalEvent()) {
  return {
    webhookAuthorization: `Bearer ${CLAIM_SECRET}`,
    event,
  };
}

describe('EMQX device Claim route', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp(options: {
    outcome?: ApplyClaimBindOutcome;
    error?: Error;
    sharedUsername?: string;
  } = {}) {
    const applyBind = options.error
      ? vi.fn<(command: ApplyDeviceClaimBindCommand) => Promise<ApplyClaimBindOutcome>>(
          async () => Promise.reject(options.error),
        )
      : vi.fn<(command: ApplyDeviceClaimBindCommand) => Promise<ApplyClaimBindOutcome>>(
          async () => options.outcome ?? 'claimed',
        );
    const dependencies: EmqxDeviceClaimRouteDependencies = {
      claimService: { applyBind },
      authenticator: new EmqxClaimAuthenticator(CLAIM_SECRET),
      sharedUsername: options.sharedUsername ?? SHARED_USERNAME,
    };
    const app = Fastify({ logger: false, bodyLimit: 8 * 1024 });
    app.register(emqxDeviceClaimRoutes, { dependencies });
    apps.push(app);
    return { app, applyBind };
  }

  function request(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
    return {
      method: 'POST' as const,
      url: ROUTE,
      headers: { 'content-type': 'application/json', ...headers },
      payload,
    };
  }

  function expectCanonicalError(
    response: Awaited<ReturnType<ReturnType<typeof Fastify>['inject']>>,
    code: string,
  ) {
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.json()).toEqual({
      error: { code, requestId: response.headers['x-request-id'] },
    });
  }

  it('accepts the exact canonical bind wrapper and invokes the Claim domain once', async () => {
    const { app, applyBind } = createApp();

    const response = await app.inject(request(canonicalWrapper()));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: 'accepted',
      requestId: response.headers['x-request-id'],
    });
    expect(applyBind).toHaveBeenCalledExactlyOnceWith({
      deviceId: DEVICE_ID,
      pairCode: PAIR_CODE,
    });
  });

  it.each(['', undefined, null])('fails closed for shared username configuration %s', async (sharedUsername) => {
    const applyBind = vi.fn(async () => 'claimed' as const);
    const app = Fastify({ logger: false });
    app.register(emqxDeviceClaimRoutes, {
      dependencies: {
        claimService: { applyBind },
        authenticator: new EmqxClaimAuthenticator(CLAIM_SECRET),
        sharedUsername: sharedUsername as unknown as string,
      },
    });
    apps.push(app);

    await expect(app.ready()).rejects.toThrow(
      'EMQX Claim shared username must be a bounded legacy identity.',
    );
    expect(applyBind).not.toHaveBeenCalled();
  });

  it.each<[
    string,
    Partial<ReturnType<typeof canonicalEvent>>,
  ]>([
    ['QoS 1', { qos: 1 }],
    ['retained true', { retained: true }],
    ['another topic', { topic: 'peecare/device/1/status' }],
    ['invalid clientId', { clientId: 'client id with spaces' }],
    ['empty clientId', { clientId: '' }],
    ['129-character clientId', { clientId: 'c'.repeat(129) }],
    ['negative broker timestamp', { brokerReceivedAtMs: -1 }],
    ['fractional broker timestamp', { brokerReceivedAtMs: 1.5 }],
    ['unsafe integer broker timestamp', { brokerReceivedAtMs: Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong shared username', { username: 'another-publisher' }],
  ])('rejects the canonical event boundary: %s', async (_case, override) => {
    const { app, applyBind } = createApp();
    const response = await app.inject(
      request(canonicalWrapper({ ...canonicalEvent(), ...override })),
    );

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it.each([
    ['device ID too short', { device_id: '68E274BD2A5', pair_code: PAIR_CODE }],
    ['device ID lowercase', { device_id: '68e274bd2a58', pair_code: PAIR_CODE }],
    ['device ID non-hex', { device_id: '68E274BD2A5G', pair_code: PAIR_CODE }],
    ['pair code too short', { device_id: DEVICE_ID, pair_code: '1234567' }],
    ['pair code non-ASCII', { device_id: DEVICE_ID, pair_code: '１２３４５６７８' }],
    ['extra owner identity', { device_id: DEVICE_ID, pair_code: PAIR_CODE, ownerUid: 'member-001' }],
  ])('rejects the exact payload boundary: %s', async (_case, payload) => {
    const { app, applyBind } = createApp();
    const response = await app.inject(
      request(canonicalWrapper({ ...canonicalEvent(), payload })),
    );

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it.each([
    ['extra wrapper property', { ...canonicalWrapper(), extra: true }],
    ['extra event property', { ...canonicalEvent(), extra: true }],
    ['array event', []],
    ['null event', null],
  ])('rejects a malformed exact wrapper or event: %s', async (_case, malformed) => {
    const { app, applyBind } = createApp();
    const payload =
      _case === 'extra wrapper property'
        ? (malformed as Record<string, unknown>)
        : canonicalWrapper(malformed);
    const response = await app.inject(request(payload));

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it.each([
    ['ingestion credential', 'Bearer ingestion-webhook-secret'],
    ['Firebase token', 'Bearer firebase-id-token'],
    ['missing credential', undefined],
  ])('authenticates before event validation and rejects a %s with zero domain calls', async (
    _case,
    webhookAuthorization,
  ) => {
    const { app, applyBind } = createApp();
    const response = await app.inject(
      request({
        webhookAuthorization,
        event: { malformed: true },
      }),
    );

    expect(response.statusCode).toBe(401);
    expectCanonicalError(response, 'unauthorized');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it('rejects the Firebase Authorization transport even with a valid body credential', async () => {
    const { app, applyBind } = createApp();
    const response = await app.inject(
      request(canonicalWrapper(), { authorization: 'Bearer firebase-id-token' }),
    );

    expect(response.statusCode).toBe(401);
    expectCanonicalError(response, 'unauthorized');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it('rejects query parameters after credential authentication with zero domain calls', async () => {
    const { app, applyBind } = createApp();
    const response = await app.inject({
      ...request(canonicalWrapper()),
      url: `${ROUTE}?retry=true`,
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it.each<ApplyClaimBindOutcome>([
    'pending',
    'claimed',
    'expired',
    'failed',
    'conflict',
    'not_found',
    'device_unavailable',
  ])('acknowledges authenticated domain outcome %s without triggering HTTP retry', async (outcome) => {
    const { app, applyBind } = createApp({ outcome });
    const response = await app.inject(request(canonicalWrapper()));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: 'accepted',
      requestId: response.headers['x-request-id'],
    });
    expect(applyBind).toHaveBeenCalledOnce();
  });

  it('maps a temporary persistence failure to a retryable canonical 503', async () => {
    const { app } = createApp({ error: new PersistenceUnavailableError() });
    const response = await app.inject(request(canonicalWrapper()));

    expect(response.statusCode).toBe(503);
    expectCanonicalError(response, 'persistence_unavailable');
  });

  it('maps unexpected domain details to a sanitized canonical 500', async () => {
    const { app } = createApp({ error: new Error(`private ${PAIR_CODE} member-001`) });
    const response = await app.inject(request(canonicalWrapper()));

    expect(response.statusCode).toBe(500);
    expectCanonicalError(response, 'internal_error');
    expect(response.body).not.toContain(PAIR_CODE);
    expect(response.body).not.toContain('member-001');
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)('rejects method %s canonically', async (method) => {
    const { app, applyBind } = createApp();
    const response = await app.inject({ method, url: ROUTE });

    expect(response.statusCode).toBe(405);
    expectCanonicalError(response, 'method_not_allowed');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it.each(['HEAD', 'OPTIONS'] as const)(
    'rejects method %s canonically with a request ID and zero domain calls',
    async (method) => {
      const { app, applyBind } = createApp();
      const response = await app.inject({ method, url: ROUTE });

      expect(response.statusCode).toBe(405);
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      if (method !== 'HEAD') {
        expectCanonicalError(response, 'method_not_allowed');
      }
      expect(applyBind).not.toHaveBeenCalled();
    },
  );

  it.each(['text/plain', 'application/jsonx'])('rejects Content-Type %s', async (contentType) => {
    const { app, applyBind } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': contentType },
      payload: JSON.stringify(canonicalWrapper()),
    });

    expect(response.statusCode).toBe(415);
    expectCanonicalError(response, 'unsupported_media_type');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON canonically before any domain call', async () => {
    const { app, applyBind } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json' },
      payload: '{"webhookAuthorization":',
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'malformed_json');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it('rejects a body larger than 8 KiB canonically before any domain call', async () => {
    const { app, applyBind } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        ...canonicalWrapper(),
        padding: 'x'.repeat(8 * 1024),
      }),
    });

    expect(response.statusCode).toBe(413);
    expectCanonicalError(response, 'body_too_large');
    expect(applyBind).not.toHaveBeenCalled();
  });

  it('does not disclose the pair code, full payload, UID, or credential in any response', async () => {
    const { app } = createApp();
    const responses = await Promise.all([
      app.inject(request(canonicalWrapper())),
      app.inject(
        request({
          webhookAuthorization: `Bearer ${CLAIM_SECRET}`,
          event: { ...canonicalEvent(), ownerUid: 'member-001' },
        }),
      ),
      app.inject(
        request({ webhookAuthorization: `Bearer ${CLAIM_SECRET}-wrong`, event: canonicalEvent() }),
      ),
    ]);

    for (const response of responses) {
      expect(response.body).not.toContain(PAIR_CODE);
      expect(response.body).not.toContain(CLAIM_SECRET);
      expect(response.body).not.toContain('member-001');
      expect(response.body).not.toMatch(/pair_code|webhookAuthorization|payload|uid/i);
    }
  });

  it.each([
    {
      case: 'accepted',
      expectedStatus: 202,
      payload: canonicalWrapper(),
      serviceError: undefined,
      expectedDomainCalls: 1,
    },
    {
      case: 'malformed event',
      expectedStatus: 400,
      payload: canonicalWrapper({
        ...canonicalEvent(),
        payload: {
          device_id: DEVICE_ID,
          pair_code: PAIR_CODE,
          ownerUid: 'private-member-uid',
        },
      }),
      serviceError: undefined,
      expectedDomainCalls: 0,
    },
    {
      case: 'cross-used credential',
      expectedStatus: 401,
      payload: {
        webhookAuthorization: 'Bearer ingestion-private-credential',
        event: canonicalEvent(),
      },
      serviceError: undefined,
      expectedDomainCalls: 0,
    },
    {
      case: 'temporary persistence failure',
      expectedStatus: 503,
      payload: canonicalWrapper(),
      serviceError: new PersistenceUnavailableError(),
      expectedDomainCalls: 1,
    },
  ])(
    'buildApp logs an exact sanitized allowlist for EMQX $case',
    async ({ expectedStatus, payload, serviceError, expectedDomainCalls }) => {
      const logs: MemberApiLogEntry[] = [];
      const applyBind = serviceError
        ? vi.fn(async () => Promise.reject(serviceError))
        : vi.fn(async () => 'claimed' as const);
      const dependencies: MemberApiDependencies = {
        tokenVerifier: {
          verifyAuthorizationHeader: vi.fn(async () => {
            throw new Error('Firebase verifier must not be called by EMQX ingress.');
          }),
        },
        deviceNameService: {
          updateDisplayName: vi.fn(async () => {
            throw new Error('Device-name service must not be called by EMQX ingress.');
          }),
        },
        claimService: {
          createSession: vi.fn(async () => {
            throw new Error('Member Claim create must not be called by EMQX ingress.');
          }),
          getSessionStatus: vi.fn(async () => {
            throw new Error('Member Claim status must not be called by EMQX ingress.');
          }),
          applyBind,
        },
        emqxClaimAuthenticator: new EmqxClaimAuthenticator(CLAIM_SECRET),
        emqxClaimSharedUsername: SHARED_USERNAME,
      };
      const app = buildApp({
        dependencies,
        allowedOrigin: 'https://app.peecare.test',
        logSink: (entry) => logs.push(entry),
      });
      apps.push(app);

      const response = await app.inject(request(payload));

      expect(response.statusCode).toBe(expectedStatus);
      expect(applyBind).toHaveBeenCalledTimes(expectedDomainCalls);
      expect(logs).toEqual([
        {
          requestId: response.headers['x-request-id'],
          routeClass: 'emqx_claim',
          statusCode: expectedStatus,
          outcome: 'request_complete',
        },
      ]);
      const serializedLogs = JSON.stringify(logs);
      for (const sensitiveValue of [
        PAIR_CODE,
        CLAIM_SECRET,
        'private-member-uid',
        'ingestion-private-credential',
      ]) {
        expect(serializedLogs).not.toContain(sensitiveValue);
      }
      expect(serializedLogs).not.toMatch(
        /pair_code|webhookAuthorization|payload|ownerUid|authorization|credential|token|uid/i,
      );
    },
  );
});
