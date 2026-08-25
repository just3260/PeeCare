import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ClaimSessionStatus,
  CreatedClaimSession,
  DeviceClaimApi,
  DeviceClaimApiResult,
} from './device-claim-api'
import type {
  DeviceClaimSessionStorage,
  PersistedClaimSession,
} from './device-claim-session-storage'
import { createDeviceClaimStore } from './device-claim-store'

const DEVICE_ID = '68E274BD2A5C'
const SESSION_ID = 'claim_session-001'
const NOW = 1_700_000_000_000
const EXPIRES_AT = NOW + 300_000

function created(): CreatedClaimSession {
  return {
    sessionId: SESSION_ID,
    deviceId: DEVICE_ID,
    pairCode: '00001234',
    status: 'pending',
    expiresAtMs: EXPIRES_AT,
  }
}

function status(claimStatus: ClaimSessionStatus): DeviceClaimApiResult<{
  sessionId: string
  deviceId: string
  status: ClaimSessionStatus
  expiresAtMs: number
}> {
  return {
    ok: true,
    session: { sessionId: SESSION_ID, deviceId: DEVICE_ID, status: claimStatus, expiresAtMs: EXPIRES_AT },
  }
}

function fakeApi(statuses: Array<ReturnType<typeof status> | Promise<ReturnType<typeof status>>> = []) {
  const createSession = vi.fn().mockResolvedValue({ ok: true, session: created() })
  const getSessionStatus = vi.fn()
  for (const result of statuses) getSessionStatus.mockResolvedValueOnce(result)
  if (statuses.length === 0) getSessionStatus.mockResolvedValue(status('pending'))
  return { api: { createSession, getSessionStatus } as DeviceClaimApi, createSession, getSessionStatus }
}

function fakeStorage(initial: PersistedClaimSession | null = null) {
  let value = initial
  const storage: DeviceClaimSessionStorage = {
    load: vi.fn(() => value),
    save: vi.fn((next) => { value = { ...next } }),
    clear: vi.fn(() => { value = null }),
  }
  return { storage, current: () => value }
}

async function tick(intervalMs = 1_000): Promise<void> {
  await vi.advanceTimersByTimeAsync(intervalMs)
}

