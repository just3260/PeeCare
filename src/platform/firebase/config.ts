// Fail-closed configuration parser for the local Firebase platform.
//
// This module never touches the Firebase SDK. It validates the injected
// environment and either returns a fully-resolved local configuration or throws
// a LocalFirebaseConfigurationError with a stable code. Callers (client.ts) must
// only initialize Firebase after this parser succeeds, guaranteeing that invalid
// configuration fails before any app, Auth, or Firestore instance is created.

/** The single demo project the local platform is allowed to touch. */
export const DEMO_PROJECT_ID = 'demo-peecare'

/** Fixed loopback Emulator ports. Kept in sync with firebase.json. */
export const AUTH_EMULATOR_PORT = 9099
export const FIRESTORE_EMULATOR_PORT = 8085

/** The exact host shared by the committed CLI and Web SDK configuration. */
export const EMULATOR_HOST = '127.0.0.1'

export type LocalFirebaseConfigErrorCode =
  | 'missing_config'
  | 'emulator_disabled'
  | 'project_mismatch'
  | 'non_loopback_host'
  | 'production_mode'

/** Raised for every invalid local configuration, before any SDK initialization. */
export class LocalFirebaseConfigurationError extends Error {
  readonly code: LocalFirebaseConfigErrorCode

  constructor(code: LocalFirebaseConfigErrorCode, message: string) {
    super(message)
    this.name = 'LocalFirebaseConfigurationError'
    this.code = code
    // Preserve prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, LocalFirebaseConfigurationError.prototype)
  }
}

/** Endpoint pair for a single Emulator. */
export interface EmulatorEndpoint {
  readonly host: string
  readonly port: number
}

/** Fully-validated local Firebase configuration. */
export interface LocalFirebaseConfig {
  readonly projectId: typeof DEMO_PROJECT_ID
  readonly apiKey: string
  readonly authEmulator: EmulatorEndpoint
  readonly firestoreEmulator: EmulatorEndpoint
}

/**
 * The subset of import.meta.env the parser reads. Injected so the parser stays
 * pure and testable without touching import.meta.
 */
export interface RawFirebaseEnv {
  readonly MODE?: string
  readonly PROD?: boolean
  readonly VITE_FIREBASE_USE_EMULATORS?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_HOST?: string
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function requireString(
  value: string | undefined,
  fieldName: string,
): string {
  if (!isNonEmptyString(value)) {
    throw new LocalFirebaseConfigurationError(
      'missing_config',
      `Missing required local Firebase configuration: ${fieldName}.`,
    )
  }
  return value
}

function parseFixedPort(
  value: string | undefined,
  fieldName: string,
  expectedPort: number,
): number {
  const raw = requireString(value, fieldName)
  const port = Number(raw)
  if (!Number.isInteger(port) || port !== expectedPort) {
    throw new LocalFirebaseConfigurationError(
      'missing_config',
      `Invalid ${fieldName}: expected the fixed Emulator port ${expectedPort}, received "${raw}".`,
    )
  }
  return port
}

function requireLoopbackHost(host: string, fieldName: string): string {
  if (host !== EMULATOR_HOST) {
    throw new LocalFirebaseConfigurationError(
      'non_loopback_host',
      `Refusing ${fieldName} "${host}"; local Firebase must use the fixed loopback host ${EMULATOR_HOST}.`,
    )
  }
  return host
}

/**
 * Validate the injected environment and return the resolved local configuration.
 * Checks run in fail-closed order: production first (never touch Firebase in a
 * production build), then explicit Emulator enablement, then required fields,
 * project identity, and finally loopback hosts and fixed ports.
 */
export function parseLocalFirebaseConfig(env: RawFirebaseEnv): LocalFirebaseConfig {
  if (env.PROD === true || env.MODE === 'production') {
    throw new LocalFirebaseConfigurationError(
      'production_mode',
      'The local Firebase adapter must never run in a production build.',
    )
  }

  if (env.VITE_FIREBASE_USE_EMULATORS !== 'true') {
    throw new LocalFirebaseConfigurationError(
      'emulator_disabled',
      'Set VITE_FIREBASE_USE_EMULATORS=true to enable the local Firebase adapter.',
    )
  }

  const projectId = requireString(env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID')
  const apiKey = requireString(env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY')
  const authHost = requireString(
    env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
    'VITE_FIREBASE_AUTH_EMULATOR_HOST',
  )
  const firestoreHost = requireString(
    env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST,
    'VITE_FIREBASE_FIRESTORE_EMULATOR_HOST',
  )

  if (projectId !== DEMO_PROJECT_ID) {
    throw new LocalFirebaseConfigurationError(
      'project_mismatch',
      `Refusing project ID "${projectId}"; the local platform only accepts ${DEMO_PROJECT_ID}.`,
    )
  }

  requireLoopbackHost(authHost, 'VITE_FIREBASE_AUTH_EMULATOR_HOST')
  requireLoopbackHost(firestoreHost, 'VITE_FIREBASE_FIRESTORE_EMULATOR_HOST')

  const authPort = parseFixedPort(
    env.VITE_FIREBASE_AUTH_EMULATOR_PORT,
    'VITE_FIREBASE_AUTH_EMULATOR_PORT',
    AUTH_EMULATOR_PORT,
  )
  const firestorePort = parseFixedPort(
    env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT,
    'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT',
    FIRESTORE_EMULATOR_PORT,
  )

  return {
    projectId: DEMO_PROJECT_ID,
    apiKey,
    authEmulator: { host: authHost, port: authPort },
    firestoreEmulator: { host: firestoreHost, port: firestorePort },
  }
}
