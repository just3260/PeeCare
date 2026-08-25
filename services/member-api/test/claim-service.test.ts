import { describe, expect, it, vi } from 'vitest';

import {
  ClaimService,
  type ClaimRepository,
} from '../src/claims/claim-service.js';
import type {
  ApplyClaimBindOutcome,
  ClaimSessionStatus,
  ClaimSessionStatusView,
  CreateClaimSessionOutcome,
} from '../src/firestore/device-claim-repository.js';

const DEVICE_ID = '68E274BD2A58';
const MEMBER_UID = 'member-001';

function createRepository(overrides: Partial<ClaimRepository> = {}): ClaimRepository {
  return {
    createSession: vi.fn(async () => 'created' as const),
    getSessionStatus: vi.fn(async () => null),
    applyBind: vi.fn(async () => 'pending' as const),
    ...overrides,
  };
}

function createService(repository: ClaimRepository): ClaimService {
  return new ClaimService({
    repository,
    nowMs: () => 1_000_000,
    randomInteger: () => 1_234,
    createSessionId: () => 'session-123',
  });
}

describe('ClaimService member session creation', () => {
  it('returns the exact pending session data from the leading-zero specification example', async () => {
    const repository = createRepository();
    const service = createService(repository);

    await expect(
      service.createSession({ memberUid: MEMBER_UID, deviceId: DEVICE_ID }),
    ).resolves.toEqual({
      ok: true,
      outcome: 'created',
      session: {
        sessionId: 'session-123',
        deviceId: DEVICE_ID,
        pairCode: '00001234',
        status: 'pending',
        expiresAtMs: 1_300_000,
      },
    });
    expect(repository.createSession).toHaveBeenCalledWith({
      sessionId: 'session-123',
      memberUid: MEMBER_UID,
      deviceId: DEVICE_ID,
      pairCode: '00001234',
      createdAtMs: 1_000_000,
      expiresAtMs: 1_300_000,
    });
  });

  it('returns a new pending response when the repository replaces a lost same-member code', async () => {
    const repository = createRepository({
      createSession: vi.fn(async () => 'replaced' as const),
    });

    await expect(
      createService(repository).createSession({ memberUid: MEMBER_UID, deviceId: DEVICE_ID }),
    ).resolves.toMatchObject({
      ok: true,
      outcome: 'replaced',
      session: { pairCode: '00001234', status: 'pending' },
    });
  });

  it.each([
    'claim_in_progress',
    'already_owned',
    'device_unavailable',
  ] as const satisfies readonly CreateClaimSessionOutcome[])(
    'maps %s without exposing generated session data',
    async (outcome) => {
    const repository = createRepository({
      createSession: vi.fn(async () => outcome),
    });

    await expect(
      createService(repository).createSession({ memberUid: MEMBER_UID, deviceId: DEVICE_ID }),
    ).resolves.toEqual({ ok: false, reason: outcome });
    },
  );

  it('fails loudly when a repository violates the documented outcome union', async () => {
    const repository = createRepository({
      createSession: vi.fn(async () => 'unexpected_outcome' as CreateClaimSessionOutcome),
    });

    await expect(
      createService(repository).createSession({ memberUid: MEMBER_UID, deviceId: DEVICE_ID }),
    ).rejects.toThrow('Claim repository returned an unsupported creation outcome.');
  });

  it('rejects an invalid injected clock before persistence', async () => {
    const repository = createRepository();
    const service = new ClaimService({
      repository,
      nowMs: () => Number.NaN,
      randomInteger: () => 1_234,
      createSessionId: () => 'session-123',
    });

    await expect(
      service.createSession({ memberUid: MEMBER_UID, deviceId: DEVICE_ID }),
    ).rejects.toThrow('Claim service clock must return a non-negative safe integer.');
    expect(repository.createSession).not.toHaveBeenCalled();
  });
});

