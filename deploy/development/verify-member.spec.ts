import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { loadMemberManifest } from './deploy-member.mjs'
import {
  createMemberSmokeAdapter,
  createCliRevisionInspector,
  runMemberVerification,
  runMemberVerificationWithAdapterFactory,
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
const claimDeviceId = '68E274BD2A58'
const claimWebhookSecret = 'claim-webhook-secret-value'

function inspectedRuntimeConfiguration() {
  return {
    resources: { billing: 'request-based' as const, minInstances: 0 },
    directIam: {
      projectRoles: ['roles/datastore.user', 'roles/firebaseauth.viewer'],
      secretAccess: {
        'peecare-claim-webhook-current': [
          'roles/secretmanager.secretAccessor',
        ],
        'peecare-pair-code-hmac-key': [
          'roles/secretmanager.secretAccessor',
        ],
      },
    },
    runtimeEnvironment: {
      values: {
        PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '5',
        PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'approved-legacy-device',
      },
      secretBindings: {
        PEECARE_CLAIM_WEBHOOK_SECRET: {
          secret: 'peecare-claim-webhook-current',
          version: '3',
        },
        PEECARE_PAIR_CODE_HMAC_KEY: {
          secret: 'peecare-pair-code-hmac-key',
          version: '5',
        },
      },
      unexpectedSensitiveKey: false,
    },
  }
}

function verificationEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://petcare-c7483.web.app',
    PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF:
      'projects/petcare-c7483/secrets/peecare-claim-webhook-current/versions/3',
    PEECARE_PAIR_CODE_HMAC_KEY_REF:
      'projects/petcare-c7483/secrets/peecare-pair-code-hmac-key/versions/5',
    PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '5',
    PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'approved-legacy-device',
  }
}

