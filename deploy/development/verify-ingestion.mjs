import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { loadIngestionManifest } from './deploy-ingestion.mjs'

const APPROVED_PROJECT = 'petcare-c7483'
const APPROVED_REGION = 'asia-east1'
const APPROVED_SERVICE = 'peecare-ingestion-development'
const DEVICE_ID = 'PC-DEV-0001'
const REVISION_PATTERN = /^peecare-ingestion-development-[0-9]{5}-[a-z0-9]{3}$/

export class IngestionVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IngestionVerificationError'
    this.code = code
  }
}

function parseArguments(args) {
  if (
    args.length !== 2 ||
    args[0] !== '--revision' ||
    !REVISION_PATTERN.test(args[1])
  ) {
    throw new IngestionVerificationError(
      'exact_revision_required',
      'Verification requires --revision with an exact development ingestion revision name.',
    )
  }
  return args[1]
}

function validateEnvironment(environment) {
  if (
    environment.PEECARE_DEVELOPMENT_PROJECT_ID !== APPROVED_PROJECT ||
    environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== APPROVED_REGION
  ) {
    throw new IngestionVerificationError(
      'target_mismatch',
      'Verification inventory must match the approved development project and region.',
    )
  }
  const secretRef = environment.PEECARE_INGESTION_SECRET_CURRENT_REF
  if (
    typeof secretRef !== 'string' ||
    !/^projects\/(?:petcare-c7483|348528459946)\/secrets\/[a-zA-Z0-9_-]+\/versions\/[1-9][0-9]*$/.test(
      secretRef,
    )
  ) {
    throw new IngestionVerificationError(
      'invalid_secret_reference',
      'Verification requires a numeric current Secret Manager version reference.',
    )
  }
  return secretRef
}

function assertInspectedRevision(inspected, revision, manifest, requireServing = false) {
  if (
    inspected.ready !== true ||
    (requireServing && inspected.serving !== true) ||
    inspected.projectId !== manifest.metadata.projectId ||
    inspected.region !== manifest.metadata.region ||
    inspected.service !== manifest.metadata.service ||
    inspected.revision !== revision ||
    inspected.runtimeIdentity !== manifest.runtimeIdentity.serviceAccount ||
    typeof inspected.image !== 'string' ||
    !new RegExp(manifest.image.digestPattern).test(inspected.image)
  ) {
    throw new IngestionVerificationError(
      'revision_mismatch',
      'Inspected Cloud Run revision does not match the approved immutable deployment.',
    )
  }
  let serviceUrl
  try {
    serviceUrl = new URL(inspected.serviceUrl)
  } catch {
    throw new IngestionVerificationError(
      'revision_mismatch',
      'Inspected Cloud Run service URL is invalid.',
    )
  }
  if (serviceUrl.protocol !== 'https:' || serviceUrl.pathname !== '/') {
    throw new IngestionVerificationError(
      'revision_mismatch',
      'Inspected Cloud Run service URL must be an HTTPS origin.',
    )
  }
  return serviceUrl.origin
}

function urinationFixture(now, eventId) {
  return Object.freeze({
    topic: `products/pc-mini/devices/${DEVICE_ID}/events/urination`,
    clientId: DEVICE_ID,
    username: 'development-smoke',
    qos: 1,
    retained: false,
    brokerReceivedAtMs: now,
    payload: Object.freeze({
      schemaVersion: 1,
      eventId,
      eventType: 'urination',
      deviceId: DEVICE_ID,
      sequence: 1,
      recordedAtMs: now - 1_000,
      firmwareVersion: '1.0.0',
      flushDurationMs: 1_000,
      pumpDurationMs: 2_000,
    }),
  })
}

function batteryFixture(now, eventId) {
  return Object.freeze({
    topic: `products/pc-mini/devices/${DEVICE_ID}/status/battery`,
    clientId: DEVICE_ID,
    username: 'development-smoke',
    qos: 1,
    retained: false,
    brokerReceivedAtMs: now,
    payload: Object.freeze({
      schemaVersion: 1,
      eventId,
      eventType: 'battery',
      deviceId: DEVICE_ID,
      sequence: 2,
      recordedAtMs: now - 1_000,
      firmwareVersion: '1.0.0',
      batteryLevelPercent: 75,
      batteryVoltageMv: 3_975,
    }),
  })
}

