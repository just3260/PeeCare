import { describe, expect, it, vi } from 'vitest'

import {
  DevelopmentReadinessError,
  runDevelopmentReadiness,
  type DevelopmentReadinessAdapter,
} from './readiness.mjs'
import {
  normalizeDefaultProviderResponse,
  normalizeIdentityToolkitAuthConfiguration,
} from './readiness-admin-adapter.mjs'

const HOSTING_DOMAIN = 'petcare-c7483.web.app'
const ACTION_DOMAIN = 'petcare-c7483.firebaseapp.com'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BILLING_OWNER: 'development-owner@example.com',
    PEECARE_DEVELOPMENT_AUTH_PROVIDER: 'google.com',
    PEECARE_DEVELOPMENT_AUTH_PROVIDERS: 'google.com',
    PEECARE_DEVELOPMENT_AUTHORIZED_DOMAINS: `${ACTION_DOMAIN},${HOSTING_DOMAIN}`,
    PEECARE_DEVELOPMENT_WEB_API_KEY: 'public-web-api-key-secret',
    PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION: 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION',
  }
}

function readyAuthConfiguration(overrides: {
  enabledProviders?: readonly string[]
  emailEnabled?: boolean | null
  passwordRequired?: boolean | null
  allowDuplicateEmails?: boolean | null
  authorizedDomains?: readonly string[]
} = {}) {
  return {
    enabledProviders: overrides.enabledProviders ?? ['google.com'],
    emailEnabled: overrides.emailEnabled === undefined ? true : overrides.emailEnabled,
    passwordRequired:
      overrides.passwordRequired === undefined ? false : overrides.passwordRequired,
    allowDuplicateEmails:
      overrides.allowDuplicateEmails === undefined ? false : overrides.allowDuplicateEmails,
    authorizedDomains:
      overrides.authorizedDomains ?? ['localhost', ACTION_DOMAIN, HOSTING_DOMAIN],
  }
}

function readyAdapter(): DevelopmentReadinessAdapter {
  return {
    readAuthConfiguration: vi.fn(async () => readyAuthConfiguration()),
    readRequiredIndexes: vi.fn(async () => [
      {
        collectionGroup: 'events',
        state: 'READY',
        fields: ['eventType:ASCENDING', 'effectiveAtMs:DESCENDING', 'eventId:DESCENDING'],
      },
    ]),
    runRulesProbes: vi.fn(async () => ({
      ownerReadAllowed: true,
      nonOwnerReadDenied: true,
      anonymousReadDenied: true,
      clientWriteDenied: true,
    })),
  }
}

