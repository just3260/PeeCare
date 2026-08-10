import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  DevelopmentInventoryError,
  guardDevelopmentMutation,
  parseDevelopmentInventory,
} from './environment.mjs'
import { runDevelopmentPreflight } from './preflight.mjs'

const REQUIRED_CONFIRMATION = 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'peecare-development',
    PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST: 'peecare-development',
    PEECARE_PRODUCTION_PROJECT_DENYLIST: 'peecare-production',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BILLING_OWNER: 'development-owner@example.com',
    PEECARE_DEVELOPMENT_AUTH_PROVIDER: 'password',
    PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION: REQUIRED_CONFIRMATION,
  }
}

describe('approved development inventory preflight', () => {
  it('keeps the Emulator default isolated from the explicit development alias', () => {
    const firebaseRc = JSON.parse(
      readFileSync(resolve(process.cwd(), '.firebaserc'), 'utf8'),
    )

    expect(firebaseRc.projects).toEqual({
      default: 'demo-peecare',
      development: 'petcare-c7483',
    })
  })

  it.each([
    'PEECARE_DEVELOPMENT_PROJECT_ID',
    'PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST',
    'PEECARE_DEVELOPMENT_FIRESTORE_REGION',
    'PEECARE_DEVELOPMENT_BILLING_OWNER',
    'PEECARE_DEVELOPMENT_AUTH_PROVIDER',
    'PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION',
  ] as const)('rejects missing %s before mutation', (field) => {
    const environment = validEnvironment()
    delete environment[field]
    const mutation = vi.fn()

    expect(() => guardDevelopmentMutation(environment, mutation)).toThrowError(
      expect.objectContaining({ code: 'missing_inventory' }),
    )
    expect(mutation).not.toHaveBeenCalled()
  })

  it.each([
    ['demo target', 'demo-peecare', 'demo-peecare'],
    ['production target', 'peecare-production', 'peecare-production'],
    ['non-allowlisted target', 'peecare-staging', 'peecare-development'],
  ])('rejects %s before mutation', (_name, projectId, allowlist) => {
    const mutation = vi.fn()
    const environment = {
      ...validEnvironment(),
      PEECARE_DEVELOPMENT_PROJECT_ID: projectId,
      PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST: allowlist,
    }

    expect(() => guardDevelopmentMutation(environment, mutation)).toThrow(
      DevelopmentInventoryError,
    )
    expect(mutation).not.toHaveBeenCalled()
  })

  it('returns a typed approved inventory and only then permits mutation', () => {
    const mutation = vi.fn(() => 'mutated')

    expect(guardDevelopmentMutation(validEnvironment(), mutation)).toBe('mutated')
    expect(mutation).toHaveBeenCalledOnce()
    expect(parseDevelopmentInventory(validEnvironment())).toEqual({
      projectId: 'peecare-development',
      firestoreRegion: 'asia-east1',
      billingOwner: 'development-owner@example.com',
      authProvider: 'password',
      operatorConfirmation: REQUIRED_CONFIRMATION,
    })
  })

  it('prints a sanitized dry-run plan without invoking mutation', () => {
    const output: string[] = []
    const mutation = vi.fn()
    const environment = {
      ...validEnvironment(),
      FIREBASE_API_KEY: 'must-not-leak',
      GOOGLE_APPLICATION_CREDENTIALS: '/private/service-account.json',
    }

    const result = runDevelopmentPreflight({
      environment,
      args: ['--dry-run'],
      write: (line) => output.push(line),
      mutation,
    })

    expect(result).toEqual(expect.objectContaining({ dryRun: true }))
    expect(mutation).not.toHaveBeenCalled()
    expect(output).toHaveLength(1)
    expect(JSON.parse(output[0])).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'peecare-development',
      firestoreRegion: 'asia-east1',
      authProvider: 'password',
      services: ['auth', 'firestore'],
      operations: ['deploy-firestore-rules', 'deploy-firestore-indexes'],
    })
    expect(output[0]).not.toContain('must-not-leak')
    expect(output[0]).not.toContain('service-account')
    expect(output[0]).not.toContain('development-owner@example.com')
  })
})