function asiaTaipeiDayKey(epochMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epochMs)
  const value = (type) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function assertEventFields(actual, expected) {
  return Object.entries(expected).every(([name, value]) => actual?.[name] === value)
}

function assertSmokeResponse(condition, message) {
  if (!condition) throw new IngestionVerificationError('smoke_failed', message)
}

async function validatePriorHealthyRelease(priorRelease, activeRevision, manifest, adapter) {
  if (priorRelease === undefined) return null
  if (
    priorRelease?.status !== 'healthy' ||
    priorRelease.projectId !== manifest.metadata.projectId ||
    priorRelease.region !== manifest.metadata.region ||
    priorRelease.service !== manifest.metadata.service ||
    !REVISION_PATTERN.test(priorRelease.revision) ||
    priorRelease.revision === activeRevision ||
    !/^sha256:[0-9a-f]{64}$/.test(priorRelease.imageDigest)
  ) {
    throw new IngestionVerificationError(
      'rollback_target_invalid',
      'Prior release must be a healthy immutable revision of the same approved service.',
    )
  }
  const inspected = await adapter.inspectRevision({
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision: priorRelease.revision,
  })
  assertInspectedRevision(inspected, priorRelease.revision, manifest)
  if (inspected.image.slice(inspected.image.lastIndexOf('@') + 1) !== priorRelease.imageDigest) {
    throw new IngestionVerificationError(
      'rollback_target_invalid',
      'Prior release digest does not match the inspected immutable revision.',
    )
  }
  return Object.freeze({
    revision: priorRelease.revision,
    imageDigest: priorRelease.imageDigest,
  })
}

