import { readonly, ref, type DeepReadonly, type Ref } from 'vue'

import type {
  ClaimSessionStatus,
  DeviceClaimApi,
  DeviceClaimApiFailureReason,
} from './device-claim-api'
import {
  createDeviceClaimSessionStorage,
  type DeviceClaimSessionStorage,
  type PersistedClaimSession,
} from './device-claim-session-storage'

type TerminalClaimStatus = Exclude<ClaimSessionStatus, 'pending' | 'claimed'>

export type DeviceClaimState =
  | { readonly status: 'idle' }
  | { readonly status: 'creating'; readonly deviceId: string }
  | {
      readonly status: 'pending'
      readonly sessionId: string
      readonly deviceId: string
      readonly pairCode: string | null
      readonly expiresAtMs: number
    }
  | {
      readonly status: 'claimed'
      readonly sessionId: string
      readonly deviceId: string
      readonly expiresAtMs: number
    }
  | {
      readonly status: 'terminal'
      readonly sessionId: string
      readonly deviceId: string
      readonly claimStatus: TerminalClaimStatus
      readonly expiresAtMs: number
    }
  | { readonly status: 'error'; readonly reason: string }

export interface DeviceClaimStore {
  readonly state: DeepReadonly<Ref<DeviceClaimState>>
  createSession(deviceId: string): Promise<void>
  restoreSession(): Promise<void>
  restart(): void
  dispose(): void
}

export interface DeviceClaimTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface CreateDeviceClaimStoreOptions {
  readonly api: DeviceClaimApi
  readonly storage?: DeviceClaimSessionStorage
  readonly now?: () => number
  readonly timers?: DeviceClaimTimers
  readonly pollIntervalMs?: number
  readonly maxPollAttempts?: number
  readonly maxPollingDurationMs?: number
}

const IDLE: DeviceClaimState = { status: 'idle' }
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_MAX_POLL_ATTEMPTS = 150
const DEFAULT_MAX_POLLING_DURATION_MS = 5 * 60_000

function defaultTimers(): DeviceClaimTimers {
  return {
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs)
    },
    clearTimeout(handle) {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
  }
}

function persisted(session: {
  readonly sessionId: string
  readonly deviceId: string
  readonly expiresAtMs: number
}): PersistedClaimSession {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    expiresAtMs: session.expiresAtMs,
  }
}

function shouldRetry(reason: DeviceClaimApiFailureReason): boolean {
  return reason === 'unexpected_error' || reason === 'persistence_unavailable'
}

