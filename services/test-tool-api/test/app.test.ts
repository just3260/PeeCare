import { describe, expect, it, vi } from 'vitest';

import {
  buildApp,
  type TestToolApiDependencies,
  type TestToolApiLogEntry,
} from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import { FirebaseIdTokenAuthenticationError } from '../src/security/firebase-id-token-verifier.js';

function dependencies(): TestToolApiDependencies {
  return {
    tokenVerifier: { verifyAuthorizationHeader: vi.fn() },
    repository: {
      listTestDevices: vi.fn(),
      submitTestEvent: vi.fn(),
    },
  };
}

describe('Test Tool API baseline', () => {
  it('exposes public liveness without runtime configuration or dependency calls', async () => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: false,
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.body).not.toContain('petcare-c7483');
    expect(response.body).not.toContain('enabled');
    expect(runtime.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(runtime.repository.listTestDevices).not.toHaveBeenCalled();
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it('permits exact-origin preflight without disclosing configuration', async () => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: {
        origin: APPROVED_WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(APPROVED_WEB_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe('POST');
    expect(response.headers['access-control-allow-headers']).toBe('authorization, content-type');
    expect(response.headers.vary).toContain('Origin');
    expect(response.body).toBe('');
    expect(runtime.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    'https://attacker.invalid',
    'https://beta.petcare-c7483.web.app',
    'http://petcare-c7483.web.app',
    'https://petcare-c7483.web.app.evil.invalid',
    'null',
  ])('denies foreign browser origin %s before authentication or repository access', async (origin) => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    const event = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { origin, 'content-type': 'application/json', authorization: 'Bearer hidden' },
      payload: { eventType: 'battery', batteryLevelPercent: 80 },
    });

    expect(preflight.statusCode).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(event.statusCode).toBe(403);
    expect(event.headers['access-control-allow-origin']).toBeUndefined();
    expect(runtime.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(runtime.repository.listTestDevices).not.toHaveBeenCalled();
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([false])('returns a sanitized 503 when event submission is disabled', async (enabled) => {
    const runtime = dependencies();
    vi.mocked(runtime.tokenVerifier.verifyAuthorizationHeader).mockResolvedValue({ uid: 'member-1' });
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: {
        origin: APPROVED_WEB_ORIGIN,
        'content-type': 'application/json',
        authorization: 'Bearer private-token',
      },
      payload: { eventType: 'battery', batteryLevelPercent: 80 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['access-control-allow-origin']).toBe(APPROVED_WEB_ORIGIN);
    expect(response.json()).toEqual({
      error: { code: 'ingestion_unavailable', requestId: expect.any(String) },
    });
    expect(response.body).not.toContain('private-token');
    expect(runtime.tokenVerifier.verifyAuthorizationHeader).toHaveBeenCalledWith(
      'Bearer private-token',
    );
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([undefined, 'Bearer malformed token'])(
    'keeps disabled event submission behind authentication for %s',
    async (authorization) => {
      const runtime = dependencies();
      vi.mocked(runtime.tokenVerifier.verifyAuthorizationHeader).mockRejectedValue(
        new FirebaseIdTokenAuthenticationError(),
      );
      const app = buildApp({
        dependencies: runtime,
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled: false,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/test-devices/PC-DEV-000001/events',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        payload: { eventType: 'battery', batteryLevelPercent: 80 },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'unauthorized', requestId: expect.any(String) },
      });
      expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it('accepts an 8 KiB JSON body at the parser boundary', async () => {
    const runtime = dependencies();
    vi.mocked(runtime.tokenVerifier.verifyAuthorizationHeader).mockResolvedValue({ uid: 'member-1' });
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: false,
    });
    const payload = JSON.stringify('x'.repeat(8 * 1024 - 2));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(Buffer.byteLength(payload)).toBe(8 * 1024);
    expect(response.statusCode).toBe(503);
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a JSON body over 8 KiB before authentication or repository access', async () => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });
    const payload = JSON.stringify('x'.repeat(8 * 1024 - 1));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { 'content-type': 'application/json', authorization: 'Bearer hidden' },
      payload,
    });

    expect(Buffer.byteLength(payload)).toBe(8 * 1024 + 1);
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: { code: 'payload_too_large', requestId: expect.any(String) },
    });
    expect(runtime.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it('emits only allowlisted completion log fields', async () => {
    const entries: TestToolApiLogEntry[] = [];
    const app = buildApp({
      dependencies: dependencies(),
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: false,
      logSink: (entry) => entries.push(entry),
    });

    await app.inject({ method: 'GET', url: '/health', headers: { authorization: 'Bearer hidden' } });

    expect(entries).toEqual([
      { requestId: expect.any(String), statusCode: 200, outcome: 'request_complete' },
    ]);
    expect(JSON.stringify(entries)).not.toContain('hidden');
    await app.close();
  });
});
