// Cloud-only, fail-closed entry point to the Firebase Web SDK. The local
// Emulator connector lives in local-client.ts so it cannot enter the hosted
// application dependency graph.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

import {
  LocalFirebaseConfigurationError,
  parseFirebaseClientConfig,
  type DevelopmentFirebaseConfig,
  type RawFirebaseEnv,
} from './config'
import {
  cacheFirebaseServices,
  clearCachedFirebaseServices,
  readCachedFirebaseServices,
} from './service-cache'

export interface FirebaseServices {
  readonly app: FirebaseApp
  readonly auth: Auth
  readonly firestore: Firestore
}

function initializeServices(config: DevelopmentFirebaseConfig): FirebaseServices {
  const app = initializeApp({
    projectId: config.projectId,
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    appId: config.appId,
  })
  const auth = getAuth(app)
  const firestore = getFirestore(app)

  return cacheFirebaseServices({ app, auth, firestore })
}

/** Return the one Firebase app for the explicit development cloud environment. */
export function getFirebaseServices(env: RawFirebaseEnv = import.meta.env): FirebaseServices {
  const cachedServices = readCachedFirebaseServices()
  if (cachedServices) return cachedServices
  const config = parseFirebaseClientConfig(env)
  if (config.environment !== 'development') {
    throw new LocalFirebaseConfigurationError(
      'invalid_environment',
      'Cloud Firebase services require the explicit development environment.',
    )
  }
  return initializeServices(config)
}

/**
 * Clear the cached services so the next call re-initializes. Intended for tests
 * and test reset flows, not for production request paths.
 */
export function resetFirebaseServices(): void {
  clearCachedFirebaseServices()
}
