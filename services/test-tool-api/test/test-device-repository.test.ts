import type { Firestore } from '@google-cloud/firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  DEVELOPMENT_TEST_TOOL_MARKER,
  FirestoreTestToolRepository,
  TestDeviceNotFoundError,
  type TestEventSubmitter,
} from '../src/devices/test-device-repository.js';
import {
  deriveUsageLedgerDocumentId,
  UsageLedgerIntegrityError,
} from '../src/usage/usage-ledger.js';

const MEMBER_UID = 'member-001';
const DEVICE_ID = 'PC-DEV-000001';

function eligibleDevice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: DEVICE_ID,
    ownerUid: MEMBER_UID,
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
    customName: '主浴室',
    developmentTestTool: {
      enabled: true,
      marker: DEVELOPMENT_TEST_TOOL_MARKER,
    },
    ...overrides,
  };
}

interface StoredDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

function firestoreDouble(documents: readonly StoredDocument[]): {
  readonly firestore: Firestore;
  readonly transactionWrites: ReturnType<typeof vi.fn>;
} {
  const byId = new Map(documents.map((document) => [document.id, document.data]));
  const transactionWrites = vi.fn();
  const snapshot = (id: string) => ({
    id,
    exists: byId.has(id),
    data: () => byId.get(id),
  });
  const firestore = {
    collection: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn(async () => ({ docs: documents.map(({ id }) => snapshot(id)) })),
      })),
    })),
    doc: vi.fn((path: string) => ({ id: path.split('/').at(-1), path })),
    runTransaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) =>
      operation({
        get: vi.fn(async (reference: { id: string }) => snapshot(reference.id)),
        create: transactionWrites,
        set: transactionWrites,
        update: transactionWrites,
        delete: transactionWrites,
      }),
    ),
  };
  return { firestore: firestore as unknown as Firestore, transactionWrites };
}

function submitter(): TestEventSubmitter & { submit: ReturnType<typeof vi.fn> } {
  return { submit: vi.fn(async () => ({ status: 'stored' })) };
}

