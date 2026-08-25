import { createHmac, randomInt, timingSafeEqual, type KeyObject } from 'node:crypto';

const PAIR_CODE_SPACE_SIZE = 100_000_000;
export const PAIR_CODE_TTL_MS = 300_000;

export type PairCodeRandomInteger = (exclusiveUpperBound: number) => number;

export interface PairCodeMacInput {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly pairCode: string;
}

export interface ProtectedPairCode {
  readonly codeMac: string;
  readonly codeKeyVersion: string;
}

export interface PairCodeMatchInput extends PairCodeMacInput {
  readonly expectedCodeMac: string;
  readonly expectedCodeKeyVersion: string;
}

export interface PairCodeProtector {
  readonly codeKeyVersion: string;
  readonly protect: (input: PairCodeMacInput) => ProtectedPairCode;
  readonly matches: (input: PairCodeMatchInput) => boolean;
}

export function generatePairCode(
  randomInteger: PairCodeRandomInteger = randomInt,
): string {
  const numericCode = randomInteger(PAIR_CODE_SPACE_SIZE);

  if (!Number.isSafeInteger(numericCode) || numericCode < 0 || numericCode >= PAIR_CODE_SPACE_SIZE) {
    throw new RangeError('The Pair Code random source returned an out-of-range value.');
  }

  return numericCode.toString().padStart(8, '0');
}

export function getPairCodeExpiresAtMs(createdAtMs: number): number {
  assertSafeTimestamp(createdAtMs, 'createdAtMs');

  const expiresAtMs = createdAtMs + PAIR_CODE_TTL_MS;
  assertSafeTimestamp(expiresAtMs, 'expiresAtMs');
  return expiresAtMs;
}

export function isPairCodeExpired(expiresAtMs: number, nowMs: number): boolean {
  assertSafeTimestamp(expiresAtMs, 'expiresAtMs');
  assertSafeTimestamp(nowMs, 'nowMs');
  return nowMs >= expiresAtMs;
}

export function createPairCodeProtector(options: {
  readonly codeKeyVersion: string;
  readonly hmacKey: KeyObject;
}): PairCodeProtector {
  const { codeKeyVersion, hmacKey } = options;

  if (!/^[1-9][0-9]*$/.test(codeKeyVersion)) {
    throw new TypeError('codeKeyVersion must be a positive numeric secret version.');
  }

  if (hmacKey.type !== 'secret' || (hmacKey.symmetricKeySize ?? 0) < 32) {
    throw new TypeError('hmacKey must contain at least 32 bytes of secret key material.');
  }

  return Object.freeze({
    codeKeyVersion,
    protect(input: PairCodeMacInput): ProtectedPairCode {
      return Object.freeze({
        codeMac: computeCodeMac(hmacKey, input).toString('hex'),
        codeKeyVersion,
      });
    },
    matches(input: PairCodeMatchInput): boolean {
      const candidateMac = computeCodeMac(hmacKey, input);
      const expectedMacIsWellFormed = /^[0-9a-f]{64}$/.test(input.expectedCodeMac);
      const expectedMac = expectedMacIsWellFormed
        ? Buffer.from(input.expectedCodeMac, 'hex')
        : Buffer.alloc(candidateMac.length);
      const macMatches = timingSafeEqual(candidateMac, expectedMac);

      return expectedMacIsWellFormed
        && input.expectedCodeKeyVersion === codeKeyVersion
        && macMatches;
    },
  });
}

function computeCodeMac(hmacKey: KeyObject, input: PairCodeMacInput): Buffer {
  assertMacInput(input);
  const macInput = `${input.sessionId}:${input.deviceId}:${input.pairCode}`;
  return createHmac('sha256', hmacKey).update(macInput, 'utf8').digest();
}

function assertMacInput(input: PairCodeMacInput): void {
  if (input.sessionId.length === 0 || input.sessionId.includes(':')) {
    throw new TypeError('sessionId must be a non-empty value without delimiters.');
  }
  if (!/^[0-9A-F]{12}$/.test(input.deviceId)) {
    throw new TypeError('deviceId must be 12 uppercase hexadecimal characters.');
  }
  if (!/^[0-9]{8}$/.test(input.pairCode)) {
    throw new TypeError('pairCode must be eight ASCII digits.');
  }
}

function assertSafeTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}