export async function runIngestionVerification({
  environment,
  args,
  manifest,
  adapter,
  priorRelease,
  now = Date.now,
  createRunId = randomUUID,
  write,
}) {
  const revision = parseArguments(args)
  const secretRef = validateEnvironment(environment)
  const inspected = await adapter.inspectRevision({
    projectId: APPROVED_PROJECT,
    region: APPROVED_REGION,
    service: APPROVED_SERVICE,
    revision,
  })
  const serviceUrl = assertInspectedRevision(inspected, revision, manifest, true)
  const priorHealthyRevision = await validatePriorHealthyRelease(
    priorRelease,
    revision,
    manifest,
    adapter,
  )
  const smokeNow = now()
  const runId = createRunId()
  const eventId = `${DEVICE_ID}:smoke-urination-${smokeNow}-${runId}`
  const batteryEventId = `${DEVICE_ID}:smoke-battery-${smokeNow}-${runId}`
  const fixture = urinationFixture(smokeNow, eventId)
  const battery = batteryFixture(smokeNow, batteryEventId)
  const dayKey = asiaTaipeiDayKey(fixture.payload.recordedAtMs)
  const requestOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: fixture,
  }
  const [health, unauthorized, baselineState] = await Promise.all([
    adapter.request({ method: 'GET', url: `${serviceUrl}/health` }),
    adapter.request({
      ...requestOptions,
      url: `${serviceUrl}/v1/emqx/events`,
    }),
    adapter.readSmokeState({
      projectId: APPROVED_PROJECT,
      deviceId: DEVICE_ID,
      eventIds: [eventId, batteryEventId],
      dayKey,
    }),
  ])
  assertSmokeResponse(
    health.status === 200 && health.body?.status === 'ok',
    'Public health smoke check failed.',
  )
  assertSmokeResponse(
    unauthorized.status === 401 && unauthorized.body?.error?.code === 'unauthorized',
    'Unauthenticated webhook smoke check failed.',
  )
  assertSmokeResponse(
    baselineState?.projectId === APPROVED_PROJECT &&
      baselineState.events?.[eventId] === null &&
      baselineState.events?.[batteryEventId] === null,
    'Smoke event IDs already exist or baseline state is outside the approved project.',
  )

  const secret = await adapter.accessSecret(secretRef)
  assertSmokeResponse(
    typeof secret === 'string' && secret.length > 0,
    'Current webhook secret could not be accessed.',
  )
  const authenticated = await adapter.request({
    ...requestOptions,
    url: `${serviceUrl}/v1/emqx/events`,
    headers: {
      ...requestOptions.headers,
      authorization: `Bearer ${secret}`,
    },
  })
  assertSmokeResponse(
    authenticated.status === 201 && authenticated.body?.eventId === eventId,
    'Authenticated webhook smoke check failed.',
  )

  const storedEvent = await adapter.readEvent({
    projectId: APPROVED_PROJECT,
    deviceId: DEVICE_ID,
    eventId,
  })
  assertSmokeResponse(
    storedEvent?.projectId === APPROVED_PROJECT &&
      storedEvent.path === `devices/${DEVICE_ID}/events/${eventId}` &&
      storedEvent.data?.eventId === eventId &&
      storedEvent.data?.deviceId === DEVICE_ID &&
      storedEvent.data?.eventType === 'urination',
    'Authenticated fixture was not found in the approved development Firestore project.',
  )

  const afterUrinationFirst = await adapter.readSmokeState({
    projectId: APPROVED_PROJECT,
    deviceId: DEVICE_ID,
    eventIds: [eventId, batteryEventId],
    dayKey,
  })
  const urinationReplay = await adapter.request({
    ...requestOptions,
    url: `${serviceUrl}/v1/emqx/events`,
    headers: {
      ...requestOptions.headers,
      authorization: `Bearer ${secret}`,
    },
  })
  const afterUrinationReplay = await adapter.readSmokeState({
    projectId: APPROVED_PROJECT,
    deviceId: DEVICE_ID,
    eventIds: [eventId, batteryEventId],
    dayKey,
  })
  assertSmokeResponse(
    urinationReplay.status === 200 && urinationReplay.body?.eventId === eventId,
    'Urination replay did not return the duplicate response.',
  )
  assertSmokeResponse(
    isDeepStrictEqual(afterUrinationFirst, afterUrinationReplay),
    'Urination replay changed Firestore state.',
  )

  const batteryRequest = {
    method: 'POST',
    url: `${serviceUrl}/v1/emqx/events`,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: battery,
  }
  const batteryFirst = await adapter.request(batteryRequest)
  const afterBatteryFirst = await adapter.readSmokeState({
    projectId: APPROVED_PROJECT,
    deviceId: DEVICE_ID,
    eventIds: [eventId, batteryEventId],
    dayKey,
  })
  const batteryReplay = await adapter.request(batteryRequest)
  const afterBatteryReplay = await adapter.readSmokeState({
    projectId: APPROVED_PROJECT,
    deviceId: DEVICE_ID,
    eventIds: [eventId, batteryEventId],
    dayKey,
  })
  assertSmokeResponse(
    batteryFirst.status === 201 && batteryFirst.body?.eventId === batteryEventId,
    'Battery first delivery did not create an event.',
  )
  assertSmokeResponse(
    batteryReplay.status === 200 && batteryReplay.body?.eventId === batteryEventId,
    'Battery replay did not return the duplicate response.',
  )
  assertSmokeResponse(
    isDeepStrictEqual(afterBatteryFirst, afterBatteryReplay),
    'Battery replay changed Firestore state.',
  )

  const baselineCount = baselineState.daily?.urinationCount ?? 0
  assertSmokeResponse(
    Number.isSafeInteger(baselineCount) &&
      afterUrinationFirst?.projectId === APPROVED_PROJECT &&
      afterBatteryFirst?.projectId === APPROVED_PROJECT &&
      assertEventFields(afterUrinationFirst.events?.[eventId], fixture.payload) &&
      afterUrinationFirst.device?.latestUrinationEventId === eventId &&
      afterUrinationFirst.daily?.urinationCount === baselineCount + 1 &&
      assertEventFields(afterBatteryFirst.events?.[batteryEventId], battery.payload) &&
      afterBatteryFirst.device?.latestBatteryEventId === batteryEventId &&
      afterBatteryFirst.daily?.urinationCount === baselineCount + 1,
    'Durable event documents, latest projections, or daily urination count are incorrect.',
  )

  const summary = Object.freeze({
    status: 'healthy',
    projectId: APPROVED_PROJECT,
    region: APPROVED_REGION,
    service: APPROVED_SERVICE,
    revision,
    imageDigest: inspected.image.slice(inspected.image.lastIndexOf('@') + 1),
    runtimeIdentity: inspected.runtimeIdentity,
    eventId,
    ...(priorHealthyRevision ? { priorHealthyRevision } : {}),
    checks: Object.freeze({
      health: health.status,
      unauthenticated: unauthorized.status,
      authenticated: authenticated.status,
      firestore: 'verified',
      durableEvents: Object.freeze({
        urination: Object.freeze([authenticated.status, urinationReplay.status]),
        battery: Object.freeze([batteryFirst.status, batteryReplay.status]),
        immutableEventCount: 2,
        urinationCountDelta: 1,
        duplicateWrites: 0,
      }),
    }),
  })
  write(JSON.stringify(summary))
  return summary
}

