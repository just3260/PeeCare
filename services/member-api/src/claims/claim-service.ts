import { randomInt, randomUUID } from 'node:crypto';

import {
  generatePairCode,
  getPairCodeExpiresAtMs,
  type PairCodeRandomInteger,
} from './pair-code.js';
import type {
  ApplyClaimBindCommand,
  ApplyClaimBindOutcome,
  ClaimSessionStatusView,
  CreateClaimSessionCommand,
  CreateClaimSessionOutcome,
  GetClaimSessionStatusCommand,
} from '../firestore/device-claim-repository.js';

export interface ClaimRepository {
  createSession(command: CreateClaimSessionCommand): Promise<CreateClaimSessionOutcome>;
  getSessionStatus(
    command: GetClaimSessionStatusCommand,
  ): Promise<ClaimSessionStatusView | null>;
  applyBind(command: ApplyClaimBindCommand): Promise<ApplyClaimBindOutcome>;
}

export interface ClaimServiceDependencies {
  readonly repository: ClaimRepository;
  readonly nowMs?: () => number;
  readonly randomInteger?: PairCodeRandomInteger;
  readonly createSessionId?: () => string;
}

export interface CreateMemberClaimSessionCommand {
  readonly memberUid: string;
  readonly deviceId: string;
}

export interface CreatedClaimSession {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly pairCode: string;
  readonly status: 'pending';
  readonly expiresAtMs: number;
}

export type CreateMemberClaimSessionResult =
  | {
      readonly ok: true;
      readonly outcome: 'created' | 'replaced';
      readonly session: CreatedClaimSession;
    }
  | {
      readonly ok: false;
      readonly reason: 'claim_in_progress' | 'already_owned' | 'device_unavailable';
    };

export interface GetMemberClaimSessionCommand {
  readonly memberUid: string;
  readonly sessionId: string;
}

export interface ApplyDeviceClaimBindCommand {
  readonly deviceId: string;
  readonly pairCode: string;
}

export class ClaimService {
  private readonly nowMs: () => number;
  private readonly randomInteger: PairCodeRandomInteger;
  private readonly createSessionId: () => string;

  constructor(private readonly dependencies: ClaimServiceDependencies) {
    this.nowMs = dependencies.nowMs ?? Date.now;
    this.randomInteger = dependencies.randomInteger ?? randomInt;
    this.createSessionId = dependencies.createSessionId ?? randomUUID;
  }

  async createSession(
    command: CreateMemberClaimSessionCommand,
  ): Promise<CreateMemberClaimSessionResult> {
    const createdAtMs = this.currentTimeMs();
    const sessionId = this.createSessionId();
    const pairCode = generatePairCode(this.randomInteger);
    const expiresAtMs = getPairCodeExpiresAtMs(createdAtMs);
    const outcome = await this.dependencies.repository.createSession({
      sessionId,
      memberUid: command.memberUid,
      deviceId: command.deviceId,
      pairCode,
      createdAtMs,
      expiresAtMs,
    });

    switch (outcome) {
      case 'created':
      case 'replaced':
        return {
          ok: true,
          outcome,
          session: {
            sessionId,
            deviceId: command.deviceId,
            pairCode,
            status: 'pending',
            expiresAtMs,
          },
        };
      case 'claim_in_progress':
      case 'already_owned':
      case 'device_unavailable':
        return { ok: false, reason: outcome };
      default:
        return unsupportedCreationOutcome(outcome);
    }
  }

  async getSessionStatus(
    command: GetMemberClaimSessionCommand,
  ): Promise<ClaimSessionStatusView | null> {
    const view = await this.dependencies.repository.getSessionStatus({
      sessionId: command.sessionId,
      memberUid: command.memberUid,
      nowMs: this.currentTimeMs(),
    });
    if (view === null) return null;

    switch (view.status) {
      case 'pending':
      case 'claimed':
      case 'expired':
      case 'failed':
      case 'conflict':
      case 'replaced':
        return {
          sessionId: view.sessionId,
          deviceId: view.deviceId,
          status: view.status,
          expiresAtMs: view.expiresAtMs,
        };
      default:
        return unsupportedSessionStatus(view.status);
    }
  }

  async applyBind(command: ApplyDeviceClaimBindCommand): Promise<ApplyClaimBindOutcome> {
    const outcome = await this.dependencies.repository.applyBind({
      deviceId: command.deviceId,
      pairCode: command.pairCode,
      nowMs: this.currentTimeMs(),
    });
    switch (outcome) {
      case 'pending':
      case 'claimed':
      case 'expired':
      case 'failed':
      case 'conflict':
      case 'not_found':
      case 'device_unavailable':
        return outcome;
      default:
        return unsupportedBindOutcome(outcome);
    }
  }

  private currentTimeMs(): number {
    const value = this.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Claim service clock must return a non-negative safe integer.');
    }
    return value;
  }
}

function unsupportedCreationOutcome(_outcome: never): never {
  throw new Error('Claim repository returned an unsupported creation outcome.');
}

function unsupportedSessionStatus(_status: never): never {
  throw new Error('Claim repository returned an unsupported session status.');
}

function unsupportedBindOutcome(_outcome: never): never {
  throw new Error('Claim repository returned an unsupported bind outcome.');
}
