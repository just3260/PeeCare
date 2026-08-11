import { pathToFileURL } from 'node:url'

import { loadTestToolManifest } from './deploy-test-tool.mjs'

const APPROVED_PROJECT = 'petcare-c7483'
const APPROVED_REGION = 'asia-east1'
const APPROVED_SERVICE = 'peecare-test-tool-development'
const APPROVED_WEB_ORIGIN = 'https://petcare-c7483.web.app'
const APPROVED_SERVICE_ORIGIN =
  'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app'
const APPROVED_DEVICE_ID = 'PC-DEV-000001'
const APPROVED_PRODUCT_MODEL = 'pc-mini'
const APPROVED_IDENTITY =
  'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com'
const REVISION_PATTERN = /^peecare-test-tool-development-[0-9]{5}-[a-z0-9]{3}$/
const IMAGE_PATTERN =
  /^asia-east1-docker\.pkg\.dev\/petcare-c7483\/peecare\/test-tool-api@sha256:[0-9a-f]{64}$/
const SECRET_PATTERN =
  /^projects\/(?:petcare-c7483|348528459946)\/secrets\/peecare-emqx-webhook-current\/versions\/[1-9][0-9]*$/
const EVENT_ID_PATTERN =
  /^tt:PC-DEV-000001:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const DEVELOPMENT_MARKER = 'petcare-c7483-beta-v1'

const PRE_MARKER_CHECKS = Object.freeze([
  ['publicHealth', 'checkPublicHealth'],
  ['exactCors', 'checkExactCors'],
  ['unauthorizedZeroWrite', 'checkUnauthorizedZeroWrite'],
  ['unmarkedDeviceDenial', 'checkUnmarkedDeviceDenial'],
])
const POST_MARKER_CHECKS = Object.freeze([
  ['foreignDeviceDenial', 'checkForeignDeviceDenial'],
  ['urinationStored', 'checkUrinationStored'],
  ['batteryStored', 'checkBatteryStored'],
  ['rateLimit', 'checkRateLimit'],
  ['firestoreProjection', 'checkFirestoreProjection'],
  ['webProjection', 'checkWebProjection'],
  ['logPrivacy', 'checkLogPrivacy'],
])
const CHECK_NAMES = Object.freeze([
  'publicHealth',
  'exactCors',
  'unauthorizedZeroWrite',
  'foreignDeviceDenial',
  'unmarkedDeviceDenial',
  'urinationStored',
  'batteryStored',
  'rateLimit',
  'firestoreProjection',
  'webProjection',
  'logPrivacy',
])

export class TestToolVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TestToolVerificationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new TestToolVerificationError(code, message)
}

function parseArguments(args) {
  if (
    args.length !== 5 ||
    !['--dry-run', '--apply'].includes(args[0]) ||
    args[1] !== '--revision' ||
    args[3] !== '--image'
  ) fail('explicit_mode_required', 'Verification requires an explicit mode, revision, and image.')
  return { mode: args[0], revision: args[2], image: args[4] }
}

function validateInputs(environment, manifest, parsed) {
  if (JSON.stringify(manifest) !== JSON.stringify(loadTestToolManifest())) {
    fail('target_mismatch', 'Verification manifest does not match the approved service.')
  }
  if (
    environment.PEECARE_DEVELOPMENT_PROJECT_ID !== APPROVED_PROJECT ||
    environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== APPROVED_REGION ||
    environment.PEECARE_DEVELOPMENT_WEB_ORIGIN !== APPROVED_WEB_ORIGIN
  ) fail('target_mismatch', 'Verification target must match the approved development environment.')
  if (!REVISION_PATTERN.test(parsed.revision ?? '')) {
    fail('invalid_revision', 'Verification requires an exact revision.')
  }
  if (!IMAGE_PATTERN.test(parsed.image ?? '')) {
    fail('immutable_image_required', 'Verification requires the approved immutable image.')
  }
  if (!SECRET_PATTERN.test(environment.PEECARE_TEST_TOOL_INGESTION_SECRET_REF ?? '')) {
    fail('invalid_secret_reference', 'Verification requires one approved numeric secret version.')
  }
  if (
    environment.PEECARE_TEST_TOOL_SMOKE_DEVICE_ID !== APPROVED_DEVICE_ID ||
    environment.PEECARE_TEST_TOOL_SMOKE_PRODUCT_MODEL !== APPROVED_PRODUCT_MODEL
  ) fail('smoke_config_invalid', 'Verification requires the approved beta device identity.')
}

