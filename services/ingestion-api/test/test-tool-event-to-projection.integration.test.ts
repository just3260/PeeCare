import { Firestore } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp as buildIngestionApp } from '../src/app.js';
import { FirestoreEventSink } from '../src/firestore/firestore-event-sink.js';
import {
  DEVELOPMENT_TEST_TOOL_MARKER,
  FirestoreTestToolRepository,
} from '../../test-tool-api/src/devices/test-device-repository.js';
import { TestEventService } from '../../test-tool-api/src/events/test-event-service.js';
import { deriveUsageLedgerDocumentId } from '../../test-tool-api/src/usage/usage-ledger.js';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const firestore = emulatorHost
  ? new Firestore({ projectId: 'demo-peecare', host: emulatorHost, ssl: false })
  : null;
const MEMBER_UID = 'member-test-tool-projection';
const DEVICE_ID = 'PC-TEST-TOOL-PROJECTION';
const DEVICE_PATH = `devices/${DEVICE_ID}`;
const LEDGER_PATH =
  `developmentTestToolUsage/${deriveUsageLedgerDocumentId(MEMBER_UID)}`;
const INGESTION_SECRET = 'emulator-test-tool-ingestion-secret';

describe.skipIf(!firestore)('Test Tool event to Ingestion projection', () => {
  let nowMs = 1_786_449_600_000;
  const activeApps = new Set<ReturnType<typeof buildIngestionApp>>();

  beforeEach(async () => {
    nowMs = 1_786_449_600_000;
    await firestore!.doc(DEVICE_PATH).set({
      deviceId: DEVICE_ID,
      ownerUid: MEMBER_UID,
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      developmentTestTool: {
        enabled: true,
        marker: DEVELOPMENT_TEST_TOOL_MARKER,
      },
    });
  });

  afterEach(async () => {
    await Promise.all([
      ...[...activeApps].map(async (app) => {
        await app.close();
        activeApps.delete(app);
      }),
      firestore!.recursiveDelete(firestore!.doc(DEVICE_PATH)),
      firestore!.recursiveDelete(firestore!.doc(LEDGER_PATH)),
    ]);
  });

  it('projects canonical urination and battery events through the real Ingestion app', async () => {
    const ingestionApp = buildIngestionApp({
      currentSecret: INGESTION_SECRET,
      now: () => nowMs,
      sink: new FirestoreEventSink(firestore!),
    });
    activeApps.add(ingestionApp);
    const ingestionClient = {
      async submit(envelope: unknown): Promise<'stored' | 'duplicate'> {
        const response = await ingestionApp.inject({
          method: 'POST',
          url: '/v1/emqx/events',
          headers: {
            authorization: `Bearer ${INGESTION_SECRET}`,
            'content-type': 'application/json',
          },
          payload: envelope,
        });
        if (response.statusCode === 201) return 'stored';
        if (response.statusCode === 200) return 'duplicate';
        throw new Error('Ingestion integration rejected a canonical Test Tool event.');
      },
    };
    let uuidIndex = 1;
    const repository = new FirestoreTestToolRepository(
      firestore!,
      new TestEventService(
        ingestionClient,
        { nowMs: () => nowMs },
        {
          randomUuid: () => uuidIndex++ === 1
            ? '1b59ef13-fc86-4c17-95d4-8556ed098d32'
            : '2c69ef13-fc86-4c17-95d4-8556ed098d43',
        },
      ),
      { nowMs: () => nowMs },
    );

    const urination = await repository.submitTestEvent({
      memberUid: MEMBER_UID,
      deviceId: DEVICE_ID,
      body: {
        eventType: 'urination',
        flushDurationMs: 3_000,
        pumpDurationMs: 5_000,
      },
    });
    expect(urination).toMatchObject({
      status: 'stored',
      eventType: 'urination',
      deviceId: DEVICE_ID,
      sequence: 0,
    });
    const urinationId = (urination as { eventId: string }).eventId;
    expect((await firestore!.doc(`${DEVICE_PATH}/events/${urinationId}`).get()).data())
      .toMatchObject({
        eventType: 'urination',
        firmwareVersion: '0.0.0-test-tool',
        flushDurationMs: 3_000,
        pumpDurationMs: 5_000,
        estimatedUrineMl: 20,
      });
    const dailyDocuments = await firestore!
      .collection(`${DEVICE_PATH}/dailyStats`)
      .get();
    expect(dailyDocuments.docs).toHaveLength(1);
    expect(dailyDocuments.docs[0].data()).toMatchObject({
      urinationCount: 1,
      estimatedUrineTotalMl: 20,
    });

    nowMs += 1_000;
    const battery = await repository.submitTestEvent({
      memberUid: MEMBER_UID,
      deviceId: DEVICE_ID,
      body: {
        eventType: 'battery',
        batteryLevelPercent: 75,
        batteryVoltageMv: 3_975,
      },
    });
    expect(battery).toMatchObject({
      status: 'stored',
      eventType: 'battery',
      deviceId: DEVICE_ID,
      sequence: 1,
    });
    const batteryId = (battery as { eventId: string }).eventId;
    expect((await firestore!.doc(`${DEVICE_PATH}/events/${batteryId}`).get()).data())
      .toMatchObject({
        eventId: batteryId,
        deviceId: DEVICE_ID,
        eventType: 'battery',
        sequence: 1,
        firmwareVersion: '0.0.0-test-tool',
        batteryLevelPercent: 75,
        batteryVoltageMv: 3_975,
      });
    expect((await firestore!.doc(DEVICE_PATH).get()).data()).toMatchObject({
      latestUrinationEventId: urinationId,
      latestBatteryEventId: batteryId,
      latestBatteryLevelPercent: 75,
      latestBatteryVoltageMv: 3_975,
      todayUrinationCount: 1,
      todayEstimatedUrineTotalMl: 20,
    });
    expect((await firestore!.doc(LEDGER_PATH).get()).data()).toMatchObject({
      acceptedToday: 2,
      devices: {
        [createHash('sha256').update(`device:${DEVICE_ID}`).digest('hex')]: {
          lastAcceptedAtMs: nowMs,
          nextSequence: 2,
        },
      },
    });
  }, 30_000);
});
