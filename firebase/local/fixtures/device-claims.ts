// Canonical Admin-only Claim storage fixtures for Firestore Rules tests.
//
// These documents are seeded only through the rules-disabled test context. No
// Web SDK path is allowed to read or mutate them, even for the owning member.

import type { Firestore } from 'firebase/firestore'
import { doc, setDoc } from 'firebase/firestore'

const DEVICE_ID = '68E274BD2A58'
const SESSION_ID = 'session-001'

export const DEVICE_CLAIM_SESSION_PATH = `deviceClaimSessions/${SESSION_ID}`
export const ACTIVE_DEVICE_CLAIM_PATH = `activeDeviceClaims/${DEVICE_ID}`

export async function seedDeviceClaimStorage(firestore: Firestore): Promise<void> {
  await setDoc(doc(firestore, DEVICE_CLAIM_SESSION_PATH), {
    memberUid: 'member-001',
    expectedDeviceId: DEVICE_ID,
    codeMac: 'a'.repeat(64),
    codeKeyVersion: '7',
    status: 'pending',
    attemptCount: 0,
    rejectedCodeMacs: [],
    createdAtMs: 1_787_675_000_000,
    expiresAtMs: 1_787_675_300_000,
  })
  await setDoc(doc(firestore, ACTIVE_DEVICE_CLAIM_PATH), {
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    status: 'pending',
    expiresAtMs: 1_787_675_300_000,
  })
}
