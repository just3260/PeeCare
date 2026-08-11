import { getFirebaseServices } from '@/platform/firebase/client'

import {
  APPROVED_TEST_TOOL_API_ORIGIN,
  TestToolApiConfigurationError,
} from './test-tool-api-config'

export interface TestToolApiUser {
  getIdToken(): Promise<string>
}

export interface TestToolApiAuth {
  readonly currentUser: TestToolApiUser | null
}

export interface TestToolDevice {
  readonly deviceId: string
  readonly displayName: string
}

export interface UrinationTestEventRequest {
  readonly eventType: 'urination'
  readonly flushDurationMs: number
  readonly pumpDurationMs: number
}

export interface BatteryTestEventRequest {
  readonly eventType: 'battery'
  readonly batteryLevelPercent: 0 | 25 | 50 | 75 | 100
  readonly batteryVoltageMv?: number
}

export type TestToolEventRequest = UrinationTestEventRequest | BatteryTestEventRequest

export interface TestToolEventResult {
  readonly status: 'stored' | 'duplicate'
  readonly eventId: string
  readonly eventType: TestToolEventRequest['eventType']
  readonly deviceId: string
  readonly sequence: number
}

export type TestToolApiFailureReason =
  | 'unauthorized'
  | 'test_device_not_found'
  | 'invalid_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'rate_limited'
  | 'sequence_exhausted'
  | 'ingestion_unavailable'
  | 'internal_error'
  | 'unexpected_error'

export interface TestToolApiFailure {
  readonly ok: false
  readonly reason: TestToolApiFailureReason
  readonly requestId?: string
  readonly retryAfterSeconds?: number
}

export type TestToolDeviceListResult =
  | { readonly ok: true; readonly devices: readonly TestToolDevice[] }
  | TestToolApiFailure

export type TestToolEventSubmissionResult =
  | { readonly ok: true; readonly result: TestToolEventResult }
  | TestToolApiFailure

export interface TestToolApi {
  listDevices(): Promise<TestToolDeviceListResult>
  submitEvent(
    deviceId: string,
    request: TestToolEventRequest,
  ): Promise<TestToolEventSubmissionResult>
}

export interface CreateTestToolApiOptions {
  readonly baseUrl: URL
  readonly auth?: () => TestToolApiAuth
  readonly fetcher?: typeof fetch
}

const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const REQUEST_ID_PATTERN = UUID_V4_PATTERN
const FORBIDDEN_DISPLAY_NAME_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u
const UINT32_MAX = 4_294_967_295
const BATTERY_TIERS = new Set([0, 25, 50, 75, 100])

const STATUS_ERRORS = new Map<number, TestToolApiFailureReason>([
  [400, 'invalid_request'],
  [401, 'unauthorized'],
  [404, 'test_device_not_found'],
  [409, 'sequence_exhausted'],
  [413, 'payload_too_large'],
  [415, 'unsupported_media_type'],
  [429, 'rate_limited'],
  [500, 'internal_error'],
  [503, 'ingestion_unavailable'],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function isCanonicalCustomName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    Array.from(value).length <= 30 &&
    !FORBIDDEN_DISPLAY_NAME_CHARACTERS.test(value)
}

function parseDeviceList(value: unknown): readonly TestToolDevice[] | null {
  if (!isRecord(value) || !hasExactKeys(value, ['devices']) || !Array.isArray(value.devices)) {
    return null
  }
  const seen = new Set<string>()
  const devices: TestToolDevice[] = []
  for (const candidate of value.devices) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['deviceId', 'displayName']) ||
      typeof candidate.deviceId !== 'string' ||
      !TOPIC_SEGMENT_PATTERN.test(candidate.deviceId) ||
      seen.has(candidate.deviceId) ||
      (candidate.displayName !== candidate.deviceId &&
        !isCanonicalCustomName(candidate.displayName))
    ) {
      return null
    }
    seen.add(candidate.deviceId)
    devices.push(Object.freeze({
      deviceId: candidate.deviceId,
      displayName: candidate.displayName as string,
    }))
  }
  return Object.freeze(devices)
}

function parseEventResult(
  value: unknown,
  expectedDeviceId: string,
  expectedEventType: TestToolEventRequest['eventType'],
): TestToolEventResult | null {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['status', 'eventId', 'eventType', 'deviceId', 'sequence'],
  )) return null
  const prefix = `tt:${expectedDeviceId}:`
  const uuid = typeof value.eventId === 'string'
    ? value.eventId.slice(prefix.length)
    : ''
  if (
    (value.status !== 'stored' && value.status !== 'duplicate') ||
    value.eventType !== expectedEventType ||
    value.deviceId !== expectedDeviceId ||
    typeof value.eventId !== 'string' ||
    !value.eventId.startsWith(prefix) ||
    !UUID_V4_PATTERN.test(uuid) ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.sequence as number) > UINT32_MAX
  ) return null

  return Object.freeze({
    status: value.status,
    eventId: value.eventId,
    eventType: expectedEventType,
    deviceId: expectedDeviceId,
    sequence: value.sequence as number,
  })
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= UINT32_MAX
}

