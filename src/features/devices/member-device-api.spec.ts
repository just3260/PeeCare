import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFirebaseServices } from '@/platform/firebase/client'

import {
  createMemberDeviceApi,
  type MemberDeviceApiAuth,
  type RenameDeviceResult,
} from './member-device-api'

vi.mock('@/platform/firebase/client', () => ({ getFirebaseServices: vi.fn() }))

function authWithToken(token = 'firebase-id-token'): {
  auth: MemberDeviceApiAuth
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

describe('Member device API adapter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gets an ID token from the existing Firebase Auth user and sends only customName', async () => {
    const { auth, getIdToken } = authWithToken()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        deviceId: 'PC:000001',
        customName: '主浴室',
        displayName: '主浴室',
      }),
    )
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test/'),
      auth: () => auth,
      fetcher,
    })

    await expect(api.renameDevice('PC:000001', '主浴室')).resolves.toEqual({
      ok: true,
      device: { deviceId: 'PC:000001', customName: '主浴室', displayName: '主浴室' },
    })
    expect(getIdToken).toHaveBeenCalledOnce()
    expect(getIdToken).toHaveBeenCalledWith()
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://member.peecare.test/v1/devices/PC%3A000001/display-name')
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: {
        authorization: 'Bearer firebase-id-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customName: '主浴室' }),
    })
    expect(JSON.parse(String(init?.body))).toEqual({ customName: '主浴室' })
  })

  it('sends null to clear the shared device name', async () => {
    const { auth } = authWithToken()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        deviceId: 'PC-000001',
        customName: null,
        displayName: 'PC-000001',
      }),
    )
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => auth,
      fetcher,
    })

    await expect(api.renameDevice('PC-000001', null)).resolves.toMatchObject({ ok: true })
    expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ customName: null }))
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'device_not_found'],
    [503, 'persistence_unavailable'],
    [400, 'unexpected_error'],
    [500, 'unexpected_error'],
  ] as const)('maps HTTP %s to the typed %s outcome', async (status, reason) => {
    const { auth } = authWithToken()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(status, { error: { code: 'server-code', requestId: 'request-1' } }),
    )
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => auth,
      fetcher,
    })

    await expect(api.renameDevice('PC-000001', '主浴室')).resolves.toEqual({
      ok: false,
      reason,
    } satisfies RenameDeviceResult)
  })

  it('returns unauthorized without a request when there is no signed-in user', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => ({ currentUser: null }),
      fetcher,
    })

    await expect(api.renameDevice('PC-000001', '主浴室')).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns unauthorized without a request when token acquisition fails', async () => {
    const getIdToken = vi.fn().mockRejectedValue(new Error('token secret'))
    const fetcher = vi.fn<typeof fetch>()
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => ({ currentUser: { getIdToken } }),
      fetcher,
    })

    await expect(api.renameDevice('PC-000001', '主浴室')).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', new Response('{', { status: 200 })],
    ['extra success property', jsonResponse(200, { deviceId: 'PC-000001', customName: '主浴室', displayName: '主浴室', ownerUid: 'member-001' })],
    ['mismatched device', jsonResponse(200, { deviceId: 'PC-999999', customName: '主浴室', displayName: '主浴室' })],
    ['non-canonical display name', jsonResponse(200, { deviceId: 'PC-000001', customName: '主浴室', displayName: '別名' })],
    ['malformed customName type', jsonResponse(200, { deviceId: 'PC-000001', customName: 123, displayName: '123' })],
    ['null-name display mismatch', jsonResponse(200, { deviceId: 'PC-000001', customName: null, displayName: '別名' })],
  ])('rejects a non-canonical success response: %s', async (_case, response) => {
    const { auth } = authWithToken()
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => auth,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
    })

    await expect(api.renameDevice('PC-000001', '主浴室')).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
  })

  it('maps a network failure without logging token, name, or request content', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { auth } = authWithToken('sensitive-token')
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      auth: () => auth,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('主浴室 sensitive-token')),
    })

    await expect(api.renameDevice('PC-000001', '主浴室')).resolves.toEqual({
      ok: false,
      reason: 'unexpected_error',
    })
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('reuses Auth from the existing Firebase services when no auth seam is injected', async () => {
    const { auth, getIdToken } = authWithToken()
    vi.mocked(getFirebaseServices).mockReturnValue({ auth } as never)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        deviceId: 'PC-000001',
        customName: '主浴室',
        displayName: '主浴室',
      }),
    )
    const api = createMemberDeviceApi({
      baseUrl: new URL('https://member.peecare.test'),
      fetcher,
    })

    await expect(api.renameDevice('PC-000001', '主浴室')).resolves.toMatchObject({ ok: true })
    expect(getFirebaseServices).toHaveBeenCalledOnce()
    expect(getIdToken).toHaveBeenCalledOnce()
  })
})
