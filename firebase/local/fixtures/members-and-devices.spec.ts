import { describe, expect, it } from 'vitest'

import {
  DEVICE_OWNERSHIP,
  mergeOwnerUid,
  type DeviceRegistryDocument,
} from './members-and-devices'

// A registry document as the ingestion service leaves it: identity plus the
// stage-two "latest" projection fields. The owner fixture must only *add*
// ownerUid and must never rebuild or drop any of these.
const ingestedDevice: DeviceRegistryDocument = {
  deviceId: 'PC-000001',
  productModel: 'pc-mini',
  ingestionStatus: 'enabled',
  latestUrinationAtMs: 1_700_000_000_000,
  latestUrinationReceivedAtMs: 1_700_000_000_100,
  latestUrinationEventId: 'evt-urination-1',
  latestBatteryAtMs: 1_700_000_000_200,
  latestBatteryReceivedAtMs: 1_700_000_000_300,
  latestBatteryEventId: 'evt-battery-1',
  latestBatteryLevelPercent: 75,
  lastReportedAtMs: 1_700_000_000_400,
}

describe('mergeOwnerUid', () => {
  // Spec example: devices/PC-000001 already has ingestion + latest projection
  // fields; assigning member-001 changes only ownerUid.
  it('adds ownerUid and preserves every existing registry field', () => {
    const merged = mergeOwnerUid(ingestedDevice, 'member-001')

    expect(merged).toEqual({ ...ingestedDevice, ownerUid: 'member-001' })
    for (const key of Object.keys(ingestedDevice) as (keyof DeviceRegistryDocument)[]) {
      expect(merged[key]).toBe(ingestedDevice[key])
    }
  })

  it('does not mutate the existing document', () => {
    mergeOwnerUid(ingestedDevice, 'member-001')
    expect(ingestedDevice).not.toHaveProperty('ownerUid')
  })

  it('overwrites the previous owner rather than merging owners', () => {
    const reassigned = mergeOwnerUid({ ...ingestedDevice, ownerUid: 'member-002' }, 'member-001')
    expect(reassigned.ownerUid).toBe('member-001')
  })

  it.each([['empty', ''], ['blank', '   ']])(
    'refuses a %s ownerUid so a non-owner document is never seeded',
    (_label, ownerUid) => {
      expect(() => mergeOwnerUid(ingestedDevice, ownerUid)).toThrow()
    },
  )
})

describe('DEVICE_OWNERSHIP', () => {
  it('assigns member-001 two devices and member-002 one device', () => {
    const byOwner = new Map<string, string[]>()
    for (const { deviceId, ownerUid } of DEVICE_OWNERSHIP) {
      byOwner.set(ownerUid, [...(byOwner.get(ownerUid) ?? []), deviceId])
    }

    expect(byOwner.get('member-001')).toEqual(['PC-000001', 'PC-000002'])
    expect(byOwner.get('member-002')).toEqual(['PC-000003'])
  })

  it('references only non-empty owner UIDs', () => {
    for (const { ownerUid } of DEVICE_OWNERSHIP) {
      expect(ownerUid.trim().length).toBeGreaterThan(0)
    }
  })

  it('includes both a canonically named device and an existing unnamed device', () => {
    expect(DEVICE_OWNERSHIP).toContainEqual({
      deviceId: 'PC-000001',
      ownerUid: 'member-001',
      customName: '主浴室',
    })
    expect(DEVICE_OWNERSHIP).toContainEqual({
      deviceId: 'PC-000002',
      ownerUid: 'member-001',
    })
  })
})
