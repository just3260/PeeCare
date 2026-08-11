export interface FirebaseIdTokenAuth {
  verifyIdToken(
    idToken: string,
    checkRevoked: true,
  ): Promise<{ readonly uid?: unknown }>;
}

export interface VerifiedFirebaseIdentity {
  readonly uid: string;
}

export class FirebaseIdTokenAuthenticationError extends Error {
  constructor() {
    super('Firebase ID token authentication failed');
    this.name = 'FirebaseIdTokenAuthenticationError';
  }
}

export class FirebaseIdTokenVerifier {
  constructor(private readonly firebaseAuth: FirebaseIdTokenAuth) {}

  async verifyAuthorizationHeader(
    authorizationHeader: string | undefined,
  ): Promise<VerifiedFirebaseIdentity> {
    const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/i);
    if (match === undefined || match === null) {
      throw new FirebaseIdTokenAuthenticationError();
    }

    try {
      const decodedToken = await this.firebaseAuth.verifyIdToken(match[1], true);
      if (typeof decodedToken.uid !== 'string' || decodedToken.uid.length === 0) {
        throw new FirebaseIdTokenAuthenticationError();
      }

      return { uid: decodedToken.uid };
    } catch {
      throw new FirebaseIdTokenAuthenticationError();
    }
  }
}
