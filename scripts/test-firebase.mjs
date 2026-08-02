import { connect } from 'node:net'
import { spawnSync } from 'node:child_process'

const projectId = 'demo-peecare'
const authHost = '127.0.0.1:9099'
const firestoreHost = '127.0.0.1:8085'

const suites = [
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

  for (const [command, args] of suites) {
    const status = run(command, args, env)
    if (status !== 0) return status
  }
  return 0
}

if (process.argv.includes('--inside-emulators')) {
  process.exitCode = runSuites()
} else {
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
