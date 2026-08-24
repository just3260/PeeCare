import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EMAIL_LINK_CALLBACK_PATH,
  EmailLinkFlowError,
  PENDING_EMAIL_LINK_STORAGE_KEY,
  PENDING_EMAIL_LINK_TTL_MS,
  clearPendingEmailLink,
  createEmailLinkActionUrl,
  readPendingEmailLink,
  validateEmailLinkEmail,
  writePendingEmailLink,
  type EmailLinkStorage,
} from './email-link-flow'

const NOW_MS = 1_800_000_000_000

function createStorage(initialValue: string | null = null): EmailLinkStorage & {
  readonly getItem: ReturnType<typeof vi.fn>
  readonly setItem: ReturnType<typeof vi.fn>
  readonly removeItem: ReturnType<typeof vi.fn>
} {
  let value = initialValue

  return {
    getItem: vi.fn((key: string) =>
      key === PENDING_EMAIL_LINK_STORAGE_KEY ? value : null,
    ),
    setItem: vi.fn((key: string, nextValue: string) => {
      if (key === PENDING_EMAIL_LINK_STORAGE_KEY) {
        value = nextValue
      }
    }),
    removeItem: vi.fn((key: string) => {
      if (key === PENDING_EMAIL_LINK_STORAGE_KEY) {
        value = null
      }
    }),
  }
}

function pendingRecord(
  overrides: Partial<{
    version: unknown
    email: unknown
    returnTo: unknown
    requestedAtMs: unknown
  }> = {},
): string {
  const record = {
    version: 1,
    email: 'member@example.test',
    returnTo: '/stats',
    requestedAtMs: NOW_MS,
    ...overrides,
  }

  return JSON.stringify(record).replace('"requestedAtMs":null', '"requestedAtMs":1e400')
}

describe('Email Link input and action URL', () => {
  it('trims the spec example Email and accepts the 254-character boundary', () => {
    expect(validateEmailLinkEmail(' member@example.test ')).toBe('member@example.test')
    expect(validateEmailLinkEmail('a'.repeat(254))).toBe('a'.repeat(254))
  })

  it.each(['', '   ', 'a'.repeat(255)])('rejects an invalid Email before Firebase', (email) => {
    expect(() => validateEmailLinkEmail(email)).toThrowError(
      expect.objectContaining<Partial<EmailLinkFlowError>>({ code: 'invalid_email' }),
    )
  })

  it('builds the fixed callback URL with only the allowlisted return path', () => {
    const actionUrl = createEmailLinkActionUrl({
      origin: 'https://petcare-c7483.web.app',
      returnTo: '/stats',
    })
    const parsed = new URL(actionUrl)

    expect(parsed.origin).toBe('https://petcare-c7483.web.app')
    expect(parsed.pathname).toBe(EMAIL_LINK_CALLBACK_PATH)
    expect([...parsed.searchParams.entries()]).toEqual([['returnTo', '/stats']])
    expect(actionUrl).not.toContain('member@example.test')
    expect(actionUrl).not.toContain(encodeURIComponent('member@example.test'))
  })

  it('re-resolves an unsafe return path instead of placing it in the action URL', () => {
    const actionUrl = createEmailLinkActionUrl({
      origin: 'https://petcare-c7483.web.app',
      returnTo: 'https://evil.example/steal',
    })

    expect(new URL(actionUrl).searchParams.get('returnTo')).toBe('/')
    expect(actionUrl).not.toContain('evil.example')
  })
})

