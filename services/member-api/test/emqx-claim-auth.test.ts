import { describe, expect, it } from 'vitest';

import {
  EmqxClaimAuthenticationError,
  EmqxClaimAuthenticator,
} from '../src/security/emqx-claim-auth.js';

describe('EMQX Claim body credential authentication', () => {
  it('accepts only the exact Bearer credential configured for Claim ingress', () => {
    const authenticator = new EmqxClaimAuthenticator('claim-webhook-secret');

    expect(() =>
      authenticator.assertBodyCredential('Bearer claim-webhook-secret'),
    ).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['non-string', ['Bearer claim-webhook-secret']],
    ['Firebase bearer', 'Bearer firebase-id-token'],
    ['ingestion bearer', 'Bearer ingestion-webhook-secret'],
    ['wrong scheme', 'Basic claim-webhook-secret'],
    ['embedded whitespace', 'Bearer claim-webhook-secret extra'],
    ['empty bearer', 'Bearer '],
  ])('fails closed for a %s credential', (_case, value) => {
    const authenticator = new EmqxClaimAuthenticator('claim-webhook-secret');

    expect(() => authenticator.assertBodyCredential(value)).toThrow(
      EmqxClaimAuthenticationError,
    );
  });

  it.each(['', ' ', 'secret with whitespace'])('rejects an unsafe configured secret', (secret) => {
    expect(() => new EmqxClaimAuthenticator(secret)).toThrowError(
      'EMQX Claim webhook secret must be a non-empty token.',
    );
  });

  it.each([undefined, null])('fails closed when runtime configuration supplies %s', (secret) => {
    expect(() => new EmqxClaimAuthenticator(secret as unknown as string)).toThrowError(
      'EMQX Claim webhook secret must be a non-empty token.',
    );
  });
});
