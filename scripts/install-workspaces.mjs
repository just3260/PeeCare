import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const INSTALL_STAGES = [
  { workspace: 'root', directory: PROJECT_ROOT },
  { workspace: 'member-api', directory: resolve(PROJECT_ROOT, 'services/member-api') },
  { workspace: 'ingestion-api', directory: resolve(PROJECT_ROOT, 'services/ingestion-api') },
  { workspace: 'test-tool-api', directory: resolve(PROJECT_ROOT, 'services/test-tool-api') },
]

function installStage(stage) {
  return spawnSync('npm', ['ci'], { cwd: stage.directory, stdio: 'inherit' })
}

export function runWorkspaceInstall({
  stages = INSTALL_STAGES,
  runStage = installStage,
  report = () => {},
} = {}) {
  for (const stage of stages) {
    report({ type: 'start', stage })
    let execution
    try {
      execution = runStage(stage)
    } catch {
      execution = { status: 1 }
    }
    if (execution.status !== 0) {
      const exitCode = Number.isInteger(execution.status) && execution.status > 0 ? execution.status : 1
      report({ type: 'failure', stage, exitCode })
      return { passed: false, exitCode, failedWorkspace: stage.workspace }
    }
    report({ type: 'success', stage })
  }
  return { passed: true, exitCode: 0 }
}

function printInstallEvent(event) {
  const prefix = `[ci:workspaces] workspace=${event.stage.workspace} stage=npm-ci`
  if (event.type === 'start') console.log(`${prefix} — START`)
  if (event.type === 'success') console.log(`${prefix} — PASS`)
  if (event.type === 'failure') console.error(`${prefix} — FAIL (exit ${event.exitCode})`)
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (import.meta.url === invokedUrl) {
  const result = runWorkspaceInstall({ report: printInstallEvent })
  process.exitCode = result.exitCode
}