describe('bounded pending Email Link state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes the exact versioned schema under the fixed key and overwrites any prior record', () => {
    const storage = createStorage(pendingRecord({ email: 'old@example.test' }))

    expect(
      writePendingEmailLink(
        { email: ' member@example.test ', returnTo: '/stats' },
        storage,
      ),
    ).toBe(true)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(
      PENDING_EMAIL_LINK_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        email: 'member@example.test',
        returnTo: '/stats',
        requestedAtMs: NOW_MS,
      }),
    )
    expect(readPendingEmailLink(storage)).toEqual({
      version: 1,
      email: 'member@example.test',
      returnTo: '/stats',
      requestedAtMs: NOW_MS,
    })
  })

  it('stores the resolver output when the requested return path is unsafe', () => {
    const storage = createStorage()

    expect(
      writePendingEmailLink(
        { email: 'member@example.test', returnTo: '//evil.example/steal' },
        storage,
      ),
    ).toBe(true)
    expect(readPendingEmailLink(storage)?.returnTo).toBe('/')
  })

  it.each([
    { ageMs: 0, accepted: true },
    { ageMs: 1_799_999, accepted: true },
    { ageMs: 1_800_000, accepted: false },
  ])('applies the spec TTL boundary at age $ageMs', ({ ageMs, accepted }) => {
    const storage = createStorage(pendingRecord({ requestedAtMs: NOW_MS - ageMs }))

    expect(readPendingEmailLink(storage) !== null).toBe(accepted)
    expect(storage.removeItem).toHaveBeenCalledTimes(accepted ? 0 : 1)
  })

  it('uses the exact 1,800,000 millisecond TTL', () => {
    expect(PENDING_EMAIL_LINK_TTL_MS).toBe(1_800_000)
  })

  it('clears a future timestamp as invalid', () => {
    const storage = createStorage(pendingRecord({ requestedAtMs: NOW_MS + 1 }))

    expect(readPendingEmailLink(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(PENDING_EMAIL_LINK_STORAGE_KEY)
  })

  it.each([
    { name: 'invalid JSON', raw: '{not-json' },
    { name: 'an array', raw: '[]' },
    { name: 'an extra key', raw: pendingRecord().replace('}', ',"extra":true}') },
    {
      name: 'a missing required key',
      raw: JSON.stringify({
        version: 1,
        email: 'member@example.test',
        requestedAtMs: NOW_MS,
      }),
    },
    { name: 'the wrong version', raw: pendingRecord({ version: 2 }) },
    { name: 'an empty Email', raw: pendingRecord({ email: '' }) },
    { name: 'an untrimmed Email', raw: pendingRecord({ email: ' member@example.test ' }) },
    { name: 'an overlong Email', raw: pendingRecord({ email: 'a'.repeat(255) }) },
    { name: 'an unsafe return path', raw: pendingRecord({ returnTo: '//evil.example' }) },
    { name: 'a non-number timestamp', raw: pendingRecord({ requestedAtMs: 'now' }) },
    { name: 'a non-finite timestamp', raw: pendingRecord({ requestedAtMs: null }) },
  ])('clears $name and returns no pending identity', ({ raw }) => {
    const storage = createStorage(raw)

    expect(readPendingEmailLink(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(PENDING_EMAIL_LINK_STORAGE_KEY)
  })

  it('returns no pending identity when storage reading is unavailable', () => {
    const storage = createStorage()
    storage.getItem.mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })

    expect(readPendingEmailLink(storage)).toBeNull()
  })

  it('does not block link delivery when storage writing fails and removes stale state', () => {
    const storage = createStorage(pendingRecord({ email: 'stale@example.test' }))
    storage.setItem.mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    expect(
      writePendingEmailLink(
        { email: 'member@example.test', returnTo: '/stats' },
        storage,
      ),
    ).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledWith(PENDING_EMAIL_LINK_STORAGE_KEY)
    expect(readPendingEmailLink(storage)).toBeNull()
  })

  it('clears pending state explicitly and never leaks a storage cleanup error', () => {
    const storage = createStorage(pendingRecord())

    expect(clearPendingEmailLink(storage)).toBe(true)
    expect(readPendingEmailLink(storage)).toBeNull()

    storage.removeItem.mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(clearPendingEmailLink(storage)).toBe(false)
  })
})
