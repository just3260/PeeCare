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
  | 'invalid_environment'
  | 'emulator_disabled'
  | 'project_mismatch'
  | 'auth_domain_mismatch'
  | 'non_loopback_host'
  | 'production_mode'
  | 'emulator_enabled_in_development'

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
  readonly VITE_FIREBASE_ENVIRONMENT?: string
  readonly VITE_FIREBASE_APPROVED_PROJECT_ID?: string
  readonly VITE_FIREBASE_USE_EMULATORS?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_HOST?: string
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string
  readonly VITE_MEMBER_API_URL?: string
}

export type MemberApiConfigErrorCode =
  | 'missing_member_api_url'
  | 'invalid_member_api_url'
  | 'insecure_member_api_url'
  | 'local_member_api_url'

export class MemberApiConfigurationError extends Error {
  readonly code: MemberApiConfigErrorCode

  constructor(code: MemberApiConfigErrorCode, message: string) {
    super(message)
    this.name = 'MemberApiConfigurationError'
    this.code = code
    Object.setPrototypeOf(this, MemberApiConfigurationError.prototype)
  }
}

export interface MemberApiConfig {
  readonly baseUrl: URL
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '')
  if (normalized === 'localhost') return true
  const ipv4Segments = normalized.split('.')
  const isIpv4Literal =
    ipv4Segments.length === 4 &&
    ipv4Segments.every(
      (segment) => /^\d{1,3}$/.test(segment) && Number(segment) >= 0 && Number(segment) <= 255,
    )
  if (isIpv4Literal && Number(ipv4Segments[0]) === 127) return true
  const ipv6 = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  return ipv6 === '::1' || /^::ffff:7f[0-9a-f]{2}:/.test(ipv6)
}

/** Validate the Member API origin before the composition root creates any client. */
export function parseMemberApiConfig(env: RawFirebaseEnv): MemberApiConfig {
  const raw = env.VITE_MEMBER_API_URL
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new MemberApiConfigurationError(
      'missing_member_api_url',
      'VITE_MEMBER_API_URL is required.',
    )
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(raw)
  } catch {
    throw new MemberApiConfigurationError(
      'invalid_member_api_url',
      'VITE_MEMBER_API_URL must be a valid HTTP(S) origin.',
    )
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.pathname !== '/' ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0 ||
    (raw !== baseUrl.origin && raw !== `${baseUrl.origin}/`)
  ) {
    throw new MemberApiConfigurationError(
      'invalid_member_api_url',
      'VITE_MEMBER_API_URL must be an exact HTTP(S) origin.',
    )
  }

  const production = env.PROD === true || env.MODE === 'production'
  const loopback = isLoopbackHostname(baseUrl.hostname)
  if (production && loopback) {
    throw new MemberApiConfigurationError(
      'local_member_api_url',
      'A production build must not use a local Member API URL.',
    )
  }
  if (baseUrl.protocol !== 'https:' && !(!production && loopback)) {
    throw new MemberApiConfigurationError(
      'insecure_member_api_url',
      'Member API requires HTTPS except for a local loopback endpoint.',
    )
  }

  return { baseUrl: new URL(`${baseUrl.origin}/`) }
}

export interface DevelopmentFirebaseConfig {
  readonly environment: 'development'
  readonly projectId: string
  readonly apiKey: string
  readonly authDomain: string
  readonly appId: string
}

export type FirebaseClientConfig =
  | DevelopmentFirebaseConfig
  | (LocalFirebaseConfig & { readonly environment: 'local' })

/** Resolve one Firebase client contract for the active Vite environment. */
export function parseFirebaseClientConfig(env: RawFirebaseEnv): FirebaseClientConfig {
  if (env.VITE_FIREBASE_ENVIRONMENT === 'local') {
    return { environment: 'local', ...parseLocalFirebaseConfig(env) }
  }
  if (env.VITE_FIREBASE_ENVIRONMENT !== 'development') {
    throw new LocalFirebaseConfigurationError(
      'invalid_environment',
      'VITE_FIREBASE_ENVIRONMENT must explicitly select local or development.',
    )
  }

  if (
    env.VITE_FIREBASE_USE_EMULATORS !== undefined ||
    env.VITE_FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
    env.VITE_FIREBASE_AUTH_EMULATOR_PORT !== undefined ||
    env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST !== undefined ||
    env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT !== undefined
  ) {
    throw new LocalFirebaseConfigurationError(
      'emulator_enabled_in_development',
      'Development Firebase configuration must not include Emulator settings.',
    )
  }

  const approvedProjectId = requireString(
    env.VITE_FIREBASE_APPROVED_PROJECT_ID,
    'VITE_FIREBASE_APPROVED_PROJECT_ID',
  )
  const projectId = requireString(env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID')
  const apiKey = requireString(env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY')
  const authDomain = requireString(env.VITE_FIREBASE_AUTH_DOMAIN, 'VITE_FIREBASE_AUTH_DOMAIN')
  const appId = requireString(env.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID')

  if (
    projectId !== approvedProjectId ||
    projectId === DEMO_PROJECT_ID ||
    /(^|-)(prod|production)(-|$)/i.test(projectId)
  ) {
    throw new LocalFirebaseConfigurationError(
      'project_mismatch',
      'Development Firebase project must match the approved non-demo, non-production project.',
    )
  }

  const allowedAuthDomains = new Set([
    `${projectId}.firebaseapp.com`,
    `${projectId}.web.app`,
  ])
  if (!allowedAuthDomains.has(authDomain)) {
    throw new LocalFirebaseConfigurationError(
      'auth_domain_mismatch',
      'VITE_FIREBASE_AUTH_DOMAIN must belong to the approved development project.',
    )
  }

  return {
    environment: 'development',
    projectId,
    apiKey,
    authDomain,
    appId,
  }
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
