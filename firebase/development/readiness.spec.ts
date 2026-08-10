import { describe, expect, it, vi } from 'vitest'

import {
  DevelopmentReadinessError,
  runDevelopmentReadiness,
  type DevelopmentReadinessAdapter,
} from './readiness.mjs'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BILLING_OWNER: 'development-owner@example.com',
    PEECARE_DEVELOPMENT_AUTH_PROVIDER: 'password',
    PEECARE_DEVELOPMENT_AUTH_PROVIDERS: 'password,google.com,apple.com',
    PEECARE_DEVELOPMENT_AUTHORIZED_DOMAINS:
      'petcare-c7483.firebaseapp.com,petcare-c7483.web.app',
    PEECARE_DEVELOPMENT_WEB_API_KEY: 'public-web-api-key',
    PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION: 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION',
  }
}

function readyAdapter(): DevelopmentReadinessAdapter {
  return {
    readAuthConfiguration: vi.fn(async () => ({
      enabledProviders: ['password', 'google.com', 'apple.com'],
      authorizedDomains: [
        'localhost',
        'petcare-c7483.firebaseapp.com',
        'petcare-c7483.web.app',
      ],
    })),
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
  it('returns only a sanitized readiness summary when every gate passes', async () => {
    const adapter = readyAdapter()
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
        providers: ['password', 'google.com', 'apple.com'],
        authorizedDomains: 2,
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
    expect(output[0]).not.toContain('public-web-api-key')
  })

  it.each([
    ['provider', { enabledProviders: ['password', 'google.com'], authorizedDomains: ['petcare-c7483.firebaseapp.com', 'petcare-c7483.web.app'] }, 'auth_provider_not_ready'],
    ['domain', { enabledProviders: ['password', 'google.com', 'apple.com'], authorizedDomains: ['petcare-c7483.firebaseapp.com'] }, 'authorized_domain_not_ready'],
  ] as const)('fails when required Auth %s is absent', async (_name, config, code) => {
    const adapter = readyAdapter()
    adapter.readAuthConfiguration = vi.fn(async () => config)

    await expect(
      runDevelopmentReadiness({ environment: validEnvironment(), adapter, write: vi.fn() }),
    ).rejects.toMatchObject({ code })
    expect(adapter.runRulesProbes).not.toHaveBeenCalled()
  })

  it('fails when any required index is not READY', async () => {
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
