import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const RELEASE_TRACKED_FILES = [
  'package.json',
  'package-lock.json',
  'services/member-api/package.json',
  'services/member-api/package-lock.json',
  'services/ingestion-api/package.json',
  'services/ingestion-api/package-lock.json',
  'services/test-tool-api/package.json',
  'services/test-tool-api/package-lock.json',
]

const LOCKFILE_DRIFT_STAGE = { name: 'lockfile:drift', workspace: 'repository' }

export const RELEASE_STAGES = [
  {
    name: 'check:all',
    workspace: 'repository',
    command: 'npm',
    args: ['run', 'check:all'],
  },
  {
    name: 'audit:production',
    workspace: 'root,member-api,ingestion-api,test-tool-api',
    command: process.execPath,
    args: [resolve(PROJECT_ROOT, 'scripts/audit-production-dependencies.mjs')],
  },
]

function executeStage(stage) {
  return spawnSync(stage.command, stage.args, { cwd: PROJECT_ROOT, stdio: 'inherit' })
}

function failureExitCode(status) {
  return Number.isInteger(status) && status > 0 ? status : 1
}

function captureReleaseFileState() {
  return new Map(
    RELEASE_TRACKED_FILES.map((path) => {
      const digest = createHash('sha256').update(readFileSync(resolve(PROJECT_ROOT, path))).digest('hex')
      return [path, digest]
    }),
  )
}

function fileStatesMatch(before, after) {
  if (before.size !== after.size) return false
  return [...before].every(([path, digest]) => after.get(path) === digest)
}

export function runReleaseGate({
  stages = RELEASE_STAGES,
  runStage = executeStage,
  report = () => {},
  captureFileState = captureReleaseFileState,
} = {}) {
  let initialFileState
  try {
    initialFileState = captureFileState()
  } catch {
    report({ type: 'failure', stage: LOCKFILE_DRIFT_STAGE, exitCode: 1 })
    return {
      passed: false,
      exitCode: 1,
      failedStage: LOCKFILE_DRIFT_STAGE.name,
      failedWorkspace: LOCKFILE_DRIFT_STAGE.workspace,
    }
  }

  for (const stage of stages) {
    report({ type: 'start', stage })
    let execution
    try {
      execution = typeof stage.run === 'function' ? stage.run() : runStage(stage)
    } catch {
      execution = { status: 1 }
    }

    if (execution.status !== 0) {
      const exitCode = failureExitCode(execution.status)
      report({ type: 'failure', stage, exitCode })
      return {
        passed: false,
        exitCode,
        failedStage: stage.name,
        failedWorkspace: stage.workspace,
      }
    }
    report({ type: 'success', stage })
  }

  let finalFileState
  try {
    finalFileState = captureFileState()
  } catch {
    finalFileState = new Map()
  }
  if (!fileStatesMatch(initialFileState, finalFileState)) {
    report({ type: 'failure', stage: LOCKFILE_DRIFT_STAGE, exitCode: 1 })
    return {
      passed: false,
      exitCode: 1,
      failedStage: LOCKFILE_DRIFT_STAGE.name,
      failedWorkspace: LOCKFILE_DRIFT_STAGE.workspace,
    }
  }
  report({ type: 'success', stage: LOCKFILE_DRIFT_STAGE })

  return { passed: true, exitCode: 0 }
}

function printReleaseEvent(event) {
  const prefix = `[check:release] workspace=${event.stage.workspace} stage=${event.stage.name}`
  if (event.type === 'start') console.log(`${prefix} — START`)
  if (event.type === 'success') console.log(`${prefix} — PASS`)
  if (event.type === 'failure') console.error(`${prefix} — FAIL (exit ${event.exitCode})`)
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (import.meta.url === invokedUrl) {
  const result = runReleaseGate({ report: printReleaseEvent })
  process.exitCode = result.exitCode
}
