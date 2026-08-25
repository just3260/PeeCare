import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Firestore } from '@google-cloud/firestore';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ClaimPersistenceIntegrityError,
  FirestoreDeviceClaimRepository,
  InvalidClaimCommandError,
  type ClaimCodeProtector,
} from '../src/firestore/device-claim-repository.js';
import { createFirestore } from '../src/firestore/firestore-client.js';
import { PersistenceUnavailableError } from '../src/http/errors.js';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const firestore = emulatorHost
  ? createFirestore({ projectId: 'demo-peecare', emulatorHost })
  : null;

const DEVICE_ID = '68E274BD2A58';
const DEVICE_PATH = `devices/${DEVICE_ID}`;
const SESSION_ID = 'session-001';
const SESSION_PATH = `deviceClaimSessions/${SESSION_ID}`;
const LOCK_PATH = `activeDeviceClaims/${DEVICE_ID}`;
const HMAC_KEY = Buffer.from('test-only-device-claim-hmac-key');

function macFor(input: {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly pairCode: string;
}): string {
  return createHmac('sha256', HMAC_KEY)
    .update(`${input.sessionId}:${input.deviceId}:${input.pairCode}`, 'utf8')
    .digest('hex');
}

const codeProtector: ClaimCodeProtector = {
  codeKeyVersion: '7',
  protect(input) {
    return { codeMac: macFor(input), codeKeyVersion: '7' };
  },
  matches(input) {
    const actual = Buffer.from(macFor(input), 'hex');
    const expected = Buffer.from(input.expectedCodeMac, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  },
};

function repositoryFor(database: Firestore): FirestoreDeviceClaimRepository {
  return new FirestoreDeviceClaimRepository(database, codeProtector);
}

function createCommand(overrides: Partial<Parameters<FirestoreDeviceClaimRepository['createSession']>[0]> = {}) {
  return {
    sessionId: SESSION_ID,
    memberUid: 'member-001',
    deviceId: DEVICE_ID,
    pairCode: '00001234',
    createdAtMs: 1_000_000,
    expiresAtMs: 1_300_000,
    ...overrides,
  };
}

function bindCommand(
  overrides: Partial<Parameters<FirestoreDeviceClaimRepository['applyBind']>[0]> = {},
) {
  return {
    deviceId: DEVICE_ID,
    pairCode: '00001234',
    nowMs: 1_100_000,
    ...overrides,
  };
}

async function seedDevice(overrides: Record<string, unknown> = {}): Promise<void> {
  await firestore!.doc(DEVICE_PATH).set({
    deviceId: DEVICE_ID,
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
    customName: '主浴室',
    latestBatteryEventId: 'evt-battery-001',
    latestBatteryLevelPercent: 75,
    lastReportedAtMs: 1_700_000_000_000,
    ...overrides,
  });
  await firestore!.doc(`${DEVICE_PATH}/events/evt-1`).set({ eventId: 'evt-1' });
  await firestore!.doc(`${DEVICE_PATH}/dailyStats/2026-08-02`).set({ urinationCount: 2 });
}

describe.skipIf(!firestore)('Firestore device-claim repository', () => {
  afterEach(async () => {
    await Promise.all([
      firestore!.recursiveDelete(firestore!.doc(DEVICE_PATH)),
      firestore!.recursiveDelete(firestore!.collection('deviceClaimSessions')),
      firestore!.recursiveDelete(firestore!.collection('activeDeviceClaims')),
    ]);
  });

  it('creates one pending session and lock without plaintext while preserving the registry', async () => {
    await seedDevice();
    const deviceBefore = (await firestore!.doc(DEVICE_PATH).get()).data();

    await expect(
      repositoryFor(firestore!).createSession(createCommand()),
    ).resolves.toBe('created');

    const session = (await firestore!.doc(SESSION_PATH).get()).data();
    expect(session).toEqual({
      memberUid: 'member-001',
      expectedDeviceId: DEVICE_ID,
      codeMac: macFor({ sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '00001234' }),
      codeKeyVersion: '7',
      status: 'pending',
      attemptCount: 0,
      rejectedCodeMacs: [],
      createdAtMs: 1_000_000,
      expiresAtMs: 1_300_000,
    });
    expect(JSON.stringify(session)).not.toContain('00001234');
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual({
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      status: 'pending',
      expiresAtMs: 1_300_000,
    });
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(deviceBefore);
    expect((await firestore!.doc(`${DEVICE_PATH}/events/evt-1`).get()).exists).toBe(true);
    expect((await firestore!.doc(`${DEVICE_PATH}/dailyStats/2026-08-02`).get()).exists).toBe(true);
  });

  it('replaces the same member session transactionally and leaves one pending lock', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await expect(repository.createSession(createCommand())).resolves.toBe('created');

    await expect(
      repository.createSession(
        createCommand({
          sessionId: 'session-002',
          pairCode: '87654321',
          createdAtMs: 1_010_000,
          expiresAtMs: 1_310_000,
        }),
      ),
    ).resolves.toBe('replaced');

    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'replaced',
      terminalAtMs: 1_010_000,
    });
    expect((await firestore!.doc('deviceClaimSessions/session-002').get()).data()).toMatchObject({
      memberUid: 'member-001',
      expectedDeviceId: DEVICE_ID,
      status: 'pending',
      attemptCount: 0,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual({
      deviceId: DEVICE_ID,
      sessionId: 'session-002',
      status: 'pending',
      expiresAtMs: 1_310_000,
    });
  });

  it('blocks a foreign member and leaves the existing session and lock unchanged', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    const sessionBefore = (await firestore!.doc(SESSION_PATH).get()).data();
    const lockBefore = (await firestore!.doc(LOCK_PATH).get()).data();

    await expect(
      repository.createSession(
        createCommand({
          sessionId: 'session-foreign',
          memberUid: 'member-002',
          pairCode: '87654321',
          createdAtMs: 1_010_000,
          expiresAtMs: 1_310_000,
        }),
      ),
    ).resolves.toBe('claim_in_progress');

    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(sessionBefore);
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual(lockBefore);
    expect((await firestore!.doc('deviceClaimSessions/session-foreign').get()).exists).toBe(false);
  });

  it('serializes concurrent different-member creates to one pending session', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);

    const outcomes = await Promise.all([
      repository.createSession(createCommand({ sessionId: 'session-a' })),
      repository.createSession(
        createCommand({ sessionId: 'session-b', memberUid: 'member-002', pairCode: '87654321' }),
      ),
    ]);

    expect(outcomes.sort()).toEqual(['claim_in_progress', 'created']);
    const sessions = await firestore!.collection('deviceClaimSessions').get();
    expect(sessions.size).toBe(1);
    expect(sessions.docs[0]?.get('status')).toBe('pending');
    expect((await firestore!.doc(LOCK_PATH).get()).get('sessionId')).toBe(sessions.docs[0]?.id);
  });

  it('expires an old pending session lazily at the exact boundary and creates a replacement', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(
      repository.createSession(
        createCommand({
          sessionId: 'session-after-expiry',
          memberUid: 'member-002',
          pairCode: '87654321',
          createdAtMs: 1_300_000,
          expiresAtMs: 1_600_000,
        }),
      ),
    ).resolves.toBe('created');

    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'expired',
      terminalAtMs: 1_300_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toMatchObject({
      sessionId: 'session-after-expiry',
      status: 'pending',
    });
  });

  it.each([
    ['same member', 'member-001'],
    ['foreign member', 'member-002'],
  ])('does not create a session for an already-owned device (%s)', async (_case, memberUid) => {
    await seedDevice({ ownerUid: 'member-001' });

    await expect(
      repositoryFor(firestore!).createSession(createCommand({ memberUid })),
    ).resolves.toBe('already_owned');
    expect((await firestore!.collection('deviceClaimSessions').get()).empty).toBe(true);
    expect((await firestore!.doc(LOCK_PATH).get()).exists).toBe(false);
  });

  it.each([
    ['disabled', { ingestionStatus: 'disabled' }],
    ['identity mismatch', { deviceId: 'AAAAAAAAAAAA' }],
    ['invalid product model', { productModel: 'pc/mini' }],
    ['malformed empty owner', { ownerUid: '' }],
  ])('fails closed for a %s registry without claim persistence', async (_case, override) => {
    await seedDevice(override);

    await expect(repositoryFor(firestore!).createSession(createCommand())).resolves.toBe(
      'device_unavailable',
    );
    expect((await firestore!.collection('deviceClaimSessions').get()).empty).toBe(true);
    expect((await firestore!.doc(LOCK_PATH).get()).exists).toBe(false);
  });

  it('deduplicates three consecutive deliveries of incorrect code 11111111', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(repository.applyBind(bindCommand({ pairCode: '11111111' }))).resolves.toBe(
      'pending',
    );
    await expect(repository.applyBind(bindCommand({ pairCode: '11111111', nowMs: 1_105_000 }))).resolves.toBe(
      'pending',
    );
    await expect(repository.applyBind(bindCommand({ pairCode: '11111111', nowMs: 1_110_000 }))).resolves.toBe(
      'pending',
    );

    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      rejectedCodeMacs: [
        macFor({
          sessionId: SESSION_ID,
          deviceId: DEVICE_ID,
          pairCode: '11111111',
        }),
      ],
    });
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).not.toHaveProperty('ownerUid');
  });

  it('marks the session and lock failed after the fifth distinct incorrect code', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    for (const [index, pairCode] of [
      '11111111',
      '22222222',
      '33333333',
      '44444444',
      '55555555',
    ].entries()) {
      await repository.applyBind(bindCommand({ pairCode, nowMs: 1_100_000 + index * 1_000 }));
    }

    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'failed',
      attemptCount: 5,
      rejectedCodeMacs: [
        '11111111',
        '22222222',
        '33333333',
        '44444444',
        '55555555',
      ].map((pairCode) => macFor({ sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode })),
      terminalAtMs: 1_104_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual({
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      status: 'failed',
      expiresAtMs: 1_300_000,
      terminalAtMs: 1_104_000,
    });

    const failedSession = (await firestore!.doc(SESSION_PATH).get()).data();
    const failedLock = (await firestore!.doc(LOCK_PATH).get()).data();
    const device = (await firestore!.doc(DEVICE_PATH).get()).data();
    await expect(
      repository.applyBind(bindCommand({ pairCode: '55555555', nowMs: 1_105_000 })),
    ).resolves.toBe('failed');
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(failedSession);
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual(failedLock);
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(device);
  });

  it('deduplicates a previously seen wrong code even after a different code', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await repository.applyBind(bindCommand({ pairCode: '11111111', nowMs: 1_100_000 }));
    await repository.applyBind(bindCommand({ pairCode: '22222222', nowMs: 1_101_000 }));
    await repository.applyBind(bindCommand({ pairCode: '11111111', nowMs: 1_102_000 }));

    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'pending',
      attemptCount: 2,
      rejectedCodeMacs: ['11111111', '22222222'].map((pairCode) =>
        macFor({ sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode }),
      ),
    });
  });

  it('claims an ownerless device once and preserves every registry and child field', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    const deviceBefore = (await firestore!.doc(DEVICE_PATH).get()).data()!;

    await expect(repository.applyBind(bindCommand())).resolves.toBe('claimed');

    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual({
      ...deviceBefore,
      ownerUid: 'member-001',
      claimedAtMs: 1_100_000,
    });
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'claimed',
      terminalAtMs: 1_100_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual({
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
      status: 'claimed',
      expiresAtMs: 1_300_000,
      terminalAtMs: 1_100_000,
    });
    expect((await firestore!.doc(`${DEVICE_PATH}/events/evt-1`).get()).data()).toEqual({
      eventId: 'evt-1',
    });
    expect((await firestore!.doc(`${DEVICE_PATH}/dailyStats/2026-08-02`).get()).data()).toEqual({
      urinationCount: 2,
    });
  });

  it('makes correct deliveries at 0, 5, and 10 seconds one ownership mutation', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(repository.applyBind(bindCommand({ nowMs: 1_100_000 }))).resolves.toBe('claimed');
    const deviceAfterFirst = (await firestore!.doc(DEVICE_PATH).get()).data();
    const sessionAfterFirst = (await firestore!.doc(SESSION_PATH).get()).data();
    const lockAfterFirst = (await firestore!.doc(LOCK_PATH).get()).data();

    await expect(repository.applyBind(bindCommand({ nowMs: 1_105_000 }))).resolves.toBe('claimed');
    await expect(repository.applyBind(bindCommand({ nowMs: 1_110_000 }))).resolves.toBe('claimed');
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(deviceAfterFirst);
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(sessionAfterFirst);
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual(lockAfterFirst);
  });

  it('treats an existing equal owner as idempotent success without mutating the device', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    await firestore!.doc(DEVICE_PATH).update({ ownerUid: 'member-001' });
    const deviceBefore = (await firestore!.doc(DEVICE_PATH).get()).data();

    await expect(repository.applyBind(bindCommand())).resolves.toBe('claimed');
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(deviceBefore);
    expect((await firestore!.doc(SESSION_PATH).get()).get('status')).toBe('claimed');
  });

  it('marks conflict and preserves a different owner and all child documents', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    await firestore!.doc(DEVICE_PATH).update({ ownerUid: 'member-002' });
    const deviceBefore = (await firestore!.doc(DEVICE_PATH).get()).data();

    await expect(repository.applyBind(bindCommand())).resolves.toBe('conflict');
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(deviceBefore);
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'conflict',
      terminalAtMs: 1_100_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).get('status')).toBe('conflict');
    expect((await firestore!.doc(`${DEVICE_PATH}/events/evt-1`).get()).exists).toBe(true);
    expect((await firestore!.doc(`${DEVICE_PATH}/dailyStats/2026-08-02`).get()).exists).toBe(true);

    const conflictSession = (await firestore!.doc(SESSION_PATH).get()).data();
    const conflictLock = (await firestore!.doc(LOCK_PATH).get()).data();
    await expect(repository.applyBind(bindCommand({ nowMs: 1_105_000 }))).resolves.toBe(
      'conflict',
    );
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(deviceBefore);
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(conflictSession);
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual(conflictLock);
  });

  it('expires at 1300000 without setting ownership', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(repository.applyBind(bindCommand({ nowMs: 1_300_000 }))).resolves.toBe('expired');
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).not.toHaveProperty('ownerUid');
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'expired',
      terminalAtMs: 1_300_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).get('status')).toBe('expired');
  });

  it.each([
    ['disabled', { ingestionStatus: 'disabled' }],
    ['identity mismatch', { deviceId: 'AAAAAAAAAAAA' }],
    ['invalid product model', { productModel: 'pc/mini' }],
  ])('rejects a bind after the registry becomes %s without consuming an attempt', async (_case, patch) => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    await firestore!.doc(DEVICE_PATH).update(patch);
    const sessionBefore = (await firestore!.doc(SESSION_PATH).get()).data();
    const lockBefore = (await firestore!.doc(LOCK_PATH).get()).data();

    await expect(
      repository.applyBind(bindCommand({ pairCode: '11111111' })),
    ).resolves.toBe('device_unavailable');
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(sessionBefore);
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toEqual(lockBefore);
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).not.toHaveProperty('claimedAtMs');
  });

  it('returns only the owner-private pending status shape before expiry', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(
      repository.getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_299_999,
      }),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'pending',
      expiresAtMs: 1_300_000,
    });
  });

  it('hides foreign and missing sessions behind the same null outcome', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(
      repository.getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-002',
        nowMs: 1_100_000,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.getSessionStatus({
        sessionId: 'missing-session',
        memberUid: 'member-002',
        nowMs: 1_100_000,
      }),
    ).resolves.toBeNull();
  });

  it('lazily expires an owner session at the exact boundary', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());

    await expect(
      repository.getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_300_000,
      }),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'expired',
      expiresAtMs: 1_300_000,
    });
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toMatchObject({
      status: 'expired',
      terminalAtMs: 1_300_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).data()).toMatchObject({
      status: 'expired',
      terminalAtMs: 1_300_000,
    });
  });

  it('returns replaced and claimed terminal status without changing it', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    await repository.createSession(
      createCommand({
        sessionId: 'session-002',
        pairCode: '87654321',
        createdAtMs: 1_010_000,
        expiresAtMs: 1_310_000,
      }),
    );

    await expect(
      repository.getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_400_000,
      }),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'replaced',
      expiresAtMs: 1_300_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).get('sessionId')).toBe('session-002');

    await repository.applyBind(
      bindCommand({ deviceId: DEVICE_ID, pairCode: '87654321', nowMs: 1_100_000 }),
    );
    const claimedSession = (await firestore!.doc('deviceClaimSessions/session-002').get()).data();
    await expect(
      repository.getSessionStatus({
        sessionId: 'session-002',
        memberUid: 'member-001',
        nowMs: 1_400_000,
      }),
    ).resolves.toEqual({
      sessionId: 'session-002',
      deviceId: DEVICE_ID,
      status: 'claimed',
      expiresAtMs: 1_310_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).exists).toBe(false);
    expect((await firestore!.doc('deviceClaimSessions/session-002').get()).data()).toEqual(
      claimedSession,
    );
  });

  it('lazily deletes an expired claimed lock during create without deleting its session', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    await repository.applyBind(bindCommand({ nowMs: 1_100_000 }));
    const terminalSession = (await firestore!.doc(SESSION_PATH).get()).data();

    await expect(
      repository.getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_299_999,
      }),
    ).resolves.toMatchObject({ status: 'claimed' });
    expect((await firestore!.doc(LOCK_PATH).get()).exists).toBe(true);

    await expect(
      repository.createSession(
        createCommand({
          sessionId: 'session-after-terminal',
          createdAtMs: 1_300_001,
          expiresAtMs: 1_600_001,
        }),
      ),
    ).resolves.toBe('already_owned');

    expect((await firestore!.doc(LOCK_PATH).get()).exists).toBe(false);
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(terminalSession);
    expect((await firestore!.doc('deviceClaimSessions/session-after-terminal').get()).exists).toBe(
      false,
    );
  });

  it('lazily deletes an expired conflict lock during owner query and preserves the session', async () => {
    await seedDevice();
    const repository = repositoryFor(firestore!);
    await repository.createSession(createCommand());
    await firestore!.doc(DEVICE_PATH).update({ ownerUid: 'member-002' });
    await repository.applyBind(bindCommand({ nowMs: 1_100_000 }));
    const terminalSession = (await firestore!.doc(SESSION_PATH).get()).data();

    await expect(
      repository.getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_300_001,
      }),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'conflict',
      expiresAtMs: 1_300_000,
    });
    expect((await firestore!.doc(LOCK_PATH).get()).exists).toBe(false);
    expect((await firestore!.doc(SESSION_PATH).get()).data()).toEqual(terminalSession);
  });

  it('rejects a non-canonical TTL before any Firestore mutation', async () => {
    await seedDevice();

    await expect(
      repositoryFor(firestore!).createSession(createCommand({ expiresAtMs: 1_300_001 })),
    ).rejects.toBeInstanceOf(InvalidClaimCommandError);
    expect((await firestore!.collection('deviceClaimSessions').get()).empty).toBe(true);
    expect((await firestore!.collection('activeDeviceClaims').get()).empty).toBe(true);
  });

  it('fails closed when an injected protector returns unsafe persistence metadata', async () => {
    await seedDevice();
    const unsafeProtector: ClaimCodeProtector = {
      ...codeProtector,
      protect: () => ({ codeMac: '00001234', codeKeyVersion: '7' }),
    };

    await expect(
      new FirestoreDeviceClaimRepository(firestore!, unsafeProtector).createSession(
        createCommand(),
      ),
    ).rejects.toBeInstanceOf(ClaimPersistenceIntegrityError);
    expect((await firestore!.collection('deviceClaimSessions').get()).empty).toBe(true);
    expect((await firestore!.collection('activeDeviceClaims').get()).empty).toBe(true);
  });

  it('maps a transient Firestore transaction failure to the sanitized persistence error', async () => {
    const unavailableFirestore = new Proxy(firestore!, {
      get(target, property) {
        if (property === 'runTransaction') {
          return async () => {
            throw Object.assign(new Error('private Firestore detail'), { code: 14 });
          };
        }
        const member = Reflect.get(target, property, target) as unknown;
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }) as Firestore;

    await expect(
      repositoryFor(unavailableFirestore).createSession(createCommand()),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError);
  });

  it('rejects a corrupt session device identity before returning owner status', async () => {
    await firestore!.doc(SESSION_PATH).set({
      memberUid: 'member-001',
      expectedDeviceId: 'invalid/path',
      codeMac: macFor({ sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '00001234' }),
      codeKeyVersion: '7',
      status: 'pending',
      attemptCount: 0,
      rejectedCodeMacs: [],
      createdAtMs: 1_000_000,
      expiresAtMs: 1_300_000,
    });

    await expect(
      repositoryFor(firestore!).getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_100_000,
      }),
    ).rejects.toBeInstanceOf(ClaimPersistenceIntegrityError);
  });

  it('hides a corrupt foreign session behind the same null outcome as missing', async () => {
    await firestore!.doc(SESSION_PATH).set({
      memberUid: 'member-002',
      expectedDeviceId: 'invalid/path',
      codeMac: 'not-a-valid-mac',
      codeKeyVersion: 'invalid-version',
      status: 'pending',
      attemptCount: 99,
      rejectedCodeMacs: 'not-an-array',
      createdAtMs: -1,
      expiresAtMs: -1,
    });

    await expect(
      repositoryFor(firestore!).getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_100_000,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    [
      'more than five entries',
      ['11111111', '22222222', '33333333', '44444444', '55555555', '66666666'],
    ],
    ['duplicate entries', ['11111111', '11111111']],
  ])('rejects owner session data with %s in rejectedCodeMacs', async (_case, pairCodes) => {
    const rejectedCodeMacs = pairCodes.map((pairCode) =>
      macFor({ sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode }),
    );
    await firestore!.doc(SESSION_PATH).set({
      memberUid: 'member-001',
      expectedDeviceId: DEVICE_ID,
      codeMac: macFor({ sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '00001234' }),
      codeKeyVersion: '7',
      status: 'pending',
      attemptCount: rejectedCodeMacs.length,
      rejectedCodeMacs,
      createdAtMs: 1_000_000,
      expiresAtMs: 1_300_000,
    });

    await expect(
      repositoryFor(firestore!).getSessionStatus({
        sessionId: SESSION_ID,
        memberUid: 'member-001',
        nowMs: 1_100_000,
      }),
    ).rejects.toBeInstanceOf(ClaimPersistenceIntegrityError);
  });
});
