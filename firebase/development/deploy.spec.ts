import { describe, expect, it, vi } from 'vitest'

import { DevelopmentDeploymentError, runDevelopmentDeploy } from './deploy.mjs'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BILLING_OWNER: 'development-owner@example.com',
    PEECARE_DEVELOPMENT_AUTH_PROVIDER: 'password',
    PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION: 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION',
  }
}

describe('development Rules and indexes deployment', () => {
  it('prints the approved Rules/indexes plan without executing in dry-run mode', () => {
    const execute = vi.fn()
    const output: string[] = []

    const result = runDevelopmentDeploy({
      environment: validEnvironment(),
      args: ['--dry-run'],
      execute,
      write: (line) => output.push(line),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      database: '(default)',
      resources: ['firestore.rules', 'firestore.indexes.json'],
    })
    expect(JSON.parse(output[0])).toEqual(result)
  })

  it('executes an exact non-interactive Firebase deployment after approved preflight', () => {
    const execute = vi.fn(() => ({ status: 0 }))
    const output: string[] = []

    const result = runDevelopmentDeploy({
      environment: validEnvironment(),
      args: ['--apply'],
      execute,
      write: (line) => output.push(line),
    })

    expect(execute).toHaveBeenCalledWith('firebase', [
      'deploy',
      '--project',
      'petcare-c7483',
      '--only',
      'firestore:rules,firestore:indexes',
      '--non-interactive',
    ])
    expect(result).toEqual({
      status: 'deployed',
      projectId: 'petcare-c7483',
      database: '(default)',
      resources: ['firestore.rules', 'firestore.indexes.json'],
    })
    expect(JSON.parse(output[0])).toEqual(result)
  })

  it('requires an explicit dry-run or apply mode before executing', () => {
    const execute = vi.fn()

    expect(() =>
      runDevelopmentDeploy({
        environment: validEnvironment(),
        args: [],
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'explicit_mode_required' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns a stable non-zero deployment failure without masking the CLI error', () => {
    expect(() =>
      runDevelopmentDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        execute: () => ({ status: 1 }),
        write: vi.fn(),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DevelopmentDeploymentError>>({
        code: 'firebase_deploy_failed',
      }),
    )
  })
})
