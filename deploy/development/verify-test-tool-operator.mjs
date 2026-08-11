import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  createTestToolSmokeAdapter,
  TestToolVerificationError,
  runTestToolVerification,
} from './verify-test-tool.mjs'
import {
  loadTestToolManifest,
  normalizeRevisionInspection,
} from './deploy-test-tool.mjs'

const APPROVED_PROJECT = 'petcare-c7483'
const APPROVED_REGION = 'asia-east1'
const APPROVED_SERVICE = 'peecare-test-tool-development'
const APPROVED_DEVICE_ID = 'PC-DEV-000001'
const APPROVED_WEB_APP_ID = '1:348528459946:web:3cd4fe2b9140a3e81f10d3'
const APPROVED_SIGNER =
  'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com'

const MUTATING_AUTH_PORT = /^(?:createUser|updateUser|deleteUser|resetPassword|generatePasswordResetLink|revokeRefreshTokens)$/
const REQUIRED_PORTS = Object.freeze([
  'inspectExactTarget',
  'readAssignedDevice',
  'readExistingUser',
  'findExistingForeignUser',
  'createCustomToken',
  'exchangeCustomToken',
  'readInspectedSecret',
  'createSmokeAdapter',
])

export class OperatorVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OperatorVerificationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new OperatorVerificationError(code, message)
}

function validateDependencies(dependencies) {
  if (
    dependencies === null ||
    typeof dependencies !== 'object' ||
    Object.keys(dependencies).some((name) => MUTATING_AUTH_PORT.test(name)) ||
    REQUIRED_PORTS.some((name) => typeof dependencies[name] !== 'function')
  ) {
    fail(
      'operator_adapter_invalid',
      'The one-time operator adapter must expose only the approved existing-identity ports.',
    )
  }
}

function existingUid(value) {
  return value !== null &&
    typeof value === 'object' &&
    typeof value.uid === 'string' &&
    value.uid.length > 0 &&
    value.disabled !== true
    ? value.uid
    : null
}

export function selectExistingForeignUser(ownerUid, users) {
  if (typeof ownerUid !== 'string' || ownerUid.length === 0 || !Array.isArray(users)) {
    return null
  }
  const selected = [...users]
    .filter((user) => existingUid(user) !== null && user.uid !== ownerUid)
    .sort((left, right) => left.uid.localeCompare(right.uid))[0]
  return selected === undefined ? null : Object.freeze({ uid: selected.uid })
}

export function createOperatorRevisionInspector(execute) {
  if (typeof execute !== 'function') {
    fail('operator_adapter_invalid', 'Cloud Run inspection requires an explicit command port.')
  }
  return async ({ projectId, region, service, revision }) => {
    let serviceRecord
    let revisionRecord
    try {
      serviceRecord = JSON.parse(await execute([
        'run', 'services', 'describe', service,
        '--project', projectId, '--region', region, '--format=json',
      ]))
    } catch {
      fail('service_inspection_failed', 'The exact Cloud Run service could not be inspected.')
    }
    try {
      revisionRecord = JSON.parse(await execute([
        'run', 'revisions', 'describe', revision,
        '--project', projectId, '--region', region, '--format=json',
      ]))
    } catch {
      fail('revision_inspection_failed', 'The exact Cloud Run revision could not be inspected.')
    }
    const inspected = normalizeRevisionInspection(
      revisionRecord,
      projectId,
      revision,
    )
    return Object.freeze({
      ready: inspected.ready === true,
      serving:
        serviceRecord?.status?.latestReadyRevisionName === revision &&
        serviceRecord?.status?.traffic?.some(
          (target) => target?.revisionName === revision && target?.percent === 100,
        ) === true,
      projectId,
      region,
      service,
      revision: inspected.revision,
      image: inspected.image,
      runtimeIdentity: inspected.runtimeIdentity,
      serviceUrl: serviceRecord?.status?.url,
      secretRef: inspected.secretRef,
    })
  }
}

function requireProject(requestedProject) {
  if (requestedProject !== APPROVED_PROJECT) {
    fail('target_mismatch', 'The operator adapter refused a foreign project.')
  }
}