function assertInspection(inspected, parsed, secretRef) {
  if (
    inspected?.ready !== true ||
    inspected?.serving !== true ||
    inspected?.projectId !== APPROVED_PROJECT ||
    inspected?.region !== APPROVED_REGION ||
    inspected?.service !== APPROVED_SERVICE ||
    inspected?.revision !== parsed.revision ||
    inspected?.image !== parsed.image ||
    inspected?.runtimeIdentity !== APPROVED_IDENTITY ||
    inspected?.serviceUrl !== APPROVED_SERVICE_ORIGIN ||
    inspected?.secretRef !== secretRef
  ) fail('revision_mismatch', 'Inspected revision does not match the approved immutable deployment.')
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function canonicalResult(value, eventType) {
  return value !== null && typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'deviceId,eventId,eventType,sequence,status' &&
    (value.status === 'stored' || value.status === 'duplicate') &&
    value.deviceId === APPROVED_DEVICE_ID &&
    value.eventType === eventType &&
    EVENT_ID_PATTERN.test(value.eventId ?? '') &&
    Number.isInteger(value.sequence) && value.sequence >= 0 && value.sequence <= 4_294_967_295
}

export function createTestToolSmokeAdapter({
  inspectRevision,
  request,
  readDevice,
  readLedger,
  writeMarker,
  readEvent,
  readProjection,
  verifyWebProjection,
  readLogs,
  wait,
  ownerToken,
  foreignToken,
  inspectedSecretValue,
  verificationStartedAt,
}) {
  const journey = { device: null, urination: null, battery: null }

  function eventUrl(inspected) {
    return `${inspected.serviceUrl}/v1/test-devices/${APPROVED_DEVICE_ID}/events`
  }

  async function state(context) {
    return Object.freeze({
      device: await readDevice({ projectId: context.projectId, deviceId: context.deviceId }),
      ledger: await readLedger({ projectId: context.projectId, deviceId: context.deviceId }),
    })
  }

  async function rejectedEvent(inspected, context, authorization, expectedStatus) {
    const before = await state(context)
    const response = await request({
      method: 'POST',
      url: eventUrl(inspected),
      headers: {
        origin: context.webOrigin,
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: { eventType: 'battery', batteryLevelPercent: 75 },
    })
    const after = await state(context)
    return response.status === expectedStatus &&
      response.body?.error?.code ===
        (expectedStatus === 401 ? 'unauthorized' : 'test_device_not_found') &&
      sameSnapshot(before, after)
  }

  async function submit(inspected, context, body) {
    return request({
      method: 'POST', url: eventUrl(inspected),
      headers: {
        origin: context.webOrigin,
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body,
    })
  }

  return Object.freeze({
    inspectRevision,
    async checkPublicHealth(inspected) {
      const response = await request({ method: 'GET', url: `${inspected.serviceUrl}/health`, headers: {} })
      return response.status === 200 && response.body?.status === 'ok'
    },
    async checkExactCors(inspected, context) {
      const headers = {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      }
      const [approved, foreign] = await Promise.all([
        request({ method: 'OPTIONS', url: eventUrl(inspected), headers: { ...headers, origin: context.webOrigin } }),
        request({ method: 'OPTIONS', url: eventUrl(inspected), headers: { ...headers, origin: 'https://foreign.invalid' } }),
      ])
      return approved.status === 204 &&
        approved.headers?.['access-control-allow-origin'] === context.webOrigin &&
        foreign.headers?.['access-control-allow-origin'] === undefined
    },
    checkUnauthorizedZeroWrite(inspected, context) {
      return rejectedEvent(inspected, context, undefined, 401)
    },
    checkUnmarkedDeviceDenial(inspected, context) {
      return rejectedEvent(inspected, context, `Bearer ${ownerToken}`, 404)
    },
    async markBetaDevice(_inspected, context) {
      const before = await readDevice({ projectId: context.projectId, deviceId: context.deviceId })
      if (
        before?.deviceId !== context.deviceId ||
        before?.productModel !== context.productModel ||
        before?.ingestionStatus !== 'enabled' ||
        typeof before?.ownerUid !== 'string' || before.ownerUid.length === 0 ||
        before.developmentTestTool !== undefined
      ) return false
      await writeMarker({
        projectId: context.projectId,
        deviceId: context.deviceId,
        expectedOwnerUid: before.ownerUid,
        marker: Object.freeze({ enabled: true, marker: DEVELOPMENT_MARKER }),
      })
      const after = await readDevice({ projectId: context.projectId, deviceId: context.deviceId })
      const { developmentTestTool: _beforeMarker, ...beforeRegistry } = before
      const { developmentTestTool, ...afterRegistry } = after ?? {}
      if (!sameSnapshot(beforeRegistry, afterRegistry) ||
          !sameSnapshot(developmentTestTool, { enabled: true, marker: DEVELOPMENT_MARKER })) {
        return false
      }
      journey.device = before
      return true
    },
    checkForeignDeviceDenial(inspected, context) {
      return rejectedEvent(inspected, context, `Bearer ${foreignToken}`, 404)
    },
    async checkUrinationStored(inspected, context) {
      const response = await submit(inspected, context, {
        eventType: 'urination', flushDurationMs: 3_000, pumpDurationMs: 5_000,
      })
      if (response.status !== 200 || !canonicalResult(response.body, 'urination')) return false
      journey.urination = response.body
      return true
    },
    async checkBatteryStored(inspected, context) {
      if (journey.urination === null) return false
      await wait(1_100)
      const response = await submit(inspected, context, {
        eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3_975,
      })
      if (response.status !== 200 || !canonicalResult(response.body, 'battery')) return false
      journey.battery = response.body
      return response.body.sequence > journey.urination.sequence
    },
    async checkRateLimit(inspected, context) {
      if (journey.battery === null) return false
      const before = await readLedger({ projectId: context.projectId, deviceId: context.deviceId })
      const response = await submit(inspected, context, {
        eventType: 'battery', batteryLevelPercent: 75, batteryVoltageMv: 3_976,
      })
      const after = await readLedger({ projectId: context.projectId, deviceId: context.deviceId })
      return response.status === 429 && response.body?.error?.code === 'rate_limited' &&
        sameSnapshot(before, after)
    },
    async checkFirestoreProjection(_inspected, context) {
      if (journey.urination === null || journey.battery === null) return false
      const [urination, battery, projection] = await Promise.all([
        readEvent({ projectId: context.projectId, deviceId: context.deviceId, eventId: journey.urination.eventId }),
        readEvent({ projectId: context.projectId, deviceId: context.deviceId, eventId: journey.battery.eventId }),
        readProjection({ projectId: context.projectId, deviceId: context.deviceId }),
      ])
      return urination?.eventId === journey.urination.eventId &&
        urination?.deviceId === context.deviceId && urination?.eventType === 'urination' &&
        urination?.sequence === journey.urination.sequence &&
        urination?.firmwareVersion === '0.0.0-test-tool' &&
        urination?.flushDurationMs === 3_000 && urination?.pumpDurationMs === 5_000 &&
        battery?.eventId === journey.battery.eventId &&
        battery?.deviceId === context.deviceId && battery?.eventType === 'battery' &&
        battery?.sequence === journey.battery.sequence &&
        battery?.firmwareVersion === '0.0.0-test-tool' &&
        battery?.batteryLevelPercent === 75 && battery?.batteryVoltageMv === 3_975 &&
        projection?.latestUrinationEventId === journey.urination.eventId &&
        projection?.latestBatteryEventId === journey.battery.eventId &&
        Number.isInteger(projection?.todayUrinationCount) && projection.todayUrinationCount >= 1
    },
    async checkWebProjection() {
      if (journey.urination === null || journey.battery === null) return false
      return await verifyWebProjection({
        deviceId: APPROVED_DEVICE_ID,
        urinationEventId: journey.urination.eventId,
        batteryEventId: journey.battery.eventId,
      }) === true
    },
    async checkLogPrivacy(_inspected, context) {
      const device = journey.device ??
        await readDevice({ projectId: APPROVED_PROJECT, deviceId: context.deviceId })
      const logs = await readLogs({
        projectId: APPROVED_PROJECT,
        service: APPROVED_SERVICE,
        since: verificationStartedAt,
      })
      const serialized = JSON.stringify(logs)
      const markers = [
        ownerToken, foreignToken, inspectedSecretValue,
        device?.ownerUid, device?.customName,
        '"flushDurationMs":3000', '"pumpDurationMs":5000',
        '"batteryVoltageMv":3975',
      ].filter((value) => typeof value === 'string' && value.length > 0)
      return Array.isArray(logs) && !markers.some((marker) => serialized.includes(marker))
    },
  })
}

async function runChecks(entries, adapter, inspected, context, result) {
  for (const [name, method] of entries) {
    const check = adapter?.[method]
    if (typeof check !== 'function' || await check(inspected, context) !== true) {
      fail('smoke_failed', `Test Tool API verification failed at ${name}.`)
    }
    result[name] = 'passed'
  }
}

export async function runTestToolVerification({
  environment,
  args,
  manifest,
  adapter,
  now = () => new Date(),
  write,
}) {
  const parsed = parseArguments(args)
  validateInputs(environment, manifest, parsed)
  const context = Object.freeze({
    projectId: APPROVED_PROJECT,
    region: APPROVED_REGION,
    service: APPROVED_SERVICE,
    webOrigin: APPROVED_WEB_ORIGIN,
    deviceId: APPROVED_DEVICE_ID,
    productModel: APPROVED_PRODUCT_MODEL,
  })

  if (parsed.mode === '--dry-run') {
    const plan = Object.freeze({
      status: 'ready',
      dryRun: true,
      projectId: APPROVED_PROJECT,
      region: APPROVED_REGION,
      service: APPROVED_SERVICE,
      revision: parsed.revision,
      image: parsed.image,
      deviceId: APPROVED_DEVICE_ID,
      productModel: APPROVED_PRODUCT_MODEL,
      checks: CHECK_NAMES,
    })
    write(JSON.stringify(plan))
    return plan
  }

  if (typeof adapter?.inspectRevision !== 'function') {
    fail('revision_mismatch', 'Revision inspection is unavailable.')
  }
  const inspected = await adapter.inspectRevision(context)
  assertInspection(
    inspected,
    parsed,
    environment.PEECARE_TEST_TOOL_INGESTION_SECRET_REF,
  )
  const smoke = {}
  await runChecks(PRE_MARKER_CHECKS, adapter, inspected, context, smoke)
  if (typeof adapter.markBetaDevice !== 'function' ||
      await adapter.markBetaDevice(inspected, context) !== true) {
    fail('smoke_failed', 'Test Tool API verification failed at beta marker setup.')
  }
  await runChecks(POST_MARKER_CHECKS, adapter, inspected, context, smoke)

  const current = now()
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
    fail('verification_clock_invalid', 'Verification requires a valid current time.')
  }
  const release = Object.freeze({
    status: 'healthy',
    projectId: APPROVED_PROJECT,
    region: APPROVED_REGION,
    service: APPROVED_SERVICE,
    revision: parsed.revision,
    image: parsed.image,
    imageDigest: parsed.image.slice(parsed.image.lastIndexOf('@') + 1),
    runtimeIdentity: APPROVED_IDENTITY,
    verifiedOrigin: APPROVED_SERVICE_ORIGIN,
    verifiedAt: current.toISOString(),
    smoke: Object.freeze(smoke),
  })
  write(JSON.stringify(release))
  return release
}

export async function runTestToolVerificationCli({
  args = process.argv.slice(2),
  environment = process.env,
  write = (line) => process.stdout.write(`${line}\n`),
  writeError = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  try {
    if (args[0] !== '--dry-run') {
      fail(
        'live_browser_harness_required',
        'Live verification requires the approved isolated browser harness.',
      )
    }
    return await runTestToolVerification({
      environment,
      args,
      manifest: loadTestToolManifest(),
      adapter: Object.freeze({}),
      write,
    })
  } catch (error) {
    const code = error instanceof TestToolVerificationError
      ? error.code
      : 'test_tool_verification_failed'
    writeError(JSON.stringify({ status: 'error', code }))
    return Object.freeze({ status: 'error', code })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runTestToolVerificationCli()
  if (result?.status === 'error') process.exitCode = 1
}
