import { getFirebaseServices } from '@/platform/firebase/client'

const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PAIR_CODE_PATTERN = /^[0-9]{8}$/

export type ClaimSessionStatus =
  | 'pending'
  | 'claimed'
  | 'expired'
  | 'failed'
  | 'conflict'
  | 'replaced'

const CLAIM_SESSION_STATUSES = new Set<ClaimSessionStatus>([
  'pending',
  'claimed',
  'expired',
  'failed',
  'conflict',
  'replaced',
])

export interface CreatedClaimSession {
  readonly sessionId: string
  readonly deviceId: string
  readonly pairCode: string
  readonly status: 'pending'
  readonly expiresAtMs: number
}

export interface ClaimSessionStatusResponse {
  readonly sessionId: string
  readonly deviceId: string
  readonly status: ClaimSessionStatus
  readonly expiresAtMs: number
}

export type DeviceClaimApiFailureReason =
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'persistence_unavailable'
  | 'unexpected_error'

export type DeviceClaimApiResult<T> =
  | { readonly ok: true; readonly session: T }
  | { readonly ok: false; readonly reason: DeviceClaimApiFailureReason }

export interface DeviceClaimApi {
  createSession(deviceId: string): Promise<DeviceClaimApiResult<CreatedClaimSession>>
  getSessionStatus(
    sessionId: string,
    options?: DeviceClaimApiRequestOptions,
  ): Promise<DeviceClaimApiResult<ClaimSessionStatusResponse>>
}

export interface DeviceClaimApiRequestOptions {
  readonly signal?: AbortSignal
}

export interface DeviceClaimApiUser {
  getIdToken(): Promise<string>
}

export interface DeviceClaimApiAuth {
  readonly currentUser: DeviceClaimApiUser | null
}

export interface CreateDeviceClaimApiOptions {
  readonly baseUrl: URL
  readonly auth?: () => DeviceClaimApiAuth
  readonly fetcher?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function isExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0
}

function parseCreatedSession(value: unknown, requestedDeviceId: string): CreatedClaimSession | null {
  if (!isRecord(value)) return null
  if (!hasExactKeys(value, ['sessionId', 'deviceId', 'pairCode', 'status', 'expiresAtMs'])) {
    return null
  }

  const { sessionId, deviceId, pairCode, status, expiresAtMs } = value
  if (
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId) ||
    deviceId !== requestedDeviceId ||
    typeof deviceId !== 'string' ||
    !DEVICE_ID_PATTERN.test(deviceId) ||
    typeof pairCode !== 'string' ||
    !PAIR_CODE_PATTERN.test(pairCode) ||
    status !== 'pending' ||
    !isExpiry(expiresAtMs)
  ) {
    return null
  }

  return { sessionId, deviceId, pairCode, status, expiresAtMs }
}

function parseSessionStatus(
  value: unknown,
  requestedSessionId: string,
): ClaimSessionStatusResponse | null {
  if (!isRecord(value)) return null
  if (!hasExactKeys(value, ['sessionId', 'deviceId', 'status', 'expiresAtMs'])) return null

  const { sessionId, deviceId, status, expiresAtMs } = value
  if (
    sessionId !== requestedSessionId ||
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId) ||
    typeof deviceId !== 'string' ||
    !DEVICE_ID_PATTERN.test(deviceId) ||
    typeof status !== 'string' ||
    !CLAIM_SESSION_STATUSES.has(status as ClaimSessionStatus) ||
    !isExpiry(expiresAtMs)
  ) {
    return null
  }

  return { sessionId, deviceId, status: status as ClaimSessionStatus, expiresAtMs }
}

function failureForStatus(status: number): DeviceClaimApiResult<never> {
  if (status === 401) return { ok: false, reason: 'unauthorized' }
  if (status === 404) return { ok: false, reason: 'not_found' }
  if (status === 409) return { ok: false, reason: 'conflict' }
  if (status === 503) return { ok: false, reason: 'persistence_unavailable' }
  return { ok: false, reason: 'unexpected_error' }
}

function rootUrl(baseUrl: URL): URL {
  return baseUrl.href.endsWith('/') ? baseUrl : new URL(`${baseUrl.href}/`)
}

export function createDeviceClaimApi(options: CreateDeviceClaimApiOptions): DeviceClaimApi {
  const auth = options.auth ?? (() => getFirebaseServices().auth)
  const fetcher = options.fetcher ?? fetch
  const baseUrl = rootUrl(options.baseUrl)

  async function authenticatedRequest(
    url: URL,
    init: Omit<RequestInit, 'headers'> & { readonly headers?: Readonly<Record<string, string>> },
  ): Promise<Response | DeviceClaimApiResult<never>> {
    let currentAuth: DeviceClaimApiAuth
    try {
      currentAuth = auth()
    } catch {
      return { ok: false, reason: 'unexpected_error' }
    }
    if (currentAuth.currentUser === null) return { ok: false, reason: 'unauthorized' }

    let token: string
    try {
      token = await currentAuth.currentUser.getIdToken()
    } catch {
      return { ok: false, reason: 'unauthorized' }
    }

    try {
      return await fetcher(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
      })
    } catch {
      return { ok: false, reason: 'unexpected_error' }
    }
  }

  return {
    async createSession(deviceId): Promise<DeviceClaimApiResult<CreatedClaimSession>> {
      if (!DEVICE_ID_PATTERN.test(deviceId)) return { ok: false, reason: 'unexpected_error' }

      const response = await authenticatedRequest(
        new URL('v1/device-claim-sessions', baseUrl),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId }),
        },
      )
      if (!(response instanceof Response)) return response
      if (response.status !== 201) return failureForStatus(response.status)

      try {
        const session = parseCreatedSession(await response.json(), deviceId)
        return session
          ? { ok: true, session }
          : { ok: false, reason: 'unexpected_error' }
      } catch {
        return { ok: false, reason: 'unexpected_error' }
      }
    },

    async getSessionStatus(
      sessionId,
      requestOptions = {},
    ): Promise<DeviceClaimApiResult<ClaimSessionStatusResponse>> {
      if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'unexpected_error' }

      const response = await authenticatedRequest(
        new URL(`v1/device-claim-sessions/${encodeURIComponent(sessionId)}`, baseUrl),
        { method: 'GET', signal: requestOptions.signal },
      )
      if (!(response instanceof Response)) return response
      if (response.status !== 200) return failureForStatus(response.status)

      try {
        const session = parseSessionStatus(await response.json(), sessionId)
        return session
          ? { ok: true, session }
          : { ok: false, reason: 'unexpected_error' }
      } catch {
        return { ok: false, reason: 'unexpected_error' }
      }
    },
  }
}
