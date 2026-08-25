import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildApp,
  type MemberApiDependencies,
  type MemberClaimService,
} from '../src/app.js';
import { PersistenceUnavailableError } from '../src/http/errors.js';
import {
  FirebaseIdTokenVerifier,
  MemberAuthenticationError,
} from '../src/security/firebase-id-token-verifier.js';
import { EmqxClaimAuthenticator } from '../src/security/emqx-claim-auth.js';

const ALLOWED_ORIGIN = 'https://app.peecare.test';
const DEVICE_ID = '68E274BD2A58';
const SESSION_ID = 'session-123';

function createClaimService(): MemberClaimService {
  return {
    createSession: vi.fn(async () => ({
      ok: true as const,
      outcome: 'created' as const,
      session: {
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        pairCode: '00001234',
        status: 'pending' as const,
        expiresAtMs: 1_300_000,
      },
    })),
    getSessionStatus: vi.fn(async () => ({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'claimed' as const,
      expiresAtMs: 1_300_000,
    })),
    applyBind: vi.fn(async () => 'claimed' as const),
  };
}

function createDependencies(claimService = createClaimService()): MemberApiDependencies {
  return {
    tokenVerifier: {
      verifyAuthorizationHeader: vi.fn(async () => ({ uid: 'member-001' })),
    },
    deviceNameService: {
      updateDisplayName: vi.fn(async () => {
        throw new Error('device-name service must not be called by Claim routes');
      }),
    },
    claimService,
  };
}

