// Single fail-closed entry point to the Firebase Web SDK.
//
// getLocalFirebaseServices validates configuration first (parseLocalFirebaseConfig
// throws before any SDK call on invalid input), then initializes exactly one
// Firebase app and connects Auth and Firestore to their fixed loopback Emulators.
// It is intentionally NOT invoked from src/main.ts: the Vue app shell must build
// and render without .env.local or running Emulators. Future data features call
// this adapter at the boundary where they actually need Firebase.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'

import {
  parseFirebaseClientConfig,
  parseLocalFirebaseConfig,
  type FirebaseClientConfig,
  type RawFirebaseEnv,
} from './config'

export interface LocalFirebaseServices {
  readonly app: FirebaseApp
  readonly auth: Auth
  readonly firestore: Firestore
}

export type FirebaseServices = LocalFirebaseServices

let cachedServices: LocalFirebaseServices | null = null

function initializeServices(config: FirebaseClientConfig): FirebaseServices {
  const app = initializeApp(
    config.environment === 'development'
      ? {
          projectId: config.projectId,
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          appId: config.appId,
        }
      : { projectId: config.projectId, apiKey: config.apiKey },
  )
  const auth = getAuth(app)
  const firestore = getFirestore(app)

  if (config.environment === 'local') {
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
  }

  cachedServices = { app, auth, firestore }
  return cachedServices
}

/** Return the one Firebase app for explicit development or local Emulator mode. */
export function getFirebaseServices(env: RawFirebaseEnv = import.meta.env): FirebaseServices {
  if (cachedServices) return cachedServices
  return initializeServices(parseFirebaseClientConfig(env))
}

/**
 * Return the lazily-initialized local Firebase services. The first valid call
 * initializes the app, Auth, and Firestore in that fixed order and connects both
 * Emulators; every later call returns the same instances. Invalid configuration
 * throws LocalFirebaseConfigurationError before initializeApp is ever called.
 *
 * @param env Injected environment (defaults to import.meta.env). Explicit env is
 *            used by tests to exercise valid and invalid configurations.
 */
export function getLocalFirebaseServices(
  env: RawFirebaseEnv = import.meta.env,
): LocalFirebaseServices {
  if (cachedServices) {
    return cachedServices
  }

  return initializeServices({ environment: 'local', ...parseLocalFirebaseConfig(env) })
}

/**
 * Clear the cached services so the next call re-initializes. Intended for tests
 * and local reset flows, not for production request paths.
 */
export function resetLocalFirebaseServices(): void {
  cachedServices = null
}
