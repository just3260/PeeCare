import { describe, expect, it, vi } from 'vitest';

import { buildApp, type TestToolApiDependencies } from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import { RateLimitedError, SequenceExhaustedError } from '../src/usage/usage-ledger.js';

describe('Test Tool API usage-ledger errors', () => {
  it.each([
    [new RateLimitedError(1), 429, 'rate_limited', { retryAfterSeconds: 1 }],
    [new SequenceExhaustedError(), 409, 'sequence_exhausted', {}],
  ])('maps %s to a stable response with no private data', async (failure, status, code, detail) => {
    const dependencies: TestToolApiDependencies = {
      tokenVerifier: { verifyAuthorizationHeader: vi.fn(async () => ({ uid: 'private-uid' })) },
      repository: {
        listTestDevices: vi.fn(),
        submitTestEvent: vi.fn(async () => {
          throw failure;
        }),
      },
    };
    const app = buildApp({
      dependencies,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { authorization: 'Bearer private-token', 'content-type': 'application/json' },
      payload: { eventType: 'battery', batteryLevelPercent: 75 },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      error: { code, requestId: expect.any(String), ...detail },
    });
    expect(response.body).not.toContain('private-uid');
    expect(response.body).not.toContain('private-token');
    expect(response.body).not.toContain('PC-DEV-000001');
    await app.close();
  });
});
