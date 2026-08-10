import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { loadMemberManifest } from './deploy-member.mjs'
import {
  createMemberSmokeAdapter,
  createCliRevisionInspector,
  runMemberVerification,
  runMemberRollback,
  runVerifiedMemberWebBuildPreflight,
  type MemberReleaseRecord,
  type MemberVerificationAdapter,
} from './verify-member.mjs'

const revision = 'peecare-member-development-00001-abc'
const image =
  'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:' +
  'a'.repeat(64)
const serviceUrl =
  'https://peecare-member-development-example.asia-east1.run.app'

function verificationEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://petcare-c7483.web.app',
  }
}

function adapter(
  overrides: Partial<MemberVerificationAdapter> = {},
): MemberVerificationAdapter {
  return {
    inspectRevision: vi.fn(async () => ({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-member-development',
      revision,
      image,
      runtimeIdentity:
        'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
      serviceUrl,
    })),
    checkPublicHealth: vi.fn(async () => true),
    checkCorsPreflight: vi.fn(async () => true),
    checkMissingToken: vi.fn(async () => true),
    checkWrongToken: vi.fn(async () => true),
    checkRevokedToken: vi.fn(async () => true),
    checkOwnerRename: vi.fn(async () => true),
    checkNonOwnerDenial: vi.fn(async () => true),
    checkProjectIsolation: vi.fn(async () => true),
    ...overrides,
  }
}

function healthyRecord(
  overrides: Partial<MemberReleaseRecord> = {},
): MemberReleaseRecord {
  return {
    status: 'healthy',
    projectId: 'petcare-c7483',
    region: 'asia-east1',
    service: 'peecare-member-development',
    revision,
    image,
    imageDigest: `sha256:${'a'.repeat(64)}`,
    runtimeIdentity:
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
    verifiedOrigin: serviceUrl,
    smoke: {
      publicHealth: 'passed',
      corsPreflight: 'passed',
      missingToken: 'passed',
      wrongToken: 'passed',
      revokedToken: 'passed',
      ownerRename: 'passed',
      nonOwnerDenial: 'passed',
      projectIsolation: 'passed',
    },
    ...overrides,
  }
}