describe('Member Claim routes', () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp(claimService = createClaimService()) {
    const dependencies = createDependencies(claimService);
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);
    return { app, dependencies, claimService };
  }

  function expectCanonicalError(
    response: Awaited<ReturnType<ReturnType<typeof buildApp>['inject']>>,
    code: string,
  ) {
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.json()).toEqual({
      error: { code, requestId: response.headers['x-request-id'] },
    });
  }

  it('creates a Claim Session from the verified member identity and returns the exact response', async () => {
    const { app, dependencies, claimService } = createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: {
        authorization: 'Bearer valid-firebase-token',
        'content-type': 'application/json',
      },
      payload: { deviceId: DEVICE_ID },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      pairCode: '00001234',
      status: 'pending',
      expiresAtMs: 1_300_000,
    });
    expect(dependencies.tokenVerifier.verifyAuthorizationHeader).toHaveBeenCalledExactlyOnceWith(
      'Bearer valid-firebase-token',
    );
    expect(claimService.createSession).toHaveBeenCalledExactlyOnceWith({
      memberUid: 'member-001',
      deviceId: DEVICE_ID,
    });
  });

  it('returns the exact Owner-private status response', async () => {
    const { app, claimService } = createApp();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/device-claim-sessions/${SESSION_ID}`,
      headers: { authorization: 'Bearer valid-firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'claimed',
      expiresAtMs: 1_300_000,
    });
    expect(claimService.getSessionStatus).toHaveBeenCalledExactlyOnceWith({
      memberUid: 'member-001',
      sessionId: SESSION_ID,
    });
  });

  it.each([
    ['create', 'POST', '/v1/device-claim-sessions'],
    ['status', 'GET', `/v1/device-claim-sessions/${SESSION_ID}`],
  ] as const)('uses a successfully verified non-revoked Firebase UID on the %s route', async (
    _case,
    method,
    url,
  ) => {
    const firebaseAuth = {
      verifyIdToken: vi.fn(async () => ({ uid: 'firebase-member-001' })),
    };
    const claimService = createClaimService();
    const dependencies: MemberApiDependencies = {
      ...createDependencies(claimService),
      tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
    };
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      headers: { authorization: 'Bearer valid-firebase-token' },
      payload: method === 'POST' ? { deviceId: DEVICE_ID } : undefined,
    });

    expect(response.statusCode).toBe(method === 'POST' ? 201 : 200);
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledExactlyOnceWith(
      'valid-firebase-token',
      true,
    );
    if (method === 'POST') {
      expect(claimService.createSession).toHaveBeenCalledExactlyOnceWith({
        memberUid: 'firebase-member-001',
        deviceId: DEVICE_ID,
      });
    } else {
      expect(claimService.getSessionStatus).toHaveBeenCalledExactlyOnceWith({
        memberUid: 'firebase-member-001',
        sessionId: SESSION_ID,
      });
    }
  });

  it('allowlists successful response fields rather than forwarding domain internals', async () => {
    const claimService = createClaimService();
    vi.mocked(claimService.createSession).mockResolvedValueOnce({
      ok: true,
      outcome: 'created',
      session: {
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        pairCode: '00001234',
        status: 'pending',
        expiresAtMs: 1_300_000,
        memberUid: 'member-private',
        codeMac: 'private-mac',
      },
    } as Awaited<ReturnType<MemberClaimService['createSession']>>);
    vi.mocked(claimService.getSessionStatus).mockResolvedValueOnce({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'claimed',
      expiresAtMs: 1_300_000,
      memberUid: 'member-private',
      pairCode: '00001234',
      attemptCount: 3,
    } as Awaited<ReturnType<MemberClaimService['getSessionStatus']>>);
    const { app } = createApp(claimService);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { deviceId: DEVICE_ID },
    });
    const status = await app.inject({
      method: 'GET',
      url: `/v1/device-claim-sessions/${SESSION_ID}`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(Object.keys(create.json()).sort()).toEqual(
      ['deviceId', 'expiresAtMs', 'pairCode', 'sessionId', 'status'].sort(),
    );
    expect(Object.keys(status.json()).sort()).toEqual(
      ['deviceId', 'expiresAtMs', 'sessionId', 'status'].sort(),
    );
    expect(`${create.body}${status.body}`).not.toContain('member-private');
    expect(`${create.body}${status.body}`).not.toContain('private-mac');
  });

  it.each([
    ['missing deviceId', {}],
    ['client-supplied ownerUid', { deviceId: DEVICE_ID, ownerUid: 'member-999' }],
    ['client-supplied pairCode', { deviceId: DEVICE_ID, pairCode: '00001234' }],
    ['lowercase deviceId', { deviceId: DEVICE_ID.toLowerCase() }],
    ['short deviceId', { deviceId: '68E274BD2A5' }],
    ['non-hex deviceId', { deviceId: '68E274BD2A5Z' }],
    ['array body', [{ deviceId: DEVICE_ID }]],
    ['null body', 'null'],
  ])('rejects an invalid exact create body before persistence: %s', async (_case, payload) => {
    const { app, dependencies, claimService } = createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: {
        authorization: 'Bearer valid-firebase-token',
        'content-type': 'application/json',
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(dependencies.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(claimService.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['create query', '/v1/device-claim-sessions?ownerUid=member-999', 'POST'],
    ['status query', `/v1/device-claim-sessions/${SESSION_ID}?include=pairCode`, 'GET'],
    ['unsafe status id', '/v1/device-claim-sessions/session%3A123', 'GET'],
  ] as const)('rejects invalid member Claim route input before authentication: %s', async (
    _case,
    url,
    method,
  ) => {
    const { app, dependencies, claimService } = createApp();
    const response = await app.inject({
      method,
      url,
      headers: { authorization: 'Bearer valid-token' },
      payload: method === 'POST' ? { deviceId: DEVICE_ID } : undefined,
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(dependencies.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(claimService.createSession).not.toHaveBeenCalled();
    expect(claimService.getSessionStatus).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/jsonx'])('rejects create Content-Type %s', async (contentType) => {
    const { app, claimService } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer valid-token', 'content-type': contentType },
      payload: JSON.stringify({ deviceId: DEVICE_ID }),
    });

    expect(response.statusCode).toBe(415);
    expectCanonicalError(response, 'unsupported_media_type');
    expect(claimService.createSession).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before persistence', async () => {
    const { app, claimService } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      payload: '{"deviceId":',
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'malformed_json');
    expect(claimService.createSession).not.toHaveBeenCalled();
  });

  it('rejects an empty JSON body before persistence', async () => {
    const { app, claimService } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'malformed_json');
    expect(claimService.createSession).not.toHaveBeenCalled();
  });

  it('rejects an overlong Claim Session identifier with the Claim canonical error', async () => {
    const { app, claimService } = createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/device-claim-sessions/${'s'.repeat(257)}`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(400);
    expectCanonicalError(response, 'invalid_request');
    expect(claimService.getSessionStatus).not.toHaveBeenCalled();
  });

  it('rejects a create body larger than 8 KiB before persistence', async () => {
    const { app, claimService } = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { deviceId: DEVICE_ID, padding: 'x'.repeat(8 * 1024) },
    });

    expect(response.statusCode).toBe(413);
    expectCanonicalError(response, 'body_too_large');
    expect(claimService.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/v1/device-claim-sessions'],
    ['PUT', '/v1/device-claim-sessions'],
    ['PATCH', '/v1/device-claim-sessions'],
    ['DELETE', '/v1/device-claim-sessions'],
    ['POST', `/v1/device-claim-sessions/${SESSION_ID}`],
    ['HEAD', `/v1/device-claim-sessions/${SESSION_ID}`],
    ['PUT', `/v1/device-claim-sessions/${SESSION_ID}`],
    ['PATCH', `/v1/device-claim-sessions/${SESSION_ID}`],
    ['DELETE', `/v1/device-claim-sessions/${SESSION_ID}`],
  ] as const)('returns method_not_allowed for %s %s without persistence', async (method, url) => {
    const { app, claimService } = createApp();
    const response = await app.inject({ method, url });

    expect(response.statusCode).toBe(405);
    expectCanonicalError(response, 'method_not_allowed');
    expect(claimService.createSession).not.toHaveBeenCalled();
    expect(claimService.getSessionStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['create', 'POST', '/v1/device-claim-sessions'],
    ['status', 'GET', `/v1/device-claim-sessions/${SESSION_ID}`],
  ] as const)(
    'requires a non-revoked Firebase token on the %s route and checks revocation',
    async (_case, method, url) => {
      const firebaseAuth = {
        verifyIdToken: vi.fn(async () => {
          throw Object.assign(new Error('revoked token detail'), { code: 'auth/id-token-revoked' });
        }),
      };
      const claimService = createClaimService();
      const dependencies: MemberApiDependencies = {
        ...createDependencies(claimService),
        tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
      };
      const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
      apps.push(app);

      const response = await app.inject({
        method,
        url,
        headers: { authorization: 'Bearer revoked-firebase-token' },
        payload: method === 'POST' ? { deviceId: DEVICE_ID } : undefined,
      });

      expect(response.statusCode).toBe(401);
      expectCanonicalError(response, 'unauthorized');
      expect(firebaseAuth.verifyIdToken).toHaveBeenCalledExactlyOnceWith(
        'revoked-firebase-token',
        true,
      );
      expect(claimService.createSession).not.toHaveBeenCalled();
      expect(claimService.getSessionStatus).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing', undefined],
    ['malformed', 'Basic not-a-firebase-bearer'],
  ])('rejects a %s Firebase credential on create with zero persistence', async (
    _case,
    authorization,
  ) => {
    const claimService = createClaimService();
    const dependencies: MemberApiDependencies = {
      ...createDependencies(claimService),
      tokenVerifier: {
        verifyAuthorizationHeader: vi.fn(async () => {
          throw new MemberAuthenticationError();
        }),
      },
    };
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: authorization === undefined ? undefined : { authorization },
      payload: { deviceId: DEVICE_ID },
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalError(response, 'unauthorized');
    expect(claimService.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['create', 'POST', '/v1/device-claim-sessions'],
    ['status', 'GET', `/v1/device-claim-sessions/${SESSION_ID}`],
  ] as const)('rejects Claim credential cross-use on the %s route with zero persistence', async (
    _case,
    method,
    url,
  ) => {
    const firebaseAuth = {
      verifyIdToken: vi.fn(async () => {
        throw new Error('Claim webhook credential is not a Firebase token');
      }),
    };
    const claimService = createClaimService();
    const dependencies: MemberApiDependencies = {
      ...createDependencies(claimService),
      tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
    };
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method,
      url,
      headers: { authorization: 'Bearer claim-webhook-secret' },
      payload: method === 'POST' ? { deviceId: DEVICE_ID } : undefined,
    });

    expect(response.statusCode).toBe(401);
    expectCanonicalError(response, 'unauthorized');
    expect(claimService.createSession).not.toHaveBeenCalled();
    expect(claimService.getSessionStatus).not.toHaveBeenCalled();
  });

  it('returns the same canonical 404 for foreign and missing sessions', async () => {
    const claimService = createClaimService();
    vi.mocked(claimService.getSessionStatus).mockResolvedValue(null);
    const { app } = createApp(claimService);

    const responses = await Promise.all(
      ['session-foreign', 'session-missing'].map((sessionId) =>
        app.inject({
          method: 'GET',
          url: `/v1/device-claim-sessions/${sessionId}`,
          headers: { authorization: 'Bearer valid-token' },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expectCanonicalError(response, 'not_found');
    }
    expect(claimService.getSessionStatus).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['claim_in_progress', 409, 'claim_in_progress'],
    ['already_owned', 409, 'already_owned'],
    ['device_unavailable', 404, 'device_not_found'],
  ] as const)('maps create outcome %s to its canonical error', async (reason, status, code) => {
    const claimService = createClaimService();
    vi.mocked(claimService.createSession).mockResolvedValue({ ok: false, reason });
    const { app } = createApp(claimService);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { deviceId: DEVICE_ID },
    });

    expect(response.statusCode).toBe(status);
    expectCanonicalError(response, code);
  });

  it.each([
    ['create persistence', 'POST', '/v1/device-claim-sessions', new PersistenceUnavailableError(), 503, 'persistence_unavailable'],
    ['create unexpected', 'POST', '/v1/device-claim-sessions', new Error('private create detail'), 500, 'internal_error'],
    ['status persistence', 'GET', `/v1/device-claim-sessions/${SESSION_ID}`, new PersistenceUnavailableError(), 503, 'persistence_unavailable'],
    ['status unexpected', 'GET', `/v1/device-claim-sessions/${SESSION_ID}`, new Error('private status detail'), 500, 'internal_error'],
  ] as const)('maps %s without exposing internal details', async (_case, method, url, error, status, code) => {
    const claimService = createClaimService();
    if (method === 'POST') {
      vi.mocked(claimService.createSession).mockRejectedValue(error);
    } else {
      vi.mocked(claimService.getSessionStatus).mockRejectedValue(error);
    }
    const { app } = createApp(claimService);
    const response = await app.inject({
      method,
      url,
      headers: { authorization: 'Bearer valid-token' },
      payload: method === 'POST' ? { deviceId: DEVICE_ID } : undefined,
    });

    expect(response.statusCode).toBe(status);
    expectCanonicalError(response, code);
    expect(response.body).not.toContain(error.message);
  });

  it.each([
    ['create', '/v1/device-claim-sessions', 'POST', 'POST', 'authorization, content-type'],
    ['status', `/v1/device-claim-sessions/${SESSION_ID}`, 'GET', 'GET', 'authorization'],
  ] as const)('permits configured-origin preflight for %s', async (
    _case,
    url,
    requestedMethod,
    allowedMethod,
    allowedHeaders,
  ) => {
    const { app, claimService } = createApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': requestedMethod,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe(allowedMethod);
    expect(response.headers['access-control-allow-headers']).toBe(allowedHeaders);
    expect(claimService.createSession).not.toHaveBeenCalled();
    expect(claimService.getSessionStatus).not.toHaveBeenCalled();
  });

  it('keeps Claim routes absent when the Claim dependency is not configured', async () => {
    const dependencies = createDependencies();
    delete (dependencies as { claimService?: MemberClaimService }).claimService;
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      payload: { deviceId: DEVICE_ID },
    });

    expect(response.statusCode).toBe(404);
    expectCanonicalError(response, 'not_found');
  });

  it('registers the isolated EMQX plugin against the same Claim service when configured', async () => {
    const claimService = createClaimService();
    const dependencies: MemberApiDependencies = {
      ...createDependencies(claimService),
      emqxClaimAuthenticator: new EmqxClaimAuthenticator('claim-webhook-secret'),
      emqxClaimSharedUsername: 'approved-legacy-device',
    };
    const app = buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/emqx/device-claims',
      headers: { 'content-type': 'application/json' },
      payload: {
        webhookAuthorization: 'Bearer claim-webhook-secret',
        event: {
          topic: 'peecare/device/1/bind',
          clientId: 'approved-legacy-client',
          username: 'approved-legacy-device',
          qos: 0,
          retained: false,
          brokerReceivedAtMs: 1_786_982_400_123,
          payload: { device_id: DEVICE_ID, pair_code: '12345678' },
        },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      status: 'accepted',
      requestId: response.headers['x-request-id'],
    });
    expect(claimService.applyBind).toHaveBeenCalledExactlyOnceWith({
      deviceId: DEVICE_ID,
      pairCode: '12345678',
    });
  });

  it('fails closed when EMQX Claim route dependencies are only partially supplied', () => {
    const dependencies: MemberApiDependencies = {
      ...createDependencies(),
      emqxClaimAuthenticator: new EmqxClaimAuthenticator('claim-webhook-secret'),
    };

    expect(() => buildApp({ dependencies, allowedOrigin: ALLOWED_ORIGIN })).toThrow(
      'EMQX Claim route dependencies must be configured together',
    );
  });

  it('logs only the allowlisted request completion fields', async () => {
    const logs: unknown[] = [];
    const claimService = createClaimService();
    const dependencies: MemberApiDependencies = {
      ...createDependencies(claimService),
      tokenVerifier: {
        verifyAuthorizationHeader: vi.fn(async () => {
          throw new MemberAuthenticationError();
        }),
      },
    };
    const app = buildApp({
      dependencies,
      allowedOrigin: ALLOWED_ORIGIN,
      logSink: (entry) => logs.push(entry),
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/device-claim-sessions',
      headers: { authorization: 'Bearer private-token' },
      payload: { deviceId: DEVICE_ID },
    });

    expect(logs).toEqual([
      {
        requestId: response.headers['x-request-id'],
        routeClass: 'member_claim',
        statusCode: 401,
        outcome: 'request_complete',
      },
    ]);
    const serialized = JSON.stringify(logs);
    for (const secret of ['private-token', DEVICE_ID, 'member-001', 'pairCode', 'authorization']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
