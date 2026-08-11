import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFirebaseServices } from '@/platform/firebase/client'

import {
  createTestToolApi,
  type TestToolApiAuth,
  type TestToolEventRequest,
} from './test-tool-api'

vi.mock('@/platform/firebase/client', () => ({ getFirebaseServices: vi.fn() }))

const baseUrl = new URL(
  'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app/',
)
const requestId = '2f6ba4f0-f16f-4a3f-9a3e-91ff2fc27379'

function authWithToken(token = 'firebase-id-token'): {
  auth: TestToolApiAuth
  getIdToken: ReturnType<typeof vi.fn>
} {
  const getIdToken = vi.fn().mockResolvedValue(token)
  return { auth: { currentUser: { getIdToken } }, getIdToken }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function apiWith(response: Response, auth = authWithToken().auth) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
  return {
    api: createTestToolApi({ baseUrl, auth: () => auth, fetcher }),
    fetcher,
  }
}

describe('Test Tool API browser adapter', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    'http://127.0.0.1:8088',
    'https://other-service-348528459946.asia-east1.run.app',
    'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app/v1',
  ])('refuses to construct against an unapproved base URL %s', (value) => {
    expect(() => createTestToolApi({ baseUrl: new URL(value) })).toThrowError(
      expect.objectContaining({ code: 'invalid_test_tool_api_url' }),
    )
  })

  it('gets a fresh token for every request and lists only canonical devices', async () => {
    const { auth, getIdToken } = authWithToken()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          devices: [{ deviceId: 'PC-DEV-000001', displayName: '浴室測試機' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { devices: [] }))
    const api = createTestToolApi({ baseUrl, auth: () => auth, fetcher })

    await expect(api.listDevices()).resolves.toEqual({
      ok: true,
      devices: [{ deviceId: 'PC-DEV-000001', displayName: '浴室測試機' }],
    })
    await expect(api.listDevices()).resolves.toEqual({ ok: true, devices: [] })

    expect(getIdToken).toHaveBeenCalledTimes(2)
    expect(getIdToken).toHaveBeenNthCalledWith(1)
    expect(getIdToken).toHaveBeenNthCalledWith(2)
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      new URL(`${baseUrl.href}v1/test-devices`),
      {
        method: 'GET',
        headers: { authorization: 'Bearer firebase-id-token' },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
    )
  })

  it.each([
    [
      'urination',
      { eventType: 'urination', flushDurationMs: 1_500, pumpDurationMs: 2_500 },
    ],
    [
      'battery',
      { eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3_900 },
    ],
  ] satisfies readonly [string, TestToolEventRequest][]) (
    'submits an exact canonical %s measurement request',
    async (eventType, body) => {
      const { auth, getIdToken } = authWithToken()
      const eventId = 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32'
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(200, {
          status: 'stored',
          eventId,
          eventType,
          deviceId: 'PC-DEV-000001',
          sequence: 17,
        }),
      )
      const api = createTestToolApi({ baseUrl, auth: () => auth, fetcher })

      await expect(api.submitEvent('PC-DEV-000001', body)).resolves.toEqual({
        ok: true,
        result: {
          status: 'stored',
          eventId,
          eventType,
          deviceId: 'PC-DEV-000001',
          sequence: 17,
        },
      })

      expect(getIdToken).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledWith(
        new URL(`${baseUrl.href}v1/test-devices/PC-DEV-000001/events`),
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer firebase-id-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        },
      )
    },
  )

  it('reuses the existing Firebase Auth instance when no seam is injected', async () => {
    const { auth, getIdToken } = authWithToken()
    vi.mocked(getFirebaseServices).mockReturnValue({ auth } as never)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { devices: [] }))
    const api = createTestToolApi({ baseUrl, fetcher })

    await expect(api.listDevices()).resolves.toEqual({ ok: true, devices: [] })
    expect(getFirebaseServices).toHaveBeenCalledOnce()
    expect(getIdToken).toHaveBeenCalledOnce()
  })

  it.each([
    ['no user', () => ({ currentUser: null })],
    [
      'token failure',
      () => ({ currentUser: { getIdToken: vi.fn().mockRejectedValue(new Error('token')) } }),
    ],
  ])('returns unauthorized with zero fetch for %s', async (_case, auth) => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createTestToolApi({ baseUrl, auth, fetcher })

    await expect(api.listDevices()).resolves.toEqual({ ok: false, reason: 'unauthorized' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['extra outer field', { devices: [], ownerUid: 'raw-uid' }],
    ['extra device field', { devices: [{ deviceId: 'PC-DEV-000001', displayName: '測試', ownerUid: 'raw-uid' }] }],
    ['malformed device ID', { devices: [{ deviceId: '../secret', displayName: '測試' }] }],
    ['blank display name', { devices: [{ deviceId: 'PC-DEV-000001', displayName: '   ' }] }],
    ['duplicate device', { devices: [{ deviceId: 'PC-DEV-000001', displayName: 'PC-DEV-000001' }, { deviceId: 'PC-DEV-000001', displayName: 'PC-DEV-000001' }] }],
  ])('fails closed on non-canonical device response: %s', async (_case, body) => {
    const { api } = apiWith(jsonResponse(200, body))
    await expect(api.listDevices()).resolves.toEqual({ ok: false, reason: 'unexpected_error' })
  })

  it.each([
    ['mismatched device', { status: 'stored', eventId: 'tt:PC-OTHER:1b59ef13-fc86-4c17-95d4-8556ed098d32', eventType: 'battery', deviceId: 'PC-OTHER', sequence: 1 }],
    ['mismatched type', { status: 'stored', eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32', eventType: 'urination', deviceId: 'PC-DEV-000001', sequence: 1 }],
    ['non-v4 event ID', { status: 'stored', eventId: 'tt:PC-DEV-000001:not-a-uuid', eventType: 'battery', deviceId: 'PC-DEV-000001', sequence: 1 }],
    ['extra response field', { status: 'stored', eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32', eventType: 'battery', deviceId: 'PC-DEV-000001', sequence: 1, payload: 'secret' }],
  ])('fails closed on non-canonical event response: %s', async (_case, responseBody) => {
    const { api } = apiWith(jsonResponse(200, responseBody))
    await expect(
      api.submitEvent('PC-DEV-000001', { eventType: 'battery', batteryLevelPercent: 75 }),
    ).resolves.toEqual({ ok: false, reason: 'unexpected_error' })
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'test_device_not_found'],
    [409, 'sequence_exhausted'],
    [429, 'rate_limited'],
    [503, 'ingestion_unavailable'],
  ] as const)('accepts only the canonical HTTP %s / %s error pair', async (status, reason) => {
    const detail = reason === 'rate_limited' ? { retryAfterSeconds: 1 } : {}
    const { api } = apiWith(jsonResponse(status, { error: { code: reason, requestId, ...detail } }))

    await expect(
      api.submitEvent('PC-DEV-000001', { eventType: 'battery', batteryLevelPercent: 75 }),
    ).resolves.toEqual({ ok: false, reason, requestId, ...detail })
  })

  it.each([
    ['wrong code for status', 401, { error: { code: 'internal_error', requestId } }],
    ['extra error field', 401, { error: { code: 'unauthorized', requestId, email: 'tester@example.com' } }],
    ['invalid request ID', 401, { error: { code: 'unauthorized', requestId: 'not-a-uuid' } }],
    ['malformed JSON', 401, '{'],
  ])('rejects a non-canonical error response: %s', async (_case, status, body) => {
    const response = typeof body === 'string'
      ? new Response(body, { status })
      : jsonResponse(status, body)
    const { api } = apiWith(response)

    await expect(api.listDevices()).resolves.toEqual({ ok: false, reason: 'unexpected_error' })
  })

  it('rejects JSON-shaped data delivered with a non-JSON media type', async () => {
    const { api } = apiWith(
      new Response(JSON.stringify({ devices: [] }), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    await expect(api.listDevices()).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
  })

  it.each([
    ['device list', 201, 'list'],
    ['event submission', 202, 'event'],
  ])('rejects non-contract success status for %s', async (_case, status, operation) => {
    const body = operation === 'list'
      ? { devices: [] }
      : {
          status: 'stored',
          eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
          eventType: 'battery',
          deviceId: 'PC-DEV-000001',
          sequence: 1,
        }
    const { api } = apiWith(jsonResponse(status, body))

    const result = operation === 'list'
      ? api.listDevices()
      : api.submitEvent('PC-DEV-000001', {
          eventType: 'battery',
          batteryLevelPercent: 75,
        })
    await expect(result).resolves.toEqual({ ok: false, reason: 'unexpected_error' })
  })

  it.each([
    ['bad device', '../PC-DEV-000001', { eventType: 'battery', batteryLevelPercent: 75 }],
    ['extra body field', 'PC-DEV-000001', { eventType: 'battery', batteryLevelPercent: 75, url: 'https://attacker.invalid' }],
    ['bad battery tier', 'PC-DEV-000001', { eventType: 'battery', batteryLevelPercent: 80 }],
    ['bad duration', 'PC-DEV-000001', { eventType: 'urination', flushDurationMs: -1, pumpDurationMs: 2 }],
  ])('rejects invalid typed input before auth or fetch: %s', async (_case, deviceId, body) => {
    const { auth, getIdToken } = authWithToken()
    const fetcher = vi.fn<typeof fetch>()
    const api = createTestToolApi({ baseUrl, auth: () => auth, fetcher })

    await expect(api.submitEvent(deviceId, body as never)).resolves.toEqual({
      ok: false,
      reason: 'invalid_request',
    })
    expect(getIdToken).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sanitizes network failures without logging identity, token, or body', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { auth } = authWithToken('sensitive-token')
    const api = createTestToolApi({
      baseUrl,
      auth: () => auth,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('sensitive-token body')),
    })

    await expect(api.listDevices()).resolves.toEqual({ ok: false, reason: 'unexpected_error' })
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
