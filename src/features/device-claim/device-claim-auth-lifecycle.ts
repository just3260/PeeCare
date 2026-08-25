import { watch } from 'vue'

import type { AuthStore } from '@/features/auth/auth-store'
import type { DeviceClaimStore } from './device-claim-store'

/**
 * Keep Claim teardown scoped to the currently published member session.
 *
 * The registry is one-shot, so a fresh disposer is installed after every
 * signed-in publication. Initial authentication intentionally installs only
 * after the auth store has published the UID, preserving a reload's redacted
 * recovery record for that member.
 */
export function registerDeviceClaimAuthLifecycle(
  authStore: Pick<AuthStore, 'state' | 'registry'>,
  claimStore: Pick<DeviceClaimStore, 'restart'>,
): () => void {
  let unregister: (() => void) | null = null
  let teardownRanForTransition = false

  const stopWatching = watch(
    authStore.state,
    (state) => {
      unregister?.()
      unregister = null

      if (state.status === 'signed-out') {
        if (!teardownRanForTransition) claimStore.restart()
        teardownRanForTransition = false
        return
      }

      if (state.status === 'signed-in') {
        teardownRanForTransition = false
        unregister = authStore.registry.register(() => {
          teardownRanForTransition = true
          claimStore.restart()
        })
      }
    },
    { flush: 'sync', immediate: true },
  )

  return () => {
    stopWatching()
    unregister?.()
    unregister = null
  }
}
