import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { RELEASE_STAGES, runReleaseGate } from './check-release.mjs'

describe('release quality orchestration', () => {
  it('runs the repository checks before the production dependency audits', () => {
    const runStage = vi.fn(() => ({ status: 0 }))

    const result = runReleaseGate({ runStage })

    expect(RELEASE_STAGES.map((stage) => stage.name)).toEqual(['check:all', 'audit:production'])
    expect(runStage.mock.calls.map(([stage]) => stage.name)).toEqual(['check:all', 'audit:production'])
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
