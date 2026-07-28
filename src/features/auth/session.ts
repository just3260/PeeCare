// Member session vocabulary for the Web MVP.
//
// The auth store publishes exactly one of these three states, derived only from
// Firebase Authentication. A signed-in session exposes the Firebase UID plus the
// minimal display identity; it never carries credentials, tokens, or roles.

/** Minimal identity surfaced for a signed-in member. */
export interface SessionUser {
  readonly uid: string
  readonly displayName: string | null
  readonly email: string | null
}

/** The complete set of member session states the app can be in. */
export type AuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly user: SessionUser }
