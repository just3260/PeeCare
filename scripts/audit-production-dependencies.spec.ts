import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_WORKSPACES,
  evaluateAuditOutput,
  runAuditGate,
} from './audit-production-dependencies.mjs'

const severities = ['info', 'low', 'moderate', 'high', 'critical'] as const

function auditJson(overrides: Partial<Record<(typeof severities)[number], number>> = {}) {
  return JSON.stringify({
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: Object.fromEntries(severities.map((severity) => [severity, overrides[severity] ?? 0])),
    },
  })
}

describe('production dependency audit threshold', () => {
  it('audits every production workspace including the Test Tool API', () => {
    expect(DEFAULT_WORKSPACES.map(({ name }) => name)).toEqual([
      'root',
      'member-api',
      'ingestion-api',
      'test-tool-api',
    ])
  })

  it.each([
    ['info', 2, true],
    ['low', 2, true],
    ['moderate', 1, false],
    ['high', 1, false],
    ['critical', 1, false],
  ] as const)('%s findings produce the expected gate result', (severity, count, expectedPass) => {
    const result = evaluateAuditOutput('root', auditJson({ [severity]: count }))

    expect(result.counts[severity]).toBe(count)
    expect(result.passed).toBe(expectedPass)
  })

  it('fails closed when npm returns invalid JSON', () => {
    const result = evaluateAuditOutput('member-api', 'npm registry temporarily unavailable')

    expect(result.passed).toBe(false)
    expect(result.failure).toBe('invalid audit JSON')
  })

  it('fails closed and sanitizes registry audit errors', () => {
    const sensitiveUrl = 'https://build-user:secret-token@registry.example.test/advisories'
    const result = evaluateAuditOutput(
      'ingestion-api',
      JSON.stringify({ error: { code: 'EAI_AGAIN', summary: `request to ${sensitiveUrl} failed` } }),
    )

    expect(result.passed).toBe(false)
    expect(result.failure).toBe('audit unavailable')
    expect(JSON.stringify(result)).not.toContain(sensitiveUrl)
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('fails closed when a workspace lockfile is missing', () => {
    const runAudit = vi.fn(() => ({ stdout: auditJson(), stderr: '', status: 0 }))
    const result = runAuditGate({
      workspaces: [{ name: 'root', directory: '.', lockfile: 'missing-package-lock.json' }],
      lockfileExists: () => false,
      runAudit,
    })

    expect(result.passed).toBe(false)
    expect(result.results[0].failure).toBe('lockfile missing')
    expect(runAudit).not.toHaveBeenCalled()
  })
})