describe('deployed Auth and Firestore readiness', () => {
  it('returns only provider identifiers, booleans, counts, project identity, and probe outcomes', async () => {
    const adapter = readyAdapter()
    adapter.readAuthConfiguration = vi.fn(async () => ({
      ...readyAuthConfiguration(),
      ignoredEmail: 'member@example.test',
      ignoredClientSecret: 'oauth-client-secret',
      ignoredToken: 'provider-token',
      ignoredOobCode: 'one-time-code',
      ignoredLink: 'https://example.test/action?mode=signIn',
    }))
    const output: string[] = []

    const result = await runDevelopmentReadiness({
      environment: validEnvironment(),
      adapter,
      write: (line) => output.push(line),
    })

    expect(result).toEqual({
      status: 'ready',
      projectId: 'petcare-c7483',
      auth: {
        provider: { id: 'google.com', enabled: true },
        emailLink: {
          enabled: true,
          passwordRequired: false,
          duplicateEmailsAllowed: false,
        },
        authorizedDomains: { required: 2, ready: true },
      },
      firestore: {
        indexesReady: 1,
        ownerRead: 'allowed',
        nonOwnerRead: 'denied',
        anonymousRead: 'denied',
        clientWrite: 'denied',
      },
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(output[0]).not.toMatch(
      /member@example\.test|oauth-client-secret|provider-token|one-time-code|example\.test\/action|public-web-api-key-secret/,
    )
  })

  it.each([
    ['Google absent', readyAuthConfiguration({ enabledProviders: [] }), 'auth_provider_not_ready'],
    [
      'Google disabled inventory result',
      readyAuthConfiguration({ enabledProviders: ['password'] }),
      'auth_provider_not_ready',
    ],
    ['Email disabled', readyAuthConfiguration({ emailEnabled: false }), 'email_link_not_ready'],
    ['Email config missing', readyAuthConfiguration({ emailEnabled: null }), 'email_link_not_ready'],
    [
      'password required',
      readyAuthConfiguration({ passwordRequired: true }),
      'email_link_not_ready',
    ],
    [
      'passwordRequired missing',
      readyAuthConfiguration({ passwordRequired: null }),
      'email_link_not_ready',
    ],
    [
      'duplicate Email enabled',
      readyAuthConfiguration({ allowDuplicateEmails: true }),
      'email_link_not_ready',
    ],
    [
      'duplicate Email setting missing',
      readyAuthConfiguration({ allowDuplicateEmails: null }),
      'email_link_not_ready',
    ],
    [
      'Hosting domain missing',
      readyAuthConfiguration({ authorizedDomains: [ACTION_DOMAIN] }),
      'authorized_domain_not_ready',
    ],
    [
      'action domain missing',
      readyAuthConfiguration({ authorizedDomains: [HOSTING_DOMAIN] }),
      'authorized_domain_not_ready',
    ],
  ] as const)('fails with a stable code when %s', async (_name, config, code) => {
    const adapter = readyAdapter()
    adapter.readAuthConfiguration = vi.fn(async () => config)

    await expect(
      runDevelopmentReadiness({ environment: validEnvironment(), adapter, write: vi.fn() }),
    ).rejects.toMatchObject({ code })
    expect(adapter.readRequiredIndexes).not.toHaveBeenCalled()
    expect(adapter.runRulesProbes).not.toHaveBeenCalled()
  })

  it.each([
    `${ACTION_DOMAIN},other.web.app`,
    `${ACTION_DOMAIN},${HOSTING_DOMAIN},other.web.app`,
    HOSTING_DOMAIN,
  ])('rejects unapproved expected-domain inventory %s before adapter calls', async (domains) => {
    const adapter = readyAdapter()

    await expect(
      runDevelopmentReadiness({
        environment: {
          ...validEnvironment(),
          PEECARE_DEVELOPMENT_AUTHORIZED_DOMAINS: domains,
        },
        adapter,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'readiness_config_invalid' })
    expect(adapter.readAuthConfiguration).not.toHaveBeenCalled()
  })

  it('fails before Rules probes when a required index is not READY', async () => {
    const adapter = readyAdapter()
    adapter.readRequiredIndexes = vi.fn(async () => [
      { collectionGroup: 'events', state: 'CREATING', fields: [] },
    ])

    await expect(
      runDevelopmentReadiness({ environment: validEnvironment(), adapter, write: vi.fn() }),
    ).rejects.toMatchObject({ code: 'firestore_index_not_ready' })
    expect(adapter.runRulesProbes).not.toHaveBeenCalled()
  })

  it.each([
    ['owner read', 'ownerReadAllowed'],
    ['non-owner denial', 'nonOwnerReadDenied'],
    ['anonymous denial', 'anonymousReadDenied'],
    ['client write denial', 'clientWriteDenied'],
  ] as const)('fails when the %s probe fails', async (_name, probe) => {
    const adapter = readyAdapter()
    adapter.runRulesProbes = vi.fn(async () => ({
      ownerReadAllowed: true,
      nonOwnerReadDenied: true,
      anonymousReadDenied: true,
      clientWriteDenied: true,
      [probe]: false,
    }))

    await expect(
      runDevelopmentReadiness({ environment: validEnvironment(), adapter, write: vi.fn() }),
    ).rejects.toBeInstanceOf(DevelopmentReadinessError)
  })
})

describe('Identity Toolkit readiness adapter normalization', () => {
  it('maps the documented v2 config shape and excludes OAuth secret fields', () => {
    const result = normalizeIdentityToolkitAuthConfiguration(
      {
        signIn: {
          email: { enabled: true, passwordRequired: false },
          allowDuplicateEmails: false,
        },
        authorizedDomains: [ACTION_DOMAIN, HOSTING_DOMAIN],
        client: {
          apiKey: 'public-key',
          permissions: { google: { clientSecret: 'oauth-client-secret' } },
        },
      },
      true,
    )

    expect(result).toEqual({
      enabledProviders: ['google.com'],
      emailEnabled: true,
      passwordRequired: false,
      allowDuplicateEmails: false,
      authorizedDomains: [ACTION_DOMAIN, HOSTING_DOMAIN],
    })
    expect(JSON.stringify(result)).not.toMatch(/oauth-client-secret|clientSecret|public-key/)
  })

  it('maps malformed or absent config values to fail-closed nulls and empty lists', () => {
    expect(
      normalizeIdentityToolkitAuthConfiguration(
        {
          signIn: {
            email: { enabled: 'true', passwordRequired: 0 },
            allowDuplicateEmails: 'false',
          },
          authorizedDomains: [HOSTING_DOMAIN, 42, null],
        },
        false,
      ),
    ).toEqual({
      enabledProviders: [],
      emailEnabled: null,
      passwordRequired: null,
      allowDuplicateEmails: null,
      authorizedDomains: [HOSTING_DOMAIN],
    })
  })

  it.each([
    ['missing provider', new Response(null, { status: 404 }), false],
    [
      'disabled provider',
      new Response(JSON.stringify({ enabled: false, clientSecret: 'must-not-leak' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      false,
    ],
    [
      'enabled provider',
      new Response(JSON.stringify({ enabled: true, clientSecret: 'must-not-leak' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      true,
    ],
  ] as const)('maps %s without returning provider response data', async (_name, response, expected) => {
    await expect(normalizeDefaultProviderResponse(response, 'google.com')).resolves.toBe(
      expected,
    )
  })

  it('maps provider HTTP failures to a stable code without response payload details', async () => {
    const response = new Response('oauth-client-secret', { status: 500 })
    const error = await normalizeDefaultProviderResponse(response, 'google.com').catch(
      (reason: unknown) => reason,
    )

    expect(error).toMatchObject({ code: 'auth_provider_google_com_http_500' })
    expect(JSON.stringify(error)).not.toContain('oauth-client-secret')
  })
})
