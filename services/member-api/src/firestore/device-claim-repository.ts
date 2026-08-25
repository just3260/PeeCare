import type { Firestore } from '@google-cloud/firestore';

import {
  PAIR_CODE_TTL_MS,
  type PairCodeMacInput,
  type PairCodeProtector,
} from '../claims/pair-code.js';
import { PersistenceUnavailableError } from '../http/errors.js';

export type ClaimSessionStatus =
  | 'pending'
  | 'claimed'
  | 'expired'
  | 'failed'
  | 'conflict'
  | 'replaced';

export type ClaimCodeInput = PairCodeMacInput;
export type ClaimCodeProtector = PairCodeProtector;

export interface CreateClaimSessionCommand extends ClaimCodeInput {
  readonly memberUid: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export type CreateClaimSessionOutcome =
  | 'created'
  | 'replaced'
  | 'claim_in_progress'
  | 'already_owned'
  | 'device_unavailable';

const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/;
const PRODUCT_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classifyDevice(
  deviceId: string,
  value: unknown,
): 'ownerless' | 'owned' | 'unavailable' {
  if (
    !isRecord(value) ||
    value.deviceId !== deviceId ||
    value.ingestionStatus !== 'enabled' ||
    typeof value.productModel !== 'string' ||
    !PRODUCT_MODEL_PATTERN.test(value.productModel)
  ) {
    return 'unavailable';
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'ownerUid')) return 'ownerless';
  return typeof value.ownerUid === 'string' && value.ownerUid.length > 0
    ? 'owned'
    : 'unavailable';
}

interface StoredClaimSession {
  readonly memberUid: string;
  readonly expectedDeviceId: string;
  readonly codeMac: string;
  readonly codeKeyVersion: string;
  readonly status: ClaimSessionStatus;
  readonly attemptCount: number;
  readonly rejectedCodeMacs: readonly string[];
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

interface StoredActiveClaimLock {
  readonly deviceId: string;
  readonly sessionId: string;
  readonly status: ClaimSessionStatus;
  readonly expiresAtMs: number;
}

const CLAIM_STATUSES = new Set<ClaimSessionStatus>([
  'pending',
  'claimed',
  'expired',
  'failed',
  'conflict',
  'replaced',
]);
const ACTIVE_LOCK_STATUSES = new Set<ClaimSessionStatus>([
  'pending',
  'claimed',
  'expired',
  'failed',
  'conflict',
]);

export class InvalidClaimCommandError extends Error {
  readonly code = 'invalid_claim_command' as const;

  constructor() {
    super('Claim repository command failed validation.');
    this.name = 'InvalidClaimCommandError';
    Object.setPrototypeOf(this, InvalidClaimCommandError.prototype);
  }
}

export class ClaimPersistenceIntegrityError extends Error {
  readonly code = 'claim_persistence_integrity' as const;

