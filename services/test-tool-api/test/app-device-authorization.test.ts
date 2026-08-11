import { describe, expect, it, vi } from 'vitest';

import { buildApp, type TestToolApiDependencies } from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import { TestDeviceNotFoundError } from '../src/devices/test-device-repository.js';

describe('Test Tool API device authorization boundary', () => {
  it('maps every hidden device eligibility failure to the canonical 404 response', async () => {
    const dependencies: TestToolApiDependencies = {
      tokenVerifier: {
        verifyAuthorizationHeader: vi.fn(async () => ({ uid: 'member-001' })),
      },
      repository: {
        listTestDevices: vi.fn(),
        submitTestEvent: vi.fn(async () => {
          throw new TestDeviceNotFoundError();
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
      headers: {
        origin: APPROVED_WEB_ORIGIN,
        authorization: 'Bearer private-token',
        'content-type': 'application/json',
      },
      payload: { eventType: 'battery', batteryLevelPercent: 75 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'test_device_not_found', requestId: expect.any(String) },
    });
    expect(response.body).not.toContain('PC-DEV-000001');
    expect(response.body).not.toContain('member-001');
    expect(response.body).not.toContain('private-token');
    await app.close();
  });
});
