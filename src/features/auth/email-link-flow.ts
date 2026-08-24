import { resolveSafeReturnPath } from './return-route'

export const EMAIL_LINK_CALLBACK_PATH = '/auth/email-link'
export const PENDING_EMAIL_LINK_STORAGE_KEY = 'peecare:auth:pending-email-link:v1'
export const PENDING_EMAIL_LINK_TTL_MS = 1_800_000

export interface PendingEmailLinkRecord {
  readonly version: 1
  readonly email: string
  readonly returnTo: string
  readonly requestedAtMs: number
}

export interface EmailLinkStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type EmailLinkFlowErrorCode = 'invalid_email' | 'invalid_origin'

/** A finite, sanitized error boundary for Email Link input failures. */
export class EmailLinkFlowError extends Error {
  readonly code: EmailLinkFlowErrorCode

  constructor(code: EmailLinkFlowErrorCode) {
    super(code)
    this.name = 'EmailLinkFlowError'
    this.code = code
  }
}

/** Return the canonical Email Link identity without exposing it in an error. */
export function validateEmailLinkEmail(email: string): string {
  if (typeof email !== 'string') {
    throw new EmailLinkFlowError('invalid_email')
  }

  const normalized = email.trim()
  if (normalized.length === 0 || normalized.length > 254) {
    throw new EmailLinkFlowError('invalid_email')
  }

  return normalized
}

/**
 * Build the Firebase action URL from a trusted application origin and an
 * attacker-influenced return path. Email is intentionally not an input.
 */
export function createEmailLinkActionUrl(input: {
  readonly origin: string
  readonly returnTo: string | null | undefined
}): string {
  let parsedOrigin: URL
  try {
    parsedOrigin = new URL(input.origin)
  } catch {
    throw new EmailLinkFlowError('invalid_origin')
  }

  if (
    (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') ||
    parsedOrigin.origin !== input.origin
  ) {
    throw new EmailLinkFlowError('invalid_origin')
  }

  const actionUrl = new URL(EMAIL_LINK_CALLBACK_PATH, parsedOrigin.origin)
  actionUrl.searchParams.set('returnTo', resolveSafeReturnPath(input.returnTo))
  return actionUrl.toString()
}

/**
 * Persist one bounded pending identity. Storage failure is deliberately a
 * non-throwing false result because Firebase may already have delivered the
 * link; the callback will then require Email re-entry.
 */
export function writePendingEmailLink(
  input: { readonly email: string; readonly returnTo: string | null | undefined },
  providedStorage?: EmailLinkStorage,
): boolean {
  const email = validateEmailLinkEmail(input.email)
  const storage = resolveStorage(providedStorage)
  if (storage === null) {
    return false
  }

  const record: PendingEmailLinkRecord = {
    version: 1,
    email,
    returnTo: resolveSafeReturnPath(input.returnTo),
    requestedAtMs: Date.now(),
  }

  try {
    storage.setItem(PENDING_EMAIL_LINK_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    // Avoid accidentally completing with a stale identity after a failed
    // overwrite. Cleanup is best-effort because storage itself is unavailable.
    removePendingRecord(storage)
    return false
  }
}

/** Read a valid pending identity, clearing every malformed or stale record. */
export function readPendingEmailLink(
  providedStorage?: EmailLinkStorage,
): PendingEmailLinkRecord | null {
  const storage = resolveStorage(providedStorage)
  if (storage === null) {
    return null
  }

  let raw: string | null
  try {
    raw = storage.getItem(PENDING_EMAIL_LINK_STORAGE_KEY)
  } catch {
    return null
  }

  if (raw === null) {
    return null
  }

  const record = parsePendingRecord(raw, Date.now())
  if (record === null) {
    removePendingRecord(storage)
  }
  return record
}

/** Clear a consumed or failed pending identity without leaking storage errors. */
export function clearPendingEmailLink(providedStorage?: EmailLinkStorage): boolean {
  const storage = resolveStorage(providedStorage)
  return storage === null ? false : removePendingRecord(storage)
}

function resolveStorage(providedStorage?: EmailLinkStorage): EmailLinkStorage | null {
  if (providedStorage !== undefined) {
    return providedStorage
  }

  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function removePendingRecord(storage: EmailLinkStorage): boolean {
  try {
    storage.removeItem(PENDING_EMAIL_LINK_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

function parsePendingRecord(raw: string, nowMs: number): PendingEmailLinkRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isExactPendingRecordObject(value)) {
    return null
  }

  const { version, email, returnTo, requestedAtMs } = value
  if (version !== 1 || typeof email !== 'string' || typeof returnTo !== 'string') {
    return null
  }

  try {
    if (validateEmailLinkEmail(email) !== email) {
      return null
    }
  } catch {
    return null
  }

  if (resolveSafeReturnPath(returnTo) !== returnTo) {
    return null
  }
  if (
    typeof requestedAtMs !== 'number' ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(requestedAtMs)
  ) {
    return null
  }
  if (requestedAtMs > nowMs || nowMs - requestedAtMs >= PENDING_EMAIL_LINK_TTL_MS) {
    return null
  }

  return { version, email, returnTo, requestedAtMs }
}

function isExactPendingRecordObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const expectedKeys = ['email', 'requestedAtMs', 'returnTo', 'version']
  const actualKeys = Object.keys(value).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}
