import { describe, expect, it, vi } from 'vitest';

import {
  buildApp,
  type TestToolApiDependencies,
  type TestToolApiLogEntry,
} from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';

const PRIVATE_VALUES = [
  'mounted-secret-canary',
  'Bearer private-token',
  'private@example.com',
  'raw-member-uid',
  '私密浴室名稱',
  'private upstream response',
];

function runtime(): TestToolApiDependencies {
  return {
    tokenVerifier: {
      verifyAuthorizationHeader: vi.fn(async () => ({ uid: 'raw-member-uid' })),
    },
    repository: {
      listTestDevices: vi.fn(),
      submitTestEvent: vi.fn(),
    },
  };
}

describe('Test Tool API response and log privacy', () => {
  it('projects device-list results to deviceId and resolved displayName only', async () => {
    const dependencies = runtime();
    vi.mocked(dependencies.repository.listTestDevices).mockResolvedValue([
      {
        deviceId: 'PC-DEV-000001',
        displayName: '主浴室',
        customName: '私密浴室名稱',
        ownerUid: 'raw-member-uid',
        productModel: 'pc-mini',
        developmentTestTool: { enabled: true, marker: 'private' },
        secret: 'mounted-secret-canary',
      } as never,
    ]);
    const app = buildApp({ dependencies, allowedOrigin: APPROVED_WEB_ORIGIN, enabled: true });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-devices',
      headers: { authorization: 'Bearer private-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      devices: [{ deviceId: 'PC-DEV-000001', displayName: '主浴室' }],
    });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    for (const privateValue of PRIVATE_VALUES) expect(response.body).not.toContain(privateValue);
    expect(response.body).not.toMatch(/customName|ownerUid|productModel|developmentTestTool|secret/);
    await app.close();
  });

  it.each([
    ['whitespace-only', '   '],
    ['leading whitespace', ' 主浴室'],
    ['trailing whitespace', '主浴室 '],
    ['over 30 code points', '名'.repeat(31)],
    ['control character', 'private\nname'],
  ])('fails closed for a noncanonical %s displayName', async (_case, displayName) => {
    const dependencies = runtime();
    vi.mocked(dependencies.repository.listTestDevices).mockResolvedValue([
      { deviceId: 'PC-DEV-000001', displayName },
    ]);
    const app = buildApp({ dependencies, allowedOrigin: APPROVED_WEB_ORIGIN, enabled: true });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test-devices',
      headers: { authorization: 'Bearer private-token' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'internal_error', requestId: expect.any(String) },
    });
    expect(response.body).not.toContain(displayName);
    await app.close();
  });

  it('projects event success to the five allowlisted fields only', async () => {
    const dependencies = runtime();
    vi.mocked(dependencies.repository.submitTestEvent).mockResolvedValue({
      status: 'stored',
      eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000',
      eventType: 'battery',
      deviceId: 'PC-DEV-000001',
      sequence: 18,
      secret: 'mounted-secret-canary',
      authorization: 'Bearer private-token',
      customName: '私密浴室名稱',
      payload: { batteryLevelPercent: 75 },
      upstreamResponse: 'private upstream response',
    });
    const app = buildApp({ dependencies, allowedOrigin: APPROVED_WEB_ORIGIN, enabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { authorization: 'Bearer private-token', 'content-type': 'application/json' },
      payload: { eventType: 'battery', batteryLevelPercent: 75 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'stored',
      eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000',
      eventType: 'battery',
      deviceId: 'PC-DEV-000001',
      sequence: 18,
    });
    expect(Object.keys(response.json())).toEqual([
      'status', 'eventId', 'eventType', 'deviceId', 'sequence',
    ]);
    for (const privateValue of PRIVATE_VALUES) expect(response.body).not.toContain(privateValue);
    expect(response.body).not.toMatch(/authorization|customName|payload|upstreamResponse|secret/);
    await app.close();
  });

  it.each([
    ['wrong status', { status: 'accepted', eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000', eventType: 'battery', deviceId: 'PC-DEV-000001', sequence: 18 }],
    ['foreign device', { status: 'stored', eventId: 'tt:PC-OTHER:123e4567-e89b-42d3-a456-426614174000', eventType: 'battery', deviceId: 'PC-OTHER', sequence: 18 }],
    ['wrong event type', { status: 'stored', eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000', eventType: 'urination', deviceId: 'PC-DEV-000001', sequence: 18 }],
    ['invalid event id', { status: 'stored', eventId: 'mounted-secret-canary', eventType: 'battery', deviceId: 'PC-DEV-000001', sequence: 18 }],
    ['invalid sequence', { status: 'stored', eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000', eventType: 'battery', deviceId: 'PC-DEV-000001', sequence: -1 }],
  ])('maps invalid repository success to sanitized internal_error: %s', async (_case, result) => {
    const dependencies = runtime();
    vi.mocked(dependencies.repository.submitTestEvent).mockResolvedValue(result);
    const entries: TestToolApiLogEntry[] = [];
    const app = buildApp({
      dependencies,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
      logSink: (entry) => entries.push(entry),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { authorization: 'Bearer private-token', 'content-type': 'application/json' },
      payload: { eventType: 'battery', batteryLevelPercent: 75 },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'internal_error', requestId: expect.any(String) },
    });
    expect(entries).toEqual([
      { requestId: expect.any(String), statusCode: 500, outcome: 'request_complete' },
    ]);
    const serialized = `${response.body}${JSON.stringify(entries)}`;
    for (const privateValue of PRIVATE_VALUES) expect(serialized).not.toContain(privateValue);
    await app.close();
  });

  it('keeps logs allowlisted across success, malformed input, and private repository failure', async () => {
    const dependencies = runtime();
    vi.mocked(dependencies.repository.submitTestEvent)
      .mockResolvedValueOnce({
        status: 'stored',
        eventId: 'tt:PC-DEV-000001:123e4567-e89b-42d3-a456-426614174000',
        eventType: 'battery',
        deviceId: 'PC-DEV-000001',
        sequence: 18,
      })
      .mockRejectedValueOnce(new Error(PRIVATE_VALUES.join(' ')));
    const entries: TestToolApiLogEntry[] = [];
    const app = buildApp({
      dependencies,
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
      logSink: (entry) => entries.push(entry),
    });
    const request = (payload: Record<string, unknown>) => app.inject({
      method: 'POST',
      url: '/v1/test-devices/PC-DEV-000001/events',
      headers: { authorization: 'Bearer private-token', 'content-type': 'application/json' },
      payload,
    });

    await request({ eventType: 'battery', batteryLevelPercent: 75 });
    await request({ eventType: 'battery', batteryLevelPercent: 75, secret: 'mounted-secret-canary' });
    await request({ eventType: 'battery', batteryLevelPercent: 75 });

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['outcome', 'requestId', 'statusCode']);
    }
    const serialized = JSON.stringify(entries);
    for (const privateValue of PRIVATE_VALUES) expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toMatch(/authorization|customName|body|payload|email|uid|secret/i);
    await app.close();
  });
});
