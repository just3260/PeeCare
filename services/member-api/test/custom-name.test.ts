import { describe, expect, it } from 'vitest';
import {
  InvalidCustomNameError,
  normalizeCustomName,
  type CustomNameNormalization,
} from '../src/devices/custom-name.js';

const DELETE_CUSTOM_NAME: CustomNameNormalization = { kind: 'delete' };

describe('normalizeCustomName', () => {
  it.each([
    ['null', null, DELETE_CUSTOM_NAME],
    ['whitespace-only string', '   ', DELETE_CUSTOM_NAME],
    ['1 Unicode code point', '主', { kind: 'set', value: '主' }],
    ['30 Unicode code points', '主'.repeat(30), { kind: 'set', value: '主'.repeat(30) }],
  ] as const)('normalizes the Name boundaries example: %s', (_label, input, expected) => {
    expect(normalizeCustomName(input)).toEqual(expected);
  });

  it.each([
    ['31 Unicode code points', '主'.repeat(31)],
    ['newline', '一樓\n浴室'],
  ] as const)('rejects the invalid Name boundaries example: %s', (_label, input) => {
    expect(() => normalizeCustomName(input)).toThrow(InvalidCustomNameError);
  });

  it('trims leading and trailing whitespace into the canonical stored value', () => {
    expect(normalizeCustomName('  主浴室  ')).toEqual({ kind: 'set', value: '主浴室' });
  });

  it('counts emoji by Unicode code point rather than UTF-16 code unit', () => {
    expect(normalizeCustomName('🚽'.repeat(30))).toEqual({ kind: 'set', value: '🚽'.repeat(30) });
  });

  it.each([
    ['NUL', '浴室\u0000'],
    ['embedded tab', '浴\t室'],
    ['trailing newline', '主浴室\n'],
    ['leading tab', '\t主浴室'],
  ])('rejects Unicode control characters: %s', (_label, input) => {
    expect(() => normalizeCustomName(input)).toThrow(InvalidCustomNameError);
  });

  it('exposes a stable machine code without echoing the rejected name', () => {
    const rejectedName = '私密名稱\u0000';

    try {
      normalizeCustomName(rejectedName);
      expect.unreachable('expected invalid custom name');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCustomNameError);
      expect((error as InvalidCustomNameError).code).toBe('invalid_custom_name');
      expect((error as Error).message).not.toContain(rejectedName);
    }
  });
});
