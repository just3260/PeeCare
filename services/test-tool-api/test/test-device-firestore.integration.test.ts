import { Firestore } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { APPROVED_WEB_ORIGIN } from '../src/config.js';
import {
  DEVELOPMENT_TEST_TOOL_MARKER,
  FirestoreTestToolRepository,
  TestDeviceNotFoundError,
} from '../src/devices/test-device-repository.js';
import { deriveUsageLedgerDocumentId, RateLimitedError } from '../src/usage/usage-ledger.js';
import { TestEventService } from '../src/events/test-event-service.js';
import { FirebaseIdTokenVerifier } from '../src/security/firebase-id-token-verifier.js';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const firestore = emulatorHost
  ? new Firestore({ projectId: 'demo-peecare', host: emulatorHost, ssl: false })
  : null;
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const authApp = firestore && authEmulatorHost
  ? initializeApp({ projectId: 'demo-peecare' }, `test-tool-auth-${process.pid}`)
  : null;
const MEMBER_UID = 'member-test-tool';
const DEVICE_ID = 'PC-TEST-TOOL-0001';
const DEVICE_PATH = `devices/${DEVICE_ID}`;
const LEDGER_ID = deriveUsageLedgerDocumentId(MEMBER_UID);
const LEDGER_PATH = `developmentTestToolUsage/${LEDGER_ID}`;

function eligibleDevice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: DEVICE_ID,
    ownerUid: MEMBER_UID,
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
    customName: '測試浴室',
    developmentTestTool: {
      enabled: true,
      marker: DEVELOPMENT_TEST_TOOL_MARKER,
    },
    registryRevision: 7,
    ...overrides,
  };
}

function unmarkedDevice(): Record<string, unknown> {
  const { developmentTestTool: _marker, ...device } = eligibleDevice();
  return device;
}

async function seedDevice(data: Record<string, unknown>): Promise<void> {
  await firestore!.doc(DEVICE_PATH).set(data);
  await firestore!.doc(`${DEVICE_PATH}/events/existing-event`).set({ eventId: 'existing-event' });
}

