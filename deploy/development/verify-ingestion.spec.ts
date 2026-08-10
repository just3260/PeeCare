import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  runIngestionRollback,
  runIngestionVerification,
  type IngestionVerificationAdapter,
} from './verify-ingestion.mjs'
import { loadIngestionManifest } from './deploy-ingestion.mjs'

const revision = 'peecare-ingestion-development-00001-abc'
const image =
  'asia-east1-docker.pkg.dev/petcare-c7483/peecare/ingestion-api@sha256:' +
  'b'.repeat(64)
const serviceUrl = 'https://peecare-ingestion-development-example.a.run.app'
const eventId = 'PC-DEV-0001:smoke-urination-1'
const batteryEventId = 'PC-DEV-0001:smoke-battery-1'

function adapter(
  overrides: Partial<IngestionVerificationAdapter> = {},
): IngestionVerificationAdapter {
  const deliveryCounts = new Map<string, number>()
  let stateRead = 0
  const urinationEvent = {
    schemaVersion: 1,
    eventId,
    eventType: 'urination',
    deviceId: 'PC-DEV-0001',
    sequence: 1,
    recordedAtMs: 1_786_358_599_000,
    firmwareVersion: '1.0.0',
    flushDurationMs: 1_000,
    pumpDurationMs: 2_000,
  }
  const batteryEvent = {
    schemaVersion: 1,
    eventId: batteryEventId,
    eventType: 'battery',
    deviceId: 'PC-DEV-0001',
    sequence: 2,
    recordedAtMs: 1_786_358_599_000,
    firmwareVersion: '1.0.0',
    batteryLevelPercent: 75,
    batteryVoltageMv: 3_975,
  }
  const baseline = {
    projectId: 'petcare-c7483',
    device: { deviceId: 'PC-DEV-0001', ingestionStatus: 'enabled' },
    events: { [eventId]: null, [batteryEventId]: null },
    daily: { date: '2026-08-10', urinationCount: 4 },
  }
  const afterUrination = {
    projectId: 'petcare-c7483',
    device: {
      deviceId: 'PC-DEV-0001',
      ingestionStatus: 'enabled',
      latestUrinationEventId: eventId,
    },
    events: { [eventId]: urinationEvent, [batteryEventId]: null },
    daily: { date: '2026-08-10', urinationCount: 5 },
  }
  const afterBattery = {
    projectId: 'petcare-c7483',
    device: {
      deviceId: 'PC-DEV-0001',
      ingestionStatus: 'enabled',
      latestUrinationEventId: eventId,
      latestBatteryEventId: batteryEventId,
    },
    events: { [eventId]: urinationEvent, [batteryEventId]: batteryEvent },
    daily: { date: '2026-08-10', urinationCount: 5 },
  }
  const states = [
    baseline,
    afterUrination,
    afterUrination,
    afterBattery,
    afterBattery,
  ]
  return {
    inspectRevision: vi.fn(async () => ({
      ready: true,
      serving: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-ingestion-development',
      revision,
      image,
      runtimeIdentity:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
      serviceUrl,
    })),
    accessSecret: vi.fn(async () => 'resolved-smoke-secret'),
    request: vi.fn(async ({ url, headers, body }) => {
      if (url.endsWith('/health')) return { status: 200, body: { status: 'ok' } }
      if (!headers?.authorization) {
        return { status: 401, body: { error: { code: 'unauthorized' } } }
      }
      const deliveredEventId = (body as { payload: { eventId: string } }).payload.eventId
      const count = deliveryCounts.get(deliveredEventId) ?? 0
      deliveryCounts.set(deliveredEventId, count + 1)
      return {
        status: count === 0 ? 201 : 200,
        body: { eventId: deliveredEventId, requestId: `request-${count + 1}` },
      }
    }),
    readEvent: vi.fn(async () => ({
      projectId: 'petcare-c7483',
      path: `devices/PC-DEV-0001/events/${eventId}`,
      data: { eventId, deviceId: 'PC-DEV-0001', eventType: 'urination' },
    })),
    readSmokeState: vi.fn(async () => states[Math.min(stateRead++, states.length - 1)]),
    ...overrides,
  }
}