describe('Firestore test-device authorization repository', () => {
  it('lists only eligible owned devices and exposes only resolved projections', async () => {
    const database = firestoreDouble([
      { id: DEVICE_ID, data: eligibleDevice() },
      {
        id: 'PC-DEV-000002',
        data: eligibleDevice({
          deviceId: 'PC-DEV-000002',
          customName: undefined,
        }),
      },
      {
        id: 'PC-DEV-FOREIGN',
        data: eligibleDevice({ deviceId: 'PC-DEV-FOREIGN', ownerUid: 'member-foreign' }),
      },
      {
        id: 'PC-DEV-UNMARKED',
        data: eligibleDevice({ deviceId: 'PC-DEV-UNMARKED', developmentTestTool: undefined }),
      },
    ]);
    const repository = new FirestoreTestToolRepository(database.firestore, submitter());

    await expect(repository.listTestDevices(MEMBER_UID)).resolves.toEqual([
      { deviceId: DEVICE_ID, displayName: '主浴室' },
      { deviceId: 'PC-DEV-000002', displayName: 'PC-DEV-000002' },
    ]);
    expect(JSON.stringify(await repository.listTestDevices(MEMBER_UID))).not.toMatch(
      /ownerUid|productModel|ingestionStatus|customName|developmentTestTool/,
    );
    expect(database.transactionWrites).not.toHaveBeenCalled();
  });

  it('falls back to immutable deviceId instead of exposing a malformed customName', async () => {
    const database = firestoreDouble([
      { id: DEVICE_ID, data: eligibleDevice({ customName: 'private\nname' }) },
    ]);
    const repository = new FirestoreTestToolRepository(database.firestore, submitter());

    await expect(repository.listTestDevices(MEMBER_UID)).resolves.toEqual([
      { deviceId: DEVICE_ID, displayName: DEVICE_ID },
    ]);
  });

  it('rechecks the current device document in a transaction before delegation', async () => {
    const database = firestoreDouble([{ id: DEVICE_ID, data: eligibleDevice() }]);
    const downstream = submitter();
    const repository = new FirestoreTestToolRepository(database.firestore, downstream);
    const body = { eventType: 'battery', batteryLevelPercent: 75 } as const;

    await expect(
      repository.submitTestEvent({ memberUid: MEMBER_UID, deviceId: DEVICE_ID, body }),
    ).resolves.toEqual({ status: 'stored' });
    expect(downstream.submit).toHaveBeenCalledWith({
      device: { deviceId: DEVICE_ID, productModel: 'pc-mini' },
      sequence: 0,
      body,
    });
    expect(database.transactionWrites).toHaveBeenCalledOnce();
  });

  it('keeps the committed reservation when downstream submission fails', async () => {
    const database = firestoreDouble([{ id: DEVICE_ID, data: eligibleDevice() }]);
    const downstream = submitter();
    downstream.submit.mockRejectedValue(new Error('transient upstream failure'));
    const repository = new FirestoreTestToolRepository(database.firestore, downstream, {
      nowMs: () => 1_786_449_600_000,
    });

    await expect(
      repository.submitTestEvent({
        memberUid: MEMBER_UID,
        deviceId: DEVICE_ID,
        body: { eventType: 'battery', batteryLevelPercent: 75 },
      }),
    ).rejects.toThrow('transient upstream failure');

    expect(database.transactionWrites).toHaveBeenCalledOnce();
    expect(database.transactionWrites).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^developmentTestToolUsage\/[a-f0-9]{64}$/) }),
      expect.objectContaining({ acceptedToday: 1 }),
    );
    expect(downstream.submit).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 0 }),
    );
    expect(database.transactionWrites.mock.invocationCallOrder[0]).toBeLessThan(
      downstream.submit.mock.invocationCallOrder[0]!,
    );
  });

  it('does not write or delegate when the ledger day is in the future', async () => {
    const ledgerId = deriveUsageLedgerDocumentId(MEMBER_UID);
    const database = firestoreDouble([
      { id: DEVICE_ID, data: eligibleDevice() },
      {
        id: ledgerId,
        data: {
          schemaVersion: 1,
          dayKey: '2026-08-12',
          acceptedToday: 500,
          devices: {},
        },
      },
    ]);
    const downstream = submitter();
    const repository = new FirestoreTestToolRepository(database.firestore, downstream, {
      nowMs: () => Date.UTC(2026, 7, 11, 12, 0, 0),
    });

    await expect(
      repository.submitTestEvent({
        memberUid: MEMBER_UID,
        deviceId: DEVICE_ID,
        body: { eventType: 'battery', batteryLevelPercent: 75 },
      }),
    ).rejects.toMatchObject(new UsageLedgerIntegrityError());
    expect(database.transactionWrites).not.toHaveBeenCalled();
    expect(downstream.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['non-object', 'invalid'],
    ['document id mismatch', eligibleDevice({ deviceId: 'PC-DEV-OTHER' })],
    ['foreign owner', eligibleDevice({ ownerUid: 'member-foreign' })],
    ['missing owner', eligibleDevice({ ownerUid: undefined })],
    ['disabled ingestion', eligibleDevice({ ingestionStatus: 'disabled' })],
    ['missing ingestion status', eligibleDevice({ ingestionStatus: undefined })],
    ['missing product model', eligibleDevice({ productModel: undefined })],
    ['unsafe product model', eligibleDevice({ productModel: 'pc/mini' })],
    ['missing marker', eligibleDevice({ developmentTestTool: undefined })],
    [
      'disabled marker',
      eligibleDevice({
        developmentTestTool: { enabled: false, marker: DEVELOPMENT_TEST_TOOL_MARKER },
      }),
    ],
    [
      'wrong marker',
      eligibleDevice({ developmentTestTool: { enabled: true, marker: 'another-marker' } }),
    ],
    [
      'marker with extra property',
      eligibleDevice({
        developmentTestTool: {
          enabled: true,
          marker: DEVELOPMENT_TEST_TOOL_MARKER,
          role: 'admin',
        },
      }),
    ],
  ])('hides %s eligibility failure and never delegates or writes', async (_case, data) => {
    const documents = data === undefined ? [] : [{ id: DEVICE_ID, data }];
    const database = firestoreDouble(documents as readonly StoredDocument[]);
    const downstream = submitter();
    const repository = new FirestoreTestToolRepository(database.firestore, downstream);

    const rejection = repository.submitTestEvent({
      memberUid: MEMBER_UID,
      deviceId: DEVICE_ID,
      body: { eventType: 'urination', flushDurationMs: 3000, pumpDurationMs: 5000 },
    });

    await expect(rejection).rejects.toMatchObject(new TestDeviceNotFoundError());
    await expect(rejection).rejects.toMatchObject({
      code: 'test_device_not_found',
      message: 'Test device not found.',
    });
    expect(downstream.submit).not.toHaveBeenCalled();
    expect(database.transactionWrites).not.toHaveBeenCalled();
  });
});