function usageLedgerId(ownerUid) {
  return createHash('sha256')
    .update(`${APPROVED_PROJECT}:${ownerUid}`, 'utf8')
    .digest('hex')
}

function firestoreStringField(document, name) {
  const value = document?.fields?.[name]?.stringValue
  return typeof value === 'string' ? value : null
}

export function createOperatorCloudDependencies({
  environment,
  auth,
  readDocument,
  writeExactMarker,
  authorizedJson,
  request,
  execute,
  wait,
}) {
  if (
    auth === null ||
    typeof auth !== 'object' ||
    typeof auth.getUser !== 'function' ||
    typeof auth.listUsers !== 'function' ||
    typeof auth.createCustomToken !== 'function' ||
    typeof readDocument !== 'function' ||
    typeof writeExactMarker !== 'function' ||
    typeof authorizedJson !== 'function' ||
    typeof request !== 'function' ||
    typeof execute !== 'function' ||
    typeof wait !== 'function'
  ) {
    fail('operator_adapter_invalid', 'The operator cloud adapter is incomplete.')
  }

  const inspectRevision = createOperatorRevisionInspector(execute)
  let assignedOwnerUid = null
  let webApiKeyPromise = null

  async function webApiKey() {
    webApiKeyPromise ??= authorizedJson(
      `https://firebase.googleapis.com/v1beta1/projects/-/webApps/${encodeURIComponent(APPROVED_WEB_APP_ID)}/config`,
    ).then((config) => {
      if (
        config?.appId !== APPROVED_WEB_APP_ID ||
        typeof config?.apiKey !== 'string' ||
        config.apiKey.length === 0
      ) {
        fail('token_exchange_failed', 'The approved Firebase Web configuration is unavailable.')
      }
      return config.apiKey
    })
    return webApiKeyPromise
  }

  async function fetchJson(url, options) {
    const response = await request(url, options)
    const body = await response.json().catch(() => null)
    return { response, body }
  }

  async function readAssignedDevice() {
    const device = await readDocument(`devices/${APPROVED_DEVICE_ID}`)
    assignedOwnerUid =
      device !== null &&
      typeof device === 'object' &&
      typeof device.ownerUid === 'string' &&
      device.ownerUid.length > 0
        ? device.ownerUid
        : null
    return device
  }

  async function readExistingUser(uid) {
    try {
      const user = await auth.getUser(uid)
      return existingUid(user) === null
        ? null
        : Object.freeze({ uid: user.uid, ...(user.disabled === true ? { disabled: true } : {}) })
    } catch (error) {
      if (error?.code === 'auth/user-not-found') return null
      throw error
    }
  }

  async function findExistingForeignUser(ownerUid) {
    let pageToken
    const visited = new Set()
    do {
      const page = await auth.listUsers(1000, pageToken)
      const selected = selectExistingForeignUser(ownerUid, page?.users)
      if (selected !== null) return selected
      pageToken = typeof page?.pageToken === 'string' && page.pageToken.length > 0
        ? page.pageToken
        : undefined
      if (pageToken !== undefined && visited.has(pageToken)) {
        fail('foreign_principal_unavailable', 'Firebase Auth pagination did not advance.')
      }
      if (pageToken !== undefined) visited.add(pageToken)
    } while (pageToken !== undefined)
    return null
  }

  async function exchangeCustomToken(customToken) {
    const apiKey = await webApiKey()
    const { response, body } = await fetchJson(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      },
    )
    if (!response.ok || typeof body?.idToken !== 'string' || body.idToken.length === 0) {
      fail('token_exchange_failed', 'Firebase Auth custom-token exchange failed.')
    }
    return body.idToken
  }

  async function readInspectedSecret() {
    const secretRef = environment?.PEECARE_TEST_TOOL_INGESTION_SECRET_REF
    if (typeof secretRef !== 'string' || secretRef.length === 0) {
      fail('invalid_secret_reference', 'The approved numeric secret reference is unavailable.')
    }
    const result = await authorizedJson(
      `https://secretmanager.googleapis.com/v1/${secretRef}:access`,
    )
    const encoded = result?.payload?.data
    if (typeof encoded !== 'string' || encoded.length === 0) {
      fail('operator_verification_failed', 'The inspected secret value is unavailable.')
    }
    const value = Buffer.from(encoded, 'base64').toString('utf8')
    if (value.length === 0) {
      fail('operator_verification_failed', 'The inspected secret value is unavailable.')
    }
    return value
  }

  function createSmokeAdapter({
    inspectedRevision,
    ownerToken,
    foreignToken,
    inspectedSecretValue,
    verificationStartedAt,
  }) {
    return createTestToolSmokeAdapter({
      inspectRevision: async () => inspectedRevision,
      ownerToken,
      foreignToken,
      inspectedSecretValue,
      verificationStartedAt,
      wait,
      async request({ url, method, headers, body }) {
        const result = await fetchJson(url, {
          method,
          redirect: 'error',
          ...(headers ? { headers } : {}),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return {
          status: result.response.status,
          headers: Object.fromEntries(result.response.headers.entries()),
          body: result.body,
        }
      },
      async readDevice({ projectId, deviceId }) {
        requireProject(projectId)
        return readDocument(`devices/${deviceId}`)
      },
      async readLedger({ projectId }) {
        requireProject(projectId)
        if (assignedOwnerUid === null) return null
        return readDocument(`developmentTestToolUsage/${usageLedgerId(assignedOwnerUid)}`)
      },
      async writeMarker({ projectId, deviceId, expectedOwnerUid, marker }) {
        requireProject(projectId)
        return writeExactMarker({
          path: `devices/${deviceId}`,
          expectedOwnerUid,
          marker,
        })
      },
      async readEvent({ projectId, deviceId, eventId }) {
        requireProject(projectId)
        return readDocument(`devices/${deviceId}/events/${eventId}`)
      },
      async readProjection({ projectId, deviceId }) {
        requireProject(projectId)
        return readDocument(`devices/${deviceId}`)
      },
      async verifyWebProjection({ deviceId, urinationEventId, batteryEventId }) {
        const { response, body } = await fetchJson(
          `https://firestore.googleapis.com/v1/projects/${APPROVED_PROJECT}/databases/(default)/documents/devices/${encodeURIComponent(deviceId)}`,
          {
            method: 'GET',
            redirect: 'error',
            headers: { authorization: `Bearer ${ownerToken}`, accept: 'application/json' },
          },
        )
        return response.ok &&
          firestoreStringField(body, 'latestUrinationEventId') === urinationEventId &&
          firestoreStringField(body, 'latestBatteryEventId') === batteryEventId
      },
      async readLogs({ projectId, service, since }) {
        requireProject(projectId)
        const result = await authorizedJson(
          'https://logging.googleapis.com/v2/entries:list',
          {
            method: 'POST',
            body: {
              resourceNames: [`projects/${APPROVED_PROJECT}`],
              filter: [
                'resource.type="cloud_run_revision"',
                `resource.labels.service_name="${service}"`,
                `timestamp>="${since}"`,
              ].join(' AND '),
              orderBy: 'timestamp asc',
              pageSize: 1000,
            },
          },
        )
        return Array.isArray(result?.entries) ? result.entries : []
      },
    })
  }

  return Object.freeze({
    inspectExactTarget: (target) => inspectRevision(target),
    readAssignedDevice,
    readExistingUser,
    findExistingForeignUser,
    createCustomToken: (uid) => auth.createCustomToken(uid),
    exchangeCustomToken,
    readInspectedSecret,
    createSmokeAdapter,
  })
}

export function createEphemeralTokenStore() {
  let protectedMaterial = null
  return Object.freeze({
    hold(value) {
      if (
        value === null ||
        typeof value !== 'object' ||
        Object.values(value).some(
          (token) => typeof token !== 'string' || token.length === 0,
        )
      ) {
        fail('token_exchange_failed', 'The operator token exchange returned no usable token.')
      }
      protectedMaterial = Object.freeze({ ...value })
    },
    use(operation) {
      if (protectedMaterial === null || typeof operation !== 'function') {
        fail('token_exchange_failed', 'Ephemeral operator tokens are unavailable.')
      }
      return operation(protectedMaterial)
    },
    clear() {
      protectedMaterial = null
    },
    hasProtectedMaterial() {
      return protectedMaterial !== null
    },
  })
}

export function createOperatorFirebaseAppOptions(credential) {
  return Object.freeze({
    credential,
    projectId: APPROVED_PROJECT,
    serviceAccountId: APPROVED_SIGNER,
  })
}

export async function runOneTimeOperatorVerification({
  environment,
  args,
  manifest,
  dependencies,
  tokenStore = createEphemeralTokenStore(),
  now = () => new Date(),
  write,
}) {
  validateDependencies(dependencies)
  if (!Array.isArray(args) || args[0] !== '--apply') {
    fail(
      'operator_apply_required',
      'The one-time operator harness requires an explicit apply acknowledgement.',
    )
  }
  if (
    typeof tokenStore?.hold !== 'function' ||
    typeof tokenStore?.use !== 'function' ||
    typeof tokenStore?.clear !== 'function'
  ) {
    fail('operator_adapter_invalid', 'The ephemeral token store is invalid.')
  }

  try {
    const inspectedRevision = await dependencies.inspectExactTarget({
      projectId: APPROVED_PROJECT,
      region: APPROVED_REGION,
      service: APPROVED_SERVICE,
      revision: args[2],
    })
    const device = await dependencies.readAssignedDevice()
    const ownerUid =
      device !== null &&
      typeof device === 'object' &&
      typeof device.ownerUid === 'string' &&
      device.ownerUid.length > 0
        ? device.ownerUid
        : null
    if (ownerUid === null) {
      fail('owner_principal_unavailable', 'The assigned owner account is unavailable.')
    }

    const owner = await dependencies.readExistingUser(ownerUid)
    if (existingUid(owner) !== ownerUid) {
      fail('owner_principal_unavailable', 'The assigned owner account is unavailable.')
    }
    const foreign = await dependencies.findExistingForeignUser(ownerUid)
    const foreignUid = existingUid(foreign)
    if (foreignUid === null || foreignUid === ownerUid) {
      fail('foreign_principal_unavailable', 'An existing foreign account is unavailable.')
    }

    let ownerCustomToken
    let foreignCustomToken
    try {
      const customTokens = await Promise.all([
        dependencies.createCustomToken(ownerUid),
        dependencies.createCustomToken(foreignUid),
      ])
      ownerCustomToken = customTokens[0]
      foreignCustomToken = customTokens[1]
    } catch {
      fail(
        'custom_token_signing_failed',
        'The approved existing signer could not mint short-lived custom tokens.',
      )
    }
    tokenStore.hold({ ownerCustomToken, foreignCustomToken })

    let ownerToken
    let foreignToken
    try {
      const idTokens = await tokenStore.use((tokens) =>
        Promise.all([
          dependencies.exchangeCustomToken(tokens.ownerCustomToken),
          dependencies.exchangeCustomToken(tokens.foreignCustomToken),
        ]),
      )
      ownerToken = idTokens[0]
      foreignToken = idTokens[1]
    } catch {
      fail('token_exchange_failed', 'Short-lived Firebase ID token exchange failed.')
    }
    tokenStore.hold({ ownerToken, foreignToken })
    let inspectedSecretValue
    try {
      inspectedSecretValue = await dependencies.readInspectedSecret()
    } catch {
      fail('secret_inspection_failed', 'The approved secret version could not be inspected.')
    }
    const verificationStartedAt = now()
    if (
      !(verificationStartedAt instanceof Date) ||
      !Number.isFinite(verificationStartedAt.getTime())
    ) {
      fail('verification_clock_invalid', 'Verification requires a valid current time.')
    }

    return await tokenStore.use((tokens) =>
      runTestToolVerification({
        environment,
        args,
        manifest,
        adapter: dependencies.createSmokeAdapter({
          inspectedRevision,
          ownerToken: tokens.ownerToken,
          foreignToken: tokens.foreignToken,
          inspectedSecretValue,
          verificationStartedAt: verificationStartedAt.toISOString(),
        }),
        now,
        write,
      }),
    )
  } catch (error) {
    if (
      error instanceof OperatorVerificationError ||
      error instanceof TestToolVerificationError
    ) {
      throw error
    }
    fail('operator_verification_failed', 'The one-time operator verification failed.')
  } finally {
    tokenStore.clear()
  }
}

function executeGcloud(args) {
  const result = spawnSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.status !== 0) {
    fail('cloud_inspection_failed', 'The exact Cloud Run target could not be inspected.')
  }
  return result.stdout.trim()
}

