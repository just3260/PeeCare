// Read-only repository for a member's owned devices.
//
// Every device read is constrained to the caller's own UID: the collection is
// only ever queried through `where('ownerUid', '==', authenticatedUid)`, and the
// runtime model re-checks ownership before a device is exposed. There is no
// unconstrained device query and no write path — client writes are denied by the
// Firestore Rules, and this module never attempts one.

import {
  collection,
  getDocs,
  query,
  where,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore'

import { parseOwnedDevice, type OwnedDevice } from './owned-device-model'

const DEVICES_COLLECTION = 'devices'
const EVENTS_SUBCOLLECTION = 'events'
const DAILY_STATS_SUBCOLLECTION = 'dailyStats'

/**
 * List the devices owned by the authenticated member.
 *
 * The query is always constrained to `ownerUid == authenticatedUid`; an empty
 * caller UID is rejected fail-closed so a blank owner can never match
 * empty-owner documents. Malformed or foreign documents that slip past the query
 * are withheld by {@link parseOwnedDevice}.
 */
export async function listOwnedDevices(
  firestore: Firestore,
  authenticatedUid: string,
): Promise<OwnedDevice[]> {
  if (!authenticatedUid) {
    throw new Error('listOwnedDevices requires a non-empty authenticated UID.')
  }

  const devicesQuery = query(
    collection(firestore, DEVICES_COLLECTION),
    where('ownerUid', '==', authenticatedUid),
  )
  const snapshot = await getDocs(devicesQuery)

  const devices: OwnedDevice[] = []
  for (const document of snapshot.docs) {
    const device = parseOwnedDevice({
      documentId: document.id,
      data: document.data(),
      authenticatedUid,
    })
    if (device) {
      devices.push(device)
    }
  }
  return devices
}

/** The `events` subcollection reference for a specific owned device. */
export function ownedDeviceEventsRef(
  firestore: Firestore,
  deviceId: string,
): CollectionReference {
  return collection(firestore, DEVICES_COLLECTION, deviceId, EVENTS_SUBCOLLECTION)
}

/** The `dailyStats` subcollection reference for a specific owned device. */
export function ownedDeviceDailyStatsRef(
  firestore: Firestore,
  deviceId: string,
): CollectionReference {
  return collection(firestore, DEVICES_COLLECTION, deviceId, DAILY_STATS_SUBCOLLECTION)
}
