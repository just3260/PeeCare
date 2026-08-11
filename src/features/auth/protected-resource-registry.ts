// Central teardown ledger for anything that must not outlive a member session.
//
// Every Firestore listener or pending protected request registers a disposer
// here. The auth store calls disposeAll() before it publishes a signed-out state
// or a different signed-in UID, so one member's data can never linger into the
// next session. disposeAll clears the ledger before running the disposers, which
// keeps it safe to call again and safe for a disposer to register nothing new.

/** A teardown callback that releases a single protected resource. */
export type Disposer = () => void

export interface ProtectedResourceRegistry {
  /** Register a disposer to run on the next teardown; returns an unregister callback. */
  register(disposer: Disposer): Disposer
  /** Run and clear every registered disposer. */
  disposeAll(): void
  /** Number of disposers currently registered. */
  size(): number
}

export function createProtectedResourceRegistry(): ProtectedResourceRegistry {
  interface Registration {
    readonly dispose: Disposer
    active: boolean
  }

  let registrations: readonly Registration[] = []

  return {
    register(disposer: Disposer): Disposer {
      const registration: Registration = { dispose: disposer, active: true }
      registrations = [...registrations, registration]
      return () => {
        if (!registration.active) return
        registration.active = false
        registrations = registrations.filter((candidate) => candidate !== registration)
      }
    },
    disposeAll(): void {
      // Snapshot and clear first so teardown is re-entrant and a failing disposer
      // cannot leave a half-cleared ledger behind.
      const pending = registrations
      registrations = []
      for (const registration of pending) {
        if (!registration.active) continue
        registration.active = false
        // Isolate failures: one broken listener must not block the rest of the
        // teardown, which would leave protected resources alive across sessions.
        try {
          registration.dispose()
        } catch {
          // Intentionally swallowed; completeness of teardown is the priority.
        }
      }
    },
    size(): number {
      return registrations.length
    },
  }
}
