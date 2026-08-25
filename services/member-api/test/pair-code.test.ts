import { createSecretKey } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createPairCodeProtector,
  getPairCodeExpiresAtMs,
  generatePairCode,
  isPairCodeExpired,
} from '../src/claims/pair-code.js';

const HMAC_KEY_TEXT = 'test-hmac-key-not-for-production';
const HMAC_KEY = createSecretKey(Buffer.from(HMAC_KEY_TEXT, 'utf8'));

describe('generatePairCode', () => {
  it('preserves the leading-zero code from the specification example', () => {
    expect(generatePairCode(() => 1_234)).toBe('00001234');
  });

  it('uses the complete uniform numeric space without modulo reduction', () => {
    expect(generatePairCode((exclusiveUpperBound) => {
      expect(exclusiveUpperBound).toBe(100_000_000);
      return exclusiveUpperBound - 1;
    })).toBe('99999999');
  });

  it.each([-1, 100_000_000, 1.5, Number.NaN])(
    'fails loudly when an injected random source returns %s',
    (invalidRandomValue) => {
      expect(() => generatePairCode(() => invalidRandomValue)).toThrow(RangeError);
    },
  );

  it('uses a secure default source and always returns eight ASCII digits', () => {
    expect(generatePairCode()).toMatch(/^[0-9]{8}$/);
  });
});

describe('Pair Code expiration', () => {
  it('expires at the exact boundary from the specification example', () => {
    const expiresAtMs = getPairCodeExpiresAtMs(1_000_000);

    expect(expiresAtMs).toBe(1_300_000);
    expect(isPairCodeExpired(expiresAtMs, 1_299_999)).toBe(false);
    expect(isPairCodeExpired(expiresAtMs, 1_300_000)).toBe(true);
  });
});

describe('createPairCodeProtector', () => {
  it('protects the exact versioned HMAC-SHA-256 input without returning plaintext from the primitive', () => {
    const protector = createPairCodeProtector({
      codeKeyVersion: '7',
      hmacKey: HMAC_KEY,
    });

    const protectedCode = protector.protect({
      sessionId: 'session-123',
      deviceId: '68E274BD2A58',
      pairCode: '00001234',
    });

    expect(protectedCode).toEqual({
      codeMac: '6fac4f4d39bb21993f860329e096cd52ac923c5accb46706692569a3d858c9f7',
      codeKeyVersion: '7',
    });
    expect(JSON.stringify(protectedCode)).not.toContain('00001234');
    expect(JSON.stringify(protectedCode)).not.toContain(HMAC_KEY_TEXT);
  });

  it.each([
    ['the matching code and key version', '00001234', '7', true],
    ['a different code', '00001235', '7', false],
    ['a different key version', '00001234', '8', false],
  ] as const)('compares %s', (_label, pairCode, expectedCodeKeyVersion, expected) => {
    const protector = createPairCodeProtector({
      codeKeyVersion: '7',
      hmacKey: HMAC_KEY,
    });

    expect(protector.matches({
      sessionId: 'session-123',
      deviceId: '68E274BD2A58',
      pairCode,
      expectedCodeMac: '6fac4f4d39bb21993f860329e096cd52ac923c5accb46706692569a3d858c9f7',
      expectedCodeKeyVersion,
    })).toBe(expected);
  });

  it('fails closed for a malformed persisted MAC', () => {
    const protector = createPairCodeProtector({
      codeKeyVersion: '7',
      hmacKey: HMAC_KEY,
    });

    expect(protector.matches({
      sessionId: 'session-123',
      deviceId: '68E274BD2A58',
      pairCode: '00001234',
      expectedCodeMac: 'not-a-mac',
      expectedCodeKeyVersion: '7',
    })).toBe(false);
  });

  it.each(['', '0', 'latest', ' 7'])('rejects unsafe key version %j', (codeKeyVersion) => {
    expect(() => createPairCodeProtector({
      codeKeyVersion,
      hmacKey: HMAC_KEY,
    })).toThrow(TypeError);
  });

  it.each([1, 31])('rejects a %d-byte HMAC key', (keySize) => {
    expect(() => createPairCodeProtector({
      codeKeyVersion: '7',
      hmacKey: createSecretKey(Buffer.alloc(keySize, 0x41)),
    })).toThrow('hmacKey must contain at least 32 bytes of secret key material.');
  });

  it('accepts a 32-byte HMAC key', () => {
    expect(() => createPairCodeProtector({
      codeKeyVersion: '7',
      hmacKey: createSecretKey(Buffer.alloc(32, 0x41)),
    })).not.toThrow();
  });

  it.each([
    ['Pair Code with seven digits', { sessionId: 'session-123', deviceId: '68E274BD2A58', pairCode: '0001234' }],
    ['lowercase device ID', { sessionId: 'session-123', deviceId: '68e274bd2a58', pairCode: '00001234' }],
    ['ambiguous session delimiter', { sessionId: 'session:123', deviceId: '68E274BD2A58', pairCode: '00001234' }],
  ] as const)('rejects invalid MAC input: %s', (_label, input) => {
    const protector = createPairCodeProtector({
      codeKeyVersion: '7',
      hmacKey: HMAC_KEY,
    });

    expect(() => protector.protect(input)).toThrow(TypeError);
  });
});
