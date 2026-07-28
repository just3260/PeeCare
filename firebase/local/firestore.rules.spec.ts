import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
  })
})