async function createEmulatorUser(): Promise<{ localId: string; idToken: string }> {
  const response = await fetch(
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  if (!response.ok) throw new Error('Auth Emulator user creation failed.');
  const value = await response.json() as { localId?: unknown; idToken?: unknown };
  if (typeof value.localId !== 'string' || typeof value.idToken !== 'string') {
    throw new Error('Auth Emulator returned an invalid user.');
  }
  return { localId: value.localId, idToken: value.idToken };
}

afterAll(async () => {
  if (authApp) await deleteApp(authApp);
});

describe.skipIf(!firestore)('Firestore test-device authorization', () => {
  afterEach(async () => {
    await Promise.all([
      firestore!.recursiveDelete(firestore!.doc(DEVICE_PATH)),
      firestore!.recursiveDelete(firestore!.doc('devices/PC-TEST-TOOL-OTHER')),
      firestore!.recursiveDelete(firestore!.doc(LEDGER_PATH)),
    ]);
  });

  it('authorizes and lists an owned marked device without changing registry state', async () => {
    await seedDevice(eligibleDevice());
    const before = (await firestore!.doc(DEVICE_PATH).get()).data();
    const submit = vi.fn(async () => ({ status: 'stored' as const }));
    const repository = new FirestoreTestToolRepository(firestore!, { submit });

    await expect(repository.listTestDevices(MEMBER_UID)).resolves.toEqual([
      { deviceId: DEVICE_ID, displayName: '測試浴室' },
    ]);
    await expect(
      repository.submitTestEvent({
        memberUid: MEMBER_UID,
        deviceId: DEVICE_ID,
        body: { eventType: 'battery', batteryLevelPercent: 75 },
      }),
    ).resolves.toEqual({ status: 'stored' });

    expect(submit).toHaveBeenCalledWith({
      device: { deviceId: DEVICE_ID, productModel: 'pc-mini' },
      sequence: 0,
      body: { eventType: 'battery', batteryLevelPercent: 75 },
    });
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(before);
    expect((await firestore!.doc(`${DEVICE_PATH}/events/existing-event`).get()).exists).toBe(true);
    expect((await firestore!.doc(LEDGER_PATH).get()).data()).toMatchObject({
      dayKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      acceptedToday: 1,
    });
  });

  it.each([
    ['foreign owner', eligibleDevice({ ownerUid: 'member-foreign' })],
    ['disabled', eligibleDevice({ ingestionStatus: 'disabled' })],
    ['malformed', eligibleDevice({ productModel: 'pc/mini' })],
    ['unmarked', unmarkedDevice()],
    [
      'not exact marker',
      eligibleDevice({
        developmentTestTool: {
          enabled: true,
          marker: DEVELOPMENT_TEST_TOOL_MARKER,
          extra: true,
        },
      }),
    ],
  ])('rejects %s with no registry, usage, or downstream write', async (_case, data) => {
    await seedDevice(data);
    const before = (await firestore!.doc(DEVICE_PATH).get()).data();
    const submit = vi.fn();
    const repository = new FirestoreTestToolRepository(firestore!, { submit });

    await expect(
      repository.submitTestEvent({
        memberUid: MEMBER_UID,
        deviceId: DEVICE_ID,
        body: { eventType: 'battery', batteryLevelPercent: 75 },
      }),
    ).rejects.toMatchObject(new TestDeviceNotFoundError());
    await expect(repository.listTestDevices(MEMBER_UID)).resolves.toEqual([]);

    expect(submit).not.toHaveBeenCalled();
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toEqual(before);
    expect((await firestore!.collection('developmentTestToolUsage').get()).empty).toBe(true);
  });

  it('makes a missing document indistinguishable and creates nothing', async () => {
    const submit = vi.fn();
    const repository = new FirestoreTestToolRepository(firestore!, { submit });

    await expect(
      repository.submitTestEvent({
        memberUid: MEMBER_UID,
        deviceId: DEVICE_ID,
        body: { eventType: 'battery', batteryLevelPercent: 75 },
      }),
    ).rejects.toMatchObject(new TestDeviceNotFoundError());

    expect(submit).not.toHaveBeenCalled();
    expect((await firestore!.doc(DEVICE_PATH).get()).exists).toBe(false);
    expect((await firestore!.collection('developmentTestToolUsage').get()).empty).toBe(true);
  });

  it('allows only one concurrent reservation and one downstream call in a time window', async () => {
    await seedDevice(eligibleDevice());
    const submit = vi.fn(async () => ({ status: 'stored' as const }));
    const repository = new FirestoreTestToolRepository(firestore!, { submit }, {
      nowMs: () => 1_786_449_600_000,
    });
    const submission = {
      memberUid: MEMBER_UID,
      deviceId: DEVICE_ID,
      body: { eventType: 'battery' as const, batteryLevelPercent: 75 as const },
    };

    const results = await Promise.allSettled([
      repository.submitTestEvent(submission),
      repository.submitTestEvent(submission),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({ status: 'rejected', reason: new RateLimitedError(1) });
    expect(submit).toHaveBeenCalledOnce();
    expect((await firestore!.doc(LEDGER_PATH).get()).data()).toMatchObject({ acceptedToday: 1 });
  });
});

describe.skipIf(!firestore || !authApp)('Firebase token to Firestore authorization', () => {
  const createdUids: string[] = [];
  const activeApps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    await Promise.all([
      ...[...activeApps].map(async (app) => {
        await app.close();
        activeApps.delete(app);
      }),
      firestore!.recursiveDelete(firestore!.doc(DEVICE_PATH)),
      firestore!.recursiveDelete(firestore!.collection('developmentTestToolUsage')),
      ...createdUids.splice(0).map(async (uid) => {
        await getAuth(authApp!).deleteUser(uid);
      }),
    ]);
  });

  it('binds a real Emulator ID token to Owner/marker checks without trusting a caller UID', async () => {
    const owner = await createEmulatorUser();
    createdUids.push(owner.localId);
    const foreign = await createEmulatorUser();
    createdUids.push(foreign.localId);
    const ownerLedgerPath =
      `developmentTestToolUsage/${deriveUsageLedgerDocumentId(owner.localId)}`;
    await seedDevice(eligibleDevice({ ownerUid: owner.localId }));

    const ingestion = { submit: vi.fn(async () => 'stored' as const) };
    const repository = new FirestoreTestToolRepository(
      firestore!,
      new TestEventService(
        ingestion,
        { nowMs: () => 1_786_449_600_000 },
        { randomUuid: () => '1b59ef13-fc86-4c17-95d4-8556ed098d32' },
      ),
      { nowMs: () => 1_786_449_600_000 },
    );
    const app = buildApp({
      dependencies: {
        tokenVerifier: new FirebaseIdTokenVerifier(getAuth(authApp!)),
        repository,
      },
      allowedOrigin: APPROVED_WEB_ORIGIN,
      enabled: true,
    });
    activeApps.add(app);

    const ownerList = await app.inject({
      method: 'GET',
      url: '/v1/test-devices',
      headers: {
        origin: APPROVED_WEB_ORIGIN,
        authorization: `Bearer ${owner.idToken}`,
      },
    });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json()).toEqual({
      devices: [{ deviceId: DEVICE_ID, displayName: '測試浴室' }],
    });

    const foreignEvent = await app.inject({
      method: 'POST',
      url: `/v1/test-devices/${DEVICE_ID}/events`,
      headers: {
        origin: APPROVED_WEB_ORIGIN,
        authorization: `Bearer ${foreign.idToken}`,
        'content-type': 'application/json',
      },
      payload: {
        eventType: 'urination',
        flushDurationMs: 1_500,
        pumpDurationMs: 2_500,
      },
    });
    expect(foreignEvent.statusCode).toBe(404);
    expect(foreignEvent.json().error.code).toBe('test_device_not_found');
    expect(ingestion.submit).not.toHaveBeenCalled();

    const ownerEvent = await app.inject({
      method: 'POST',
      url: `/v1/test-devices/${DEVICE_ID}/events`,
      headers: {
        origin: APPROVED_WEB_ORIGIN,
        authorization: `Bearer ${owner.idToken}`,
        'content-type': 'application/json',
      },
      payload: {
        eventType: 'urination',
        flushDurationMs: 1_500,
        pumpDurationMs: 2_500,
      },
    });
    expect(ownerEvent.statusCode).toBe(200);
    expect(ownerEvent.json()).toMatchObject({
      status: 'stored',
      deviceId: DEVICE_ID,
      eventType: 'urination',
      sequence: 0,
    });
    expect(ingestion.submit).toHaveBeenCalledOnce();
    expect((await firestore!.doc(ownerLedgerPath).get()).data()).toMatchObject({
      acceptedToday: 1,
      devices: {
        [createHash('sha256').update(`device:${DEVICE_ID}`).digest('hex')]: {
          lastAcceptedAtMs: 1_786_449_600_000,
          nextSequence: 1,
        },
      },
    });
  }, 30_000);
});
