// Provider-neutral authentication adapter.
//
// Views depend on this narrow boundary instead of Firebase SDK details. The
// adapter triggers Firebase operations only; session publication remains the
// responsibility of the application's single onAuthStateChanged observer.

import type { InjectionKey } from 'vue'
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'

import { getFirebaseServices } from '@/platform/firebase/client'
import {
  createEmailLinkActionUrl,
  validateEmailLinkEmail,
  writePendingEmailLink,
} from './email-link-flow'
import { resolveSafeReturnPath } from './return-route'

export interface SendEmailSignInLinkInput {
  readonly email: string
  readonly returnTo: string
}

export interface CompleteEmailSignInLinkInput {
  readonly email: string
  readonly href: string
}

export interface AuthProvider {
  /** Start Google authentication from a direct user activation. */
  signInWithGoogle(): Promise<void>
  /** Ask Firebase to send a passwordless sign-in link. */
  sendEmailSignInLink(input: SendEmailSignInLinkInput): Promise<void>
  /** Complete a Firebase-recognized passwordless sign-in link. */
  completeEmailSignInLink(input: CompleteEmailSignInLinkInput): Promise<void>
  /** End the current Firebase session. */
  signOut(): Promise<void>
}

export type AuthProviderErrorCode =
  | 'google-popup-unavailable'
  | 'identity-collision'
  | 'google-sign-in-failed'
  | 'invalid-email'
  | 'email-link-send-failed'
  | 'email-link-invalid'
  | 'email-link-completion-failed'
  | 'sign-out-failed'

const NEUTRAL_MESSAGES: Readonly<Record<AuthProviderErrorCode, string>> = {
  'google-popup-unavailable': '無法開啟 Google 登入視窗，請再試一次。',
  'identity-collision': '無法完成登入，請使用原本的登入方式。',
  'google-sign-in-failed': 'Google 登入失敗，請稍後再試。',
  'invalid-email': '請輸入有效的電子郵件地址。',
  'email-link-send-failed': '無法寄出登入連結，請稍後再試。',
  'email-link-invalid': '登入連結無效或已失效，請重新取得。',
  'email-link-completion-failed': '無法完成登入，請重新取得登入連結。',
  'sign-out-failed': '無法登出，請稍後再試。',
}

/** A finite, user-safe failure that never retains the raw Firebase error. */
export class AuthProviderError extends Error {
  readonly code: AuthProviderErrorCode

  constructor(code: AuthProviderErrorCode) {
    super(NEUTRAL_MESSAGES[code])
    this.name = 'AuthProviderError'
    this.code = code
  }
}

const POPUP_UNAVAILABLE_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
])

const IDENTITY_COLLISION_CODES = new Set([
  'auth/account-exists-with-different-credential',
  'auth/credential-already-in-use',
])

function readFirebaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  try {
    const code = Reflect.get(error, 'code')
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

function normalizeGoogleError(error: unknown): AuthProviderError {
  const code = readFirebaseErrorCode(error)
  if (code && POPUP_UNAVAILABLE_CODES.has(code)) {
    return new AuthProviderError('google-popup-unavailable')
  }
  if (code && IDENTITY_COLLISION_CODES.has(code)) {
    return new AuthProviderError('identity-collision')
  }
  return new AuthProviderError('google-sign-in-failed')
}

function normalizeCompletionError(error: unknown): AuthProviderError {
  const code = readFirebaseErrorCode(error)
  if (code && IDENTITY_COLLISION_CODES.has(code)) {
    return new AuthProviderError('identity-collision')
  }
  return new AuthProviderError('email-link-completion-failed')
}

/** Injection key so views receive the same provider instance. */
export const AUTH_PROVIDER_KEY: InjectionKey<AuthProvider> = Symbol('auth-provider')

/**
 * Firebase-backed provider using the existing cached Auth instance. It never
 * initializes another app or subscribes to an auth observer.
 */
export function createFirebaseAuthProvider(): AuthProvider {
  return {
    async signInWithGoogle(): Promise<void> {
      try {
        const { auth } = getFirebaseServices()
        const googleProvider = new GoogleAuthProvider()
        // The default provider is sufficient; do not call addScope().
        await signInWithPopup(auth, googleProvider)
      } catch (error: unknown) {
        throw normalizeGoogleError(error)
      }
    },

    async sendEmailSignInLink({ email, returnTo }: SendEmailSignInLinkInput): Promise<void> {
      let normalizedEmail: string
      try {
        normalizedEmail = validateEmailLinkEmail(email)
      } catch {
        throw new AuthProviderError('invalid-email')
      }

      const safeReturnTo = resolveSafeReturnPath(returnTo)
      let actionUrl: string
      try {
        actionUrl = createEmailLinkActionUrl({
          origin: window.location.origin,
          returnTo: safeReturnTo,
        })
        const { auth } = getFirebaseServices()
        await sendSignInLinkToEmail(auth, normalizedEmail, {
          url: actionUrl,
          handleCodeInApp: true,
        })
      } catch {
        throw new AuthProviderError('email-link-send-failed')
      }

      // Link delivery remains successful when same-origin storage is blocked.
      try {
        writePendingEmailLink({ email: normalizedEmail, returnTo: safeReturnTo })
      } catch {
        // The helper is fail-closed, but keep this boundary safe if an injected
        // Storage implementation behaves unexpectedly.
      }
    },

    async completeEmailSignInLink({
      email,
      href,
    }: CompleteEmailSignInLinkInput): Promise<void> {
      let normalizedEmail: string
      try {
        normalizedEmail = validateEmailLinkEmail(email)
      } catch {
        throw new AuthProviderError('invalid-email')
      }

      try {
        const { auth } = getFirebaseServices()
        if (!isSignInWithEmailLink(auth, href)) {
          throw new AuthProviderError('email-link-invalid')
        }
        await signInWithEmailLink(auth, normalizedEmail, href)
      } catch (error: unknown) {
        if (error instanceof AuthProviderError) throw error
        throw normalizeCompletionError(error)
      }
    },

    async signOut(): Promise<void> {
      try {
        const { auth } = getFirebaseServices()
        await firebaseSignOut(auth)
      } catch {
        throw new AuthProviderError('sign-out-failed')
      }
    },
  }
}
