import { timingSafeEqual } from 'node:crypto';

const BODY_CREDENTIAL_PATTERN = /^Bearer ([^\s]+)$/;
const CONFIGURED_SECRET_PATTERN = /^[^\s]+$/;

export class EmqxClaimAuthenticationError extends Error {
  readonly code = 'unauthorized' as const;

  constructor() {
    super('EMQX Claim body credential is invalid.');
    this.name = 'EmqxClaimAuthenticationError';
    Object.setPrototypeOf(this, EmqxClaimAuthenticationError.prototype);
  }
}

/**
 * Authenticates only the dedicated body-wrapper credential used by EMQX Claim ingress.
 * The configured value is the secret token, without the `Bearer ` prefix.
 */
export class EmqxClaimAuthenticator {
  private readonly expectedSecret: Buffer;

  constructor(configuredSecret: string) {
    if (
      typeof configuredSecret !== 'string' ||
      !CONFIGURED_SECRET_PATTERN.test(configuredSecret)
    ) {
      throw new Error('EMQX Claim webhook secret must be a non-empty token.');
    }
    this.expectedSecret = Buffer.from(configuredSecret, 'utf8');
  }

  assertBodyCredential(value: unknown): void {
    const match = typeof value === 'string' ? BODY_CREDENTIAL_PATTERN.exec(value) : null;
    const presentedSecret = Buffer.from(match?.[1] ?? '', 'utf8');

    if (presentedSecret.length !== this.expectedSecret.length) {
      timingSafeEqual(Buffer.alloc(this.expectedSecret.length), this.expectedSecret);
      throw new EmqxClaimAuthenticationError();
    }
    if (!timingSafeEqual(presentedSecret, this.expectedSecret)) {
      throw new EmqxClaimAuthenticationError();
    }
  }
}
