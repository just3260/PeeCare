import { randomUUID } from 'node:crypto'

import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
  type App as AdminApp,
} from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import type { Firestore as AdminFirestore } from 'firebase-admin/firestore'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  type Auth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'

import { buildApp } from '../src/app.js'
import { DeviceNameService } from '../src/devices/device-name-service.js'
import { createFirestore } from '../src/firestore/firestore-client.js'
import { FirestoreDeviceNameRepository } from '../src/firestore/device-name-repository.js'
import { FirebaseIdTokenVerifier } from '../src/security/firebase-id-token-verifier.js'
import { resolveDeviceDisplayName } from '../../../src/features/devices/device-display-name.js'
import { createMemberDeviceApi } from '../../../src/features/devices/member-device-api.js'
import { parseOwnedDevice } from '../../../src/features/devices/owned-device-model.js'

const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST
const hasEmulators = Boolean(authEmulatorHost && firestoreEmulatorHost)
const PROJECT_ID = 'demo-peecare'
const DEVICE_ID = 'PC-E2E-NAME-001'
const MISSING_DEVICE_ID = 'PC-E2E-MISSING'
const PASSWORD = 'emulator-pass-1234'

describe.skipIf(!hasEmulators)('Member API authenticated rename flow', () => {
  interface Harness {
    ownerApp: FirebaseApp
    foreignApp: FirebaseApp
    ownerAuth: Auth
    foreignAuth: Auth
    ownerFirestore: Firestore
    adminApp: AdminApp
    adminFirestore: AdminFirestore
    app: FastifyInstance
  }

  let harness: Harness | undefined

  let ownerUid = ''
  let foreignUid = ''

  function currentHarness(): Harness {
    if (!harness) throw new Error('Firebase emulator test harness is not initialized')
    return harness
  }

  function connectWebEmulators(auth: Auth): void {
    connectAuthEmulator(auth, `http://${authEmulatorHost!}`, { disableWarnings: true })
  }

  function fetchThroughFastify(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const { app } = currentHarness()
    const headers = new Headers(init?.headers)
    return app
      .inject({
        method: (init?.method ?? 'GET') as 'GET' | 'PATCH',
        url: new URL(String(input)).pathname,
        headers: Object.fromEntries(headers.entries()),
        payload: typeof init?.body === 'string' ? init.body : undefined,
      })
      .then(
        (response) =>
          new Response(response.body, {
            status: response.statusCode,
            headers: { 'content-type': response.headers['content-type'] ?? 'application/json' },
          }),
      )
  }

  beforeAll(async () => {
    if (!authEmulatorHost || !firestoreEmulatorHost) {
      throw new Error('Firebase emulator hosts are required')
    }

    const suffix = `${Date.now()}-${randomUUID()}`
    const ownerApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, `owner-${suffix}`)
    const foreignApp = initializeApp(
      { projectId: PROJECT_ID, apiKey: 'demo-key' },
      `foreign-${suffix}`,
    )
    const ownerAuth = getAuth(ownerApp)
    const foreignAuth = getAuth(foreignApp)
    const ownerFirestore = getFirestore(ownerApp)
    const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `member-api-${suffix}`)
    const adminFirestore = createFirestore({
      projectId: PROJECT_ID,
      emulatorHost: firestoreEmulatorHost,
    })
    const app = buildApp({
      dependencies: {
        tokenVerifier: new FirebaseIdTokenVerifier(getAdminAuth(adminApp)),
        deviceNameService: new DeviceNameService(
          new FirestoreDeviceNameRepository(adminFirestore),
        ),
      },
      allowedOrigin: 'http://127.0.0.1:5173',
      logger: false,
    })
    harness = {
      ownerApp,
      foreignApp,
      ownerAuth,
      foreignAuth,
      ownerFirestore,
      adminApp,
      adminFirestore,
      app,
    }

    try {
      connectWebEmulators(ownerAuth)
      connectWebEmulators(foreignAuth)
      const [firestoreHost, firestorePort] = firestoreEmulatorHost.split(':')
      connectFirestoreEmulator(ownerFirestore, firestoreHost, Number(firestorePort))

      const owner = await createUserWithEmailAndPassword(
        ownerAuth,
        `owner-${suffix}@peecare.test`,
        PASSWORD,
      )
      const foreign = await createUserWithEmailAndPassword(
        foreignAuth,
        `foreign-${suffix}@peecare.test`,
        PASSWORD,
      )
      ownerUid = owner.user.uid
      foreignUid = foreign.user.uid

      await adminFirestore.doc(`devices/${DEVICE_ID}`).set({
        deviceId: DEVICE_ID,
        ownerUid,
        productModel: 'pc-mini',
        ingestionStatus: 'enabled',
        latestBatteryLevelPercent: 75,
        lastReportedAtMs: 1_700_000_000_000,
      })
      await adminFirestore.doc(`devices/${DEVICE_ID}/events/evt-1`).set({ eventId: 'evt-1' })
      await adminFirestore.doc(`devices/${DEVICE_ID}/dailyStats/2026-08-02`).set({
        urinationCount: 2,
      })
    } catch (error) {
      try {
        await closeHarness()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Harness setup and cleanup both failed')
      }
      throw error
    }
  })

  async function closeHarness(): Promise<void> {
    if (!harness) return
    const resources = harness
    harness = undefined
    const cleanupResults = await Promise.allSettled([
      resources.adminFirestore.recursiveDelete(resources.adminFirestore.doc(`devices/${DEVICE_ID}`)),
      resources.adminFirestore.recursiveDelete(
        resources.adminFirestore.doc(`devices/${MISSING_DEVICE_ID}`),
      ),
    ])
    cleanupResults.push(
      ...(await Promise.allSettled([resources.app.close(), resources.adminFirestore.terminate()])),
    )
    cleanupResults.push(
      ...(await Promise.allSettled([
        deleteApp(resources.ownerApp),
        deleteApp(resources.foreignApp),
        deleteAdminApp(resources.adminApp),
      ])),
    )

    const failures = cleanupResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length > 0) throw new AggregateError(failures, 'Harness cleanup failed')
  }

  afterAll(closeHarness)

  it('renames, reloads through Web Firestore, clears, and preserves registry data', async () => {
    const { ownerAuth, ownerFirestore, adminFirestore } = currentHarness()
    const api = createMemberDeviceApi({
      baseUrl: new URL('http://127.0.0.1:8087'),
      auth: () => ownerAuth,
      fetcher: fetchThroughFastify,
    })

    await expect(api.renameDevice(DEVICE_ID, '  主浴室  ')).resolves.toEqual({
      ok: true,
      device: { deviceId: DEVICE_ID, customName: '主浴室', displayName: '主浴室' },
    })

    const stored = (await adminFirestore.doc(`devices/${DEVICE_ID}`).get()).data()
    expect(stored).toMatchObject({
      deviceId: DEVICE_ID,
      ownerUid,
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      latestBatteryLevelPercent: 75,
      lastReportedAtMs: 1_700_000_000_000,
      customName: '主浴室',
    })
    expect((await adminFirestore.doc(`devices/${DEVICE_ID}/events/evt-1`).get()).exists).toBe(true)
    expect((await adminFirestore.doc(`devices/${DEVICE_ID}/dailyStats/2026-08-02`).get()).exists).toBe(true)

    const renamedSnapshot = await getDoc(doc(ownerFirestore, 'devices', DEVICE_ID))
    const renamed = parseOwnedDevice({
      documentId: renamedSnapshot.id,
      data: renamedSnapshot.data(),
      authenticatedUid: ownerUid,
    })
    expect(renamed && resolveDeviceDisplayName(renamed)).toBe('主浴室')

    await expect(api.renameDevice(DEVICE_ID, null)).resolves.toEqual({
      ok: true,
      device: { deviceId: DEVICE_ID, customName: null, displayName: DEVICE_ID },
    })
    const clearedSnapshot = await getDoc(doc(ownerFirestore, 'devices', DEVICE_ID))
    const cleared = parseOwnedDevice({
      documentId: clearedSnapshot.id,
      data: clearedSnapshot.data(),
      authenticatedUid: ownerUid,
    })
    expect(cleared?.customName).toBeNull()
    expect(cleared && resolveDeviceDisplayName(cleared)).toBe(DEVICE_ID)
  })

  it('maps foreign-owned and missing devices to the same typed 404 outcome', async () => {
    const { foreignAuth, adminFirestore } = currentHarness()
    const foreignApi = createMemberDeviceApi({
      baseUrl: new URL('http://127.0.0.1:8087'),
      auth: () => foreignAuth,
      fetcher: fetchThroughFastify,
    })

    const foreign = await foreignApi.renameDevice(DEVICE_ID, '越權名稱')
    const missing = await foreignApi.renameDevice(MISSING_DEVICE_ID, '探測名稱')

    expect(foreign).toEqual({ ok: false, reason: 'device_not_found' })
    expect(missing).toEqual(foreign)
    expect((await adminFirestore.doc(`devices/${DEVICE_ID}`).get()).get('ownerUid')).toBe(ownerUid)
    expect(foreignUid).not.toBe(ownerUid)
  })
})
