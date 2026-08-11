import { describe, expect, it, vi } from 'vitest';

import {
  FirebaseIdTokenAuthenticationError,
  FirebaseIdTokenVerifier,
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
    ['wrong scheme', 'Basic tester-token'],
    ['missing token', 'Bearer'],
    ['whitespace in token', 'Bearer tester token'],
  ])('rejects a %s Authorization header without calling Firebase', async (_case, header) => {
    const firebaseAuth = createFirebaseAuth();
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader(header)).rejects.toEqual(
      new FirebaseIdTokenAuthenticationError(),
    );
    expect(firebaseAuth.verifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', 'malformed-token', 'auth/argument-error'],
    ['expired', 'expired-token', 'auth/id-token-expired'],
    ['revoked', 'revoked-token', 'auth/id-token-revoked'],
    ['wrong project', 'wrong-project-token', 'auth/argument-error'],
  ])(
    'maps a %s token failure to the same sanitized authentication error',
    async (_case, token, code) => {
      const firebaseAuth = createFirebaseAuth();
      firebaseAuth.verifyIdToken.mockRejectedValue(
        Object.assign(new Error('tester-token private@example.com raw-uid'), { code }),
      );
      const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

      let caught: unknown;
      try {
        await verifier.verifyAuthorizationHeader(`Bearer ${token}`);
      } catch (error) {
        caught = error;
      }

      expect(caught).toEqual(new FirebaseIdTokenAuthenticationError());
      expect(String(caught)).not.toContain(token);
      expect(String(caught)).not.toContain('private@example.com');
      expect(String(caught)).not.toContain('raw-uid');
      expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith(token, true);
    },
  );

  it('always enables revoked-token checking and returns only the decoded uid', async () => {
    const firebaseAuth = createFirebaseAuth();
    firebaseAuth.verifyIdToken.mockResolvedValue({
      uid: 'member-001',
      email: 'private@example.com',
      aud: 'petcare-c7483',
    });
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader('Bearer valid-token')).resolves.toEqual({
      uid: 'member-001',
    });
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith('valid-token', true);
  });

  it.each([
    ['missing uid', {}],
    ['non-string uid', { uid: 123 }],
    ['empty uid', { uid: '' }],
  ])('fails closed for a decoded token with %s', async (_case, decodedToken) => {
    const firebaseAuth = createFirebaseAuth();
    firebaseAuth.verifyIdToken.mockResolvedValue(decodedToken);
    const verifier = new FirebaseIdTokenVerifier(firebaseAuth);

    await expect(verifier.verifyAuthorizationHeader('Bearer valid-token')).rejects.toEqual(
      new FirebaseIdTokenAuthenticationError(),
    );
  });
});
