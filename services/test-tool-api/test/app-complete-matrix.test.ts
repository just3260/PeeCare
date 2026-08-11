import { describe, expect, it, vi } from 'vitest';

import { buildApp, type TestToolApiDependencies } from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import { TestDeviceNotFoundError } from '../src/devices/test-device-repository.js';
import { IngestionUnavailableError } from '../src/ingestion/ingestion-client.js';
import { FirebaseIdTokenAuthenticationError } from '../src/security/firebase-id-token-verifier.js';
import { RateLimitedError, SequenceExhaustedError } from '../src/usage/usage-ledger.js';

function dependencies(failure?: Error): TestToolApiDependencies {
  return {
    tokenVerifier: {
      verifyAuthorizationHeader: failure instanceof FirebaseIdTokenAuthenticationError
        ? vi.fn(async () => { throw failure; })
        : vi.fn(async () => ({ uid: 'member-001' })),
    },
    repository: {
      listTestDevices: vi.fn(),
      submitTestEvent: failure && !(failure instanceof FirebaseIdTokenAuthenticationError)
        ? vi.fn(async () => { throw failure; })
        : vi.fn(async () => ({
          status: 'stored',
          eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000',
          eventType: 'battery',
          deviceId: 'PC-DEV-000001',
          sequence: 18,
        })),
    },
  };
}

describe('Test Tool API complete stable error matrix', () => {
  it.each([
    ['invalid request', undefined, 400, 'invalid_request', { eventType: 'battery', batteryLevelPercent: 80 }, 'application/json', true],
    ['unauthorized', new FirebaseIdTokenAuthenticationError(), 401, 'unauthorized', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', true],
    ['device hidden', new TestDeviceNotFoundError(), 404, 'test_device_not_found', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', true],
    ['sequence exhausted', new SequenceExhaustedError(), 409, 'sequence_exhausted', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', true],
    ['oversized', undefined, 413, 'payload_too_large', JSON.stringify({ eventType: 'battery', batteryLevelPercent: 75, padding: 'x'.repeat(8192) }), 'application/json', true],
    ['wrong media', undefined, 415, 'unsupported_media_type', JSON.stringify({ eventType: 'battery', batteryLevelPercent: 75 }), 'text/plain', true],
    ['rate limited', new RateLimitedError(1), 429, 'rate_limited', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', true],
    ['internal', new Error('private upstream response'), 500, 'internal_error', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', true],
    ['ingestion unavailable', new IngestionUnavailableError(), 503, 'ingestion_unavailable', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', true],
    ['disabled', undefined, 503, 'ingestion_unavailable', { eventType: 'battery', batteryLevelPercent: 75 }, 'application/json', false],
  ])(
    'returns canonical $expectedStatus $code for $case',
    async (_case, failure, expectedStatus, code, payload, contentType, enabled) => {
      const runtime = dependencies(failure);
      const app = buildApp({
        dependencies: runtime,
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/test-devices/PC-DEV-000001/events',
        headers: { authorization: 'Bearer private-token', 'content-type': contentType },
        payload,
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toEqual({
        error: {
          code,
          requestId: expect.any(String),
          ...(code === 'rate_limited' ? { retryAfterSeconds: 1 } : {}),
        },
      });
      expect(response.headers['x-request-id']).toBe(response.json().error.requestId);
      expect(response.body).not.toContain('private-token');
      expect(response.body).not.toContain('private upstream response');
      await app.close();
    },
  );
});
