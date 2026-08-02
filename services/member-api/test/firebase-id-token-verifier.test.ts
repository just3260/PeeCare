import { describe, expect, it, vi } from 'vitest';
import {
  FirebaseIdTokenVerifier,
  MemberAuthenticationError,
} from '../src/security/firebase-id-token-verifier.js';

function createFirebaseAuth() {
  return {
    verifyIdToken: vi.fn(),
  };
}

describe('FirebaseIdTokenVerifier', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong scheme', 'Basic token'],
    ['missing token', 'Bearer'],
    ['whitespace token', 'Bearer token with spaces'],
  ])('rejects a %s Authorization header before calling Firebase', async (_case, header) => {
    const firebaseAuth = createFirebaseAuth();
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader(header)).rejects.toBeInstanceOf(
      MemberAuthenticationError,
    );
    expect(firebaseAuth.verifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', 'auth/id-token-expired'],
    ['revoked', 'auth/id-token-revoked'],
    ['invalid', 'auth/argument-error'],
  ])('maps a Firebase %s token failure to one unauthorized error', async (_case, code) => {
    const firebaseAuth = createFirebaseAuth();
    firebaseAuth.verifyIdToken.mockRejectedValue(Object.assign(new Error('sensitive detail'), { code }));
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader(`Bearer ${_case}-token`)).rejects.toEqual(
      new MemberAuthenticationError(),
    );
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith(`${_case}-token`, true);
  });

  it('returns only the decoded uid after Firebase verifies signature, claims, expiry, and revocation', async () => {
    const firebaseAuth = createFirebaseAuth();
    firebaseAuth.verifyIdToken.mockResolvedValue({
      uid: 'member-001',
      email: 'private@example.com',
      aud: 'demo-peecare',
    });
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader('Bearer valid-token')).resolves.toEqual({
      uid: 'member-001',
    });
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith('valid-token', true);
  });

  it('fails closed when Firebase returns an empty uid', async () => {
    const firebaseAuth = createFirebaseAuth();
    firebaseAuth.verifyIdToken.mockResolvedValue({ uid: '' });
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader('Bearer valid-token')).rejects.toBeInstanceOf(
      MemberAuthenticationError,
    );
  });
});
