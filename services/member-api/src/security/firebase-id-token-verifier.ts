export interface FirebaseIdTokenAuth {
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<{ readonly uid: string }>;
}

export interface VerifiedMemberIdentity {
  readonly uid: string;
}

export class MemberAuthenticationError extends Error {
  constructor() {
    super('Member authentication failed');
    this.name = 'MemberAuthenticationError';
  }
}

export class FirebaseIdTokenVerifier {
  constructor(private readonly firebaseAuth: FirebaseIdTokenAuth) {}

  async verifyAuthorizationHeader(
    authorizationHeader: string | undefined,
  ): Promise<VerifiedMemberIdentity> {
    const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/i);
    if (match === undefined || match === null) {
      throw new MemberAuthenticationError();
    }

    try {
      const decodedToken = await this.firebaseAuth.verifyIdToken(match[1], true);
      if (typeof decodedToken.uid !== 'string' || decodedToken.uid.length === 0) {
        throw new MemberAuthenticationError();
      }

      return { uid: decodedToken.uid };
    } catch {
      throw new MemberAuthenticationError();
    }
  }
}
