import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  loadBuildManifest,
  validateEmbeddedAssets,
  validatePinnedBuildTooling,
} from './test-tool-macos-build.mjs'

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
  'scripts/test-tool-macos-build.json',
  'scripts/test-tool-macos-build.mjs',
  'scripts/test-tool-macos-verify.mjs',
  'scripts/TEST_TOOL_MACOS_RUNBOOK.md',
]

const PACKAGING_PRIVACY_FILES = Object.freeze([
  'scripts/test-tool-operator-entry.mjs',
  'scripts/test-tool-operator.mjs',
  'scripts/test-tool.mjs',
  'scripts/test-tool-macos-build.mjs',
  'scripts/test-tool-macos-verify.mjs',
  'scripts/test-tool-macos-build.json',
  'scripts/test-tool.html',
  'scripts/machine.png',
  'scripts/dog.png',
])

const LOCKFILE_DRIFT_STAGE = { name: 'lockfile:drift', workspace: 'repository' }

export const RELEASE_STAGES = [
  {
    name: 'check:all',
    workspace: 'repository',
    command: 'npm',
    args: ['run', 'check:all'],
  },
  {
    name: 'test-tool:source-boundary',
    workspace: 'repository',
    run: runPackagingSourceGate,
  },
  {
    name: 'audit:production',
    workspace: 'root,member-api,ingestion-api,test-tool-api',
    command: process.execPath,
    args: [resolve(PROJECT_ROOT, 'scripts/audit-production-dependencies.mjs')],
  },
]

export function scanPackagingPrivacy(files) {
  if (!Array.isArray(files)) return ['privacy_input_invalid']
  const findings = []
  for (const file of files) {
    if (typeof file?.path !== 'string' || !Buffer.isBuffer(file.bytes)) {
      findings.push('privacy_input_invalid')
      continue
    }
    const text = file.bytes.toString('utf8')
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text) ||
      /"private_key"\s*:\s*"[^"\n]+"/u.test(text) ||
      /ya29\.[A-Za-z0-9_-]{16,}/u.test(text) ||
      /Authorization:\s*Bearer\s+[A-Za-z0-9_-]{16,}/u.test(text)
    ) {
      findings.push(file.path)
    }
  }
  return [...new Set(findings)].sort()
}

export function runPackagingSourceGate() {
  try {
    const manifest = loadBuildManifest()
    const packageLock = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package-lock.json'), 'utf8'))
    validatePinnedBuildTooling(manifest, packageLock)
    validateEmbeddedAssets(new Map(
      manifest.assets.map((asset) => [
        asset.key,
        readFileSync(resolve(PROJECT_ROOT, asset.source)),
      ]),
    ))
    const findings = scanPackagingPrivacy(
      PACKAGING_PRIVACY_FILES.map((path) => ({
        path,
        bytes: readFileSync(resolve(PROJECT_ROOT, path)),
      })),
    )
    return { status: findings.length === 0 ? 0 : 1 }
  } catch {
    return { status: 1 }
  }
}

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
