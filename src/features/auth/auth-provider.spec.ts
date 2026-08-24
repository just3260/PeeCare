import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const providerInstances: Array<{ addScope: ReturnType<typeof vi.fn> }> = []

  return {
    auth: { kind: 'existing-auth' },
    providerInstances,
    GoogleAuthProvider: vi.fn(function GoogleAuthProviderMock() {
      const provider = { addScope: vi.fn() }
      providerInstances.push(provider)
      return provider
    }),
    signInWithPopup: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    firebaseSignOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
    getFirebaseServices: vi.fn(),
    validateEmailLinkEmail: vi.fn(),
    createEmailLinkActionUrl: vi.fn(),
    writePendingEmailLink: vi.fn(),
  }
})

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: mocks.GoogleAuthProvider,
  signInWithPopup: mocks.signInWithPopup,
  sendSignInLinkToEmail: mocks.sendSignInLinkToEmail,
  isSignInWithEmailLink: mocks.isSignInWithEmailLink,
  signInWithEmailLink: mocks.signInWithEmailLink,
  signOut: mocks.firebaseSignOut,
  onAuthStateChanged: mocks.onAuthStateChanged,
}))

vi.mock('@/platform/firebase/client', () => ({
  getFirebaseServices: mocks.getFirebaseServices,
}))

vi.mock('./email-link-flow', () => ({
  validateEmailLinkEmail: mocks.validateEmailLinkEmail,
  createEmailLinkActionUrl: mocks.createEmailLinkActionUrl,
  writePendingEmailLink: mocks.writePendingEmailLink,
}))

import {
  AuthProviderError,
  createFirebaseAuthProvider,
  type AuthProviderErrorCode,
} from './auth-provider'

function firebaseError(code: string): unknown {
  return {
    code,
    message: 'Firebase raw failure for member@example.test using google.com',
    customData: { email: 'member@example.test', _tokenResponse: 'provider-token-secret' },
  }
}

async function expectSanitizedFailure(
  action: Promise<void>,
  expectedCode: AuthProviderErrorCode,
): Promise<void> {
  const error = await action.catch((reason: unknown) => reason)

  expect(error).toBeInstanceOf(AuthProviderError)
  expect(error).toMatchObject({ code: expectedCode })
  const serialized = JSON.stringify(error)
  expect(serialized).not.toContain('member@example.test')
  expect(serialized).not.toContain('provider-token-secret')
  expect(serialized).not.toContain('google.com')
  expect(serialized).not.toContain('Firebase raw failure')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.providerInstances.length = 0
  mocks.getFirebaseServices.mockReturnValue({ auth: mocks.auth })
  mocks.validateEmailLinkEmail.mockImplementation((email: string) => email.trim())
  mocks.createEmailLinkActionUrl.mockReturnValue('https://app.test/auth/email-link?returnTo=%2Fstats')
  mocks.writePendingEmailLink.mockReturnValue(true)
  mocks.signInWithPopup.mockResolvedValue({ user: { uid: 'member-001' } })
  mocks.sendSignInLinkToEmail.mockResolvedValue(undefined)
  mocks.isSignInWithEmailLink.mockReturnValue(true)
  mocks.signInWithEmailLink.mockResolvedValue({ user: { uid: 'member-001' } })
  mocks.firebaseSignOut.mockResolvedValue(undefined)
})

