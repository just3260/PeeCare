import { pathToFileURL } from 'node:url'

import { DevelopmentInventoryError, parseDevelopmentInventory } from './environment.mjs'
import { DevelopmentReadinessError, runDevelopmentReadiness } from './readiness.mjs'
import { createFirebaseAdminReadinessAdapter } from './readiness-admin-adapter.mjs'

function sanitizedDetail(error) {
  if (typeof error !== 'object' || error === null) return 'unknown_error'
  if ('code' in error && typeof error.code === 'string' && /^[a-z0-9_./-]+$/i.test(error.code)) {
    return error.code
  }
  if ('message' in error && typeof error.message === 'string') {
    const httpStatus = error.message.match(/HTTP [1-5][0-9]{2}/)
    if (httpStatus) return httpStatus[0]
  }
  return error instanceof Error ? error.name : 'unknown_error'
}

async function runCli() {
  try {
    if (process.argv.length !== 2) {
      throw new DevelopmentReadinessError(
        'readiness_config_invalid',
        'Development readiness does not accept positional arguments.',
      )
    }
    const inventory = parseDevelopmentInventory(process.env)
    const adapter = await createFirebaseAdminReadinessAdapter(inventory.projectId)
    await runDevelopmentReadiness({
      environment: process.env,
      adapter,
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof DevelopmentReadinessError || error instanceof DevelopmentInventoryError
        ? error.code
        : 'development_readiness_failed'
    process.stderr.write(
      JSON.stringify({ status: 'error', code, detail: sanitizedDetail(error) }) + '\n',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
