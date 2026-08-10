import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'

import { parseLocalFirebaseConfig, type RawFirebaseEnv } from './config'
import {
  cacheFirebaseServices,
  clearCachedFirebaseServices,
  readCachedFirebaseServices,
} from './service-cache'

export interface LocalFirebaseServices {
  readonly app: FirebaseApp
  readonly auth: Auth
  readonly firestore: Firestore
}

/** Local-only adapter kept out of the hosted application dependency graph. */
export function getLocalFirebaseServices(
  env: RawFirebaseEnv = import.meta.env,
): LocalFirebaseServices {
  const cachedServices = readCachedFirebaseServices()
  if (cachedServices) return cachedServices

  const config = parseLocalFirebaseConfig(env)
  const app = initializeApp({ projectId: config.projectId, apiKey: config.apiKey })
  const auth = getAuth(app)
  const firestore = getFirestore(app)
  connectAuthEmulator(
    auth,
    `http://${config.authEmulator.host}:${config.authEmulator.port}`,
    { disableWarnings: true },
  )
  connectFirestoreEmulator(
    firestore,
    config.firestoreEmulator.host,
    config.firestoreEmulator.port,
  )

  return cacheFirebaseServices({ app, auth, firestore })
}

export function resetLocalFirebaseServices(): void {
  clearCachedFirebaseServices()
}
