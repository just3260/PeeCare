import { describe, expect, it, vi } from 'vitest';

import { buildApp, type TestToolApiDependencies } from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';

function dependencies(): TestToolApiDependencies {
  return {
    tokenVerifier: {
      verifyAuthorizationHeader: vi.fn(async () => ({ uid: 'member-001' })),
    },
    repository: {
      listTestDevices: vi.fn(),
      submitTestEvent: vi.fn(async (submission) => ({
        status: 'stored',
        eventId: `tt:${submission.deviceId}:123e4567-e89b-42d3-a456-426614174000`,
        eventType: submission.body.eventType,
        deviceId: submission.deviceId,
        sequence: 0,
      })),
    },
  };
}

function eventRequest(payload: string | Record<string, unknown>, contentType = 'application/json') {
  return {
    method: 'POST' as const,
    url: '/v1/test-devices/PC-DEV-000001/events',
    headers: {
      origin: APPROVED_WEB_ORIGIN,
      authorization: 'Bearer private-token',
      'content-type': contentType,
    },
    payload,
  };
}

describe('Test Tool API typed event boundary', () => {
  it.each([
    { eventType: 'urination', flushDurationMs: 3000, pumpDurationMs: 5000 },
    { eventType: 'battery', batteryLevelPercent: 75 },
    { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3975 },
  ])('passes only a validated exact request to the repository: %j', async (payload) => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });

    const response = await app.inject(eventRequest(payload, 'application/json; charset=utf-8'));

    expect(response.statusCode).toBe(200);
    expect(runtime.repository.submitTestEvent).toHaveBeenCalledWith({
      memberUid: 'member-001',
      deviceId: 'PC-DEV-000001',
      body: payload,
    });
    await app.close();
  });

  it.each([
    ['extra property', { eventType: 'battery', batteryLevelPercent: 75, extra: true }],
    ['URL control', { eventType: 'battery', batteryLevelPercent: 75, url: 'https://evil.invalid' }],
    [
      'header control',
      { eventType: 'battery', batteryLevelPercent: 75, headers: { authorization: 'secret' } },
    ],
    ['topic control', { eventType: 'battery', batteryLevelPercent: 75, topic: 'attacker/topic' }],
    ['identity control', { eventType: 'battery', batteryLevelPercent: 75, eventId: 'chosen' }],
    ['transport control', { eventType: 'battery', batteryLevelPercent: 75, qos: 0 }],
    ['invalid measurement', { eventType: 'battery', batteryLevelPercent: 80 }],
  ])('returns sanitized invalid_request for %s with zero repository calls', async (_case, payload) => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });

    const response = await app.inject(eventRequest(payload));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'invalid_request', requestId: expect.any(String) },
    });
    expect(response.body).not.toContain('evil.invalid');
    expect(response.body).not.toContain('attacker/topic');
    expect(response.body).not.toContain('secret');
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/problem+json'])(
    'rejects non-approved media type %s before authentication and repository access',
    async (contentType) => {
      const runtime = dependencies();
      const app = buildApp({
        dependencies: runtime,
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled: true,
      });

      const response = await app.inject(
        eventRequest(JSON.stringify({ eventType: 'battery', batteryLevelPercent: 75 }), contentType),
      );

      expect(response.statusCode).toBe(415);
      expect(response.json()).toEqual({
        error: { code: 'unsupported_media_type', requestId: expect.any(String) },
      });
      expect(runtime.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
      expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it('maps malformed JSON to invalid_request before repository access', async () => {
    const runtime = dependencies();
    const app = buildApp({
      dependencies: runtime,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });

    const response = await app.inject(eventRequest('{"eventType":"battery"'));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'invalid_request', requestId: expect.any(String) },
    });
    expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(['/api/send', '/v1/proxy', '/v1/test-devices/PC-DEV-000001/proxy'])(
    'does not expose generic proxy route %s',
    async (url) => {
      const runtime = dependencies();
      const app = buildApp({
        dependencies: runtime,
        allowedOrigin: APPROVED_WEB_ORIGIN,
        enabled: true,
      });

      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json', authorization: 'Bearer private-token' },
        payload: { url: 'https://evil.invalid', method: 'POST', headers: { authorization: 'x' } },
      });

      expect(response.statusCode).toBe(404);
      expect(runtime.tokenVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
      expect(runtime.repository.submitTestEvent).not.toHaveBeenCalled();
      await app.close();
    },
  );
});
