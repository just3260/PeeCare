import { describe, expect, it, vi } from 'vitest'

import { loadTestToolManifest } from './deploy-test-tool.mjs'
import {
  createTestToolSmokeAdapter,
  runTestToolVerification,
} from './verify-test-tool.mjs'

const digest = `sha256:${'a'.repeat(64)}`
const image = `asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@${digest}`
const revision = 'peecare-test-tool-development-00001-abc'
const verifiedOrigin =
  'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app'
const secretRef =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/7'
const smokeNames = [
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
] as const

function environment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://petcare-c7483.web.app',
    PEECARE_TEST_TOOL_INGESTION_SECRET_REF: secretRef,
    PEECARE_TEST_TOOL_SMOKE_DEVICE_ID: 'PC-DEV-000001',
    PEECARE_TEST_TOOL_SMOKE_PRODUCT_MODEL: 'pc-mini',
  }
}

function adapter() {
  return {
    inspectRevision: vi.fn(async () => ({
      ready: true,
      serving: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
      image,
      runtimeIdentity:
        'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      serviceUrl: verifiedOrigin,
      secretRef,
    })),
    checkPublicHealth: vi.fn(async () => true),
    checkExactCors: vi.fn(async () => true),
    checkUnauthorizedZeroWrite: vi.fn(async () => true),
    checkForeignDeviceDenial: vi.fn(async () => true),
    checkUnmarkedDeviceDenial: vi.fn(async () => true),
    markBetaDevice: vi.fn(async () => true),
    checkUrinationStored: vi.fn(async () => true),
    checkBatteryStored: vi.fn(async () => true),
    checkRateLimit: vi.fn(async () => true),
    checkFirestoreProjection: vi.fn(async () => true),
    checkWebProjection: vi.fn(async () => true),
    checkLogPrivacy: vi.fn(async () => true),
  }
}

describe('Test Tool API live verification', () => {
  it('emits a sanitized zero-call dry-run with the exact ordered smoke plan', async () => {
    const smoke = adapter()
    const output: string[] = []
    const result = await runTestToolVerification({
      environment: environment(),
      args: ['--dry-run', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      adapter: smoke,
      now: () => new Date('2026-08-11T08:00:00.000Z'),
      write: (line) => output.push(line),
    })

    expect(Object.values(smoke).every((value) => !('mock' in value) || value.mock.calls.length === 0)).toBe(true)
    expect(result).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
      image,
      deviceId: 'PC-DEV-000001',
      productModel: 'pc-mini',
      checks: smokeNames,
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(output[0]).not.toMatch(/bearer\s|private.?key|resolved.?secret|customName|ownerUid/i)
  })

  it.each([
    ['wrong project', { PEECARE_DEVELOPMENT_PROJECT_ID: 'demo-peecare' }, 'target_mismatch'],
    ['wrong region', { PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'us-central1' }, 'target_mismatch'],
    ['wrong Web origin', { PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://other.invalid' }, 'target_mismatch'],
    ['mutable image', {}, 'immutable_image_required', image.replace(/@sha256:.+$/, ':latest')],
    ['wrong device', { PEECARE_TEST_TOOL_SMOKE_DEVICE_ID: 'PC-DEV-000002' }, 'smoke_config_invalid'],
    ['wrong product', { PEECARE_TEST_TOOL_SMOKE_PRODUCT_MODEL: 'pc-pro' }, 'smoke_config_invalid'],
    ['latest secret', { PEECARE_TEST_TOOL_INGESTION_SECRET_REF: secretRef.replace('/7', '/latest') }, 'invalid_secret_reference'],
  ])('rejects %s before inspection or mutation', async (_case, override, code, candidateImage = image) => {
    const smoke = adapter()
    await expect(runTestToolVerification({
      environment: { ...environment(), ...override },
      args: ['--apply', '--revision', revision, '--image', candidateImage],
      manifest: loadTestToolManifest(),
      adapter: smoke,
      write: vi.fn(),
    })).rejects.toMatchObject({ code })
    expect(smoke.inspectRevision).not.toHaveBeenCalled()
    expect(smoke.markBetaDevice).not.toHaveBeenCalled()
  })

  it('runs denial gates before marker mutation and emits the exact healthy Web handoff', async () => {
    const calls: string[] = []
    const smoke = adapter()
    for (const [name, fn] of Object.entries(smoke)) {
      if (name === 'inspectRevision') continue
      fn.mockImplementation(async () => {
        calls.push(name)
        return true
      })
    }
    const output: string[] = []
    const result = await runTestToolVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      adapter: smoke,
      now: () => new Date('2026-08-11T08:00:00.000Z'),
      write: (line) => output.push(line),
    })

    expect(calls).toEqual([
      'checkPublicHealth',
      'checkExactCors',
      'checkUnauthorizedZeroWrite',
      'checkUnmarkedDeviceDenial',
      'markBetaDevice',
      'checkForeignDeviceDenial',
      'checkUrinationStored',
      'checkBatteryStored',
      'checkRateLimit',
      'checkFirestoreProjection',
      'checkWebProjection',
      'checkLogPrivacy',
    ])
    expect(result).toEqual({
      status: 'healthy',
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
      image,
      imageDigest: digest,
      runtimeIdentity:
        'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      verifiedOrigin,
      verifiedAt: '2026-08-11T08:00:00.000Z',
      smoke: Object.fromEntries(smokeNames.map((name) => [name, 'passed'])),
    })
    expect(JSON.parse(output[0])).toEqual(result)
  })

  it.each([
    ['pre-marker denial', 'checkUnmarkedDeviceDenial'],
    ['marker mutation', 'markBetaDevice'],
    ['event', 'checkBatteryStored'],
    ['projection', 'checkWebProjection'],
    ['privacy', 'checkLogPrivacy'],
  ])('fails closed without a healthy record when %s fails', async (_case, method) => {
    const smoke = adapter()
    smoke[method as keyof typeof smoke].mockResolvedValue(false as never)
    const write = vi.fn()

    await expect(runTestToolVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      adapter: smoke,
      write,
    })).rejects.toMatchObject({ code: 'smoke_failed' })
    expect(write).not.toHaveBeenCalled()
    if (method === 'checkUnmarkedDeviceDenial') {
      expect(smoke.markBetaDevice).not.toHaveBeenCalled()
      expect(smoke.checkUrinationStored).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['not serving', { serving: false }],
    ['mutable deployed image', { image: image.replace(/@sha256:.+$/, ':latest') }],
    ['shared identity', { runtimeIdentity: 'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com' }],
    ['different secret version', { secretRef: secretRef.replace('/7', '/8') }],
    ['foreign URL', { serviceUrl: 'https://other.run.app' }],
  ])('rejects an inspected revision with %s before smoke', async (_case, inspectedOverride) => {
    const smoke = adapter()
    smoke.inspectRevision.mockResolvedValue({
      ...(await adapter().inspectRevision()),
      ...inspectedOverride,
    })
    await expect(runTestToolVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      adapter: smoke,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'revision_mismatch' })
    expect(smoke.markBetaDevice).not.toHaveBeenCalled()
  })
})

