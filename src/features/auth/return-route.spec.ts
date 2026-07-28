import { describe, it, expect } from 'vitest'

import { resolveSafeReturnPath } from './return-route'

describe('resolveSafeReturnPath', () => {
  const table: ReadonlyArray<{ name: string; candidate: string | null | undefined; expected: string }> = [
    { name: 'a same-app absolute path is preserved', candidate: '/history', expected: '/history' },
    { name: 'a same-app path with query is preserved', candidate: '/history?tab=1', expected: '/history?tab=1' },
    { name: 'an external https URL falls back to home', candidate: 'https://example.test/steal', expected: '/' },
    { name: 'an external http URL falls back to home', candidate: 'http://evil.test', expected: '/' },
    { name: 'a protocol-relative URL falls back to home', candidate: '//evil.test', expected: '/' },
    { name: 'a leading-backslash variant falls back to home', candidate: '/\\evil.test', expected: '/' },
    { name: 'a double-backslash variant falls back to home', candidate: '\\\\evil.test', expected: '/' },
    { name: 'the sign-in route itself falls back to home', candidate: '/sign-in', expected: '/' },
    { name: 'the sign-in route with query falls back to home', candidate: '/sign-in?returnTo=/x', expected: '/' },
    { name: 'an empty string falls back to home', candidate: '', expected: '/' },
    { name: 'null falls back to home', candidate: null, expected: '/' },
    { name: 'undefined falls back to home', candidate: undefined, expected: '/' },
  ]

  it.each(table)('$name', ({ candidate, expected }) => {
    expect(resolveSafeReturnPath(candidate)).toBe(expected)
  })
})
