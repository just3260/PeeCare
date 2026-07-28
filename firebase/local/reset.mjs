#!/usr/bin/env node
// Deterministic reset of the local Firebase Emulators.
//
// Deletes every Auth Emulator account and every Firestore Emulator document for
// the demo project via the official Emulator REST endpoints. The target is
// validated (exact demo project ID + loopback endpoints) BEFORE any DELETE is
// issued, so a misconfigured run can never touch a non-demo or network-visible
// target. Any unreachable Emulator or non-2xx response fails the whole reset.

import { pathToFileURL } from 'node:url'

/** The only project this reset is ever allowed to touch. */
export const DEMO_PROJECT_ID = 'demo-peecare'

/** The exact destructive endpoints committed in firebase.json. */
const EMULATOR_HOST = '127.0.0.1'
const AUTH_EMULATOR_PORT = 9099
const FIRESTORE_EMULATOR_PORT = 8085

/** Raised for any unsafe target or failed reset step. */
export class ResetError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ResetError'
  }
}

function assertLoopback(host, label) {
  if (host !== EMULATOR_HOST) {
    throw new ResetError(
      `Refusing to reset ${label} on host "${host}"; the Emulator reset only targets ${EMULATOR_HOST}.`,
    )
  }
}

function assertFixedPort(port, expectedPort, label) {
  if (!Number.isInteger(port) || port !== expectedPort) {
    throw new ResetError(
      `Refusing to reset ${label} on port "${port}"; the Emulator reset only targets ${EMULATOR_HOST}:${expectedPort}.`,
    )
  }
}

/**
 * Validate that the reset target is the demo project on the exact committed
 * loopback endpoints.
 * Throws ResetError before any request is issued when the target is unsafe.
 *
 * @param {{ projectId: string, authHost: string, authPort: number, firestoreHost: string, firestorePort: number }} config
 */
export function assertSafeResetTarget(config) {
  if (config.projectId !== DEMO_PROJECT_ID) {
    throw new ResetError(
      `Refusing to reset non-demo project "${config.projectId}"; only ${DEMO_PROJECT_ID} may be reset.`,
    )
  }
  assertLoopback(config.authHost, 'Auth')
  assertFixedPort(config.authPort, AUTH_EMULATOR_PORT, 'Auth')
  assertLoopback(config.firestoreHost, 'Firestore')
  assertFixedPort(config.firestorePort, FIRESTORE_EMULATOR_PORT, 'Firestore')
}

function authAccountsUrl(config) {
  return `http://${config.authHost}:${config.authPort}/emulator/v1/projects/${config.projectId}/accounts`
}

function firestoreDocumentsUrl(config) {
  return `http://${config.firestoreHost}:${config.firestorePort}/emulator/v1/projects/${config.projectId}/databases/(default)/documents`
}

async function deleteEndpoint(fetchImpl, url, label) {
  let response
  try {
    response = await fetchImpl(url, { method: 'DELETE' })
  } catch (cause) {
    throw new ResetError(`${label} Emulator is unreachable at ${url} (${cause.message}).`)
  }
  if (!response.ok) {
    throw new ResetError(
      `${label} Emulator reset failed with status ${response.status} at ${url}.`,
    )
  }
}

/**
 * Reset the demo Emulators. Validates the target first, then deletes Auth
 * accounts and Firestore documents, awaiting both. Resolves with the endpoints
 * that were reset; rejects with ResetError on any unsafe target or failed step.
 *
 * @param {{ projectId: string, authHost: string, authPort: number, firestoreHost: string, firestorePort: number }} config
 * @param {{ fetch: typeof fetch }} deps
 */
export async function runReset(config, deps) {
  assertSafeResetTarget(config)

  const authUrl = authAccountsUrl(config)
  const firestoreUrl = firestoreDocumentsUrl(config)

  await deleteEndpoint(deps.fetch, authUrl, 'Auth')
  await deleteEndpoint(deps.fetch, firestoreUrl, 'Firestore')

  return { auth: authUrl, firestore: firestoreUrl }
}

function configFromEnv(env) {
  return {
    projectId: env.FIREBASE_RESET_PROJECT_ID ?? DEMO_PROJECT_ID,
    authHost: env.FIREBASE_RESET_AUTH_HOST ?? '127.0.0.1',
    authPort: Number(env.FIREBASE_RESET_AUTH_PORT ?? 9099),
    firestoreHost: env.FIREBASE_RESET_FIRESTORE_HOST ?? '127.0.0.1',
    firestorePort: Number(env.FIREBASE_RESET_FIRESTORE_PORT ?? 8085),
  }
}

async function main() {
  const config = configFromEnv(process.env)
  try {
    const summary = await runReset(config, { fetch: globalThis.fetch })
    console.log(`✓ Reset Auth accounts:      ${summary.auth}`)
    console.log(`✓ Reset Firestore documents: ${summary.firestore}`)
    console.log(`✓ Local Firebase reset complete for project ${config.projectId}.`)
  } catch (error) {
    console.error(`✗ Local Firebase reset failed: ${error.message}`)
    process.exitCode = 1
  }
}

// Run only when invoked directly as a CLI, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