export async function runIngestionRollback({
  args,
  manifest,
  releaseRecord,
  inspectRevision,
  executeTrafficMutation: _executeTrafficMutation,
  write,
}) {
  const target = releaseRecord?.priorHealthyRevision
  if (
    args.length !== 1 ||
    args[0] !== '--rollback-dry-run' ||
    releaseRecord?.status !== 'healthy' ||
    releaseRecord.projectId !== manifest.metadata.projectId ||
    releaseRecord.region !== manifest.metadata.region ||
    releaseRecord.service !== manifest.metadata.service ||
    !REVISION_PATTERN.test(releaseRecord.revision) ||
    target === null ||
    typeof target !== 'object' ||
    !REVISION_PATTERN.test(target.revision) ||
    target.revision === releaseRecord.revision ||
    !/^sha256:[0-9a-f]{64}$/.test(target.imageDigest)
  ) {
    throw new IngestionVerificationError(
      'rollback_target_invalid',
      'Rollback requires a same-service healthy release record with an exact prior immutable revision.',
    )
  }
  const inspected = await inspectRevision({
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision: target.revision,
  })
  assertInspectedRevision(inspected, target.revision, manifest)
  if (inspected.image.slice(inspected.image.lastIndexOf('@') + 1) !== target.imageDigest) {
    throw new IngestionVerificationError(
      'rollback_target_invalid',
      'Rollback target digest does not match the inspected revision.',
    )
  }

  const command = Object.freeze({
    executable: 'gcloud',
    args: Object.freeze([
      'run',
      'services',
      'update-traffic',
      manifest.metadata.service,
      '--project',
      manifest.metadata.projectId,
      '--region',
      manifest.metadata.region,
      '--to-revisions',
      `${target.revision}=100`,
      '--quiet',
    ]),
  })
  const plan = Object.freeze({
    status: 'ready',
    dryRun: true,
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    currentRevision: releaseRecord.revision,
    targetRevision: target.revision,
    imageDigest: target.imageDigest,
    command,
  })
  write(JSON.stringify(plan))
  return plan
}

function executeGcloud(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new IngestionVerificationError(
      'cloud_inspection_failed',
      'gcloud could not inspect the development ingestion deployment.',
    )
  }
  return result.stdout.trim()
}

function parseSecretReference(reference) {
  const segments = reference.split('/')
  return { projectId: segments[1], secret: segments[3], version: segments[5] }
}

