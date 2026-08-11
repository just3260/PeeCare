import { inspect } from 'node:util';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APPROVED_INGESTION_ORIGIN } from '../src/config.js';
import {
  IngestionConfigurationError,
  IngestionRejectedError,
  IngestionUnavailableError,
  IngestionUpstreamError,
  createIngestionClient,
} from '../src/ingestion/ingestion-client.js';

const temporaryDirectories: string[] = [];
const SECRET = 'development-secret-value';
const EVENT_ID = 'tt:PC-BETA-0001:123e4567-e89b-42d3-a456-426614174000';
const envelope = {
  topic: 'products/pc-mini/devices/PC-BETA-0001/status/battery',
  clientId: 'PC-BETA-0001',
  username: 'development-test-tool' as const,
  qos: 1 as const,
  retained: false as const,
  brokerReceivedAtMs: 1_786_449_600_000,
  payload: {
    schemaVersion: 1 as const,
    eventId: EVENT_ID,
    eventType: 'battery' as const,
    deviceId: 'PC-BETA-0001',
    sequence: 18,
    recordedAtMs: 1_786_449_600_000,
    firmwareVersion: '0.0.0-test-tool',
    batteryLevelPercent: 75 as const,
  },
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryFile(value = `${SECRET}\n`, mode = 0o400): string {
  const directory = mkdtempSync(join(tmpdir(), 'peecare-ingestion-client-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'secret');
  writeFileSync(path, value, { mode });
  chmodSync(path, mode);
  return path;
}

function fetchReturning(status: number) {
  return vi.fn(async () => ({ status })) as unknown as typeof fetch;
}

describe('fixed-boundary Ingestion client', () => {
  it('posts only to the exact event endpoint with mounted authorization and no redirects', async () => {
    const fetchImpl = fetchReturning(201);
    const client = createIngestionClient({
      ingestionOrigin: APPROVED_INGESTION_ORIGIN,
      ingestionSecretFile: temporaryFile(),
      fetchImpl,
    });

    await expect(client.submit(envelope)).resolves.toBe('stored');

    expect(fetchImpl).toHaveBeenCalledWith(
      `${APPROVED_INGESTION_ORIGIN}/v1/emqx/events`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(envelope),
      },
    );
    expect(JSON.stringify(client)).not.toContain(SECRET);
    expect(inspect(client)).not.toContain(SECRET);
  });

  it.each([
    [201, 'stored'],
    [200, 'duplicate'],
  ] as const)('maps upstream %s without reading or returning its body', async (status, outcome) => {
    const response = {
      status,
      text: vi.fn(() => {
        throw new Error(`reflected ${SECRET}`);
      }),
      json: vi.fn(() => {
        throw new Error(`reflected ${SECRET}`);
      }),
    };
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
    const client = createIngestionClient({
      ingestionOrigin: APPROVED_INGESTION_ORIGIN,
      ingestionSecretFile: temporaryFile(),
      fetchImpl,
    });

    await expect(client.submit(envelope)).resolves.toBe(outcome);
    expect(response.text).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it.each([
    [401, IngestionConfigurationError],
    [403, IngestionConfigurationError],
    [422, IngestionRejectedError],
    [503, IngestionUnavailableError],
    [202, IngestionUpstreamError],
    [404, IngestionUpstreamError],
    [500, IngestionUpstreamError],
  ])('maps upstream status %s to a sanitized error', async (status, ErrorType) => {
    const client = createIngestionClient({
      ingestionOrigin: APPROVED_INGESTION_ORIGIN,
      ingestionSecretFile: temporaryFile(),
      fetchImpl: fetchReturning(status),
    });

    const submission = client.submit(envelope);
    await expect(submission).rejects.toBeInstanceOf(ErrorType);
    await expect(submission).rejects.not.toThrow(SECRET);
    await expect(submission).rejects.not.toThrow(EVENT_ID);
  });

  it('maps network failures without retaining secret or upstream detail', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`${SECRET} private upstream response`);
    }) as unknown as typeof fetch;
    const client = createIngestionClient({
      ingestionOrigin: APPROVED_INGESTION_ORIGIN,
      ingestionSecretFile: temporaryFile(),
      fetchImpl,
    });

    const submission = client.submit(envelope);
    await expect(submission).rejects.toMatchObject(new IngestionUnavailableError());
    await expect(submission).rejects.not.toThrow(SECRET);
    await expect(submission).rejects.not.toThrow('private upstream response');
  });

  it.each([
    'http://peecare-ingestion-development-348528459946.asia-east1.run.app',
    'https://attacker.invalid',
    `${APPROVED_INGESTION_ORIGIN}/v1/emqx/events`,
    `${APPROVED_INGESTION_ORIGIN}.evil.invalid`,
    `https://user:pass@${new URL(APPROVED_INGESTION_ORIGIN).host}`,
  ])('rejects unsafe Ingestion origin before reading secret or fetching: %s', (ingestionOrigin) => {
    const secretPath = temporaryFile();
    const fetchImpl = fetchReturning(201);

    expect(() =>
      createIngestionClient({ ingestionOrigin, ingestionSecretFile: secretPath, fetchImpl }),
    ).toThrow(new IngestionConfigurationError());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unsafe secret files before fetching without exposing the path or value', () => {
    const validTarget = temporaryFile();
    const symlinkDirectory = mkdtempSync(join(tmpdir(), 'peecare-ingestion-symlink-'));
    temporaryDirectories.push(symlinkDirectory);
    const symlinkPath = join(symlinkDirectory, 'secret-link');
    symlinkSync(validTarget, symlinkPath);
    const cases = [
      'relative-secret',
      '/does/not/exist',
      symlinkPath,
      temporaryFile(SECRET, 0o644),
      temporaryFile('   \n'),
      temporaryFile('密碼'),
      temporaryFile('secret with spaces'),
    ];

    for (const ingestionSecretFile of cases) {
      const fetchImpl = fetchReturning(201);
      let failure: unknown;
      try {
        createIngestionClient({
          ingestionOrigin: APPROVED_INGESTION_ORIGIN,
          ingestionSecretFile,
          fetchImpl,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject(new IngestionConfigurationError());
      expect(JSON.stringify(failure)).not.toContain(SECRET);
      expect((failure as Error).message).not.toContain(ingestionSecretFile);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});
