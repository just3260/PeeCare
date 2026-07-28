import { beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error - reset.mjs is a plain ESM Node script without type declarations.
import { ResetError, runReset } from './reset.mjs'

interface ResetConfig {
  projectId: string
  authHost: string
  authPort: number
  firestoreHost: string
  firestorePort: number
}

function validConfig(): ResetConfig {
  return {
    projectId: 'demo-peecare',
    authHost: '127.0.0.1',
    authPort: 9099,
    firestoreHost: '127.0.0.1',
    firestorePort: 8085,
  }
}

const AUTH_URL =
  'http://127.0.0.1:9099/emulator/v1/projects/demo-peecare/accounts'
const FIRESTORE_URL =
  'http://127.0.0.1:8085/emulator/v1/projects/demo-peecare/databases/(default)/documents'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
})

describe('runReset', () => {
  it('deletes both Auth accounts and Firestore documents on the demo Emulators', async () => {
    const summary = await runReset(validConfig(), { fetch: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(AUTH_URL, { method: 'DELETE' })
    expect(fetchMock).toHaveBeenCalledWith(FIRESTORE_URL, { method: 'DELETE' })
    expect(summary.auth).toBe(AUTH_URL)
    expect(summary.firestore).toBe(FIRESTORE_URL)
  })

  it('remains successful and idempotent when run twice against empty Emulators', async () => {
    await runReset(validConfig(), { fetch: fetchMock })
    await runReset(validConfig(), { fetch: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('refuses a non-demo project and issues zero DELETE requests', async () => {
    const config = { ...validConfig(), projectId: 'peecare-production' }

    await expect(runReset(config, { fetch: fetchMock })).rejects.toBeInstanceOf(ResetError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a non-loopback endpoint and issues zero DELETE requests', async () => {
    const config = { ...validConfig(), firestoreHost: '0.0.0.0' }

    await expect(runReset(config, { fetch: fetchMock })).rejects.toBeInstanceOf(ResetError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['Auth host', { authHost: 'localhost' }],
    ['Firestore host', { firestoreHost: '::1' }],
    ['Auth port', { authPort: 9999 }],
    ['Firestore port', { firestorePort: 9999 }],
    ['non-numeric Auth port', { authPort: Number.NaN }],
  ])('refuses a non-fixed %s and issues zero DELETE requests', async (_label, override) => {
    const config = { ...validConfig(), ...override }

    await expect(runReset(config, { fetch: fetchMock })).rejects.toBeInstanceOf(ResetError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails and names the Auth endpoint when the Auth Emulator is unreachable', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === AUTH_URL) {
        return Promise.reject(new Error('ECONNREFUSED'))
      }
      return Promise.resolve({ ok: true, status: 200 })
    })

    await expect(runReset(validConfig(), { fetch: fetchMock })).rejects.toThrowError(/Auth/)
  })

  it('fails and names the Firestore endpoint on a non-2xx response', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === FIRESTORE_URL) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      return Promise.resolve({ ok: true, status: 200 })
    })

    await expect(runReset(validConfig(), { fetch: fetchMock })).rejects.toThrowError(/Firestore/)
  })
})