export function createCliVerificationAdapter() {
  const firestoreClients = new Map()
  async function firestoreFor(projectId) {
    const existing = firestoreClients.get(projectId)
    if (existing) return existing
    const { Firestore } = await import('@google-cloud/firestore')
    const firestore = new Firestore({ projectId })
    firestoreClients.set(projectId, firestore)
    return firestore
  }
  return Object.freeze({
    async inspectRevision({ projectId, region, service, revision }) {
      const serviceRecord = JSON.parse(
        executeGcloud([
          'run',
          'services',
          'describe',
          service,
          '--project',
          projectId,
          '--region',
          region,
          '--format=json',
        ]),
      )
      const revisionRecord = JSON.parse(
        executeGcloud([
          'run',
          'revisions',
          'describe',
          revision,
          '--project',
          projectId,
          '--region',
          region,
          '--format=json',
        ]),
      )
      const serving =
        serviceRecord.status?.latestReadyRevisionName === revision &&
        serviceRecord.status?.traffic?.some(
          (target) => target.revisionName === revision && target.percent === 100,
        )
      const ready = revisionRecord.status?.conditions?.some(
          (condition) => condition.type === 'Ready' && condition.status === 'True',
        )
      return {
        ready: Boolean(ready),
        serving: Boolean(serving),
        projectId,
        region,
        service,
        revision: revisionRecord.metadata?.name,
        image: revisionRecord.spec?.containers?.[0]?.image,
        runtimeIdentity: revisionRecord.spec?.serviceAccountName,
        serviceUrl: serviceRecord.status?.url,
      }
    },
    async accessSecret(reference) {
      const { projectId, secret, version } = parseSecretReference(reference)
      return executeGcloud([
        'secrets',
        'versions',
        'access',
        version,
        '--secret',
        secret,
        '--project',
        projectId,
      ])
    },
    async request({ url, method, headers, body }) {
      const response = await fetch(url, {
        method,
        ...(headers ? { headers } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const responseBody = await response.json().catch(() => null)
      return { status: response.status, body: responseBody }
    },
    async readEvent({ projectId, deviceId, eventId }) {
      const firestore = await firestoreFor(projectId)
      const path = `devices/${deviceId}/events/${eventId}`
      const snapshot = await firestore.doc(path).get()
      return snapshot.exists ? { projectId, path, data: snapshot.data() } : null
    },
    async readSmokeState({ projectId, deviceId, eventIds, dayKey }) {
      const firestore = await firestoreFor(projectId)
      const devicePath = `devices/${deviceId}`
      const [device, daily, ...events] = await Promise.all([
        firestore.doc(devicePath).get(),
        firestore.doc(`${devicePath}/dailyStats/${dayKey}`).get(),
        ...eventIds.map((eventId) =>
          firestore.doc(`${devicePath}/events/${eventId}`).get(),
        ),
      ])
      return {
        projectId,
        device: device.exists ? device.data() : null,
        events: Object.fromEntries(
          eventIds.map((eventId, index) => [
            eventId,
            events[index].exists ? events[index].data() : null,
          ]),
        ),
        daily: daily.exists ? daily.data() : null,
      }
    },
  })
}

async function runCli() {
  try {
    if (process.argv[2] === '--rollback-dry-run') {
      const recordPath = process.env.PEECARE_INGESTION_RELEASE_RECORD
      if (typeof recordPath !== 'string' || recordPath.trim().length === 0) {
        throw new IngestionVerificationError(
          'rollback_target_invalid',
          'PEECARE_INGESTION_RELEASE_RECORD is required for rollback dry-run.',
        )
      }
      const releaseRecord = JSON.parse(readFileSync(resolve(recordPath), 'utf8'))
      const adapter = createCliVerificationAdapter()
      await runIngestionRollback({
        args: ['--rollback-dry-run'],
        manifest: loadIngestionManifest(),
        releaseRecord,
        inspectRevision: (input) => adapter.inspectRevision(input),
        executeTrafficMutation: () => {
          throw new IngestionVerificationError(
            'rollback_target_invalid',
            'Rollback dry-run must not execute a traffic mutation.',
          )
        },
        write: (line) => process.stdout.write(`${line}\n`),
      })
      return
    }
    const priorRecordPath = process.env.PEECARE_INGESTION_PRIOR_RELEASE_RECORD
    const priorRelease =
      typeof priorRecordPath === 'string' && priorRecordPath.trim().length > 0
        ? JSON.parse(readFileSync(resolve(priorRecordPath), 'utf8'))
        : undefined
    await runIngestionVerification({
      environment: process.env,
      args: process.argv.slice(2),
      manifest: loadIngestionManifest(),
      adapter: createCliVerificationAdapter(),
      priorRelease,
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof IngestionVerificationError
        ? error.code
        : 'ingestion_verification_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