describe('ClaimService owner-private status', () => {
  it.each([
    'pending',
    'claimed',
    'expired',
    'failed',
    'conflict',
    'replaced',
  ] as const satisfies readonly ClaimSessionStatus[])(
    'returns the repository %s view without member identity',
    async (status) => {
      const view: ClaimSessionStatusView = {
        sessionId: 'session-123',
        deviceId: DEVICE_ID,
        status,
        expiresAtMs: 1_300_000,
      };
      const repository = createRepository({
        getSessionStatus: vi.fn(async () => view),
      });

      await expect(
        createService(repository).getSessionStatus({
          memberUid: MEMBER_UID,
          sessionId: 'session-123',
        }),
      ).resolves.toEqual(view);
      expect(repository.getSessionStatus).toHaveBeenCalledWith({
        memberUid: MEMBER_UID,
        sessionId: 'session-123',
        nowMs: 1_000_000,
      });
      expect(JSON.stringify(view)).not.toContain(MEMBER_UID);
    },
  );

  it('reconstructs an exact allowlisted view when a repository object has sensitive extras', async () => {
    const repositoryView = {
      sessionId: 'session-123',
      deviceId: DEVICE_ID,
      status: 'claimed' as const,
      expiresAtMs: 1_300_000,
      memberUid: MEMBER_UID,
      pairCode: '00001234',
      attemptCount: 4,
    };
    const repository = createRepository({
      getSessionStatus: vi.fn(async () => repositoryView),
    });

    await expect(
      createService(repository).getSessionStatus({
        memberUid: MEMBER_UID,
        sessionId: 'session-123',
      }),
    ).resolves.toEqual({
      sessionId: 'session-123',
      deviceId: DEVICE_ID,
      status: 'claimed',
      expiresAtMs: 1_300_000,
    });
  });

  it('fails loudly when a repository violates the documented status union', async () => {
    const repository = createRepository({
      getSessionStatus: vi.fn(async () => ({
        sessionId: 'session-123',
        deviceId: DEVICE_ID,
        status: 'unexpected_status',
        expiresAtMs: 1_300_000,
      }) as unknown as ClaimSessionStatusView),
    });

    await expect(
      createService(repository).getSessionStatus({
        memberUid: MEMBER_UID,
        sessionId: 'session-123',
      }),
    ).rejects.toThrow('Claim repository returned an unsupported session status.');
  });

  it('keeps a foreign session indistinguishable from a missing session', async () => {
    const repository = createRepository({
      getSessionStatus: vi.fn(async () => null),
    });

    await expect(
      createService(repository).getSessionStatus({
        memberUid: 'member-foreign',
        sessionId: 'session-123',
      }),
    ).resolves.toBeNull();
  });
});

describe('ClaimService bind outcome mapping', () => {
  it.each([
    'pending',
    'claimed',
    'expired',
    'failed',
    'conflict',
    'not_found',
    'device_unavailable',
  ] as const satisfies readonly ApplyClaimBindOutcome[])(
    'maps the repository %s outcome without transport data',
    async (outcome) => {
      const repository = createRepository({
        applyBind: vi.fn(async () => outcome),
      });
      const service = createService(repository);

      await expect(
        service.applyBind({ deviceId: DEVICE_ID, pairCode: '00001234' }),
      ).resolves.toBe(outcome);
      expect(repository.applyBind).toHaveBeenCalledWith({
        deviceId: DEVICE_ID,
        pairCode: '00001234',
        nowMs: 1_000_000,
      });
    },
  );

  it('fails loudly when a repository violates the documented bind outcome union', async () => {
    const repository = createRepository({
      applyBind: vi.fn(async () => 'unexpected_outcome' as ApplyClaimBindOutcome),
    });

    await expect(
      createService(repository).applyBind({ deviceId: DEVICE_ID, pairCode: '00001234' }),
    ).rejects.toThrow('Claim repository returned an unsupported bind outcome.');
  });
});
