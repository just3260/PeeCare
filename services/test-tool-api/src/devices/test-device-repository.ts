import type { DocumentSnapshot, Firestore } from '@google-cloud/firestore';

import type {
  TestDeviceSummary,
  TestEventSubmission,
  TestToolRepository,
} from '../app.js';
import {
  deriveUsageLedgerDocumentId,
  reserveTestToolUsage,
} from '../usage/usage-ledger.js';

export const DEVELOPMENT_TEST_TOOL_MARKER = 'petcare-c7483-beta-v1';

const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_CUSTOM_NAME_CODE_POINTS = 30;
const FORBIDDEN_CUSTOM_NAME_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export interface AuthorizedTestDevice {
  readonly deviceId: string;
  readonly productModel: string;
}

export interface AuthorizedTestEventSubmission {
  readonly device: AuthorizedTestDevice;
  readonly sequence: number;
  readonly body: TestEventSubmission['body'];
}

export interface TestEventSubmitter {
  submit(submission: AuthorizedTestEventSubmission): Promise<unknown>;
}

export interface TestToolClock {
  nowMs(): number;
}

const SYSTEM_CLOCK: TestToolClock = { nowMs: () => Date.now() };

export class TestDeviceNotFoundError extends Error {
  readonly code = 'test_device_not_found' as const;

  constructor() {
    super('Test device not found.');
    this.name = 'TestDeviceNotFoundError';
    Object.setPrototypeOf(this, TestDeviceNotFoundError.prototype);
  }
}

interface ParsedTestDevice extends AuthorizedTestDevice, TestDeviceSummary {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalCustomName(value: unknown): value is string {
  if (typeof value !== 'string' || FORBIDDEN_CUSTOM_NAME_CHARACTERS.test(value)) {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed === value &&
    Array.from(trimmed).length <= MAX_CUSTOM_NAME_CODE_POINTS
  );
}

function hasExactDevelopmentMarker(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    Object.prototype.hasOwnProperty.call(value, 'enabled') &&
    Object.prototype.hasOwnProperty.call(value, 'marker') &&
    value.enabled === true &&
    value.marker === DEVELOPMENT_TEST_TOOL_MARKER
  );
}

export interface ParseTestDeviceInput {
  readonly documentId: string;
  readonly data: unknown;
  readonly memberUid: string;
}

/**
 * Parse an untrusted registry document through the complete Test Tool gate.
 * Returning null for every failure keeps missing and ineligible devices
 * indistinguishable to callers.
 */
export function parseEligibleTestDevice(input: ParseTestDeviceInput): ParsedTestDevice | null {
  const { documentId, data, memberUid } = input;
  if (!TOPIC_SEGMENT_PATTERN.test(documentId) || memberUid.length === 0 || !isRecord(data)) {
    return null;
  }
  if (
    data.deviceId !== documentId ||
    data.ownerUid !== memberUid ||
    data.ingestionStatus !== 'enabled' ||
    typeof data.productModel !== 'string' ||
    !TOPIC_SEGMENT_PATTERN.test(data.productModel) ||
    !hasExactDevelopmentMarker(data.developmentTestTool)
  ) {
    return null;
  }

  return {
    deviceId: documentId,
    productModel: data.productModel,
    displayName: isCanonicalCustomName(data.customName) ? data.customName : documentId,
  };
}

function parseSnapshot(snapshot: DocumentSnapshot, memberUid: string): ParsedTestDevice | null {
  if (!snapshot.exists) return null;
  return parseEligibleTestDevice({
    documentId: snapshot.id,
    data: snapshot.data(),
    memberUid,
  });
}

/**
 * Read-only registry adapter. Event authorization is deliberately performed in
 * a transaction so the same parser can be reused when usage reservation joins
 * that transaction.
 */
export class FirestoreTestToolRepository implements TestToolRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly eventSubmitter: TestEventSubmitter,
    private readonly clock: TestToolClock = SYSTEM_CLOCK,
  ) {}

  async listTestDevices(memberUid: string): Promise<readonly TestDeviceSummary[]> {
    if (memberUid.length === 0) return [];
    const result = await this.firestore
      .collection('devices')
      .where('ownerUid', '==', memberUid)
      .get();

    return result.docs.flatMap((snapshot) => {
      const parsed = parseSnapshot(snapshot, memberUid);
      return parsed
        ? [{ deviceId: parsed.deviceId, displayName: parsed.displayName }]
        : [];
    });
  }

  async submitTestEvent(submission: TestEventSubmission): Promise<unknown> {
    if (
      submission.memberUid.length === 0 ||
      !TOPIC_SEGMENT_PATTERN.test(submission.deviceId)
    ) {
      throw new TestDeviceNotFoundError();
    }
    const reference = this.firestore.doc(`devices/${submission.deviceId}`);
    const ledgerReference = this.firestore.doc(
      `developmentTestToolUsage/${deriveUsageLedgerDocumentId(submission.memberUid)}`,
    );
    const reservation = await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const parsed = parseSnapshot(snapshot, submission.memberUid);
      if (!parsed) throw new TestDeviceNotFoundError();
      const ledgerSnapshot = await transaction.get(ledgerReference);
      const usage = reserveTestToolUsage({
        currentData: ledgerSnapshot.exists ? ledgerSnapshot.data() : undefined,
        deviceId: parsed.deviceId,
        nowMs: this.clock.nowMs(),
      });
      transaction.set(ledgerReference, usage.ledger);
      return {
        device: { deviceId: parsed.deviceId, productModel: parsed.productModel },
        sequence: usage.sequence,
      };
    });

    return this.eventSubmitter.submit({
      device: reservation.device,
      sequence: reservation.sequence,
      body: submission.body,
    });
  }
}
