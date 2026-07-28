import { describe, expect, it } from 'vitest'

import {
  OwnedDeviceDataIntegrityError,
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
    }
    const deviceB: OwnedDevice = {
      deviceId: 'PC-000002',
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'disabled',
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
    })
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
