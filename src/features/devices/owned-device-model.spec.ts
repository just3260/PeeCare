import { describe, expect, it } from 'vitest'

import {
  OwnedDeviceDataIntegrityError,
  normalizeCustomNameDraft,
  parseOwnedDevice,
  type OwnedDevice,
} from './owned-device-model'

// Single-owner MVP model: ownership is expressed by a single scalar `ownerUid`
// per device. One UID may appear on many device documents; a device never
// carries more than one owner.
describe('single-owner device model', () => {
  it('lets one UID own multiple devices, each with exactly one owner', () => {
    const deviceA: OwnedDevice = {
      deviceId: 'PC-000001',
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      customName: null,
    }
    const deviceB: OwnedDevice = {
      deviceId: 'PC-000002',
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'disabled',
      customName: '主浴室',
    }

    // Both devices belong to member-001.
    expect(deviceA.ownerUid).toBe('member-001')
    expect(deviceB.ownerUid).toBe('member-001')
    expect([deviceA, deviceB].every((device) => device.ownerUid === 'member-001')).toBe(true)

    // Single owner: ownerUid is a scalar string, never a collection of owners.
    expect(typeof deviceA.ownerUid).toBe('string')
    expect(typeof deviceB.ownerUid).toBe('string')
  })
})

describe('normalizeCustomNameDraft', () => {
  it.each([
    ['trimmed name', '  主浴室  ', { valid: true, value: '主浴室' }],
    ['blank clear', '   ', { valid: true, value: null }],
    ['30 emoji', '🚽'.repeat(30), { valid: true, value: '🚽'.repeat(30) }],
    ['31 code points', 'x'.repeat(31), { valid: false }],
    ['newline', '主浴室\n', { valid: false }],
    ['control character', '主\u0001浴室', { valid: false }],
  ])('normalizes or rejects %s', (_case, draft, expected) => {
    expect(normalizeCustomNameDraft(draft)).toEqual(expected)
  })
})

// Runtime shape validation at the Firestore boundary. Structural defects raise a
// typed error (never silently omit fields); ownership that does not match the
// authenticated member is unauthorized and yields no model.
describe('parseOwnedDevice', () => {
  const ownedDoc = {
    deviceId: 'PC-000001',
    ownerUid: 'member-001',
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
    // Ingestion projection fields ride along and are ignored by the model.
    latestUrinationAtMs: 1_700_000_000_000,
    lastReportedAtMs: 1_700_000_000_500,
  }

  it('returns a validated model when the document is owned by the member', () => {
    const device = parseOwnedDevice({
      documentId: 'PC-000001',
      data: ownedDoc,
      authenticatedUid: 'member-001',
    })

    expect(device).toEqual({
      deviceId: 'PC-000001',
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      customName: null,
    })
  })

  it('returns the shared device custom name when the stored value is canonical', () => {
    expect(
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, customName: '主浴室' },
        authenticatedUid: 'member-001',
      }),
    ).toMatchObject({ customName: '主浴室' })
  })

  it('normalizes an absent customName to null without requiring backfill', () => {
    expect(
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: ownedDoc,
        authenticatedUid: 'member-001',
      }),
    ).toMatchObject({ customName: null })
  })

  it.each([
    ['1 code point', '🚽'],
    ['30 code points', '🚽'.repeat(30)],
  ])('accepts a canonical customName at the %s boundary', (_label, customName) => {
    expect(
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, customName },
        authenticatedUid: 'member-001',
      }),
    ).toMatchObject({ customName })
  })

  it.each([
    ['null', null],
    ['non-string', 42],
    ['empty string', ''],
    ['whitespace-only string', '   '],
    ['untrimmed string', '  主浴室  '],
    ['31 code points', '🚽'.repeat(31)],
    ['newline', '一樓\n浴室'],
    ['Unicode control character', '浴室\u0000'],
  ])('throws a data-integrity error for malformed stored customName: %s', (_label, customName) => {
    expect(() =>
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, customName },
        authenticatedUid: 'member-001',
      }),
    ).toThrow(OwnedDeviceDataIntegrityError)
  })

  it('reports invalid_custom_name for malformed stored customName', () => {
    try {
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, customName: '🚽'.repeat(31) },
        authenticatedUid: 'member-001',
      })
      expect.unreachable('expected a data-integrity error')
    } catch (error) {
      expect(error).toBeInstanceOf(OwnedDeviceDataIntegrityError)
      expect((error as OwnedDeviceDataIntegrityError).code).toBe('invalid_custom_name')
    }
  })

  it('does not hide a malformed customName behind an ownership mismatch', () => {
    expect(() =>
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, ownerUid: 'member-002', customName: null },
        authenticatedUid: 'member-001',
      }),
    ).toThrow(OwnedDeviceDataIntegrityError)
  })

  // Spec example: document devices/PC-000001 contains deviceId PC-000002.
  it('throws a data-integrity error when deviceId differs from the document id', () => {
    expect(() =>
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, deviceId: 'PC-000002' },
        authenticatedUid: 'member-001',
      }),
    ).toThrow(OwnedDeviceDataIntegrityError)
  })

  it.each([
    ['productModel', { ...ownedDoc, productModel: '' }],
    ['productModel missing', { ...ownedDoc, productModel: undefined }],
    ['ingestionStatus', { ...ownedDoc, ingestionStatus: 42 }],
  ])('throws a data-integrity error for structural defect: %s', (_label, data) => {
    expect(() =>
      parseOwnedDevice({ documentId: 'PC-000001', data, authenticatedUid: 'member-001' }),
    ).toThrow(OwnedDeviceDataIntegrityError)
  })

  it('carries the offending device id on the typed error', () => {
    try {
      parseOwnedDevice({
        documentId: 'PC-000001',
        data: { ...ownedDoc, deviceId: 'PC-000002' },
        authenticatedUid: 'member-001',
      })
      expect.unreachable('expected a data-integrity error')
    } catch (error) {
      expect(error).toBeInstanceOf(OwnedDeviceDataIntegrityError)
      expect((error as OwnedDeviceDataIntegrityError).documentId).toBe('PC-000001')
    }
  })

  // Malformed ownership is an authorization concern, not a structural defect: the
  // model is silently withheld rather than raised, so a member never sees a
  // device that is not theirs.
  it.each([
    ['empty ownerUid', { ...ownedDoc, ownerUid: '' }],
    ['missing ownerUid', { ...ownedDoc, ownerUid: undefined }],
    ['non-string ownerUid', { ...ownedDoc, ownerUid: 12345 }],
    ['mismatched ownerUid', { ...ownedDoc, ownerUid: 'member-002' }],
  ])('returns null for unauthorized ownership: %s', (_label, data) => {
    expect(
      parseOwnedDevice({ documentId: 'PC-000001', data, authenticatedUid: 'member-001' }),
    ).toBeNull()
  })
})