describe('createFirebaseAuthProvider', () => {
  it('uses the existing Auth instance for a scope-free Google popup without publishing session state', async () => {
    const provider = createFirebaseAuthProvider()

    expect(mocks.getFirebaseServices).not.toHaveBeenCalled()
    await provider.signInWithGoogle()

    expect(mocks.GoogleAuthProvider).toHaveBeenCalledOnce()
    expect(mocks.providerInstances).toHaveLength(1)
    expect(mocks.providerInstances[0]?.addScope).not.toHaveBeenCalled()
    expect(mocks.signInWithPopup).toHaveBeenCalledWith(mocks.auth, mocks.providerInstances[0])
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled()
  })

  it.each(['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'])(
    'maps %s to one retryable popup failure without raw identity details',
    async (code) => {
      mocks.signInWithPopup.mockRejectedValueOnce(firebaseError(code))

      await expectSanitizedFailure(
        createFirebaseAuthProvider().signInWithGoogle(),
        'google-popup-unavailable',
      )
      expect(mocks.onAuthStateChanged).not.toHaveBeenCalled()
    },
  )

  it.each(['auth/account-exists-with-different-credential', 'auth/credential-already-in-use'])(
    'maps %s to a neutral identity collision without provider disclosure',
    async (code) => {
      mocks.signInWithPopup.mockRejectedValueOnce(firebaseError(code))

      await expectSanitizedFailure(
        createFirebaseAuthProvider().signInWithGoogle(),
        'identity-collision',
      )
    },
  )

  it('masks an unrecognized Google provider rejection', async () => {
    mocks.signInWithPopup.mockRejectedValueOnce(firebaseError('auth/internal-error'))

    await expectSanitizedFailure(
      createFirebaseAuthProvider().signInWithGoogle(),
      'google-sign-in-failed',
    )
  })

  it('sends an Email Link with a safe callback and records only the normalized pending request', async () => {
    const provider = createFirebaseAuthProvider()

    await provider.sendEmailSignInLink({ email: ' member@example.test ', returnTo: '/stats' })

    expect(mocks.validateEmailLinkEmail).toHaveBeenCalledWith(' member@example.test ')
    expect(mocks.createEmailLinkActionUrl).toHaveBeenCalledWith({
      origin: window.location.origin,
      returnTo: '/stats',
    })
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledWith(mocks.auth, 'member@example.test', {
      url: 'https://app.test/auth/email-link?returnTo=%2Fstats',
      handleCodeInApp: true,
    })
    expect(mocks.writePendingEmailLink).toHaveBeenCalledWith({
      email: 'member@example.test',
      returnTo: '/stats',
    })
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled()
  })

  it('does not create pending state when Firebase rejects an Email Link request', async () => {
    mocks.sendSignInLinkToEmail.mockRejectedValueOnce(firebaseError('auth/quota-exceeded'))

    await expectSanitizedFailure(
      createFirebaseAuthProvider().sendEmailSignInLink({
        email: 'member@example.test',
        returnTo: '/stats',
      }),
      'email-link-send-failed',
    )
    expect(mocks.writePendingEmailLink).not.toHaveBeenCalled()
  })

  it('completes only a Firebase-recognized Email Link on the existing Auth instance', async () => {
    const href = 'https://app.test/auth/email-link?mode=signIn&oobCode=opaque'

    await createFirebaseAuthProvider().completeEmailSignInLink({
      email: ' member@example.test ',
      href,
    })

    expect(mocks.isSignInWithEmailLink).toHaveBeenCalledWith(mocks.auth, href)
    expect(mocks.signInWithEmailLink).toHaveBeenCalledWith(
      mocks.auth,
      'member@example.test',
      href,
    )
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled()
  })

  it('rejects a non-Email-Link URL before Firebase completion', async () => {
    mocks.isSignInWithEmailLink.mockReturnValueOnce(false)

    await expectSanitizedFailure(
      createFirebaseAuthProvider().completeEmailSignInLink({
        email: 'member@example.test',
        href: 'https://app.test/not-a-link',
      }),
      'email-link-invalid',
    )
    expect(mocks.signInWithEmailLink).not.toHaveBeenCalled()
  })

  it('uses the existing Auth instance to sign out without changing observer lifecycle', async () => {
    await createFirebaseAuthProvider().signOut()

    expect(mocks.firebaseSignOut).toHaveBeenCalledWith(mocks.auth)
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled()
  })
})