describe('development ingestion cloud verification', () => {
  it('verifies the exact healthy revision and emits a sanitized summary', async () => {
    const output: string[] = []
    const verificationAdapter = adapter()

    const result = await runIngestionVerification({
      environment: {
        PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
        PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
        PEECARE_INGESTION_SECRET_CURRENT_REF:
          'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
      },
      args: ['--revision', revision],
      manifest: loadIngestionManifest(),
      adapter: verificationAdapter,
      now: () => 1_786_358_600_000,
      write: (line) => output.push(line),
    })

    expect(result).toEqual({
      status: 'healthy',
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-ingestion-development',
      revision,
      imageDigest: `sha256:${'b'.repeat(64)}`,
      runtimeIdentity:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
      eventId,
      checks: {
        health: 200,
        unauthenticated: 401,
        authenticated: 201,
        firestore: 'verified',
        durableEvents: {
          urination: [201, 200],
          battery: [201, 200],
          immutableEventCount: 2,
          urinationCountDelta: 1,
          duplicateWrites: 0,
        },
      },
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(output[0]).not.toContain('resolved-smoke-secret')
    expect(output[0]).not.toContain('flushDurationMs')
    expect(verificationAdapter.readEvent).toHaveBeenCalledWith({
      projectId: 'petcare-c7483',
      deviceId: 'PC-DEV-0001',
      eventId,
    })
    expect(verificationAdapter.readSmokeState).toHaveBeenCalledTimes(5)
  })

  it('accepts the approved numeric project identifier for live secret access', async () => {
    const result = await runIngestionVerification({
      environment: {
        PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
        PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
        PEECARE_INGESTION_SECRET_CURRENT_REF:
          'projects/348528459946/secrets/peecare-emqx-webhook-current/versions/1',
      },
      args: ['--revision', revision],
      manifest: loadIngestionManifest(),
      adapter: adapter(),
      now: () => 1_786_358_600_000,
      write: vi.fn(),
    })

    expect(result.status).toBe('healthy')
  })

  it.each([
    ['wrong project', { projectId: 'demo-peecare' }],
    ['wrong region', { region: 'us-central1' }],
    ['wrong service', { service: 'peecare-ingestion' }],
    ['wrong revision', { revision: 'peecare-ingestion-development-00002-def' }],
    ['not ready', { ready: false }],
    ['not serving', { serving: false }],
  ])('rejects a %s revision inspection before smoke requests', async (_case, inspected) => {
    const request = vi.fn()
    const verificationAdapter = adapter({
      inspectRevision: vi.fn(async () => ({
        ready: true,
        serving: true,
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-ingestion-development',
        revision,
        image,
        runtimeIdentity:
          'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
        serviceUrl,
        ...inspected,
      })),
      request,
    })

    await expect(
      runIngestionVerification({
        environment: {
          PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
          PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
          PEECARE_INGESTION_SECRET_CURRENT_REF:
            'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
        },
        args: ['--revision', revision],
        manifest: loadIngestionManifest(),
        adapter: verificationAdapter,
        now: () => 1_786_358_600_000,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'revision_mismatch' })
    expect(request).not.toHaveBeenCalled()
  })

  it('fails without a healthy result when a smoke response is wrong', async () => {
    const verificationAdapter = adapter({
      request: vi.fn(async ({ url }) =>
        url.endsWith('/health')
          ? { status: 503, body: {} }
          : { status: 401, body: { error: { code: 'unauthorized' } } },
      ),
    })

    await expect(
      runIngestionVerification({
        environment: {
          PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
          PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
          PEECARE_INGESTION_SECRET_CURRENT_REF:
            'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
        },
        args: ['--revision', revision],
        manifest: loadIngestionManifest(),
        adapter: verificationAdapter,
        now: () => 1_786_358_600_000,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'smoke_failed' })
  })

  it('fails when an urination replay changes the event, projection, or daily count snapshot', async () => {
    let read = 0
    const urination = {
      schemaVersion: 1,
      eventId,
      eventType: 'urination',
      deviceId: 'PC-DEV-0001',
      sequence: 1,
      recordedAtMs: 1_786_358_599_000,
      firmwareVersion: '1.0.0',
      flushDurationMs: 1_000,
      pumpDurationMs: 2_000,
    }
    const baseline = {
      projectId: 'petcare-c7483',
      device: { deviceId: 'PC-DEV-0001' },
      events: { [eventId]: null, [batteryEventId]: null },
      daily: { date: '2026-08-10', urinationCount: 4 },
    }
    const afterFirst = {
      projectId: 'petcare-c7483',
      device: { deviceId: 'PC-DEV-0001', latestUrinationEventId: eventId },
      events: { [eventId]: urination, [batteryEventId]: null },
      daily: { date: '2026-08-10', urinationCount: 5 },
    }
    const changedByReplay = {
      ...afterFirst,
      daily: { date: '2026-08-10', urinationCount: 6 },
    }
    const states = [baseline, afterFirst, changedByReplay]
    const verificationAdapter = adapter({
      readSmokeState: vi.fn(async () => states[Math.min(read++, states.length - 1)]),
    })

    await expect(
      runIngestionVerification({
        environment: {
          PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
          PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
          PEECARE_INGESTION_SECRET_CURRENT_REF:
            'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
        },
        args: ['--revision', revision],
        manifest: loadIngestionManifest(),
        adapter: verificationAdapter,
        now: () => 1_786_358_600_000,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'smoke_failed' })
  })

  it('exposes verification through the repository package interface', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(packageJson.scripts['ingestion:development:verify']).toBe(
      'node deploy/development/verify-ingestion.mjs',
    )
  })

  it('records an exact prior healthy immutable revision from the same service', async () => {
    const activeRevision = 'peecare-ingestion-development-00002-def'
    const priorRevision = 'peecare-ingestion-development-00001-abc'
    const activeImage =
      'asia-east1-docker.pkg.dev/petcare-c7483/peecare/ingestion-api@sha256:' +
      'c'.repeat(64)
    const priorImageDigest = `sha256:${'b'.repeat(64)}`
    const verificationAdapter = adapter({
      inspectRevision: vi.fn(async ({ revision: requestedRevision }) => ({
        ready: true,
        serving: requestedRevision === activeRevision,
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-ingestion-development',
        revision: requestedRevision,
        image: requestedRevision === activeRevision ? activeImage : image,
        runtimeIdentity:
          'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
        serviceUrl,
      })),
    })

    const result = await runIngestionVerification({
      environment: {
        PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
        PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
        PEECARE_INGESTION_SECRET_CURRENT_REF:
          'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
      },
      args: ['--revision', activeRevision],
      manifest: loadIngestionManifest(),
      adapter: verificationAdapter,
      priorRelease: {
        status: 'healthy',
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-ingestion-development',
        revision: priorRevision,
        imageDigest: priorImageDigest,
      },
      now: () => 1_786_358_600_000,
      write: vi.fn(),
    })

    expect(result.priorHealthyRevision).toEqual({
      revision: priorRevision,
      imageDigest: priorImageDigest,
    })
  })

  it('resolves the exact prior healthy revision in rollback dry-run without changing traffic', async () => {
    const executeTrafficMutation = vi.fn()
    const targetRevision = 'peecare-ingestion-development-00001-abc'
    const targetDigest = `sha256:${'b'.repeat(64)}`
    const output: string[] = []

    const result = await runIngestionRollback({
      args: ['--rollback-dry-run'],
      manifest: loadIngestionManifest(),
      releaseRecord: {
        status: 'healthy',
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-ingestion-development',
        revision: 'peecare-ingestion-development-00002-def',
        priorHealthyRevision: { revision: targetRevision, imageDigest: targetDigest },
      },
      inspectRevision: vi.fn(async () => ({
        ready: true,
        serving: false,
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-ingestion-development',
        revision: targetRevision,
        image,
        runtimeIdentity:
          'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
        serviceUrl,
      })),
      executeTrafficMutation,
      write: (line) => output.push(line),
    })

    expect(result).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-ingestion-development',
      currentRevision: 'peecare-ingestion-development-00002-def',
      targetRevision,
      imageDigest: targetDigest,
      command: {
        executable: 'gcloud',
        args: [
          'run',
          'services',
          'update-traffic',
          'peecare-ingestion-development',
          '--project',
          'petcare-c7483',
          '--region',
          'asia-east1',
          '--to-revisions',
          `${targetRevision}=100`,
          '--quiet',
        ],
      },
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })

  it.each([
    ['missing prior revision', { priorHealthyRevision: null }],
    ['wrong service', { service: 'peecare-member-development' }],
    ['wrong project', { projectId: 'demo-peecare' }],
  ])('rejects a rollback record with %s before traffic mutation', async (_case, override) => {
    const executeTrafficMutation = vi.fn()
    const inspectRevision = vi.fn()

    await expect(
      runIngestionRollback({
        args: ['--rollback-dry-run'],
        manifest: loadIngestionManifest(),
        releaseRecord: {
          status: 'healthy',
          projectId: 'petcare-c7483',
          region: 'asia-east1',
          service: 'peecare-ingestion-development',
          revision: 'peecare-ingestion-development-00002-def',
          priorHealthyRevision: {
            revision: 'peecare-ingestion-development-00001-abc',
            imageDigest: `sha256:${'b'.repeat(64)}`,
          },
          ...override,
        },
        inspectRevision,
        executeTrafficMutation,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'rollback_target_invalid' })
    expect(inspectRevision).not.toHaveBeenCalled()
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })

  it('exposes rollback dry-run through the repository package interface', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(packageJson.scripts['ingestion:development:rollback']).toBe(
      'node deploy/development/verify-ingestion.mjs --rollback-dry-run',
    )
  })
})
