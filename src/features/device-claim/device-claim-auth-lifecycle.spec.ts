import { describe, expect, it, vi } from 'vitest'

import { createAuthStore, type AuthObserver } from '@/features/auth/auth-store'
import type { SessionUser } from '@/features/auth/session'
import { registerDeviceClaimAuthLifecycle } from './device-claim-auth-lifecycle'

function member(uid: string): SessionUser {
  return { uid, displayName: null, email: null }
}

function controllableObserver() {
  let publish: ((user: SessionUser | null) => void) | null = null
  return {
    observer: {
      subscribe(next) {
        publish = next
        return () => { publish = null }
      },
    } satisfies AuthObserver,
    emit(user: SessionUser | null) {
      if (publish === null) throw new Error('observer is not mounted')
      publish(user)
    },
  }
}

describe('device Claim auth lifecycle', () => {
  it('preserves reload recovery on initial auth and re-arms teardown for every later session boundary', () => {
    const control = controllableObserver()
    const authStore = createAuthStore({ observer: control.observer })
    const restart = vi.fn()
    const stop = registerDeviceClaimAuthLifecycle(authStore, { restart })
    authStore.mount()

    control.emit(member('member-001'))
    expect(restart).not.toHaveBeenCalled()

    control.emit(null)
    expect(restart).toHaveBeenCalledTimes(1)

    control.emit(member('member-002'))
    expect(restart).toHaveBeenCalledTimes(1)

    control.emit(member('member-003'))
    expect(restart).toHaveBeenCalledTimes(2)

    control.emit(null)
    expect(restart).toHaveBeenCalledTimes(3)

    stop()
  })

  it('clears recovery when initial authentication resolves signed out without double teardown later', () => {
    const control = controllableObserver()
    const authStore = createAuthStore({ observer: control.observer })
    const restart = vi.fn()
    registerDeviceClaimAuthLifecycle(authStore, { restart })
    authStore.mount()

    control.emit(null)
    expect(restart).toHaveBeenCalledTimes(1)

    control.emit(member('member-001'))
    expect(restart).toHaveBeenCalledTimes(1)

    control.emit(null)
    expect(restart).toHaveBeenCalledTimes(2)
  })
})