  constructor() {
    super('Claim persistence data failed integrity validation.');
    this.name = 'ClaimPersistenceIntegrityError';
    Object.setPrototypeOf(this, ClaimPersistenceIntegrityError.prototype);
  }
}

function parseStoredSession(value: unknown, expectedDeviceId: string): StoredClaimSession {
  const rejectedCodeMacs = isRecord(value) && Array.isArray(value.rejectedCodeMacs)
    ? value.rejectedCodeMacs
    : null;
  if (
    !isRecord(value) ||
    typeof value.memberUid !== 'string' ||
    value.memberUid.length === 0 ||
    !DEVICE_ID_PATTERN.test(expectedDeviceId) ||
    value.expectedDeviceId !== expectedDeviceId ||
    typeof value.codeMac !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.codeMac) ||
    typeof value.codeKeyVersion !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.codeKeyVersion) ||
    typeof value.status !== 'string' ||
    !CLAIM_STATUSES.has(value.status as ClaimSessionStatus) ||
    !Number.isSafeInteger(value.attemptCount) ||
    (value.attemptCount as number) < 0 ||
    (value.attemptCount as number) > 5 ||
    rejectedCodeMacs === null ||
    rejectedCodeMacs.length > 5 ||
    rejectedCodeMacs.some(
      (codeMac) => typeof codeMac !== 'string' || !/^[0-9a-f]{64}$/.test(codeMac),
    ) ||
    new Set(rejectedCodeMacs).size !== rejectedCodeMacs.length ||
    value.attemptCount !== rejectedCodeMacs.length ||
    !Number.isSafeInteger(value.createdAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    (value.createdAtMs as number) < 0 ||
    (value.expiresAtMs as number) - (value.createdAtMs as number) !== PAIR_CODE_TTL_MS
  ) {
    throw new ClaimPersistenceIntegrityError();
  }
  return {
    memberUid: value.memberUid,
    expectedDeviceId,
    codeMac: value.codeMac,
    codeKeyVersion: value.codeKeyVersion,
    status: value.status as ClaimSessionStatus,
    attemptCount: value.attemptCount as number,
    rejectedCodeMacs: rejectedCodeMacs as string[],
    createdAtMs: value.createdAtMs as number,
    expiresAtMs: value.expiresAtMs as number,
  };
}

function parseStoredLock(value: unknown, expectedDeviceId: string): StoredActiveClaimLock {
  if (
    !isRecord(value) ||
    value.deviceId !== expectedDeviceId ||
    typeof value.sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(value.sessionId) ||
    typeof value.status !== 'string' ||
    !ACTIVE_LOCK_STATUSES.has(value.status as ClaimSessionStatus) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    (value.expiresAtMs as number) < 0
  ) {
    throw new ClaimPersistenceIntegrityError();
  }
  return {
    deviceId: expectedDeviceId,
    sessionId: value.sessionId,
    status: value.status as ClaimSessionStatus,
    expiresAtMs: value.expiresAtMs as number,
  };
}

function assertValidCreateCommand(command: CreateClaimSessionCommand): void {
  if (!(
    SESSION_ID_PATTERN.test(command.sessionId) &&
    DEVICE_ID_PATTERN.test(command.deviceId) &&
    command.memberUid.length > 0 &&
    /^[0-9]{8}$/.test(command.pairCode) &&
    Number.isSafeInteger(command.createdAtMs) &&
    Number.isSafeInteger(command.expiresAtMs) &&
    command.createdAtMs >= 0 &&
    command.expiresAtMs - command.createdAtMs === PAIR_CODE_TTL_MS
  )) {
    throw new InvalidClaimCommandError();
  }
}

export interface ApplyClaimBindCommand {
  readonly deviceId: string;
  readonly pairCode: string;
  readonly nowMs: number;
}

export type ApplyClaimBindOutcome =
  | 'pending'
  | 'claimed'
  | 'expired'
  | 'failed'
  | 'conflict'
  | 'not_found'
  | 'device_unavailable';

export interface GetClaimSessionStatusCommand {
  readonly sessionId: string;
  readonly memberUid: string;
  readonly nowMs: number;
}

export interface ClaimSessionStatusView {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly status: ClaimSessionStatus;
  readonly expiresAtMs: number;
}

function isValidBindCommand(command: ApplyClaimBindCommand): boolean {
  return (
    DEVICE_ID_PATTERN.test(command.deviceId) &&
    /^[0-9]{8}$/.test(command.pairCode) &&
    Number.isSafeInteger(command.nowMs) &&
    command.nowMs >= 0
  );
}

function isTransientFirestoreError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return [
    4,
    8,
    10,
    13,
    14,
    'DEADLINE_EXCEEDED',
    'RESOURCE_EXHAUSTED',
    'ABORTED',
    'INTERNAL',
    'UNAVAILABLE',
    'deadline-exceeded',
    'resource-exhausted',
    'aborted',
    'internal',
    'unavailable',
  ].includes(code as never);
}