describe('development Member API verification and Web origin handoff', () => {
  it('emits the exact HTTPS origin only after every smoke check succeeds', async () => {
    const write = vi.fn()
    const checks = adapter()

    const result = await runMemberVerification({
      environment: verificationEnvironment(),
      args: ['--revision', revision, '--image', image],
      manifest: loadMemberManifest(),
      adapter: checks,
      write,
    })

    expect(result).toEqual(healthyRecord())
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(JSON.stringify(result))
    for (const check of [
      checks.checkPublicHealth,
      checks.checkCorsPreflight,
      checks.checkMissingToken,
      checks.checkWrongToken,
      checks.checkRevokedToken,
      checks.checkOwnerRename,
      checks.checkNonOwnerDenial,
      checks.checkProjectIsolation,
    ]) {
      expect(check).toHaveBeenCalledTimes(1)
    }
  })

  it.each([
    'checkPublicHealth',
    'checkCorsPreflight',
    'checkMissingToken',
    'checkWrongToken',
    'checkRevokedToken',
    'checkOwnerRename',
    'checkNonOwnerDenial',
    'checkProjectIsolation',
  ] as const)('does not emit a healthy origin when %s fails', async (failedCheck) => {
    const write = vi.fn()
    const checks = adapter({ [failedCheck]: vi.fn(async () => false) })

    await expect(
      runMemberVerification({
        environment: verificationEnvironment(),
        args: ['--revision', revision, '--image', image],
        manifest: loadMemberManifest(),
        adapter: checks,
        write,
      }),
    ).rejects.toMatchObject({ code: 'smoke_failed' })
    expect(write).not.toHaveBeenCalled()
  })

  it('creates a Web build dry-run plan from the matching healthy release record', () => {
    const execute = vi.fn()
    const output: string[] = []

    const result = runVerifiedMemberWebBuildPreflight({
      environment: verificationEnvironment(),
      args: ['--dry-run'],
      releaseRecord: healthyRecord(),
      execute,
      write: (line) => output.push(line),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      service: 'peecare-member-development',
      revision,
      buildEnvironment: { VITE_MEMBER_API_URL: serviceUrl },
    })
    expect(JSON.parse(output[0])).toEqual(result)
  })

  it.each([
    ['missing healthy record', undefined],
    ['unhealthy record', healthyRecord({ status: 'failed' })],
    [
      'HTTP origin',
      healthyRecord({ verifiedOrigin: serviceUrl.replace('https:', 'http:') }),
    ],
    ['loopback origin', healthyRecord({ verifiedOrigin: 'https://127.0.0.1:8087' })],
    ['path', healthyRecord({ verifiedOrigin: `${serviceUrl}/v1` })],
    ['query', healthyRecord({ verifiedOrigin: `${serviceUrl}?from=record` })],
    ['fragment', healthyRecord({ verifiedOrigin: `${serviceUrl}#member` })],
    ['wrong project', healthyRecord({ projectId: 'other-project' })],
    ['wrong service', healthyRecord({ service: 'other-member-service' })],
    [
      'origin from another service',
      healthyRecord({
        verifiedOrigin: 'https://other-service-example.asia-east1.run.app',
      }),
    ],
  ])('rejects %s before the Web build executes', (_case, releaseRecord) => {
    const execute = vi.fn()

    expect(() =>
      runVerifiedMemberWebBuildPreflight({
        environment: verificationEnvironment(),
        args: ['--apply'],
        releaseRecord,
        execute,
        write: vi.fn(),
      }),
    ).toThrowError()
    expect(execute).not.toHaveBeenCalled()
  })

  it('emits only the sanitized release-record schema', async () => {
    const result = await runMemberVerification({
      environment: {
        ...verificationEnvironment(),
        PEECARE_MEMBER_OWNER_ID_TOKEN: 'owner-secret-token',
        PEECARE_MEMBER_REVOKED_ID_TOKEN: 'revoked-secret-token',
        GOOGLE_APPLICATION_CREDENTIALS: '/tmp/private-key.json',
      },
      args: ['--revision', revision, '--image', image],
      manifest: loadMemberManifest(),
      adapter: adapter(),
      write: vi.fn(),
    })

    expect(Object.keys(result)).toEqual([
      'status',
      'projectId',
      'region',
      'service',
      'revision',
      'image',
      'imageDigest',
      'runtimeIdentity',
      'verifiedOrigin',
      'smoke',
    ])
    expect(JSON.stringify(result)).not.toMatch(
      /owner-secret-token|revoked-secret-token|private-key|Authorization|customName/,
    )
  })

  it('records an exact prior healthy immutable revision from the same service', async () => {
    const activeRevision = 'peecare-member-development-00002-def'
    const activeImage =
      'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:' +
      'c'.repeat(64)
    const priorImage =
      'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:' +
      'b'.repeat(64)
    const checks = adapter({
      inspectRevision: vi.fn(async ({ revision: requestedRevision }) => ({
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-member-development',
        revision: requestedRevision,
        image: requestedRevision === activeRevision ? activeImage : priorImage,
        runtimeIdentity:
          'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
        serviceUrl,
      })),
    })

    const result = await runMemberVerification({
      environment: verificationEnvironment(),
      args: ['--revision', activeRevision, '--image', activeImage],
      manifest: loadMemberManifest(),
      adapter: checks,
      priorRelease: healthyRecord({
        revision,
        image: priorImage,
        imageDigest: `sha256:${'b'.repeat(64)}`,
      }),
      write: vi.fn(),
    })

    expect(result.priorHealthyRevision).toEqual({
      revision,
      imageDigest: `sha256:${'b'.repeat(64)}`,
    })
  })

  it('resolves the exact prior healthy revision in rollback dry-run without changing traffic', async () => {
    const executeTrafficMutation = vi.fn()
    const targetDigest = `sha256:${'b'.repeat(64)}`
    const priorImage =
      'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@' + targetDigest
    const activeRecord = healthyRecord({
      revision: 'peecare-member-development-00002-def',
      priorHealthyRevision: { revision, imageDigest: targetDigest },
    })
    const output: string[] = []

    const result = await runMemberRollback({
      args: ['--rollback-dry-run'],
      manifest: loadMemberManifest(),
      releaseRecord: activeRecord,
      inspectRevision: vi.fn(async () => ({
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-member-development',
        revision,
        image: priorImage,
        runtimeIdentity:
          'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
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
      service: 'peecare-member-development',
      currentRevision: 'peecare-member-development-00002-def',
      targetRevision: revision,
      imageDigest: targetDigest,
      command: {
        executable: 'gcloud',
        args: [
          'run',
          'services',
          'update-traffic',
          'peecare-member-development',
          '--project',
          'petcare-c7483',
          '--region',
          'asia-east1',
          '--to-revisions',
          `${revision}=100`,
          '--quiet',
        ],
      },
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })

  it.each([
    ['missing prior revision', { priorHealthyRevision: undefined }],
    ['wrong service', { service: 'other-member-service' }],
    ['wrong project', { projectId: 'other-project' }],
  ])('rejects a rollback record with %s before traffic mutation', async (_case, override) => {
    const executeTrafficMutation = vi.fn()
    const inspectRevision = vi.fn()

    await expect(
      runMemberRollback({
        args: ['--rollback-dry-run'],
        manifest: loadMemberManifest(),
        releaseRecord: healthyRecord({
          revision: 'peecare-member-development-00002-def',
          priorHealthyRevision: {
            revision,
            imageDigest: `sha256:${'b'.repeat(64)}`,
          },
          ...override,
        }),
        inspectRevision,
        executeTrafficMutation,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'rollback_target_invalid' })
    expect(inspectRevision).not.toHaveBeenCalled()
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })

  it('exposes deploy, verification, and rollback through the package interface', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(packageJson.scripts['member:development:deploy']).toBe(
      'node deploy/development/deploy-member.mjs',
    )
    expect(packageJson.scripts['member:development:verify']).toBe(
      'node deploy/development/verify-member.mjs',
    )
    expect(packageJson.scripts['member:development:rollback']).toBe(
      'node deploy/development/verify-member.mjs --rollback-dry-run',
    )
    expect(packageJson.scripts['member:development:web-build:dry-run']).toBe(
      'node deploy/development/verify-member.mjs --web-build-dry-run',
    )
    expect(packageJson.scripts['member:development:web-build']).toBe(
      'node deploy/development/verify-member.mjs --web-build-apply',
    )
  })

  it('documents the immutable deploy, smoke, verified Web build, and rollback sequence', () => {
    const runbook = readFileSync(
      'deploy/development/MEMBER_API_RUNBOOK.md',
      'utf8',
    )

    for (const command of [
      'member:development:deploy',
      'member:development:verify',
      'member:development:web-build:dry-run',
      'member:development:web-build',
      'member:development:rollback',
    ]) {
      expect(runbook).toContain(command)
    }
    expect(runbook).toContain('/health')
    expect(runbook).toContain('roles/firebaseauth.viewer')
  })

  it('runs the live smoke matrix with zero writes on rejected requests and owner rename/clear', async () => {
    let device: Record<string, unknown> = {
      deviceId: 'PC-DEV-0001',
      ownerUid: 'owner-uid',
      productModel: 'pc-mini',
    }
    let updateVersion = 1
    const readDevice = vi.fn(async ({ projectId, deviceId }) => ({
      projectId,
      deviceId,
      exists: true,
      data: structuredClone(device),
      updateTime: `version-${updateVersion}`,
    }))
    const request = vi.fn(async ({ method, url, headers, body }) => {
      if (method === 'GET' && url.endsWith('/health')) {
        return { status: 200, body: { status: 'ok' }, headers: {} }
      }
      if (method === 'OPTIONS') {
        return {
          status: 204,
          body: null,
          headers:
            headers?.origin === 'https://petcare-c7483.web.app'
              ? {
                  'access-control-allow-origin':
                    'https://petcare-c7483.web.app',
                  'access-control-allow-methods': 'PATCH',
                }
              : {},
        }
      }
      if (headers?.authorization === 'Bearer owner-token') {
        const customName = (body as { customName: string | null }).customName
        device =
          customName === null
            ? Object.fromEntries(
                Object.entries(device).filter(([key]) => key !== 'customName'),
              )
            : { ...device, customName }
        updateVersion += 1
        return {
          status: 200,
          body: {
            deviceId: 'PC-DEV-0001',
            customName,
            displayName: customName ?? 'PC-DEV-0001',
          },
          headers: {},
        }
      }
      if (headers?.authorization === 'Bearer non-owner-token') {
        return { status: 404, body: {}, headers: {} }
      }
      return { status: 401, body: {}, headers: {} }
    })
    const live = createMemberSmokeAdapter({
      environment: {
        PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
        PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://petcare-c7483.web.app',
        PEECARE_MEMBER_SMOKE_DEVICE_ID: 'PC-DEV-0001',
        PEECARE_MEMBER_OWNER_ID_TOKEN: 'owner-token',
        PEECARE_MEMBER_NON_OWNER_ID_TOKEN: 'non-owner-token',
        PEECARE_MEMBER_REVOKED_ID_TOKEN: 'revoked-token',
      },
      inspectRevision: adapter().inspectRevision,
      request,
      readDevice,
    })
    const inspected = await live.inspectRevision({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-member-development',
      revision,
    })

    await expect(live.checkPublicHealth(inspected)).resolves.toBe(true)
    await expect(live.checkCorsPreflight(inspected)).resolves.toBe(true)
    await expect(live.checkMissingToken(inspected)).resolves.toBe(true)
    await expect(live.checkWrongToken(inspected)).resolves.toBe(true)
    await expect(live.checkRevokedToken(inspected)).resolves.toBe(true)
    await expect(live.checkOwnerRename(inspected)).resolves.toBe(true)
    await expect(live.checkNonOwnerDenial(inspected)).resolves.toBe(true)
    await expect(live.checkProjectIsolation(inspected)).resolves.toBe(true)

    expect(device).toEqual({
      deviceId: 'PC-DEV-0001',
      ownerUid: 'owner-uid',
      productModel: 'pc-mini',
    })
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer invalid-token' }),
      }),
    )
  })

  it('inspects the exact ready and serving Cloud Run revision for CLI verification', async () => {
    const execute = vi.fn((args: readonly string[]) => {
      if (args[1] === 'services') {
        return JSON.stringify({
          status: {
            url: serviceUrl,
            latestReadyRevisionName: revision,
            traffic: [{ revisionName: revision, percent: 100 }],
          },
        })
      }
      return JSON.stringify({
        metadata: { name: revision },
        spec: {
          containers: [{ image }],
          serviceAccountName:
            'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
        },
        status: { conditions: [{ type: 'Ready', status: 'True' }] },
      })
    })

    const inspectRevision = createCliRevisionInspector(execute)

    await expect(
      inspectRevision({
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-member-development',
        revision,
      }),
    ).resolves.toEqual({
      ready: true,
      serving: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-member-development',
      revision,
      image,
      runtimeIdentity:
        'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
      serviceUrl,
    })
  })
})
