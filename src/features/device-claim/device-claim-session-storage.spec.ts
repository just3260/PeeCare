import { describe, expect, it } from 'vitest'

import { createDeviceClaimSessionStorage } from './device-claim-session-storage'

const KEY = 'peecare.device-claim-session'
const RECORD = {
  sessionId: 'claim_session-001',
  deviceId: '68E274BD2A5C',
  expiresAtMs: 1_700_000_300_000,
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return [...values.keys()][index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, value) },
  }
}

describe('device Claim sessionStorage adapter', () => {
  it('persists exactly version, sessionId, deviceId, and expiresAtMs', () => {
    const storage = memoryStorage()
    const adapter = createDeviceClaimSessionStorage({ storage, now: () => 1_700_000_000_000 })

    adapter.save(RECORD)

    expect(JSON.parse(storage.getItem(KEY) ?? '{}')).toEqual({ version: 1, ...RECORD })
    expect(storage.getItem(KEY)).not.toContain('pairCode')
    expect(storage.getItem(KEY)).not.toContain('memberUid')
    expect(adapter.load()).toEqual(RECORD)
  })

  it.each([
    ['malformed JSON', '{'],
    ['extra field', JSON.stringify({ version: 1, ...RECORD, pairCode: '00001234' })],
    ['wrong version', JSON.stringify({ version: 2, ...RECORD })],
    ['unsafe session id', JSON.stringify({ version: 1, ...RECORD, sessionId: '../claim' })],
    ['malformed device id', JSON.stringify({ version: 1, ...RECORD, deviceId: 'not-a-device' })],
    ['expired record', JSON.stringify({ version: 1, ...RECORD, expiresAtMs: 1_699_999_999_999 })],
  ])('rejects and clears %s', (_case, value) => {
    const storage = memoryStorage()
    storage.setItem(KEY, value)
    const adapter = createDeviceClaimSessionStorage({ storage, now: () => 1_700_000_000_000 })

    expect(adapter.load()).toBeNull()
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('falls back to an in-memory record when browser storage throws', () => {
    const throwingStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    } as unknown as Storage
    const adapter = createDeviceClaimSessionStorage({
      storage: throwingStorage,
      now: () => 1_700_000_000_000,
    })

    expect(() => adapter.save(RECORD)).not.toThrow()
    expect(adapter.load()).toEqual(RECORD)
    expect(() => adapter.clear()).not.toThrow()
    expect(adapter.load()).toBeNull()
  })

  it('projects wider runtime objects before retaining an in-memory fallback', () => {
    const throwingStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    } as unknown as Storage
    const adapter = createDeviceClaimSessionStorage({
      storage: throwingStorage,
      now: () => 1_700_000_000_000,
    })

    adapter.save({
      ...RECORD,
      pairCode: '00001234',
      memberUid: 'member-private',
      idToken: 'firebase-id-token',
    } as typeof RECORD)

    expect(adapter.load()).toEqual(RECORD)
    expect(Object.keys(adapter.load() ?? {}).sort()).toEqual(
      ['sessionId', 'deviceId', 'expiresAtMs'].sort(),
    )
  })
})
