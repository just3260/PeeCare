import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical']
const BLOCKING_SEVERITIES = ['moderate', 'high', 'critical']

export const DEFAULT_WORKSPACES = [
  { name: 'root', directory: '.', lockfile: 'package-lock.json' },
  {
    name: 'member-api',
    directory: 'services/member-api',
    lockfile: 'services/member-api/package-lock.json',
  },
  {
    name: 'ingestion-api',
    directory: 'services/ingestion-api',
    lockfile: 'services/ingestion-api/package-lock.json',
  },
]

function unavailableCounts() {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, null]))
}

function failedResult(workspace, failure) {
  return { workspace, counts: unavailableCounts(), passed: false, failure }
}

function readCounts(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities
  if (vulnerabilities === null || typeof vulnerabilities !== 'object') return null

  const counts = {}
  for (const severity of SEVERITIES) {
    const count = vulnerabilities[severity]
    if (!Number.isSafeInteger(count) || count < 0) return null
    counts[severity] = count
  }
  return counts
}

export function evaluateAuditOutput(workspace, rawOutput) {
  let report
  try {
    report = JSON.parse(rawOutput)
  } catch {
    return failedResult(workspace, 'invalid audit JSON')
  }

  if (report?.error !== undefined) return failedResult(workspace, 'audit unavailable')

  const counts = readCounts(report)
  if (counts === null) return failedResult(workspace, 'invalid audit JSON')

  const passed = BLOCKING_SEVERITIES.every((severity) => counts[severity] === 0)
  return {
    workspace,
    counts,
    passed,
    ...(passed ? {} : { failure: 'moderate-or-higher advisory' }),
  }
}

function runNpmAudit(directory) {
  return spawnSync(
    'npm',
    ['audit', '--json', '--audit-level=moderate', '--omit=dev', '--omit=optional'],
    { cwd: resolve(directory), encoding: 'utf8' },
  )
}

export function runAuditGate({
  workspaces = DEFAULT_WORKSPACES,
  lockfileExists = existsSync,
  runAudit = ({ directory }) => runNpmAudit(directory),
} = {}) {
  const results = workspaces.map((workspace) => {
    if (!lockfileExists(resolve(workspace.lockfile))) {
      return failedResult(workspace.name, 'lockfile missing')
    }

    const audit = runAudit(workspace)
    if (audit.error !== undefined) return failedResult(workspace.name, 'audit unavailable')

    const result = evaluateAuditOutput(workspace.name, audit.stdout)
    if (audit.status !== 0 && result.passed) {
      return { ...result, passed: false, failure: 'audit command failed' }
    }
    return result
  })

  return { passed: results.every((result) => result.passed), results }
}

export function formatAuditGate(gate) {
  const lines = gate.results.map((result) => {
    const counts = SEVERITIES.map(
      (severity) => `${severity}=${result.counts[severity] ?? '?'}`,
    ).join(' ')
    const outcome = result.passed ? 'PASS' : `FAIL (${result.failure})`
    return `[audit:production] ${result.workspace}: ${counts} — ${outcome}`
  })
  lines.push(`[audit:production] release dependency baseline: ${gate.passed ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (import.meta.url === invokedUrl) {
  const gate = runAuditGate()
  console.log(formatAuditGate(gate))
  process.exitCode = gate.passed ? 0 : 1
}