describe('device Claim store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('creates, exposes the one-time Pair Code, persists only recovery fields, and starts polling', async () => {
    const { api, createSession, getSessionStatus } = fakeApi()
    const { storage } = fakeStorage()
    const store = createDeviceClaimStore({ api, storage, now: () => NOW, pollIntervalMs: 1_000 })

    const operation = store.createSession(DEVICE_ID)
    expect(store.state.value).toEqual({ status: 'creating', deviceId: DEVICE_ID })
    await operation

    expect(createSession).toHaveBeenCalledWith(DEVICE_ID)
    expect(store.state.value).toEqual({
      status: 'pending',
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      pairCode: '00001234',
      expiresAtMs: EXPIRES_AT,
    })
    expect(storage.save).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      expiresAtMs: EXPIRES_AT,
    })

    await tick()
    expect(getSessionStatus).toHaveBeenCalledWith(SESSION_ID, {
      signal: expect.any(AbortSignal),
    })
  })

  it('restores without a Pair Code and treats only authenticated GET claimed as success', async () => {
    const { api } = fakeApi([status('claimed')])
    const { storage } = fakeStorage({ sessionId: SESSION_ID, deviceId: DEVICE_ID, expiresAtMs: EXPIRES_AT })
    const store = createDeviceClaimStore({ api, storage, now: () => NOW, pollIntervalMs: 1_000 })

    await store.restoreSession()
    expect(store.state.value).toMatchObject({ status: 'pending', pairCode: null })

    await tick()
    expect(store.state.value).toEqual({
      status: 'claimed',
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      expiresAtMs: EXPIRES_AT,
    })
    expect(storage.clear).toHaveBeenCalled()
  })

  it.each(['expired', 'failed', 'conflict', 'replaced'] as const)(
    'stops polling on terminal %s',
    async (claimStatus) => {
      const { api, getSessionStatus } = fakeApi([status(claimStatus)])
      const { storage } = fakeStorage()
      const store = createDeviceClaimStore({ api, storage, now: () => NOW, pollIntervalMs: 1_000 })

      await store.createSession(DEVICE_ID)
      await tick()
      await tick(10_000)

      expect(store.state.value).toEqual({
        status: 'terminal',
        sessionId: SESSION_ID,
        deviceId: DEVICE_ID,
        claimStatus,
        expiresAtMs: EXPIRES_AT,
      })
      expect(getSessionStatus).toHaveBeenCalledOnce()
      expect(storage.clear).toHaveBeenCalled()
    },
  )

  it('bounds pending polling by maximum attempts', async () => {
    const { api, getSessionStatus } = fakeApi()
    const { storage } = fakeStorage()
    const store = createDeviceClaimStore({
      api,
      storage,
      now: () => NOW,
      pollIntervalMs: 1_000,
      maxPollAttempts: 2,
    })

    await store.createSession(DEVICE_ID)
    await tick()
    await tick()
    await tick(10_000)

    expect(getSessionStatus).toHaveBeenCalledTimes(2)
    expect(store.state.value).toEqual({ status: 'error', reason: 'polling_limit_reached' })
  })

  it('bounds polling by elapsed time and by session expiry', async () => {
    let now = NOW
    const { api, getSessionStatus } = fakeApi()
    const { storage } = fakeStorage()
    const store = createDeviceClaimStore({
      api,
      storage,
      now: () => now,
      pollIntervalMs: 1_000,
      maxPollingDurationMs: 5_000,
    })

    await store.createSession(DEVICE_ID)
    now = NOW + 5_000
    await tick()
    expect(getSessionStatus).not.toHaveBeenCalled()
    expect(store.state.value).toEqual({ status: 'error', reason: 'polling_limit_reached' })

    const expiryApi = fakeApi()
    const expiryStore = createDeviceClaimStore({
      api: expiryApi.api,
      storage: fakeStorage().storage,
      now: () => EXPIRES_AT,
      pollIntervalMs: 1_000,
    })
    await expiryStore.createSession(DEVICE_ID)
    await tick()
    expect(expiryApi.getSessionStatus).not.toHaveBeenCalled()
    expect(expiryStore.state.value).toMatchObject({ status: 'terminal', claimStatus: 'expired' })
  })

  it('does not overshoot a non-divisible total duration while waiting between polls', async () => {
    vi.setSystemTime(NOW)
    const { api, getSessionStatus } = fakeApi()
    const store = createDeviceClaimStore({
      api,
      storage: fakeStorage().storage,
      now: Date.now,
      pollIntervalMs: 2_000,
      maxPollingDurationMs: 2_500,
    })

    await store.createSession(DEVICE_ID)
    await tick(2_499)
    expect(getSessionStatus).toHaveBeenCalledOnce()
    expect(store.state.value.status).toBe('pending')

    await tick(1)
    expect(store.state.value).toEqual({ status: 'error', reason: 'polling_limit_reached' })
    expect(getSessionStatus).toHaveBeenCalledOnce()
  })

  it('never overlaps status requests and schedules the next poll after settlement', async () => {
    let settle!: (result: ReturnType<typeof status>) => void
    const pendingRequest = new Promise<ReturnType<typeof status>>((resolve) => { settle = resolve })
    const createSession = vi.fn().mockResolvedValue({ ok: true, session: created() })
    const getSessionStatus = vi.fn().mockReturnValue(pendingRequest)
    const api: DeviceClaimApi = { createSession, getSessionStatus }
    const store = createDeviceClaimStore({ api, storage: fakeStorage().storage, now: () => NOW, pollIntervalMs: 1_000 })

    await store.createSession(DEVICE_ID)
    await tick()
    await tick(10_000)
    expect(getSessionStatus).toHaveBeenCalledOnce()

    settle(status('pending'))
    await Promise.resolve()
    await tick()
    expect(getSessionStatus).toHaveBeenCalledTimes(2)
  })

  it('dispose cancels timers and ignores an in-flight response', async () => {
    let settle!: (result: ReturnType<typeof status>) => void
    const pendingRequest = new Promise<ReturnType<typeof status>>((resolve) => { settle = resolve })
    const { api, getSessionStatus } = fakeApi([pendingRequest])
    const store = createDeviceClaimStore({ api, storage: fakeStorage().storage, now: () => NOW, pollIntervalMs: 1_000 })

    await store.createSession(DEVICE_ID)
    await tick()
    store.dispose()
    settle(status('claimed'))
    await Promise.resolve()
    await tick(10_000)

    expect(store.state.value).toEqual({ status: 'idle' })
    expect(getSessionStatus).toHaveBeenCalledOnce()
  })

  it('dispose preserves redacted recovery storage for a later remount', async () => {
    const { api, getSessionStatus } = fakeApi()
    const { storage, current } = fakeStorage()
    const store = createDeviceClaimStore({ api, storage, now: () => NOW, pollIntervalMs: 1_000 })

    await store.createSession(DEVICE_ID)
    store.dispose()
    await tick(10_000)

    expect(getSessionStatus).not.toHaveBeenCalled()
    expect(current()).toEqual({ sessionId: SESSION_ID, deviceId: DEVICE_ID, expiresAtMs: EXPIRES_AT })
  })

  it('restart clears recovery state, cancels polling, and returns idle', async () => {
    const { api, getSessionStatus } = fakeApi()
    const { storage } = fakeStorage()
    const store = createDeviceClaimStore({ api, storage, now: () => NOW, pollIntervalMs: 1_000 })

    await store.createSession(DEVICE_ID)
    store.restart()
    await tick(10_000)

    expect(store.state.value).toEqual({ status: 'idle' })
    expect(storage.clear).toHaveBeenCalled()
    expect(getSessionStatus).not.toHaveBeenCalled()
  })

  it('normalizes API failures without logging request secrets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const api: DeviceClaimApi = {
      createSession: vi.fn().mockResolvedValue({ ok: false, reason: 'unauthorized' }),
      getSessionStatus: vi.fn(),
    }
    const store = createDeviceClaimStore({ api, storage: fakeStorage().storage, now: () => NOW })

    await store.createSession(DEVICE_ID)

    expect(store.state.value).toEqual({ status: 'error', reason: 'unauthorized' })
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('normalizes an adapter exception and does not leave the store in creating', async () => {
    const api: DeviceClaimApi = {
      createSession: vi.fn().mockRejectedValue(new Error('sensitive-token 00001234')),
      getSessionStatus: vi.fn(),
    }
    const store = createDeviceClaimStore({ api, storage: fakeStorage().storage, now: () => NOW })

    await expect(store.createSession(DEVICE_ID)).resolves.toBeUndefined()

    expect(store.state.value).toEqual({ status: 'error', reason: 'unexpected_error' })
  })

  it('retries a thrown status request without overlapping', async () => {
    const createSession = vi.fn().mockResolvedValue({ ok: true, session: created() })
    const getSessionStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('normal-network unavailable'))
      .mockResolvedValueOnce(status('claimed'))
    const api: DeviceClaimApi = { createSession, getSessionStatus }
    const store = createDeviceClaimStore({
      api,
      storage: fakeStorage().storage,
      now: () => NOW,
      pollIntervalMs: 1_000,
    })

    await store.createSession(DEVICE_ID)
    await tick()
    await tick()

    expect(getSessionStatus).toHaveBeenCalledTimes(2)
    expect(store.state.value.status).toBe('claimed')
  })

  it('aborts a hung status request when the total polling duration is exhausted', async () => {
    vi.setSystemTime(NOW)
    let requestSignal: AbortSignal | undefined
    const createSession = vi.fn().mockResolvedValue({ ok: true, session: created() })
    const getSessionStatus = vi.fn((_sessionId: string, request?: { signal?: AbortSignal }) => {
      requestSignal = request?.signal
      return new Promise<ReturnType<typeof status>>(() => undefined)
    })
    const api: DeviceClaimApi = { createSession, getSessionStatus }
    const store = createDeviceClaimStore({
      api,
      storage: fakeStorage().storage,
      now: Date.now,
      pollIntervalMs: 1_000,
      maxPollingDurationMs: 5_000,
    })

    await store.createSession(DEVICE_ID)
    await tick(1_000)
    expect(requestSignal?.aborted).toBe(false)
    await tick(4_000)

    expect(requestSignal?.aborted).toBe(true)
    expect(store.state.value).toEqual({ status: 'error', reason: 'polling_limit_reached' })
    expect(getSessionStatus).toHaveBeenCalledOnce()
  })
})
