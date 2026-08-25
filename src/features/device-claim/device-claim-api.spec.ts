import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDeviceClaimApi,
  type DeviceClaimApiAuth,
  type DeviceClaimApiResult,
} from './device-claim-api'

const DEVICE_ID = '68E274BD2A5C'
const SESSION_ID = 'claim_session-001'

function authWithToken(token = 'firebase-id-token'): DeviceClaimApiAuth {
  return { currentUser: { getIdToken: vi.fn().mockResolvedValue(token) } }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('device Claim API adapter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a session with the current Firebase ID token and exact deviceId body', async () => {
    const auth = authWithToken()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(201, {
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        pairCode: '00001234',
        status: 'pending',
        expiresAtMs: 1_700_000_300_000,
      }),
    )
    const api = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test/'),
      auth: () => auth,
      fetcher,
    })

    await expect(api.createSession(DEVICE_ID)).resolves.toEqual({
      ok: true,
      session: {
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        pairCode: '00001234',
        status: 'pending',
        expiresAtMs: 1_700_000_300_000,
      },
    })
    expect(auth.currentUser?.getIdToken).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://member.peecare.test/v1/device-claim-sessions'),
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer firebase-id-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ deviceId: DEVICE_ID }),
      },
    )
  })

  it('gets owner-private status using an encoded session id and a fresh token', async () => {
    const auth = authWithToken()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        status: 'claimed',
        expiresAtMs: 1_700_000_300_000,
      }),
    )
    const api = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => auth,
      fetcher,
    })

    await expect(api.getSessionStatus(SESSION_ID)).resolves.toEqual({
      ok: true,
      session: {
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        status: 'claimed',
        expiresAtMs: 1_700_000_300_000,
      },
    })
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`https://member.peecare.test/v1/device-claim-sessions/${SESSION_ID}`),
      {
        method: 'GET',
        headers: { authorization: 'Bearer firebase-id-token' },
      },
    )
  })

  it('requires exact POST 201 and GET 200 success statuses', async () => {
    const createdBody = {
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      pairCode: '00001234',
      status: 'pending',
      expiresAtMs: 1_700_000_300_000,
    }
    const statusBody = {
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      status: 'pending',
      expiresAtMs: 1_700_000_300_000,
    }
    const createApi = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => authWithToken(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(202, createdBody)),
    })
    const statusApi = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => authWithToken(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(201, statusBody)),
    })

    await expect(createApi.createSession(DEVICE_ID)).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
    await expect(statusApi.getSessionStatus(SESSION_ID)).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
  })

  it.each([
    ['extra create field', { sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '00001234', status: 'pending', expiresAtMs: 1_700_000_300_000, memberUid: 'member-private' }],
    ['non-pending create', { sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '00001234', status: 'claimed', expiresAtMs: 1_700_000_300_000 }],
    ['short Pair Code', { sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '1234567', status: 'pending', expiresAtMs: 1_700_000_300_000 }],
    ['non-ASCII Pair Code', { sessionId: SESSION_ID, deviceId: DEVICE_ID, pairCode: '１２３４５６７８', status: 'pending', expiresAtMs: 1_700_000_300_000 }],
    ['unsafe session id', { sessionId: '../claim', deviceId: DEVICE_ID, pairCode: '00001234', status: 'pending', expiresAtMs: 1_700_000_300_000 }],
    ['wrong device id', { sessionId: SESSION_ID, deviceId: 'FFFFFFFFFFFF', pairCode: '00001234', status: 'pending', expiresAtMs: 1_700_000_300_000 }],
  ])('rejects malformed or sensitive create success: %s', async (_case, body) => {
    const api = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => authWithToken(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(201, body)),
    })

    await expect(api.createSession(DEVICE_ID)).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
  })

  it.each([
    ['extra status field', { sessionId: SESSION_ID, deviceId: DEVICE_ID, status: 'pending', expiresAtMs: 1_700_000_300_000, pairCode: '00001234' }],
    ['unknown status', { sessionId: SESSION_ID, deviceId: DEVICE_ID, status: 'complete', expiresAtMs: 1_700_000_300_000 }],
    ['non-integer expiry', { sessionId: SESSION_ID, deviceId: DEVICE_ID, status: 'pending', expiresAtMs: 1.5 }],
    ['mismatched session id', { sessionId: 'different-session', deviceId: DEVICE_ID, status: 'pending', expiresAtMs: 1_700_000_300_000 }],
  ])('rejects malformed or sensitive status success: %s', async (_case, body) => {
    const api = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => authWithToken(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, body)),
    })

    await expect(api.getSessionStatus(SESSION_ID)).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'not_found'],
    [409, 'conflict'],
    [503, 'persistence_unavailable'],
    [500, 'unexpected_error'],
  ] as const)('maps HTTP %s to %s', async (status, reason) => {
    const api = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => authWithToken(),
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, {})),
    })

    await expect(api.createSession(DEVICE_ID)).resolves.toEqual({
      ok: false,
      reason,
    } satisfies DeviceClaimApiResult<never>)
  })

  it('does not request or log when no user is authenticated', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetcher = vi.fn<typeof fetch>()
    const api = createDeviceClaimApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => ({ currentUser: null }),
      fetcher,
    })

    await expect(api.createSession(DEVICE_ID)).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