async function withPersistenceErrorMapping<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isTransientFirestoreError(error)) throw new PersistenceUnavailableError();
    throw error;
  }
}

function assertProtectedCodeMetadata(
  protectedCode: ReturnType<PairCodeProtector['protect']>,
  protector: PairCodeProtector,
): void {
  if (
    protectedCode.codeKeyVersion !== protector.codeKeyVersion ||
    !/^[1-9][0-9]*$/.test(protectedCode.codeKeyVersion) ||
    !/^[0-9a-f]{64}$/.test(protectedCode.codeMac)
  ) {
    throw new ClaimPersistenceIntegrityError();
  }
}

function terminalOutcome(status: ClaimSessionStatus): ApplyClaimBindOutcome | null {
  switch (status) {
    case 'claimed':
    case 'expired':
    case 'failed':
    case 'conflict':
      return status;
    case 'pending':
    case 'replaced':
      return null;
  }
}

export class FirestoreDeviceClaimRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly codeProtector: ClaimCodeProtector,
  ) {}

  async createSession(command: CreateClaimSessionCommand): Promise<CreateClaimSessionOutcome> {
    assertValidCreateCommand(command);

    const deviceReference = this.firestore.doc(`devices/${command.deviceId}`);
    const sessionReference = this.firestore.doc(`deviceClaimSessions/${command.sessionId}`);
    const lockReference = this.firestore.doc(`activeDeviceClaims/${command.deviceId}`);

    return withPersistenceErrorMapping(() => this.firestore.runTransaction(async (transaction) => {
      const [deviceSnapshot, lockSnapshot] = await transaction.getAll(
        deviceReference,
        lockReference,
      );
      let outcome: CreateClaimSessionOutcome = 'created';
      let shouldOverwriteLock = false;
      let lock: StoredActiveClaimLock | null = null;
      let priorSession: StoredClaimSession | null = null;
      let priorSessionReference: ReturnType<Firestore['doc']> | null = null;
      if (lockSnapshot.exists) {
        lock = parseStoredLock(lockSnapshot.data(), command.deviceId);
        priorSessionReference = this.firestore.doc(
          `deviceClaimSessions/${lock.sessionId}`,
        );
        const priorSessionSnapshot = await transaction.get(priorSessionReference);
        if (!priorSessionSnapshot.exists) throw new ClaimPersistenceIntegrityError();
        priorSession = parseStoredSession(priorSessionSnapshot.data(), command.deviceId);
        if (
          priorSession.expiresAtMs !== lock.expiresAtMs ||
          priorSession.status !== lock.status
        ) {
          throw new ClaimPersistenceIntegrityError();
        }
      }

      const deviceState = classifyDevice(command.deviceId, deviceSnapshot.data());
      if (deviceState === 'owned') {
        if (lock && priorSession && priorSessionReference && command.createdAtMs >= lock.expiresAtMs) {
          if (priorSession.status === 'pending') {
            transaction.update(priorSessionReference, {
              status: 'expired',
              terminalAtMs: command.createdAtMs,
            });
          }
          transaction.delete(lockReference);
        }
        return 'already_owned';
      }
      if (deviceState === 'unavailable') return 'device_unavailable';

      if (lock && priorSession && priorSessionReference) {
        if (command.createdAtMs < lock.expiresAtMs) {
          if (priorSession.status !== 'pending' || priorSession.memberUid !== command.memberUid) {
            return 'claim_in_progress';
          }
          transaction.update(priorSessionReference, {
            status: 'replaced',
            terminalAtMs: command.createdAtMs,
          });
          outcome = 'replaced';
        } else if (priorSession.status === 'pending') {
          transaction.update(priorSessionReference, {
            status: 'expired',
            terminalAtMs: command.createdAtMs,
          });
        }
        shouldOverwriteLock = true;
      }

      const protectedCode = this.codeProtector.protect(command);
      assertProtectedCodeMetadata(protectedCode, this.codeProtector);
      transaction.create(sessionReference, {
        memberUid: command.memberUid,
        expectedDeviceId: command.deviceId,
        codeMac: protectedCode.codeMac,
        codeKeyVersion: protectedCode.codeKeyVersion,
        status: 'pending',
        attemptCount: 0,
        rejectedCodeMacs: [],
        createdAtMs: command.createdAtMs,
        expiresAtMs: command.expiresAtMs,
      });
      const lockData = {
        deviceId: command.deviceId,
        sessionId: command.sessionId,
        status: 'pending',
        expiresAtMs: command.expiresAtMs,
      };
      if (shouldOverwriteLock) transaction.set(lockReference, lockData);
      else transaction.create(lockReference, lockData);
      return outcome;
    }));
  }

  async applyBind(command: ApplyClaimBindCommand): Promise<ApplyClaimBindOutcome> {
    if (!isValidBindCommand(command)) return 'not_found';

    const lockReference = this.firestore.doc(`activeDeviceClaims/${command.deviceId}`);
    const deviceReference = this.firestore.doc(`devices/${command.deviceId}`);

    return withPersistenceErrorMapping(() => this.firestore.runTransaction(async (transaction) => {
      const lockSnapshot = await transaction.get(lockReference);
      if (!lockSnapshot.exists) return 'not_found';
      const lock = parseStoredLock(lockSnapshot.data(), command.deviceId);
      const sessionReference = this.firestore.doc(`deviceClaimSessions/${lock.sessionId}`);
      const [sessionSnapshot, deviceSnapshot] = await transaction.getAll(
        sessionReference,
        deviceReference,
      );
      if (!sessionSnapshot.exists) throw new ClaimPersistenceIntegrityError();
      const session = parseStoredSession(sessionSnapshot.data(), command.deviceId);
      if (session.expiresAtMs !== lock.expiresAtMs || session.status !== lock.status) {
        throw new ClaimPersistenceIntegrityError();
      }

      if (session.status === 'replaced') throw new ClaimPersistenceIntegrityError();
      const existingTerminalOutcome = terminalOutcome(session.status);
      if (existingTerminalOutcome) return existingTerminalOutcome;

      if (command.nowMs >= session.expiresAtMs) {
        const terminalData = { status: 'expired', terminalAtMs: command.nowMs };
        transaction.update(sessionReference, terminalData);
        transaction.update(lockReference, terminalData);
        return 'expired';
      }

      const device = deviceSnapshot.data();
      const deviceState = classifyDevice(command.deviceId, device);
      if (deviceState === 'unavailable' || !isRecord(device)) return 'device_unavailable';

      const codeInput = {
        sessionId: lock.sessionId,
        deviceId: command.deviceId,
        pairCode: command.pairCode,
      };
      if (session.codeKeyVersion !== this.codeProtector.codeKeyVersion) {
        return 'device_unavailable';
      }
      const correctCode = this.codeProtector.matches({
        ...codeInput,
        expectedCodeMac: session.codeMac,
        expectedCodeKeyVersion: session.codeKeyVersion,
      });
      if (!correctCode) {
        let duplicateWrongCode = false;
        for (const rejectedCodeMac of session.rejectedCodeMacs) {
          const matchesRejectedCode = this.codeProtector.matches({
            ...codeInput,
            expectedCodeMac: rejectedCodeMac,
            expectedCodeKeyVersion: session.codeKeyVersion,
          });
          duplicateWrongCode = matchesRejectedCode || duplicateWrongCode;
        }
        if (duplicateWrongCode) return 'pending';

        const rejected = this.codeProtector.protect(codeInput);
        assertProtectedCodeMetadata(rejected, this.codeProtector);
        if (rejected.codeKeyVersion !== session.codeKeyVersion) {
          throw new ClaimPersistenceIntegrityError();
        }
        const attemptCount = session.attemptCount + 1;
        const attemptData = {
          attemptCount,
          rejectedCodeMacs: [...session.rejectedCodeMacs, rejected.codeMac],
        };
        if (attemptCount >= 5) {
          const terminalData = {
            ...attemptData,
            status: 'failed',
            terminalAtMs: command.nowMs,
          };
          transaction.update(sessionReference, terminalData);
          transaction.update(lockReference, {
            status: 'failed',
            terminalAtMs: command.nowMs,
          });
          return 'failed';
        }
        transaction.update(sessionReference, attemptData);
        return 'pending';
      }

      if (deviceState === 'owned' && device.ownerUid !== session.memberUid) {
        const terminalData = { status: 'conflict', terminalAtMs: command.nowMs };
        transaction.update(sessionReference, terminalData);
        transaction.update(lockReference, terminalData);
        return 'conflict';
      }

      if (deviceState === 'ownerless') {
        transaction.update(deviceReference, {
          ownerUid: session.memberUid,
          claimedAtMs: command.nowMs,
        });
      }
      const terminalData = { status: 'claimed', terminalAtMs: command.nowMs };
      transaction.update(sessionReference, terminalData);
      transaction.update(lockReference, terminalData);
      return 'claimed';
    }));
  }

  async getSessionStatus(
    command: GetClaimSessionStatusCommand,
  ): Promise<ClaimSessionStatusView | null> {
    if (
      !SESSION_ID_PATTERN.test(command.sessionId) ||
      command.memberUid.length === 0 ||
      !Number.isSafeInteger(command.nowMs) ||
      command.nowMs < 0
    ) {
      return null;
    }

    const sessionReference = this.firestore.doc(
      `deviceClaimSessions/${command.sessionId}`,
    );
    return withPersistenceErrorMapping(() => this.firestore.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionReference);
      if (!sessionSnapshot.exists) return null;
      const rawSession = sessionSnapshot.data();
      if (
        !isRecord(rawSession) ||
        typeof rawSession.memberUid !== 'string' ||
        rawSession.memberUid.length === 0
      ) {
        throw new ClaimPersistenceIntegrityError();
      }
      if (rawSession.memberUid !== command.memberUid) return null;
      if (typeof rawSession.expectedDeviceId !== 'string') {
        throw new ClaimPersistenceIntegrityError();
      }
      const session = parseStoredSession(rawSession, rawSession.expectedDeviceId);

      let status = session.status;
      if (status === 'pending' && command.nowMs >= session.expiresAtMs) {
        const lockReference = this.firestore.doc(
          `activeDeviceClaims/${session.expectedDeviceId}`,
        );
        const lockSnapshot = await transaction.get(lockReference);
        if (!lockSnapshot.exists) throw new ClaimPersistenceIntegrityError();
        const lock = parseStoredLock(lockSnapshot.data(), session.expectedDeviceId);
        if (
          lock.sessionId !== command.sessionId ||
          lock.status !== 'pending' ||
          lock.expiresAtMs !== session.expiresAtMs
        ) {
          throw new ClaimPersistenceIntegrityError();
        }
        const terminalData = { status: 'expired', terminalAtMs: command.nowMs };
        transaction.update(sessionReference, terminalData);
        transaction.update(lockReference, terminalData);
        status = 'expired';
      } else if (status !== 'pending' && command.nowMs >= session.expiresAtMs) {
        const lockReference = this.firestore.doc(
          `activeDeviceClaims/${session.expectedDeviceId}`,
        );
        const lockSnapshot = await transaction.get(lockReference);
        if (lockSnapshot.exists) {
          const lock = parseStoredLock(lockSnapshot.data(), session.expectedDeviceId);
          if (lock.sessionId === command.sessionId) {
            if (lock.status !== status || lock.expiresAtMs !== session.expiresAtMs) {
              throw new ClaimPersistenceIntegrityError();
            }
            transaction.delete(lockReference);
          }
        }
      }

      return {
        sessionId: command.sessionId,
        deviceId: session.expectedDeviceId,
        status,
        expiresAtMs: session.expiresAtMs,
      };
    }));
  }
}
