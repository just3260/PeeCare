import { pathToFileURL } from 'node:url'

import { DevelopmentInventoryError, parseDevelopmentInventory } from './environment.mjs'

export function runDevelopmentPreflight({ environment, args, write, mutation: _mutation }) {
  if (args.length !== 1 || args[0] !== '--dry-run') {
    throw new DevelopmentInventoryError(
      'invalid_inventory',
      'Development preflight requires the explicit --dry-run flag.',
    )
  }

  const inventory = parseDevelopmentInventory(environment)
  const plan = Object.freeze({
    status: 'ready',
    dryRun: true,
    projectId: inventory.projectId,
    firestoreRegion: inventory.firestoreRegion,
    authProvider: inventory.authProvider,
    services: ['auth', 'firestore'],
    operations: ['deploy-firestore-rules', 'deploy-firestore-indexes'],
  })
  write(JSON.stringify(plan))
  return plan
}

function runCli() {
  try {
    runDevelopmentPreflight({
      environment: process.env,
      args: process.argv.slice(2),
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code = error instanceof DevelopmentInventoryError ? error.code : 'preflight_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