export async function createOneTimeOperatorCliDependencies(environment = process.env) {
  if (
    typeof environment.GOOGLE_APPLICATION_CREDENTIALS === 'string' &&
    environment.GOOGLE_APPLICATION_CREDENTIALS.trim().length > 0
  ) {
    fail(
      'operator_adapter_invalid',
      'The one-time operator harness requires user Application Default Credentials without a key file.',
    )
  }
  const [appModule, authModule, firestoreModule] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore'),
  ])
  const credential = appModule.applicationDefault()
  const appName = 'peecare-test-tool-one-time-operator'
  const app =
    appModule.getApps().find((candidate) => candidate.name === appName) ??
    appModule.initializeApp(
      createOperatorFirebaseAppOptions(credential),
      appName,
    )
  const auth = authModule.getAuth(app)
  const firestore = firestoreModule.getFirestore(app)

  async function authorizedJson(url, options = {}) {
    const accessToken = await credential.getAccessToken()
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${accessToken.access_token}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'x-goog-user-project': APPROVED_PROJECT,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    })
    if (!response.ok) {
      fail('cloud_inspection_failed', 'An approved Google Cloud resource could not be read.')
    }
    return response.json()
  }

  async function readDocument(path) {
    const snapshot = await firestore.doc(path).get()
    return snapshot.exists ? snapshot.data() : null
  }

  async function writeExactMarker({ path, expectedOwnerUid, marker }) {
    await firestore.runTransaction(async (transaction) => {
      const reference = firestore.doc(path)
      const snapshot = await transaction.get(reference)
      const data = snapshot.exists ? snapshot.data() : null
      if (
        data === null ||
        data.ownerUid !== expectedOwnerUid ||
        data.developmentTestTool !== undefined
      ) {
        fail('marker_precondition_failed', 'The exact beta marker precondition failed.')
      }
      transaction.update(reference, { developmentTestTool: marker })
    })
  }

  return createOperatorCloudDependencies({
    environment,
    auth,
    readDocument,
    writeExactMarker,
    authorizedJson,
    request: fetch,
    execute: executeGcloud,
    wait: (milliseconds) =>
      new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
  })
}

