// Admin-only owner fixture for the local Firebase platform.
//
// The ingestion service owns the `devices/{deviceId}` registry document and its
// latest projection fields. This fixture only *adds* a single `ownerUid` to an
// existing registry document; it must never rebuild the document or disturb
// `deviceId`, `productModel`, `ingestionStatus`, the latest projection fields, or
// `lastReportedAtMs`. Seeding runs through the Admin/rules-disabled context — the
// Web client is read-only and never writes ownership.

import type { Firestore } from 'firebase/firestore'
import { doc, setDoc } from 'firebase/firestore'

/**
 * The subset of a device registry document this fixture is aware of. Ingestion
 * may attach more projection fields over time; extra keys ride along untouched
 * because merging is by spread, never by an explicit allow-list.
 */
export interface DeviceRegistryDocument {
  readonly deviceId: string
  readonly productModel: string
  readonly ingestionStatus: string
  readonly ownerUid?: string
  readonly lastReportedAtMs?: number
  readonly latestUrinationAtMs?: number
  readonly latestUrinationReceivedAtMs?: number
  readonly latestUrinationEventId?: string
  readonly latestBatteryAtMs?: number
  readonly latestBatteryReceivedAtMs?: number
  readonly latestBatteryEventId?: string
  readonly latestBatteryLevelPercent?: number
  readonly [extraProjectionField: string]: string | number | undefined
}

/** A single owner assignment: one device is owned by exactly one member UID. */
export interface DeviceOwnership {
  readonly deviceId: string
  readonly ownerUid: string
}

/**
 * Canonical owner assignments for the seeded devices. member-001 owns two
 * devices (the multi-device case); member-002 owns one. Device ids mirror the
 * ingestion `DEVICE_FIXTURES`.
 */
export const DEVICE_OWNERSHIP: readonly DeviceOwnership[] = [
  { deviceId: 'PC-000001', ownerUid: 'member-001' },
  { deviceId: 'PC-000002', ownerUid: 'member-001' },
  { deviceId: 'PC-000003', ownerUid: 'member-002' },
] as const

/**
 * Return a copy of an existing registry document with `ownerUid` merged in.
 *
 * The existing document is never mutated, and no field other than `ownerUid` is
 * touched. A missing or blank `ownerUid` is rejected fail-closed: seeding an
 * empty owner would silently produce a document that the runtime model and Rules
 * treat as unauthorized.
 */
export function mergeOwnerUid(
  existing: DeviceRegistryDocument,
  ownerUid: string,
): DeviceRegistryDocument {
  if (ownerUid.trim().length === 0) {
    throw new Error('mergeOwnerUid requires a non-empty ownerUid.')
  }
  return { ...existing, ownerUid }
}

/**
 * Admin-context seed: merge each ownership assignment into its existing registry
 * document. Uses `setDoc(..., { merge: true })` so ingestion fields are
 * preserved. Intended for the rules-disabled fixture/admin path only.
 */
export async function seedDeviceOwnership(firestore: Firestore): Promise<void> {
  for (const { deviceId, ownerUid } of DEVICE_OWNERSHIP) {
    if (ownerUid.trim().length === 0) {
      throw new Error(`Refusing to seed empty ownerUid for device ${deviceId}.`)
    }
    await setDoc(doc(firestore, 'devices', deviceId), { ownerUid }, { merge: true })
  }
}