export function createDeviceClaimStore(options: CreateDeviceClaimStoreOptions): DeviceClaimStore {
  const storage = options.storage ?? createDeviceClaimSessionStorage({ now: options.now })
  const now = options.now ?? Date.now
  const timers = options.timers ?? defaultTimers()
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS
  const maxPollingDurationMs = options.maxPollingDurationMs ?? DEFAULT_MAX_POLLING_DURATION_MS

  if (
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs <= 0 ||
    !Number.isSafeInteger(maxPollAttempts) ||
    maxPollAttempts <= 0 ||
    !Number.isFinite(maxPollingDurationMs) ||
    maxPollingDurationMs <= 0
  ) {
    throw new Error('Invalid device Claim polling configuration')
  }

  const state = ref<DeviceClaimState>(IDLE)
  let timer: unknown | null = null
  let requestDeadlineTimer: unknown | null = null
  let requestAbortController: AbortController | null = null
  let lifecycle = 0
  let pollingStartedAtMs = 0
  let pollAttempts = 0

  function cancelTimer(): void {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  function cancelRequest(): void {
    if (requestDeadlineTimer !== null) {
      timers.clearTimeout(requestDeadlineTimer)
      requestDeadlineTimer = null
    }
    if (requestAbortController !== null) {
      requestAbortController.abort()
      requestAbortController = null
    }
  }

  function stopPolling(): void {
    lifecycle += 1
    cancelTimer()
    cancelRequest()
  }

  function setPollingLimitError(): void {
    stopPolling()
    state.value = { status: 'error', reason: 'polling_limit_reached' }
  }

  function setExpired(session: PersistedClaimSession): void {
    stopPolling()
    storage.clear()
    state.value = {
      status: 'terminal',
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      claimStatus: 'expired',
      expiresAtMs: session.expiresAtMs,
    }
  }

  function startPolling(session: PersistedClaimSession): void {
    stopPolling()
    const pollingLifecycle = lifecycle
    pollingStartedAtMs = now()
    pollAttempts = 0

    const schedule = (): void => {
      if (pollingLifecycle !== lifecycle) return
      const currentTime = now()
      if (currentTime >= session.expiresAtMs) {
        setExpired(session)
        return
      }
      const elapsedMs = currentTime - pollingStartedAtMs
      if (elapsedMs >= maxPollingDurationMs) {
        setPollingLimitError()
        return
      }
      const delayMs = Math.min(
        pollIntervalMs,
        session.expiresAtMs - currentTime,
        maxPollingDurationMs - elapsedMs,
      )
      timer = timers.setTimeout(() => {
        timer = null
        void poll()
      }, delayMs)
    }

    const poll = async (): Promise<void> => {
      if (pollingLifecycle !== lifecycle) return
      const currentTime = now()
      if (currentTime >= session.expiresAtMs) {
        setExpired(session)
        return
      }
      if (
        pollAttempts >= maxPollAttempts ||
        currentTime - pollingStartedAtMs >= maxPollingDurationMs
      ) {
        setPollingLimitError()
        return
      }

      pollAttempts += 1
      const controller = new AbortController()
      requestAbortController = controller
      const requestDeadlineMs = Math.min(
        session.expiresAtMs - currentTime,
        maxPollingDurationMs - (currentTime - pollingStartedAtMs),
      )
      requestDeadlineTimer = timers.setTimeout(() => {
        requestDeadlineTimer = null
        controller.abort()
        if (pollingLifecycle !== lifecycle) return
        if (now() >= session.expiresAtMs) {
          setExpired(session)
        } else {
          setPollingLimitError()
        }
      }, requestDeadlineMs)

      let result: Awaited<ReturnType<DeviceClaimApi['getSessionStatus']>>
      try {
        result = await options.api.getSessionStatus(session.sessionId, { signal: controller.signal })
      } catch {
        result = { ok: false, reason: 'unexpected_error' }
      }
      if (requestAbortController === controller) {
        if (requestDeadlineTimer !== null) timers.clearTimeout(requestDeadlineTimer)
        requestDeadlineTimer = null
        requestAbortController = null
      }
      if (pollingLifecycle !== lifecycle) return

      if (!result.ok) {
        if (shouldRetry(result.reason)) {
          if (pollAttempts >= maxPollAttempts || now() - pollingStartedAtMs >= maxPollingDurationMs) {
            setPollingLimitError()
          } else {
            schedule()
          }
          return
        }
        stopPolling()
        state.value = { status: 'error', reason: result.reason }
        return
      }

      const authoritative = result.session
      if (
        authoritative.sessionId !== session.sessionId ||
        authoritative.deviceId !== session.deviceId
      ) {
        stopPolling()
        state.value = { status: 'error', reason: 'unexpected_error' }
        return
      }

      const nextSession = persisted(authoritative)
      if (authoritative.status === 'claimed') {
        stopPolling()
        storage.clear()
        state.value = { status: 'claimed', ...nextSession }
        return
      }
      if (authoritative.status !== 'pending') {
        stopPolling()
        storage.clear()
        state.value = {
          status: 'terminal',
          sessionId: authoritative.sessionId,
          deviceId: authoritative.deviceId,
          claimStatus: authoritative.status,
          expiresAtMs: authoritative.expiresAtMs,
        }
        return
      }

      session = nextSession
      storage.save(nextSession)
      const currentPairCode = state.value.status === 'pending' ? state.value.pairCode : null
      state.value = { status: 'pending', ...nextSession, pairCode: currentPairCode }
      if (pollAttempts >= maxPollAttempts || now() - pollingStartedAtMs >= maxPollingDurationMs) {
        setPollingLimitError()
      } else {
        schedule()
      }
    }

    schedule()
  }

  async function createSession(deviceId: string): Promise<void> {
    stopPolling()
    const operationLifecycle = lifecycle
    state.value = { status: 'creating', deviceId }
    let result: Awaited<ReturnType<DeviceClaimApi['createSession']>>
    try {
      result = await options.api.createSession(deviceId)
    } catch {
      result = { ok: false, reason: 'unexpected_error' }
    }
    if (operationLifecycle !== lifecycle) return

    if (!result.ok) {
      storage.clear()
      state.value = { status: 'error', reason: result.reason }
      return
    }

    const session = persisted(result.session)
    storage.save(session)
    state.value = { status: 'pending', ...session, pairCode: result.session.pairCode }
    startPolling(session)
  }

  async function restoreSession(): Promise<void> {
    stopPolling()
    let session: PersistedClaimSession | null
    try {
      session = storage.load()
    } catch {
      session = null
    }
    if (session === null) {
      state.value = IDLE
      return
    }

    if (now() >= session.expiresAtMs) {
      setExpired(session)
      return
    }
    state.value = { status: 'pending', ...session, pairCode: null }
    startPolling(session)
  }

  function restart(): void {
    stopPolling()
    storage.clear()
    state.value = IDLE
  }

  function dispose(): void {
    stopPolling()
    state.value = IDLE
  }

  return {
    state: readonly(state),
    createSession,
    restoreSession,
    restart,
    dispose,
  }
}
