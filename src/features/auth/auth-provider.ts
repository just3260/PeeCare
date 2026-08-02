// Provider-neutral authentication adapter.
//
// The UI depends only on the AuthProvider interface, never on a concrete login
// mechanism. The local implementation authenticates test members against the
// Auth Emulator; the production provider is injected during deployment
// refinement without changing any view or route.

import type { InjectionKey } from 'vue'
import { signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'

import { getFirebaseServices } from '@/platform/firebase/client'

/** Credentials the local provider accepts. Production providers may differ. */
export interface SignInInput {
  readonly email: string
  readonly password: string
}

export interface AuthProvider {
  /** Authenticate a member. Rejects when authentication fails. */
  signIn(input: SignInInput): Promise<void>
  /** End the current Firebase session. */
  signOut(): Promise<void>
}

/** Injection key so views receive a provider without importing a concrete one. */
export const AUTH_PROVIDER_KEY: InjectionKey<AuthProvider> = Symbol('auth-provider')

/**
 * Local provider backed by the existing single Firebase app and the Auth
 * Emulator. Firebase is touched only when a method runs, never at construction,
 * so this is safe to instantiate as an injection default.
 */
export function createFirebaseAuthProvider(): AuthProvider {
  return {
    async signIn({ email, password }: SignInInput): Promise<void> {
      const { auth } = getFirebaseServices()
      await signInWithEmailAndPassword(auth, email, password)
    },
    async signOut(): Promise<void> {
      const { auth } = getFirebaseServices()
      await firebaseSignOut(auth)
    },
  }
}