function hasExactOperatorArguments(args) {
  return Array.isArray(args) &&
    args.length === 5 &&
    args[0] === '--apply' &&
    args[1] === '--revision' &&
    args[3] === '--image'
}

export async function runOneTimeOperatorVerificationCli({
  args = process.argv.slice(2),
  environment = process.env,
  createDependencies = createOneTimeOperatorCliDependencies,
  write = (line) => process.stdout.write(`${line}\n`),
  writeError = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  try {
    if (!hasExactOperatorArguments(args)) {
      fail(
        'operator_apply_required',
        'The one-time operator harness requires exact apply, revision, and image arguments.',
      )
    }
    const manifest = loadTestToolManifest()
    await runTestToolVerification({
      environment,
      args: ['--dry-run', ...args.slice(1)],
      manifest,
      adapter: Object.freeze({}),
      write: () => undefined,
    })
    const dependencies = await createDependencies(environment)
    return await runOneTimeOperatorVerification({
      environment,
      args,
      manifest,
      dependencies,
      write,
    })
  } catch (error) {
    const code =
      error instanceof OperatorVerificationError ||
      error instanceof TestToolVerificationError
        ? error.code
        : 'operator_verification_failed'
    const result = Object.freeze({ status: 'error', code })
    writeError(JSON.stringify(result))
    return result
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runOneTimeOperatorVerificationCli()
  if (result?.status === 'error') process.exitCode = 1
}
