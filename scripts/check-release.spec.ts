import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  RELEASE_STAGES,
  RELEASE_TRACKED_FILES,
  runPackagingSourceGate,
  runReleaseGate,
  scanPackagingPrivacy,
} from './check-release.mjs'

describe('release quality orchestration', () => {
  it('runs the repository checks before the production dependency audits', () => {
    const runStage = vi.fn(() => ({ status: 0 }))

    const result = runReleaseGate({ runStage })

    expect(RELEASE_STAGES.map((stage) => stage.name)).toEqual([
      'check:all',
      'test-tool:source-boundary',
      'audit:production',
    ])
    expect(RELEASE_STAGES[2].workspace).toBe(
      'root,member-api,ingestion-api,test-tool-api',
    )
    expect(RELEASE_TRACKED_FILES).toContain('services/test-tool-api/package.json')
    expect(RELEASE_TRACKED_FILES).toContain('services/test-tool-api/package-lock.json')
    expect(runStage.mock.calls.map(([stage]) => stage.name)).toEqual([
      'check:all',
      'audit:production',
    ])
    expect(result).toEqual({ passed: true, exitCode: 0 })
  })

  it('stops at a failing stage and propagates its non-zero exit code', () => {
    const laterStage = vi.fn(() => ({ status: 0 }))
    const result = runReleaseGate({
      stages: [
        { name: 'fixture:failure', workspace: 'ingestion-api', run: () => ({ status: 7 }) },
        { name: 'fixture:must-not-run', workspace: 'root', run: laterStage },
      ],
    })

    expect(result).toEqual({
      passed: false,
      exitCode: 7,
      failedStage: 'fixture:failure',
      failedWorkspace: 'ingestion-api',
    })
    expect(laterStage).not.toHaveBeenCalled()
  })

  it('wires package check:release to the release runner', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

    expect(packageJson.scripts['check:release']).toBe('node scripts/check-release.mjs')
  })

  it('wires the exact macOS build, verify and paired release gates', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))
    const expected = {
      'test-tool:macos:build': 'node scripts/test-tool-macos-build.mjs',
      'test-tool:macos:verify': 'node scripts/test-tool-macos-verify.mjs',
      'test-tool:macos:release':
        'npm run check:release && npm run test-tool:macos:verify',
    }

    expect(packageJson.scripts).toMatchObject(expected)
    expect(packageLock.packages[''].devDependencies).toMatchObject({
      esbuild: '0.25.12',
      postject: '1.0.0-alpha.6',
    })
  })

  it('keeps the fast source gate offline and free of signing or cloud mutation', () => {
    expect(runPackagingSourceGate()).toEqual({ status: 0 })
    expect(JSON.stringify(RELEASE_STAGES)).not.toMatch(
      /codesign|notarytool|gcloud|secret-manager|test-tool:macos:build|test-tool:macos:verify/u,
    )
  })

  it('fails the packaging privacy scan without returning matched secret material', () => {
    const token = `ya29.${'sensitive'.repeat(3)}`
    const result = scanPackagingPrivacy([
      { path: 'scripts/safe.mjs', bytes: Buffer.from('export const safe = true') },
      { path: 'scripts/unsafe.mjs', bytes: Buffer.from(token) },
    ])

    expect(result).toEqual(['scripts/unsafe.mjs'])
    expect(JSON.stringify(result)).not.toContain(token)
  })

  it('documents the complete operator handoff and withdrawal flow', () => {
    const runbook = readFileSync(resolve('scripts/TEST_TOOL_MACOS_RUNBOOK.md'), 'utf8')

    for (const required of [
      'macOS 14.8.8',
      'gcloud auth login',
      'gcloud config set project petcare-c7483',
      '--secret-version 7',
      'shasum -a 256 -c',
      'uname -m',
      'peecare-test-tool-macos-arm64',
      'peecare-test-tool-macos-x64',
      'SIGINT',
      'SIGTERM',
      'gcloud auth revoke',
      'Secret Manager IAM',
      'withdraw',
      'npm run test-tool:macos:verify',
      'npm run test-tool:macos:release',
    ]) {
      expect(runbook).toContain(required)
    }
  })

  it('fails when a release stage changes a tracked manifest or lockfile', () => {
    const captureFileState = vi
      .fn()
      .mockReturnValueOnce(new Map([['package-lock.json', 'before']]))
      .mockReturnValueOnce(new Map([['package-lock.json', 'after']]))

    const result = runReleaseGate({
      stages: [{ name: 'fixture:mutation', workspace: 'root', run: () => ({ status: 0 }) }],
      captureFileState,
    })

    expect(result).toEqual({
      passed: false,
      exitCode: 1,
      failedStage: 'lockfile:drift',
      failedWorkspace: 'repository',
    })
  })
})
