import { describe, expect, it } from 'vitest';

import { findPrivacyLeaks } from '../src/security/privacy-scan.js';

describe('server source and bundle privacy scanner', () => {
  it.each([
    'Authorization: Bearer hardcoded-production-token',
    "authorization: 'Bearer hardcoded-production-token'",
    '"authorization":"Bearer hardcoded-production-token"',
    "const secret = 'hardcoded-production-token'",
    'const token = "hardcoded-production-token"',
    "const ingestionSecret = 'hardcoded-production-token'; const headers = { authorization: `Bearer ${ingestionSecret}` }",
    "const serviceCredentialValue = 'hardcoded-production-token'",
    "const googleApiKey = 'hardcoded-production-token'",
    "const oauth2Token = 'hardcoded-production-token'",
    '{"ingestionSecret":"hardcoded-production-token"}',
    'ENV INGESTION_SECRET hardcoded-production-token',
    'ARG SERVICE_CREDENTIAL=hardcoded-production-token',
    'env INGESTION_SECRET hardcoded-production-token',
    'arg SERVICE_CREDENTIAL=hardcoded-production-token',
    '-----BEGIN PRIVATE KEY-----',
    '{"private_key":"resolved-key-material"}',
    'AIzaSyResolvedProductionApiKey123456789',
  ])('detects embedded credential material: %s', (text) => {
    expect(findPrivacyLeaks(text)).not.toEqual([]);
  });

  it('does not flag server-side interpolation that contains no resolved secret', () => {
    expect(findPrivacyLeaks('authorization: `Bearer ${secret}`')).toEqual([]);
  });
});
