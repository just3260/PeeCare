import { connect } from 'node:net'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const projectId = 'demo-peecare'
const authHost = '127.0.0.1:9099'
const firestoreHost = '127.0.0.1:8085'

export const FIREBASE_SUITES = [
  ['npm', ['exec', '--', 'vitest', 'run', '--config', 'vitest.firebase.config.ts']],
  [
    'npm',
    [
      '--prefix',
      'services/member-api',
      'test',
      '--',
      '--run',
      'test/device-name-firestore.integration.test.ts',
      'test/authenticated-member-flow.integration.test.ts',
    ],
  ],
  [
    'npm',
    [
      '--prefix',
      'services/ingestion-api',
      'test',
      '--',
      '--run',
      'test/firestore-emulator.integration.test.ts',
      'test/device-fixtures.integration.test.ts',
      'test/firestore-event-sink.integration.test.ts',
      'test/end-to-end-ingestion.integration.test.ts',
      'test/test-tool-event-to-projection.integration.test.ts',
    ],
  ],
  [
    'npm',
    [
      '--prefix',
      'services/test-tool-api',
      'test',
      '--',
      '--run',
      'test/test-device-firestore.integration.test.ts',
    ],
  ],
]

function isListening(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

function runSuites() {
  const env = {
    ...process.env,
    FIREBASE_AUTH_EMULATOR_HOST: authHost,
    FIRESTORE_EMULATOR_HOST: firestoreHost,
    GCLOUD_PROJECT: projectId,
  }

  for (const [command, args] of FIREBASE_SUITES) {
    const status = run(command, args, env)
    if (status !== 0) return status
  }
  return 0
}

async function runCli() {
  if (process.argv.includes('--inside-emulators')) {
    process.exitCode = runSuites()
    return
  }
  const [authRunning, firestoreRunning] = await Promise.all([
    isListening('127.0.0.1', 9099),
    isListening('127.0.0.1', 8085),
  ])

  if (authRunning && firestoreRunning) {
    console.log('Using Firebase Auth and Firestore emulators already running for demo-peecare.')
    process.exitCode = runSuites()
  } else if (!authRunning && !firestoreRunning) {
    process.exitCode = run('firebase', [
      'emulators:exec',
      '--project',
      projectId,
      '--only',
      'auth,firestore',
      'node scripts/test-firebase.mjs --inside-emulators',
    ])
  } else {
    console.error(
      'Firebase emulator ports are only partially occupied. Stop the stale emulator process and retry.',
    )
    process.exitCode = 1
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (import.meta.url === invokedUrl) await runCli()