describe('Test Tool API concrete smoke adapter', () => {
  function dependencies() {
    const device = {
      deviceId: 'PC-DEV-000001', ownerUid: 'private-owner-uid', productModel: 'pc-mini',
      ingestionStatus: 'enabled', customName: '不應進入 evidence',
    }
    let marked = false
    const events = new Map<string, Record<string, unknown>>()
    const request = vi.fn(async ({ method, url, headers, body }) => {
      if (method === 'GET' && url.endsWith('/health')) {
        return { status: 200, headers: {}, body: { status: 'ok' } }
      }
      if (method === 'OPTIONS') {
        return headers.origin === 'https://petcare-c7483.web.app'
          ? { status: 204, headers: { 'access-control-allow-origin': headers.origin }, body: null }
          : { status: 403, headers: {}, body: null }
      }
      if (headers.authorization === undefined) {
        return { status: 401, headers: {}, body: { error: { code: 'unauthorized' } } }
      }
      if (!marked || headers.authorization === 'Bearer foreign-token') {
        return { status: 404, headers: {}, body: { error: { code: 'test_device_not_found' } } }
      }
      if (body.eventType === 'urination') {
        const result = {
          status: 'stored', eventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
          eventType: 'urination', deviceId: 'PC-DEV-000001', sequence: 4,
        }
        events.set(result.eventId, { ...result, firmwareVersion: '0.0.0-test-tool', ...body })
        return { status: 200, headers: {}, body: result }
      }
      if (body.batteryVoltageMv === 3_976) {
        return { status: 429, headers: {}, body: { error: { code: 'rate_limited' } } }
      }
      const result = {
        status: 'stored', eventId: 'tt:PC-DEV-000001:2c69ef13-fc86-4c17-95d4-8556ed098d43',
        eventType: 'battery', deviceId: 'PC-DEV-000001', sequence: 5,
      }
      events.set(result.eventId, { ...result, firmwareVersion: '0.0.0-test-tool', ...body })
      return { status: 200, headers: {}, body: result }
    })
    return {
      request,
      readDevice: vi.fn(async () => ({
        ...device,
        ...(marked ? { developmentTestTool: { enabled: true, marker: 'petcare-c7483-beta-v1' } } : {}),
      })),
      readLedger: vi.fn(async () => ({ marker: 'stable-ledger-snapshot' })),
      writeMarker: vi.fn(async () => { marked = true }),
      readEvent: vi.fn(async ({ eventId }) => events.get(eventId)),
      readProjection: vi.fn(async () => ({
        latestUrinationEventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
        latestBatteryEventId: 'tt:PC-DEV-000001:2c69ef13-fc86-4c17-95d4-8556ed098d43',
        todayUrinationCount: 1,
      })),
      verifyWebProjection: vi.fn(async () => true),
      readLogs: vi.fn(async () => [{ severity: 'INFO', message: 'request completed' }]),
      wait: vi.fn(async () => undefined),
    }
  }

  function concreteAdapter(deps = dependencies()) {
    return { deps, smoke: createTestToolSmokeAdapter({
      ...deps,
      ownerToken: 'owner-token',
      foreignToken: 'foreign-token',
      inspectedSecretValue: 'resolved-secret-value',
      verificationStartedAt: '2026-08-11T08:00:00.000Z',
      inspectRevision: vi.fn(),
    }) }
  }

  it('proves 401 and unmarked/foreign 404 paths preserve device and ledger state', async () => {
    const { smoke } = concreteAdapter()
    const inspected = { serviceUrl: verifiedOrigin }
    const context = { projectId: 'petcare-c7483', deviceId: 'PC-DEV-000001', productModel: 'pc-mini', webOrigin: 'https://petcare-c7483.web.app' }
    await expect(smoke.checkUnauthorizedZeroWrite(inspected, context)).resolves.toBe(true)
    await expect(smoke.checkUnmarkedDeviceDenial(inspected, context)).resolves.toBe(true)
    await expect(smoke.markBetaDevice(inspected, context)).resolves.toBe(true)
    await expect(smoke.checkForeignDeviceDenial(inspected, context)).resolves.toBe(true)
  })

  it('submits canonical urination and battery, then proves immediate rate limiting', async () => {
    const { deps, smoke } = concreteAdapter()
    const inspected = { serviceUrl: verifiedOrigin }
    const context = { projectId: 'petcare-c7483', deviceId: 'PC-DEV-000001', productModel: 'pc-mini', webOrigin: 'https://petcare-c7483.web.app' }
    await smoke.markBetaDevice(inspected, context)
    await expect(smoke.checkUrinationStored(inspected, context)).resolves.toBe(true)
    await expect(smoke.checkBatteryStored(inspected, context)).resolves.toBe(true)
    await expect(smoke.checkRateLimit(inspected, context)).resolves.toBe(true)
    expect(deps.wait).toHaveBeenCalledWith(1_100)
    expect(deps.request).toHaveBeenCalledWith(expect.objectContaining({
      body: { eventType: 'urination', flushDurationMs: 3_000, pumpDurationMs: 5_000 },
    }))
  })

  it('binds Firestore and Web projections to both returned event IDs', async () => {
    const { deps, smoke } = concreteAdapter()
    const inspected = { serviceUrl: verifiedOrigin }
    const context = { projectId: 'petcare-c7483', deviceId: 'PC-DEV-000001', productModel: 'pc-mini', webOrigin: 'https://petcare-c7483.web.app' }
    await smoke.markBetaDevice(inspected, context)
    await smoke.checkUrinationStored(inspected, context)
    await smoke.checkBatteryStored(inspected, context)
    await expect(smoke.checkFirestoreProjection(inspected, context)).resolves.toBe(true)
    await expect(smoke.checkWebProjection(inspected, context)).resolves.toBe(true)
    expect(deps.verifyWebProjection).toHaveBeenCalledWith({
      deviceId: 'PC-DEV-000001',
      urinationEventId: 'tt:PC-DEV-000001:1b59ef13-fc86-4c17-95d4-8556ed098d32',
      batteryEventId: 'tt:PC-DEV-000001:2c69ef13-fc86-4c17-95d4-8556ed098d43',
    })
  })

  it('rejects logs that reflect credentials, UID, custom name, or payload material', async () => {
    const deps = dependencies()
    const { smoke } = concreteAdapter(deps)
    deps.readLogs.mockResolvedValue([{ message: 'resolved-secret-value' }])
    await expect(smoke.checkLogPrivacy({}, { deviceId: 'PC-DEV-000001' })).resolves.toBe(false)
    deps.readLogs.mockResolvedValue([{ message: 'private-owner-uid' }])
    await expect(smoke.checkLogPrivacy({}, { deviceId: 'PC-DEV-000001' })).resolves.toBe(false)
  })
})
