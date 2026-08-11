import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedDeviceOwnership } from './fixtures/members-and-devices'

// Emulator-backed verification of the deny-by-default Firestore rules. Runs under
// `firebase emulators:exec`, which starts Firestore on 127.0.0.1:8085 and exports
// FIRESTORE_EMULATOR_HOST. The rules file is loaded from disk so a compilation
// error surfaces here as a non-zero test run.
const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url))
const DOC_PATH = 'anything/doc-1'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-peecare',
    firestore: {
      host: '127.0.0.1',
      port: 8085,
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

describe('deny-by-default Firestore rules', () => {
  describe('unauthenticated client', () => {
    it('denies get, create, update, and delete', async () => {
      const db = testEnv.unauthenticatedContext().firestore()
      const ref = doc(db, DOC_PATH)

      await assertFails(getDoc(ref))
      await assertFails(setDoc(ref, { created: true }))
      await assertFails(updateDoc(ref, { changed: true }))
      await assertFails(deleteDoc(ref))
    })
  })

  describe('authenticated client with arbitrary uid and claims', () => {
    it('denies get, create, update, and delete', async () => {
      const db = testEnv
        .authenticatedContext('user-123', { role: 'admin', owner: true })
        .firestore()
      const ref = doc(db, DOC_PATH)

      await assertFails(getDoc(ref))
      await assertFails(setDoc(ref, { created: true }))
      await assertFails(updateDoc(ref, { changed: true }))
      await assertFails(deleteDoc(ref))
    })
  })

  describe('rules-disabled test setup', () => {
    it('permits a fixture write without loosening client authorization', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await assertSucceeds(setDoc(doc(context.firestore(), DOC_PATH), { seeded: true }))
      })

      // Client authorization is unchanged: an unauthenticated read of the
      // seeded document is still denied.
      const clientRef = doc(testEnv.unauthenticatedContext().firestore(), DOC_PATH)
      const denied = await assertFails(getDoc(clientRef))
      expect(denied).toBeDefined()
    })

    it('uses the production ownership fixture to preserve registry fields and seed named/unnamed devices', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore()
        for (const deviceId of ['PC-000001', 'PC-000002', 'PC-000003']) {
          await setDoc(doc(db, 'devices', deviceId), {
            deviceId,
            productModel: 'pc-mini',
            ingestionStatus: 'enabled',
            lastReportedAtMs: 1_700_000_000_000,
            latestBatteryLevelPercent: 75,
          })
        }

        await seedDeviceOwnership(db)

        const named = (await getDoc(doc(db, 'devices/PC-000001'))).data()
        const unnamed = (await getDoc(doc(db, 'devices/PC-000002'))).data()
        expect(named).toMatchObject({
          deviceId: 'PC-000001',
          ownerUid: 'member-001',
          customName: '主浴室',
          productModel: 'pc-mini',
          ingestionStatus: 'enabled',
          lastReportedAtMs: 1_700_000_000_000,
          latestBatteryLevelPercent: 75,
        })
        expect(unnamed).toMatchObject({
          deviceId: 'PC-000002',
          ownerUid: 'member-001',
          productModel: 'pc-mini',
          ingestionStatus: 'enabled',
          lastReportedAtMs: 1_700_000_000_000,
          latestBatteryLevelPercent: 75,
        })
        expect(unnamed).not.toHaveProperty('customName')
      })
    })
  })
})

// Owner-only, read-only device access. The ingestion service writes the registry
// through the Admin SDK (bypassing Rules); the Web client may only *read* a
// device and its child data when it is the single owner.
const OWNER_UID = 'member-001'
const OTHER_UID = 'member-002'
const DEVICE_ID = 'PC-000001'
const DEVICE_PATH = `devices/${DEVICE_ID}`
const EVENT_PATH = `${DEVICE_PATH}/events/evt-1`
const DAILY_PATH = `${DEVICE_PATH}/dailyStats/2026-07-29`

const OWNED_DEVICE = {
  deviceId: DEVICE_ID,
  ownerUid: OWNER_UID,
  productModel: 'pc-mini',
  ingestionStatus: 'enabled',
  lastReportedAtMs: 1_700_000_000_000,
} as const

/** Seed a device document (and optional child docs) through the Admin bypass. */
async function seedDevice(device: Record<string, unknown>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, DEVICE_PATH), device)
    await setDoc(doc(db, EVENT_PATH), { eventId: 'evt-1', eventType: 'urination' })
    await setDoc(doc(db, DAILY_PATH), { dayKey: '2026-07-29', urinationCount: 3 })
  })
}

