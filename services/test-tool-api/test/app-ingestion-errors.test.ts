import { describe, expect, it, vi } from 'vitest';

import { buildApp, type TestToolApiDependencies } from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import {
  IngestionConfigurationError,
  IngestionRejectedError,
  IngestionUnavailableError,
  IngestionUpstreamError,
} from '../src/ingestion/ingestion-client.js';

describe('Test Tool API Ingestion failure mapping', () => {
  it.each([
    [new IngestionUnavailableError(), 503, 'ingestion_unavailable'],
    [new IngestionRejectedError(), 404, 'test_device_not_found'],
    [new IngestionConfigurationError(), 500, 'internal_error'],
    [new IngestionUpstreamError(), 500, 'internal_error'],
  ])('maps %s to a stable sanitized response', async (failure, statusCode, code) => {
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

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({
      error: { code, requestId: expect.any(String) },
    });
    expect(response.body).not.toContain('private-token');
    expect(response.body).not.toContain('private-uid');
    expect(response.body).not.toContain('PC-DEV-000001');
    await app.close();
  });
});
