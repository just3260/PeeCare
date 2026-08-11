import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { INSTALL_STAGES, runWorkspaceInstall } from './install-workspaces.mjs'

describe('deterministic workspace installs', () => {
  it('runs npm ci in root and every API workspace in deterministic order', () => {
    const runStage = vi.fn(() => ({ status: 0 }))

    const result = runWorkspaceInstall({ runStage })

    expect(INSTALL_STAGES.map((stage) => stage.workspace)).toEqual([
      'root',
      'member-api',
      'ingestion-api',
      'test-tool-api',
    ])
    expect(runStage.mock.calls.map(([stage]) => stage.workspace)).toEqual([
      'root',
      'member-api',
      'ingestion-api',
      'test-tool-api',
    ])
    expect(result).toEqual({ passed: true, exitCode: 0 })
  })

  it('wires package ci:workspaces to the deterministic installer', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

    expect(packageJson.scripts['ci:workspaces']).toBe('node scripts/install-workspaces.mjs')
    expect(packageJson.scripts.check).toContain('npm run check:test-tool')
    expect(packageJson.scripts['check:test-tool']).toBe(
      'npm --prefix services/test-tool-api run check',
    )
  })
})