function isCanonicalEventRequest(value: unknown): value is TestToolEventRequest {
  if (!isRecord(value)) return false
  if (value.eventType === 'urination') {
    return hasExactKeys(value, ['eventType', 'flushDurationMs', 'pumpDurationMs']) &&
      isUint32(value.flushDurationMs) &&
      isUint32(value.pumpDurationMs)
  }
  if (value.eventType === 'battery') {
    const expectedKeys = value.batteryVoltageMv === undefined
      ? ['eventType', 'batteryLevelPercent']
      : ['eventType', 'batteryLevelPercent', 'batteryVoltageMv']
    return hasExactKeys(value, expectedKeys) &&
      Number.isInteger(value.batteryLevelPercent) &&
      BATTERY_TIERS.has(value.batteryLevelPercent as number) &&
      (value.batteryVoltageMv === undefined ||
        (Number.isInteger(value.batteryVoltageMv) &&
          (value.batteryVoltageMv as number) >= 0 &&
          (value.batteryVoltageMv as number) <= 20_000))
  }
  return false
}

function unexpected(): TestToolApiFailure {
  return { ok: false, reason: 'unexpected_error' }
}

function hasCanonicalJsonMediaType(response: Response): boolean {
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
    response.headers.get('content-type') ?? '',
  )
}

async function parseError(response: Response): Promise<TestToolApiFailure> {
  const expectedReason = STATUS_ERRORS.get(response.status)
  if (expectedReason === undefined) return unexpected()
  try {
    const value: unknown = await response.json()
    if (!isRecord(value) || !hasExactKeys(value, ['error']) || !isRecord(value.error)) {
      return unexpected()
    }
    const expectedKeys = expectedReason === 'rate_limited'
      ? ['code', 'requestId', 'retryAfterSeconds']
      : ['code', 'requestId']
    if (
      !hasExactKeys(value.error, expectedKeys) ||
      value.error.code !== expectedReason ||
      typeof value.error.requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(value.error.requestId) ||
      (expectedReason === 'rate_limited' &&
        (!Number.isInteger(value.error.retryAfterSeconds) ||
          (value.error.retryAfterSeconds as number) < 1 ||
          (value.error.retryAfterSeconds as number) > 86_400))
    ) return unexpected()

    return Object.freeze({
      ok: false,
      reason: expectedReason,
      requestId: value.error.requestId,
      ...(expectedReason === 'rate_limited'
        ? { retryAfterSeconds: value.error.retryAfterSeconds as number }
        : {}),
    })
  } catch {
    return unexpected()
  }
}

async function tokenFor(auth: () => TestToolApiAuth): Promise<string | null> {
  try {
    const user = auth().currentUser
    if (user === null) return null
    const token = await user.getIdToken()
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch {
    return null
  }
}

export function createTestToolApi(options: CreateTestToolApiOptions): TestToolApi {
  if (
    options.baseUrl.origin !== APPROVED_TEST_TOOL_API_ORIGIN ||
    options.baseUrl.pathname !== '/' ||
    options.baseUrl.search.length > 0 ||
    options.baseUrl.hash.length > 0 ||
    options.baseUrl.username.length > 0 ||
    options.baseUrl.password.length > 0
  ) {
    throw new TestToolApiConfigurationError(
      'invalid_test_tool_api_url',
      'The browser adapter requires the approved exact Test Tool API origin.',
    )
  }
  const auth = options.auth ?? (() => getFirebaseServices().auth)
  const fetcher = options.fetcher ?? fetch
  const root = new URL(`${options.baseUrl.origin}/`)

  return Object.freeze({
    async listDevices(): Promise<TestToolDeviceListResult> {
      const token = await tokenFor(auth)
      if (token === null) return { ok: false, reason: 'unauthorized' }
      try {
        const response = await fetcher(new URL('v1/test-devices', root), {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        })
        if (!hasCanonicalJsonMediaType(response)) return unexpected()
        if (response.ok && response.status !== 200) return unexpected()
        if (!response.ok) return parseError(response)
        const devices = parseDeviceList(await response.json())
        return devices === null ? unexpected() : { ok: true, devices }
      } catch {
        return unexpected()
      }
    },

    async submitEvent(
      deviceId: string,
      request: TestToolEventRequest,
    ): Promise<TestToolEventSubmissionResult> {
      if (!TOPIC_SEGMENT_PATTERN.test(deviceId) || !isCanonicalEventRequest(request)) {
        return { ok: false, reason: 'invalid_request' }
      }
      const token = await tokenFor(auth)
      if (token === null) return { ok: false, reason: 'unauthorized' }
      try {
        const response = await fetcher(
          new URL(`v1/test-devices/${encodeURIComponent(deviceId)}/events`, root),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(request),
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
          },
        )
        if (!hasCanonicalJsonMediaType(response)) return unexpected()
        if (response.ok && response.status !== 200) return unexpected()
        if (!response.ok) return parseError(response)
        const result = parseEventResult(await response.json(), deviceId, request.eventType)
        return result === null ? unexpected() : { ok: true, result }
      } catch {
        return unexpected()
      }
    },
  })
}
