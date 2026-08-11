import { describe, expect, it, vi } from 'vitest';

import {
  buildApp,
  type TestToolApiLogEntry,
  type TestToolRepository,
} from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import { FirebaseIdTokenVerifier } from '../src/security/firebase-id-token-verifier.js';

function createRepository(): TestToolRepository {
  return {
    listTestDevices: vi.fn(),
    submitTestEvent: vi.fn(),
  };
}

const protectedRequests = [
  {
    name: 'device listing',
    request: { method: 'GET' as const, url: '/v1/test-devices' },
  },
  {
    name: 'event submission',
    request: {
      method: 'POST' as const,
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { 'content-type': 'application/json' },
      payload: { eventType: 'battery', batteryLevelPercent: 80 },
    },
  },
];

describe('Test Tool API Firebase authentication boundary', () => {
  it.each(protectedRequests)(
    'returns the same unauthorized response for missing credentials on $name without repository calls',
    async ({ request }) => {
      const firebaseAuth = { verifyIdToken: vi.fn() };
      const repository = createRepository();
      const app = buildApp({
        dependencies: {
          tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
          repository,
        },
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled: true,
      });

      const response = await app.inject(request);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'unauthorized', requestId: expect.any(String) },
      });
      expect(firebaseAuth.verifyIdToken).not.toHaveBeenCalled();
      expect(repository.listTestDevices).not.toHaveBeenCalled();
      expect(repository.submitTestEvent).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it.each(protectedRequests)(
    'returns the same unauthorized response for a malformed header on $name without repository calls',
    async ({ request }) => {
      const firebaseAuth = { verifyIdToken: vi.fn() };
      const repository = createRepository();
      const app = buildApp({
        dependencies: {
          tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
          repository,
        },
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled: true,
      });

      const response = await app.inject({
        ...request,
        headers: { ...request.headers, authorization: 'Bearer malformed token' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'unauthorized', requestId: expect.any(String) },
      });
      expect(firebaseAuth.verifyIdToken).not.toHaveBeenCalled();
      expect(repository.listTestDevices).not.toHaveBeenCalled();
      expect(repository.submitTestEvent).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it.each([
    ['malformed', 'malformed-token', 'auth/argument-error'],
    ['expired', 'expired-token', 'auth/id-token-expired'],
    ['revoked', 'revoked-token', 'auth/id-token-revoked'],
    ['wrong-project', 'wrong-project-token', 'auth/argument-error'],
  ])(
    'maps a Firebase %s failure to sanitized unauthorized responses and zero repository calls',
    async (_case, token, code) => {
      const firebaseAuth = {
        verifyIdToken: vi.fn().mockRejectedValue(
          Object.assign(new Error(`${token} private@example.com raw-member-uid`), { code }),
        ),
      };
      const repository = createRepository();
      const entries: TestToolApiLogEntry[] = [];
      const app = buildApp({
        dependencies: {
          tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
          repository,
        },
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled: true,
        logSink: (entry) => entries.push(entry),
      });

      for (const { request } of protectedRequests) {
        const response = await app.inject({
          ...request,
          headers: { ...request.headers, authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({
          error: { code: 'unauthorized', requestId: expect.any(String) },
        });
      }

      expect(firebaseAuth.verifyIdToken).toHaveBeenCalledTimes(protectedRequests.length);
      expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith(token, true);
      expect(repository.listTestDevices).not.toHaveBeenCalled();
      expect(repository.submitTestEvent).not.toHaveBeenCalled();
      expect(JSON.stringify(entries)).not.toContain(token);
      expect(JSON.stringify(entries)).not.toContain('private@example.com');
      expect(JSON.stringify(entries)).not.toContain('raw-member-uid');
      await app.close();
    },
  );

  it('passes only the verified uid to the repository and excludes identity data from logs', async () => {
    const firebaseAuth = {
      verifyIdToken: vi.fn().mockResolvedValue({
        uid: 'raw-member-uid',
        email: 'private@example.com',
        aud: 'petcare-c7483',
      }),
    };
    const repository = createRepository();
    vi.mocked(repository.listTestDevices).mockResolvedValue([]);
    const entries: TestToolApiLogEntry[] = [];
    const app = buildApp({
      dependencies: {
        tokenVerifier: new FirebaseIdTokenVerifier(firebaseAuth),
        repository,
      },
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
      logSink: (entry) => entries.push(entry),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-devices',
      headers: { authorization: 'Bearer valid-private-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.listTestDevices).toHaveBeenCalledWith('raw-member-uid');
    expect(JSON.stringify(entries)).not.toContain('valid-private-token');
    expect(JSON.stringify(entries)).not.toContain('private@example.com');
    expect(JSON.stringify(entries)).not.toContain('raw-member-uid');
    await app.close();
  });
});