function adapter(
  overrides: Partial<MemberVerificationAdapter> = {},
): MemberVerificationAdapter {
  return {
    inspectRevision: vi.fn(async () => ({
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
      ...inspectedRuntimeConfiguration(),
    })),
    checkPublicHealth: vi.fn(async () => true),
    checkCorsPreflight: vi.fn(async () => true),
    checkMissingToken: vi.fn(async () => true),
    checkWrongToken: vi.fn(async () => true),
    checkRevokedToken: vi.fn(async () => true),
    checkOwnerRename: vi.fn(async () => true),
    checkNonOwnerDenial: vi.fn(async () => true),
    checkProjectIsolation: vi.fn(async () => true),
    checkMemberClaimRoutes: vi.fn(async () => true),
    checkClaimCredentialIsolation: vi.fn(async () => true),
    checkClaimPersistenceBoundary: vi.fn(async () => true),
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
    claimRuntime: {
      billing: 'request-based',
      minInstances: 0,
      directIamBindings: 'verified',
      secretBindings: {
        PEECARE_CLAIM_WEBHOOK_SECRET: {
          secret: 'peecare-claim-webhook-current',
          version: '3',
        },
        PEECARE_PAIR_CODE_HMAC_KEY: {
          secret: 'peecare-pair-code-hmac-key',
          version: '5',
        },
      },
    },
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
      memberClaimRoutes: 'passed',
      claimCredentialIsolation: 'passed',
      claimPersistenceBoundary: 'passed',
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
      checks.checkMemberClaimRoutes,
      checks.checkClaimCredentialIsolation,
      checks.checkClaimPersistenceBoundary,
    ]) {
      expect(check).toHaveBeenCalledTimes(1)
    }
  })

  it.each([
    ['omitted ready state', { ready: undefined }],
    ['omitted serving state', { serving: undefined }],
    [
      'instance-based billing',
      { resources: { billing: 'instance-based', minInstances: 0 } },
    ],
    [
      'non-zero minimum instances',
      { resources: { billing: 'request-based', minInstances: 1 } },
    ],
    [
      'mutable Claim secret version',
      {
        runtimeEnvironment: {
          ...inspectedRuntimeConfiguration().runtimeEnvironment,
          secretBindings: {
            ...inspectedRuntimeConfiguration().runtimeEnvironment.secretBindings,
            PEECARE_CLAIM_WEBHOOK_SECRET: {
              secret: 'peecare-claim-webhook-current',
              version: 'latest',
            },
          },
        },
      },
    ],
    [
      'wrong Pair Code HMAC version',
      {
        runtimeEnvironment: {
          ...inspectedRuntimeConfiguration().runtimeEnvironment,
          secretBindings: {
            ...inspectedRuntimeConfiguration().runtimeEnvironment.secretBindings,
            PEECARE_PAIR_CODE_HMAC_KEY: {
              secret: 'peecare-pair-code-hmac-key',
              version: '4',
            },
          },
        },
      },
    ],
    [
      'unexpected sensitive revision environment',
      {
        runtimeEnvironment: {
          ...inspectedRuntimeConfiguration().runtimeEnvironment,
          unexpectedSensitiveKey: true,
        },
      },
    ],
    [
      'unapproved direct project IAM role',
      {
        directIam: {
          ...inspectedRuntimeConfiguration().directIam,
          projectRoles: [
            'roles/datastore.user',
            'roles/firebaseauth.viewer',
            'roles/owner',
          ],
        },
      },
    ],
    [
      'direct access to an unapproved project secret',
      {
        directIam: {
          ...inspectedRuntimeConfiguration().directIam,
          secretAccess: {
            ...inspectedRuntimeConfiguration().directIam.secretAccess,
            'unapproved-third-secret': [
              'roles/secretmanager.secretAccessor',
            ],
          },
        },
      },
    ],
  ])('rejects inspected Claim runtime drift: %s', async (_case, drift) => {
    const inspected = {
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
      ...inspectedRuntimeConfiguration(),
      ...drift,
    }
    const checks = adapter({ inspectRevision: vi.fn(async () => inspected) })

    await expect(
      runMemberVerification({
        environment: verificationEnvironment(),
        args: ['--revision', revision, '--image', image],
        manifest: loadMemberManifest(),
        adapter: checks,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'revision_mismatch' })
    expect(checks.checkPublicHealth).not.toHaveBeenCalled()
  })

  it.each([
    ['missing Claim secret reference', 'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF'],
    ['missing HMAC secret reference', 'PEECARE_PAIR_CODE_HMAC_KEY_REF'],
  ])('rejects %s before Cloud Run inspection', async (_case, name) => {
    const environment = verificationEnvironment()
    delete environment[name]
    const checks = adapter()

    await expect(
      runMemberVerification({
        environment,
        args: ['--revision', revision, '--image', image],
        manifest: loadMemberManifest(),
        adapter: checks,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'claim_configuration_invalid' })
    expect(checks.inspectRevision).not.toHaveBeenCalled()
  })

  it('does not construct the side-effecting CLI adapter before pure preflight succeeds', async () => {
    const adapterFactory = vi.fn(async () => adapter())
    const environment = verificationEnvironment()
    delete environment.PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF

    await expect(
      runMemberVerificationWithAdapterFactory({
        environment,
        args: ['--revision', revision, '--image', image],
        manifest: loadMemberManifest(),
        adapterFactory,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'claim_configuration_invalid' })
    expect(adapterFactory).not.toHaveBeenCalled()
  })

  it('does not construct the CLI adapter before pure smoke fixture validation succeeds', async () => {
    const adapterFactory = vi.fn(async () => adapter())

    await expect(
      runMemberVerificationWithAdapterFactory({
        environment: {
          ...verificationEnvironment(),
          PEECARE_DEVELOPMENT_WEB_API_KEY: 'public-web-api-key',
          PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID: 'claim-smoke-client',
        },
        args: ['--revision', revision, '--image', image],
        manifest: loadMemberManifest(),
        adapterFactory,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'smoke_config_missing' })
    expect(adapterFactory).not.toHaveBeenCalled()
  })

  it.each([
    'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT',
    'PEECARE_PAIR_CODE_HMAC_KEY_CURRENT',
    'PEECARE_CLAIM_WEBHOOKPASSWORD',
    'PEECARE_PAIR_CODE_HMACKEY',
    'PEECARE_PAIR_CODE_KEY',
    'PEECARE_CLAIM_WEBHOOK_KEY',
    'PEECARE_CLAIM_CREDENTIAL',
    'PEECARE_CLAIM_AUTHORIZATION',
    'PEECARE_CLAIM_APIKEY',
    'PEECARE_CLAIM_JWT',
    'PEECARE_CLAIM_SIGNING_KEY',
    'PEECARE_CLAIM_ACCESS_KEY',
  ])('rejects unsupported sensitive operator variable %s', async (name) => {
    const checks = adapter()

    await expect(
      runMemberVerification({
        environment: { ...verificationEnvironment(), [name]: 'sentinel' },
        args: ['--revision', revision, '--image', image],
        manifest: loadMemberManifest(),
        adapter: checks,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'claim_configuration_invalid' })
    expect(checks.inspectRevision).not.toHaveBeenCalled()
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
    'checkMemberClaimRoutes',
    'checkClaimCredentialIsolation',
    'checkClaimPersistenceBoundary',
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
      'extra sensitive top-level evidence',
      { ...healthyRecord(), pairCode: '00123456' },
    ],
    [
      'extra nested runtime evidence',
      {
        ...healthyRecord(),
        claimRuntime: {
          ...healthyRecord().claimRuntime,
          resolvedSecret: 'sentinel-secret',
        },
      },
    ],
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

  it.each(['--dry-run', '--apply']) (
    'rejects unsupported direct credentials before Web build mode %s',
    (mode) => {
      const execute = vi.fn()

      expect(() =>
        runVerifiedMemberWebBuildPreflight({
          environment: {
            ...verificationEnvironment(),
            PEECARE_CLAIM_AUTHORIZATION: 'Bearer sentinel',
          },
          args: [mode],
          releaseRecord: healthyRecord(),
          execute,
          write: vi.fn(),
        }),
      ).toThrowError(expect.objectContaining({ code: 'unverified_release' }))
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('emits only the sanitized release-record schema', async () => {
    const checks = adapter({
      inspectRevision: vi.fn(async () => {
        const runtime = inspectedRuntimeConfiguration()
        return {
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
          resources: runtime.resources,
          directIam: runtime.directIam,
          runtimeEnvironment: {
            ...runtime.runtimeEnvironment,
            secretBindings: {
              ...runtime.runtimeEnvironment.secretBindings,
              PEECARE_CLAIM_WEBHOOK_SECRET: {
                ...runtime.runtimeEnvironment.secretBindings
                  .PEECARE_CLAIM_WEBHOOK_SECRET,
                value: 'sentinel-raw-secret',
              },
            },
          },
        }
      }),
    })
    const result = await runMemberVerification({
      environment: verificationEnvironment(),
      args: ['--revision', revision, '--image', image],
      manifest: loadMemberManifest(),
      adapter: checks,
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
      'claimRuntime',
      'verifiedOrigin',
      'smoke',
    ])
    expect(JSON.stringify(result)).not.toMatch(
      /sentinel-raw-secret|Authorization|customName/,
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
        ready: true,
        serving: requestedRevision === activeRevision,
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-member-development',
        revision: requestedRevision,
        image: requestedRevision === activeRevision ? activeImage : priorImage,
        runtimeIdentity:
          'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
        serviceUrl,
        ...(requestedRevision === activeRevision
          ? inspectedRuntimeConfiguration()
          : {}),
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

  it('documents the Claim release boundary, QR contract, and data-safe rollback', () => {
    const runbook = readFileSync(
      'deploy/development/MEMBER_API_RUNBOOK.md',
      'utf8',
    )

    for (const required of [
      'https://petcare-c7483.web.app/connect?deviceId=68E274BD2A58',
      'peecare-claim-webhook-current',
      'peecare-pair-code-hmac-key',
      'database-wide',
      'application-enforced logical scope',
      'runtime compromise',
      'deviceClaimSessions',
      'activeDeviceClaims',
      'first-set `ownerUid`',
      'credential cross-use',
      'PEECARE_DEVELOPMENT_WEB_API_KEY',
      "PEECARE_MEMBER_CLAIM_SMOKE_DEVICE_ID='68E274BD2A58'",
      "PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID='claim-smoke-client'",
      'devices/68E274BD2A58',
      '`ingestionStatus: enabled`',
      'must have no `ownerUid` field',
      'activeDeviceClaims/68E274BD2A58',
      'does not prepare this Claim fixture',
      '先停用 EMQX bind rule',
      '不自動移除已成功設定的 `ownerUid`',
    ]) {
      expect(runbook).toContain(required)
    }

    expect(runbook).not.toContain('collection-level IAM isolation')
    expect(runbook).not.toContain('field-level IAM isolation')
  })

  it('runs the live smoke matrix with isolated Claim credentials and a first-owner persistence probe', async () => {
    let device: Record<string, unknown> = {
      deviceId: 'PC-DEV-0001',
      ownerUid: 'owner-uid',
      productModel: 'pc-mini',
    }
    let claimDevice: Record<string, unknown> = {
      deviceId: claimDeviceId,
      productModel: 'pc-mini',
      hardwareVersion: 'development-fixture-v1',
    }
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const pairCode = '00123456'
    let claimSession: Record<string, unknown> | null = null
    let activeClaim: Record<string, unknown> | null = null
    let claimDeviceUpdateVersion = 1
    let claimCollectionUpdateVersion = 1
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
      if (method === 'GET' && url.endsWith('/v1/device-claim-sessions')) {
        return { status: 405, body: {}, headers: {} }
      }
      if (method === 'OPTIONS') {
        const isClaimRoute = url.endsWith('/v1/device-claim-sessions')
        return {
          status: 204,
          body: null,
          headers:
            headers?.origin === 'https://petcare-c7483.web.app'
              ? {
                  'access-control-allow-origin':
                    'https://petcare-c7483.web.app',
                  'access-control-allow-methods': isClaimRoute ? 'POST' : 'PATCH',
                }
              : {},
        }
      }
      if (method === 'POST' && url.endsWith('/v1/device-claim-sessions')) {
        if (headers?.authorization !== 'Bearer owner-token') {
          return { status: 401, body: {}, headers: {} }
        }
        claimSession = {
          expectedDeviceId: claimDeviceId,
          memberUid: 'owner-uid',
          status: 'pending',
          expiresAtMs: 1_800_000_000_000,
        }
        activeClaim = {
          deviceId: claimDeviceId,
          sessionId,
          status: 'pending',
          expiresAtMs: 1_800_000_000_000,
        }
        claimCollectionUpdateVersion += 1
        return {
          status: 201,
          body: {
            sessionId,
            deviceId: claimDeviceId,
            pairCode,
            status: 'pending',
            expiresAtMs: 1_800_000_000_000,
          },
          headers: {},
        }
      }
      if (
        method === 'GET' &&
        url.endsWith(`/v1/device-claim-sessions/${sessionId}`)
      ) {
        if (headers?.authorization !== 'Bearer owner-token') {
          return { status: 401, body: {}, headers: {} }
        }
        return {
          status: 200,
          body: {
            sessionId,
            deviceId: claimDeviceId,
            status: claimSession?.status,
            expiresAtMs: claimSession?.expiresAtMs,
          },
          headers: {},
        }
      }
      if (method === 'POST' && url.endsWith('/v1/emqx/device-claims')) {
        const wrapper = body as {
          webhookAuthorization?: string
          event?: { payload?: { pair_code?: string } }
        }
        if (wrapper.webhookAuthorization !== claimWebhookSecret) {
          return { status: 401, body: {}, headers: {} }
        }
        if (wrapper.event?.payload?.pair_code !== pairCode) {
          return { status: 202, body: { status: 'accepted' }, headers: {} }
        }
        if (claimSession?.status === 'pending') {
          claimDevice = {
            ...claimDevice,
            ownerUid: 'owner-uid',
            claimedAtMs: 1_700_000_000_000,
          }
          claimSession = {
            ...claimSession,
            status: 'claimed',
            terminalAtMs: 1_700_000_000_000,
          }
          activeClaim = {
            ...activeClaim,
            status: 'claimed',
            terminalAtMs: 1_700_000_000_000,
          }
          claimDeviceUpdateVersion += 1
          claimCollectionUpdateVersion += 1
        }
        return { status: 202, body: { status: 'accepted' }, headers: {} }
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
        PEECARE_MEMBER_CLAIM_SMOKE_DEVICE_ID: claimDeviceId,
        PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID: 'claim-smoke-client',
        PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'approved-legacy-device',
      },
      inspectRevision: adapter().inspectRevision,
      request,
      readDevice,
      claimWebhookSecret,
      readClaimState: vi.fn(async ({ projectId, deviceId, requestedSessionId }) => ({
        projectId,
        deviceId,
        device: {
          exists: true,
          data: structuredClone(claimDevice),
          updateTime: `claim-device-${claimDeviceUpdateVersion}`,
        },
        activeClaim: {
          exists: activeClaim !== null,
          data: structuredClone(activeClaim),
          updateTime:
            activeClaim === null
              ? null
              : `claim-lock-${claimCollectionUpdateVersion}`,
        },
        session: {
          exists: requestedSessionId !== undefined && claimSession !== null,
          data:
            requestedSessionId === undefined || claimSession === null
              ? null
              : structuredClone(claimSession),
          updateTime:
            requestedSessionId === undefined || claimSession === null
              ? null
              : `claim-session-${claimCollectionUpdateVersion}`,
        },
      })),
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
    await expect(live.checkMemberClaimRoutes(inspected)).resolves.toBe(true)
    await expect(live.checkClaimCredentialIsolation(inspected)).resolves.toBe(true)
    claimSession = { ...claimSession, memberUid: '' }
    await expect(live.checkClaimPersistenceBoundary(inspected)).resolves.toBe(false)
    claimSession = { ...claimSession, memberUid: 'owner-uid' }
    await expect(live.checkClaimPersistenceBoundary(inspected)).resolves.toBe(true)

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
    expect(claimDevice).toEqual({
      deviceId: claimDeviceId,
      productModel: 'pc-mini',
      hardwareVersion: 'development-fixture-v1',
      ownerUid: 'owner-uid',
      claimedAtMs: 1_700_000_000_000,
    })
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
      if (args[1] === 'get-iam-policy') {
        const member =
          'serviceAccount:peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
        return JSON.stringify({
          bindings:
            args[0] === 'projects'
              ? [
                  { role: 'roles/datastore.user', members: [member] },
                  { role: 'roles/firebaseauth.viewer', members: [member] },
                ]
              : [
                  {
                    role: 'roles/secretmanager.secretAccessor',
                    members: [member],
                  },
                ],
        })
      }
      if (args[0] === 'secrets' && args[1] === 'list') {
        return JSON.stringify([
          { name: 'peecare-claim-webhook-current' },
          { name: 'peecare-pair-code-hmac-key' },
        ])
      }
      return JSON.stringify({
        metadata: {
          name: revision,
          annotations: {
            'autoscaling.knative.dev/minScale': '0',
            'run.googleapis.com/cpu-throttling': 'true',
          },
        },
        spec: {
          containers: [
            {
              image,
              env: [
                {
                  name: 'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
                  value: '5',
                },
                {
                  name: 'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
                  value: 'approved-legacy-device',
                },
                {
                  name: 'PEECARE_CLAIM_WEBHOOK_SECRET',
                  valueFrom: {
                    secretKeyRef: {
                      name: 'peecare-claim-webhook-current',
                      key: '3',
                    },
                  },
                },
                {
                  name: 'PEECARE_PAIR_CODE_HMAC_KEY',
                  valueSource: {
                    secretKeyRef: {
                      secret: 'peecare-pair-code-hmac-key',
                      version: '5',
                    },
                  },
                },
              ],
            },
          ],
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
      ...inspectedRuntimeConfiguration(),
    })
  })

  it.each(['{}', '[{}]'])(
    'rejects malformed Secret Manager inventory %s',
    async (inventory) => {
      const execute = vi.fn((args: readonly string[]) => {
        if (args[1] === 'services') {
          return JSON.stringify({ status: { url: serviceUrl } })
        }
        if (args[1] === 'revisions') {
          return JSON.stringify({
            metadata: { name: revision },
            spec: {
              containers: [{ image }],
              serviceAccountName:
                'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
            },
          })
        }
        if (args[0] === 'projects') return '{"bindings":[]}'
        if (args[0] === 'secrets' && args[1] === 'list') return inventory
        return '{"bindings":[]}'
      })

      await expect(
        createCliRevisionInspector(execute)({
          projectId: 'petcare-c7483',
          region: 'asia-east1',
          service: 'peecare-member-development',
          revision,
        }),
      ).rejects.toMatchObject({ code: 'cloud_inspection_failed' })
    },
  )

  it('preserves a __proto__ secret as own IAM evidence instead of mutating the record prototype', async () => {
    const member =
      'serviceAccount:peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
    const execute = vi.fn((args: readonly string[]) => {
      if (args[1] === 'services') {
        return JSON.stringify({ status: { url: serviceUrl } })
      }
      if (args[1] === 'revisions') {
        return JSON.stringify({
          metadata: { name: revision },
          spec: {
            containers: [{ image }],
            serviceAccountName:
              'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
          },
        })
      }
      if (args[0] === 'projects') return '{"bindings":[]}'
      if (args[0] === 'secrets' && args[1] === 'list') {
        return '[{"name":"__proto__"}]'
      }
      return JSON.stringify({
        bindings: [
          {
            role: 'roles/secretmanager.secretAccessor',
            members: [member],
          },
        ],
      })
    })

    const inspected = await createCliRevisionInspector(execute)({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-member-development',
      revision,
    })

    expect(
      Object.prototype.hasOwnProperty.call(
        inspected.directIam?.secretAccess,
        '__proto__',
      ),
    ).toBe(true)
    expect(JSON.stringify(inspected.directIam?.secretAccess)).toContain(
      '__proto__',
    )
  })
})
