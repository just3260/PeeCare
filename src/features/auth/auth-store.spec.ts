import { describe, it, expect, vi } from 'vitest'

import { createAuthStore, type AuthObserver } from './auth-store'
import { createProtectedResourceRegistry } from './protected-resource-registry'
import type { SessionUser } from './session'

function member(uid: string): SessionUser {
  return { uid, displayName: null, email: `${uid}@peecare.test` }
}

/** A fake Firebase observer that lets a test push auth changes on demand. */
function createFakeObserver() {
  let handler: ((user: SessionUser | null) => void) | null = null
  const unsubscribe = vi.fn(() => {
    handler = null
  })
  const subscribe = vi.fn((onUser: (user: SessionUser | null) => void) => {
    handler = onUser
    return unsubscribe
  })

  return {
    port: { subscribe } satisfies AuthObserver,
    emit(user: SessionUser | null) {
      if (!handler) throw new Error('observer emitted before subscribe')
      handler(user)
    },
    subscribe,
    unsubscribe,
  }
}

describe('auth store — authoritative authentication state', () => {
  it('starts in loading before the observer reports', () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })
    store.mount()

    expect(store.state.value).toEqual({ status: 'loading' })
  })

  it('enters signed-in state for member-001 when the observer returns that user', () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })
    store.mount()

    observer.emit(member('member-001'))

    expect(store.state.value).toEqual({
      status: 'signed-in',
      user: { uid: 'member-001', displayName: null, email: 'member-001@peecare.test' },
    })
  })

  it('enters signed-out state when the observer returns null', () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })
    store.mount()

    observer.emit(null)

    expect(store.state.value).toEqual({ status: 'signed-out' })
  })

  it('detaches the observer when disposed', () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })
    store.mount()
    expect(store.activeObserverCount()).toBe(1)

    store.dispose()

    expect(observer.unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.activeObserverCount()).toBe(0)
  })
})

describe('auth store — single authentication lifecycle', () => {
  it('keeps a single observer when mounted more than once and clears it on dispose', () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })

    store.mount()
    store.mount()

    expect(observer.subscribe).toHaveBeenCalledTimes(1)
    expect(store.activeObserverCount()).toBe(1)

    store.dispose()

    expect(store.activeObserverCount()).toBe(0)
  })

  it('resolves whenResolved after the first observer report', async () => {
    const observer = createFakeObserver()
    const store = createAuthStore({ observer: observer.port })
    store.mount()

    let resolved = false
    const pending = store.whenResolved().then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)

    observer.emit(member('member-001'))
    await pending

    expect(resolved).toBe(true)
  })
})

describe('auth store — protected resource teardown on session change', () => {
  it('disposes resources registered by member-001 before publishing member-002', () => {
    const observer = createFakeObserver()
    const registry = createProtectedResourceRegistry()
    const store = createAuthStore({ observer: observer.port, registry })
    store.mount()

    observer.emit(member('member-001'))

    const order: string[] = []
    registry.register(() => order.push('disposed'))

    observer.emit(member('member-002'))
    order.push('published:' + (store.state.value.status === 'signed-in' ? store.state.value.user.uid : 'none'))

    expect(order).toEqual(['disposed', 'published:member-002'])
    expect(registry.size()).toBe(0)
  })

  it('disposes resources before publishing a signed-out state', () => {
    const observer = createFakeObserver()
    const registry = createProtectedResourceRegistry()
    const store = createAuthStore({ observer: observer.port, registry })
    store.mount()

    observer.emit(member('member-001'))
    const disposer = vi.fn()
    registry.register(disposer)

    observer.emit(null)

    expect(disposer).toHaveBeenCalledTimes(1)
    expect(store.state.value).toEqual({ status: 'signed-out' })
  })

  it('does not tear down resources when the same UID is reported again', () => {
    const observer = createFakeObserver()
    const registry = createProtectedResourceRegistry()
    const store = createAuthStore({ observer: observer.port, registry })
    store.mount()

    observer.emit(member('member-001'))
    const disposer = vi.fn()
    registry.register(disposer)

    observer.emit(member('member-001'))

    expect(disposer).not.toHaveBeenCalled()
    expect(registry.size()).toBe(1)
  })
})
