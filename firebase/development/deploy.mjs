import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { DevelopmentInventoryError, parseDevelopmentInventory } from './environment.mjs'

const DEPLOY_RESOURCES = Object.freeze(['firestore.rules', 'firestore.indexes.json'])

export class DevelopmentDeploymentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DevelopmentDeploymentError'
    this.code = code
  }
}

function deploymentSummary(inventory, status, dryRun) {
  return Object.freeze({
    status,
    ...(dryRun ? { dryRun: true } : {}),
    projectId: inventory.projectId,
    database: '(default)',
    resources: DEPLOY_RESOURCES,
  })
}

export function runDevelopmentDeploy({ environment, args, execute, write }) {
  const mode = args.length === 1 ? args[0] : undefined
  if (mode !== '--dry-run' && mode !== '--apply') {
    throw new DevelopmentDeploymentError(
      'explicit_mode_required',
      'Development deployment requires exactly one of --dry-run or --apply.',
    )
  }

  const inventory = parseDevelopmentInventory(environment)
  if (mode === '--dry-run') {
    const plan = deploymentSummary(inventory, 'ready', true)
    write(JSON.stringify(plan))
    return plan
  }

  const result = execute('firebase', [
    'deploy',
    '--project',
    inventory.projectId,
    '--only',
    'firestore:rules,firestore:indexes',
    '--non-interactive',
  ])
  if (result.status !== 0) {
    throw new DevelopmentDeploymentError(
      'firebase_deploy_failed',
      'Firebase CLI failed to deploy development Firestore Rules or indexes.',
    )
  }

  const summary = deploymentSummary(inventory, 'deployed', false)
  write(JSON.stringify(summary))
  return summary
}

function executeFirebase(command, args) {
  return spawnSync(command, args, { stdio: 'inherit' })
}

function runCli() {
  try {
    runDevelopmentDeploy({
      environment: process.env,
      args: process.argv.slice(2),
      execute: executeFirebase,
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof DevelopmentDeploymentError || error instanceof DevelopmentInventoryError
        ? error.code
        : 'development_deploy_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
