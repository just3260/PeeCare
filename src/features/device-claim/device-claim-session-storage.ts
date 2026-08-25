const STORAGE_KEY = 'peecare.device-claim-session'
const STORAGE_VERSION = 1
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/

export interface PersistedClaimSession {
  readonly sessionId: string
  readonly deviceId: string
  readonly expiresAtMs: number
}

export interface DeviceClaimSessionStorage {
  load(): PersistedClaimSession | null
  save(session: PersistedClaimSession): void
  clear(): void
}

export interface CreateDeviceClaimSessionStorageOptions {
  readonly storage?: Storage
  readonly now?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStoredSession(value: unknown, now: number): PersistedClaimSession | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (
    keys.length !== 4 ||
    !['version', 'sessionId', 'deviceId', 'expiresAtMs'].every((key) => keys.includes(key))
  ) {
    return null
  }

  const { version, sessionId, deviceId, expiresAtMs } = value
  if (
    version !== STORAGE_VERSION ||
    typeof sessionId !== 'string' ||
    !SESSION_ID_PATTERN.test(sessionId) ||
    typeof deviceId !== 'string' ||
    !DEVICE_ID_PATTERN.test(deviceId) ||
    typeof expiresAtMs !== 'number' ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= now
  ) {
    return null
  }

  return { sessionId, deviceId, expiresAtMs }
}

function defaultSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function createDeviceClaimSessionStorage(
  options: CreateDeviceClaimSessionStorageOptions = {},
): DeviceClaimSessionStorage {
  const storage = options.storage ?? defaultSessionStorage()
  const now = options.now ?? Date.now
  let memory: PersistedClaimSession | null = null
  let storageUsable = storage !== null

  function loadFromMemory(): PersistedClaimSession | null {
    if (memory === null) return null
    const parsed = parseStoredSession({ version: STORAGE_VERSION, ...memory }, now())
    memory = parsed
    return parsed === null ? null : { ...parsed }
  }

  function removeFromBrowserStorage(): void {
    if (!storageUsable || storage === null) return
    try {
      storage.removeItem(STORAGE_KEY)
    } catch {
      storageUsable = false
    }
  }

  return {
    load(): PersistedClaimSession | null {
      if (!storageUsable || storage === null) {
        return loadFromMemory()
      }

      let raw: string | null
      try {
        raw = storage.getItem(STORAGE_KEY)
      } catch {
        storageUsable = false
        return loadFromMemory()
      }

      if (raw === null) return null
      let parsed: PersistedClaimSession | null = null
      try {
        parsed = parseStoredSession(JSON.parse(raw), now())
      } catch {
        // Invalid JSON is handled exactly like any other corrupt record.
      }
      if (parsed === null) {
        memory = null
        removeFromBrowserStorage()
        return null
      }

      memory = parsed
      return { ...parsed }
    },

    save(session): void {
      memory = parseStoredSession(
        {
          version: STORAGE_VERSION,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          expiresAtMs: session.expiresAtMs,
        },
        now(),
      )
      if (memory === null) {
        removeFromBrowserStorage()
        return
      }
      if (!storageUsable || storage === null) return
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            sessionId: memory.sessionId,
            deviceId: memory.deviceId,
            expiresAtMs: memory.expiresAtMs,
          }),
        )
      } catch {
        storageUsable = false
      }
    },

    clear(): void {
      memory = null
      removeFromBrowserStorage()
    },
  }
}