describe('owner-only device reads', () => {
  beforeEach(async () => {
    await seedDevice({ ...OWNED_DEVICE })
  })

  it('allows the owner to read their device', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertSucceeds(getDoc(doc(db, DEVICE_PATH)))
  })

  it('allows the owner to read the same device when it has a customName', async () => {
    await seedDevice({ ...OWNED_DEVICE, customName: '主浴室' })
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()

    const snapshot = await assertSucceeds(getDoc(doc(db, DEVICE_PATH)))

    expect(snapshot.data()?.customName).toBe('主浴室')
  })

  it('denies another member reading the device', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore()
    await assertFails(getDoc(doc(db, DEVICE_PATH)))
  })

  it('denies an anonymous client reading the device', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, DEVICE_PATH)))
  })
})

describe('owner-only child data reads', () => {
  beforeEach(async () => {
    await seedDevice({ ...OWNED_DEVICE })
  })

  it('allows the owner to read an event under their device', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertSucceeds(getDoc(doc(db, EVENT_PATH)))
  })

  it('allows the owner to read dailyStats under their device', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertSucceeds(getDoc(doc(db, DAILY_PATH)))
  })

  it('denies another member reading child data', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore()
    await assertFails(getDoc(doc(db, EVENT_PATH)))
    await assertFails(getDoc(doc(db, DAILY_PATH)))
  })

  it('denies an anonymous client reading dailyStats', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, DAILY_PATH)))
  })
})

describe('client write denial', () => {
  beforeEach(async () => {
    await seedDevice({ ...OWNED_DEVICE })
  })

  it('denies the owner creating, updating, or deleting the device', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertFails(setDoc(doc(db, 'devices/PC-999999'), { deviceId: 'PC-999999', ownerUid: OWNER_UID }))
    await assertFails(updateDoc(doc(db, DEVICE_PATH), { productModel: 'pc-pro' }))
    await assertFails(updateDoc(doc(db, DEVICE_PATH), { ownerUid: OTHER_UID }))
    await assertFails(deleteDoc(doc(db, DEVICE_PATH)))
  })

  it('denies the owner setting or clearing customName through the Web SDK', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertFails(updateDoc(doc(db, DEVICE_PATH), { customName: '主浴室' }))

    await seedDevice({ ...OWNED_DEVICE, customName: '既有名稱' })
    await assertFails(updateDoc(doc(db, DEVICE_PATH), { customName: deleteField() }))
  })

  it('denies the owner writing events and dailyStats', async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertFails(setDoc(doc(db, `${DEVICE_PATH}/events/evt-2`), { eventId: 'evt-2' }))
    await assertFails(updateDoc(doc(db, DAILY_PATH), { urinationCount: 99 }))
    await assertFails(deleteDoc(doc(db, EVENT_PATH)))
  })
})

describe('Test Tool usage-ledger client denial', () => {
  const ledgerPath = `developmentTestToolUsage/${'a'.repeat(64)}`
  const newLedgerPath = `developmentTestToolUsage/${'b'.repeat(64)}`

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), ledgerPath), {
        dayKey: '2026-08-11',
        acceptedToday: 1,
        nextSequence: 1,
      })
    })
  })

  it.each([
    ['owner', () => testEnv.authenticatedContext(OWNER_UID).firestore()],
    ['anonymous', () => testEnv.unauthenticatedContext().firestore()],
  ])('denies %s direct reads and every write', async (_case, database) => {
    const ref = doc(database(), ledgerPath)
    const newRef = doc(database(), newLedgerPath)

    await assertFails(getDoc(ref))
    await assertFails(setDoc(newRef, { acceptedToday: 0 }))
    await assertFails(setDoc(ref, { acceptedToday: 0 }))
    await assertFails(updateDoc(ref, { acceptedToday: 0 }))
    await assertFails(deleteDoc(ref))
  })
})

describe('malformed ownership denial', () => {
  it.each([
    ['empty ownerUid', { ...OWNED_DEVICE, ownerUid: '' }],
    ['missing ownerUid', { deviceId: DEVICE_ID, productModel: 'pc-mini', ingestionStatus: 'enabled' }],
    ['non-string ownerUid', { ...OWNED_DEVICE, ownerUid: 12345 }],
  ])('denies an authenticated member reading a device with %s', async (_label, device) => {
    await seedDevice(device as Record<string, unknown>)
    const db = testEnv.authenticatedContext(OWNER_UID).firestore()
    await assertFails(getDoc(doc(db, DEVICE_PATH)))
    // Child data is equally unreachable when the parent owner is malformed.
    await assertFails(getDoc(doc(db, EVENT_PATH)))
  })
})
