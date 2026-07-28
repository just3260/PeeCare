import {
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Firestore,
} from 'firebase/firestore'

import { ownedDeviceEventsRef } from '@/features/devices/owned-device-repository'
import {
  parseUrinationHistoryRecord,
  type UrinationHistoryRecord,
} from './urination-history-model'

/** The fixed, bounded history page size. */
export const URINATION_HISTORY_PAGE_SIZE = 25

/** A Firestore page before its documents are validated into domain records. */
export interface UrinationHistoryPage {
  readonly items: readonly UrinationHistoryRecord[]
  readonly cursor: QueryDocumentSnapshot<DocumentData> | null
  readonly hasMore: boolean
}

/**
 * Load one stable page of a device's urination events.
 *
 * Firestore applies both ordering keys; the document cursor therefore advances
 * through an exact continuation of this order without an offset scan.
 */
export async function loadUrinationPage(
  firestore: Firestore,
  deviceId: string,
  cursor?: QueryDocumentSnapshot<DocumentData> | null,
): Promise<UrinationHistoryPage> {
  if (!deviceId) {
    throw new Error('loadUrinationPage requires a non-empty device ID.')
  }

  const constraints = [
    where('eventType', '==', 'urination'),
    orderBy('effectiveAtMs', 'desc'),
    orderBy('eventId', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(URINATION_HISTORY_PAGE_SIZE),
  ]
  const snapshot = await getDocs(query(ownedDeviceEventsRef(firestore, deviceId), ...constraints))
  const lastDocument = snapshot.docs.at(-1) ?? null

  return {
    items: snapshot.docs.map((document) =>
      parseUrinationHistoryRecord({
        documentId: document.id,
        selectedDeviceId: deviceId,
        data: document.data(),
      }),
    ),
    cursor: lastDocument,
    hasMore: snapshot.docs.length === URINATION_HISTORY_PAGE_SIZE,
  }
}
