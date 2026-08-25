import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  loadMemberManifest,
  runMemberDeploy,
  type MemberManifest,
} from './deploy-member.mjs'

const immutableImage =
  'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:' +
  'a'.repeat(64)
const revisionSuffix = '00001-abc'
const approvedBudgetRecord =
  'billingAccounts/000000-111111-222222/budgets/33333333-4444-5555-6666-777777777777'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BUDGET_RECORD: approvedBudgetRecord,
    PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://petcare-c7483.web.app',
    PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF:
      'projects/petcare-c7483/secrets/peecare-claim-webhook-current/versions/3',
    PEECARE_PAIR_CODE_HMAC_KEY_REF:
      'projects/petcare-c7483/secrets/peecare-pair-code-hmac-key/versions/5',
    PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '5',
    PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'approved-legacy-device',
  }
}

describe('development Member API deployment', () => {
  it('loads a digest-only manifest for the exact development target', () => {
    expect(loadMemberManifest()).toMatchObject({
      apiVersion: 'peecare.dev/v1',
      kind: 'CloudRunService',
      metadata: {
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-member-development',
      },
      image: {
        digestPattern:
          '^asia-east1-docker\\.pkg\\.dev/petcare-c7483/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$',
      },
    })
  })

  it.each(['--dry-run', '--apply'])(
    'rejects a mutable latest tag in %s mode before any cloud mutation',
    (mode) => {
      const execute = vi.fn()

      expect(() =>
        runMemberDeploy({
          environment: validEnvironment(),
          args: [
            mode,
            '--image',
            'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api:latest',
            '--revision-suffix',
            revisionSuffix,
          ],
          manifest: loadMemberManifest(),
          execute,
          write: vi.fn(),
        }),
      ).toThrowError(expect.objectContaining({ code: 'immutable_image_required' }))
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('records the exact target, revision, and immutable digest in the dry-run plan', () => {
    const execute = vi.fn()
    const output: string[] = []

    const result = runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--dry-run',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute,
      write: (line) => output.push(line),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-member-development',
      revision: 'peecare-member-development-00001-abc',
      image: immutableImage,
      imageDigest: `sha256:${'a'.repeat(64)}`,
    })
    expect(JSON.parse(output[0])).toEqual(result)
  })

  it('deploys the exact immutable revision in apply mode', () => {
    const execute = vi.fn((_command: string, args: readonly string[]) => ({
      status: 0,
      stdout:
        args[0] === 'projects' && args[1] === 'get-iam-policy'
          ? '{"bindings":[]}'
          : args[0] === 'secrets' && args[1] === 'list'
            ? '[]'
            : '',
    }))

    const result = runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--apply',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        'run',
        'deploy',
        'peecare-member-development',
        '--project',
        'petcare-c7483',
        '--region',
        'asia-east1',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ]),
    )
    expect(result).toMatchObject({
      status: 'deployed',
      revision: 'peecare-member-development-00001-abc',
      imageDigest: `sha256:${'a'.repeat(64)}`,
    })
  })

  it('builds the Member API image from the repository-root Docker context', () => {
    const cloudBuild = JSON.parse(
      readFileSync('services/member-api/cloudbuild.json', 'utf8'),
    )

    expect(cloudBuild).toEqual({
      steps: [
        {
          name: 'gcr.io/cloud-builders/docker',
          args: [
            'build',
            '--platform',
            'linux/amd64',
            '--file',
            'services/member-api/Dockerfile',
            '--tag',
            '${_IMAGE}',
            '.',
          ],
        },
      ],
      images: ['${_IMAGE}'],
    })
  })

  it('rejects a manifest that changes the exact target before mutation', () => {
    const execute = vi.fn()
    const base = loadMemberManifest()
    const manifest = {
      ...base,
      metadata: { ...base.metadata, service: 'peecare-member' },
    } as MemberManifest

    expect(() =>
      runMemberDeploy({
        environment: validEnvironment(),
        args: [
          '--apply',
          '--image',
          immutableImage,
          '--revision-suffix',
          revisionSuffix,
        ],
        manifest,
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_manifest' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('emits the dedicated identity, least-privilege Firestore/Auth IAM, and ADC-only runtime contract', () => {
    const result = runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--dry-run',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      runtimeIdentity:
        'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
      iam: {
        projectRoles: ['roles/datastore.user', 'roles/firebaseauth.viewer'],
        secretAccess: [
          {
            secret: 'peecare-claim-webhook-current',
            role: 'roles/secretmanager.secretAccessor',
          },
          {
            secret: 'peecare-pair-code-hmac-key',
            role: 'roles/secretmanager.secretAccessor',
          },
        ],
      },
      runtimeEnvironment: {
        values: {
          NODE_ENV: 'production',
          GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
          PEECARE_WEB_ORIGIN: 'https://petcare-c7483.web.app',
        },
        platformProvided: ['PORT'],
        requiredValues: [
          'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
          'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
        ],
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
      persistenceAccess: {
        enforcement: {
          iam: 'database-wide-datastore-role-with-direct-binding-audit',
          logicalScope: 'application-repository-and-release-probe',
        },
        deviceRegistry: {
          reads: 'enabled-registry-fields-only',
          ownerUidMutation: 'first-set-only',
        },
        claimCollections: {
          deviceClaimSessions: ['create', 'read', 'update'],
          activeDeviceClaims: ['create', 'read', 'update'],
        },
        deniedMutations: [
          'owner-transfer',
          'device-delete',
          'device-child-write',
        ],
      },
    })
    expect(JSON.stringify(result)).not.toMatch(
      /GOOGLE_APPLICATION_CREDENTIALS|private_key|EMQX_WEBHOOK_SECRET|FIRESTORE_EMULATOR_HOST|approved-legacy-device/,
    )
  })

  it.each([
    ['missing Claim secret', { PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF: undefined }, 'invalid_claim_secret_reference'],
    ['unapproved Claim secret', { PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF: 'projects/petcare-c7483/secrets/other/versions/3' }, 'invalid_claim_secret_reference'],
    ['missing HMAC key', { PEECARE_PAIR_CODE_HMAC_KEY_REF: undefined }, 'invalid_hmac_secret_reference'],
    ['non-numeric HMAC key', { PEECARE_PAIR_CODE_HMAC_KEY_REF: 'projects/petcare-c7483/secrets/peecare-pair-code-hmac-key/versions/latest' }, 'invalid_hmac_secret_reference'],
    ['equal references', { PEECARE_PAIR_CODE_HMAC_KEY_REF: 'projects/petcare-c7483/secrets/peecare-claim-webhook-current/versions/3' }, 'claim_credentials_not_independent'],
    ['HMAC version mismatch', { PEECARE_PAIR_CODE_HMAC_KEY_VERSION: '4' }, 'invalid_hmac_key_version'],
    ['missing shared username', { PEECARE_CLAIM_SHARED_MQTT_USERNAME: undefined }, 'invalid_shared_publisher'],
    ['different bounded shared username', { PEECARE_CLAIM_SHARED_MQTT_USERNAME: 'not-the-fixed-policy-publisher' }, 'invalid_shared_publisher'],
  ])('rejects %s before IAM or Cloud Run mutation', (_case, overrides, code) => {
    const execute = vi.fn()

    expect(() => runMemberDeploy({
      environment: { ...validEnvironment(), ...overrides },
      args: ['--apply', '--image', immutableImage, '--revision-suffix', revisionSuffix],
      manifest: loadMemberManifest(),
      execute,
      write: vi.fn(),
    })).toThrowError(expect.objectContaining({ code }))
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['service-account key path', 'GOOGLE_APPLICATION_CREDENTIALS', '/tmp/key.json'],
    ['Firestore Emulator', 'FIRESTORE_EMULATOR_HOST', '127.0.0.1:8085'],
    ['Auth Emulator', 'FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099'],
    ['Ingestion secret', 'EMQX_WEBHOOK_SECRET_CURRENT', 'secret'],
    ['unsupported Claim secret alias', 'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT', 'secret'],
    ['unsupported HMAC key alias', 'PEECARE_PAIR_CODE_HMAC_KEY_CURRENT', 'secret'],
    ['unsupported Claim password alias', 'PEECARE_CLAIM_WEBHOOKPASSWORD', 'secret'],
    ['unsupported HMAC compact alias', 'PEECARE_PAIR_CODE_HMACKEY', 'secret'],
    ['unsupported Pair Code key alias', 'PEECARE_PAIR_CODE_KEY', 'secret'],
    ['unsupported Claim credential alias', 'PEECARE_CLAIM_CREDENTIAL', 'secret'],
    ['unsupported Claim authorization alias', 'PEECARE_CLAIM_AUTHORIZATION', 'secret'],
    ['unsupported Claim API key alias', 'PEECARE_CLAIM_APIKEY', 'secret'],
  ])('rejects operator %s before any cloud mutation', (_case, key, value) => {
    const execute = vi.fn()

    expect(() =>
      runMemberDeploy({
        environment: { ...validEnvironment(), [key]: value },
        args: [
          '--apply',
          '--image',
          immutableImage,
          '--revision-suffix',
          revisionSuffix,
        ],
        manifest: loadMemberManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'forbidden_runtime_configuration' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('grants only the approved project roles and per-secret access to the dedicated runtime identity', () => {
    const execute = vi.fn((_command: string, args: readonly string[]) => ({
      status: 0,
      stdout:
        args[0] === 'projects' && args[1] === 'get-iam-policy'
          ? '{"bindings":[]}'
          : args[0] === 'secrets' && args[1] === 'list'
            ? '[]'
            : '',
    }))

    runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--apply',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith('gcloud', [
      'iam',
      'service-accounts',
      'create',
      'peecare-member-runtime',
      '--project',
      'petcare-c7483',
      '--display-name',
      'PeeCare development Member API runtime',
      '--quiet',
    ])
    expect(execute).toHaveBeenCalledWith('gcloud', [
      'projects',
      'add-iam-policy-binding',
      'petcare-c7483',
      '--member',
      'serviceAccount:peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
      '--role',
      'roles/datastore.user',
      '--condition=None',
      '--quiet',
    ])
    expect(execute).toHaveBeenCalledWith('gcloud', [
      'projects',
      'add-iam-policy-binding',
      'petcare-c7483',
      '--member',
      'serviceAccount:peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
      '--role',
      'roles/firebaseauth.viewer',
      '--condition=None',
      '--quiet',
    ])
    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        '--service-account',
        'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
      ]),
    )
    for (const secret of [
      'peecare-claim-webhook-current',
      'peecare-pair-code-hmac-key',
    ]) {
      expect(execute).toHaveBeenCalledWith('gcloud', [
        'secrets',
        'add-iam-policy-binding',
        secret,
        '--project',
        'petcare-c7483',
        '--member',
        'serviceAccount:peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
        '--role',
        'roles/secretmanager.secretAccessor',
        '--condition=None',
        '--quiet',
      ])
    }
    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        '--set-secrets',
        'PEECARE_CLAIM_WEBHOOK_SECRET=peecare-claim-webhook-current:3,PEECARE_PAIR_CODE_HMAC_KEY=peecare-pair-code-hmac-key:5',
      ]),
    )
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(
      /roles\/(?:owner|editor|firebase\.admin)/,
    )
  })

  it('rejects a newly created runtime identity with a pre-provisioned unapproved direct project role', () => {
    const serviceAccount =
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
    const member = `serviceAccount:${serviceAccount}`
    const execute = vi.fn((_command: string, args: readonly string[]) => {
      if (args[1] === 'service-accounts' && args[2] === 'list') {
        return { status: 0, stdout: '' }
      }
      if (args[1] === 'get-iam-policy') {
        return {
          status: 0,
          stdout: JSON.stringify({
            bindings: [{ role: 'roles/owner', members: [member] }],
          }),
        }
      }
      return { status: 0, stdout: '{"bindings":[]}' }
    })

    expect(() =>
      runMemberDeploy({
        environment: validEnvironment(),
        args: [
          '--apply',
          '--image',
          immutableImage,
          '--revision-suffix',
          revisionSuffix,
        ],
        manifest: loadMemberManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'iam_drift_detected' }))
    expect(execute).not.toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining(['run', 'deploy']),
    )
  })

  it('rejects direct runtime access to a non-allowlisted __proto__ project secret', () => {
    const serviceAccount =
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
    const member = `serviceAccount:${serviceAccount}`
    const execute = vi.fn((_command: string, args: readonly string[]) => {
      if (args[1] === 'service-accounts' && args[2] === 'list') {
        return { status: 0, stdout: `${serviceAccount}\n` }
      }
      if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
        return { status: 0, stdout: '{"bindings":[]}' }
      }
      if (args[0] === 'secrets' && args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([{ name: '__proto__' }]),
        }
      }
      if (args[0] === 'secrets' && args[1] === 'get-iam-policy') {
        return {
          status: 0,
          stdout: JSON.stringify({
            bindings: [
              {
                role: 'roles/secretmanager.secretAccessor',
                members: [member],
              },
            ],
          }),
        }
      }
      return { status: 0, stdout: '' }
    })

    expect(() =>
      runMemberDeploy({
        environment: validEnvironment(),
        args: [
          '--apply',
          '--image',
          immutableImage,
          '--revision-suffix',
          revisionSuffix,
        ],
        manifest: loadMemberManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'iam_drift_detected' }))
    expect(execute).not.toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining(['run', 'deploy']),
    )
  })

  it.each([
    ['non-array inventory', '{}'],
    ['malformed inventory entry', '[{}]'],
    ['empty inventory output', ''],
  ])('rejects %s before IAM grants or Cloud Run deployment', (_case, inventory) => {
    const serviceAccount =
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
    const execute = vi.fn((_command: string, args: readonly string[]) => {
      if (args[1] === 'service-accounts' && args[2] === 'list') {
        return { status: 0, stdout: `${serviceAccount}\n` }
      }
      if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
        return { status: 0, stdout: '{"bindings":[]}' }
      }
      if (args[0] === 'secrets' && args[1] === 'list') {
        return { status: 0, stdout: inventory }
      }
      return { status: 0, stdout: '{"bindings":[]}' }
    })

    expect(() =>
      runMemberDeploy({
        environment: validEnvironment(),
        args: [
          '--apply',
          '--image',
          immutableImage,
          '--revision-suffix',
          revisionSuffix,
        ],
        manifest: loadMemberManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'iam_binding_failed' }))
    expect(execute).not.toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining(['run', 'deploy']),
    )
  })

  it.each([
    ['empty project policy', '', '[]', '{"bindings":[]}'],
    [
      'empty secret policy',
      '{"bindings":[]}',
      '[{"name":"peecare-claim-webhook-current"}]',
      '',
    ],
  ])(
    'rejects %s before IAM grants or Cloud Run deployment',
    (_case, projectPolicy, inventory, secretPolicy) => {
      const serviceAccount =
        'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
      const execute = vi.fn((_command: string, args: readonly string[]) => {
        if (args[1] === 'service-accounts' && args[2] === 'list') {
          return { status: 0, stdout: `${serviceAccount}\n` }
        }
        if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
          return { status: 0, stdout: projectPolicy }
        }
        if (args[0] === 'secrets' && args[1] === 'list') {
          return { status: 0, stdout: inventory }
        }
        if (args[0] === 'secrets' && args[1] === 'get-iam-policy') {
          return { status: 0, stdout: secretPolicy }
        }
        return { status: 0, stdout: '' }
      })

      expect(() =>
        runMemberDeploy({
          environment: validEnvironment(),
          args: [
            '--apply',
            '--image',
            immutableImage,
            '--revision-suffix',
            revisionSuffix,
          ],
          manifest: loadMemberManifest(),
          execute,
          write: vi.fn(),
        }),
      ).toThrowError(expect.objectContaining({ code: 'iam_binding_failed' }))
      expect(execute).not.toHaveBeenCalledWith(
        'gcloud',
        expect.arrayContaining(['run', 'deploy']),
      )
    },
  )

  it('contains no service-account private key material in deployment artifacts', () => {
    const deploymentArtifacts = [
      'deploy/development/member-service.yaml',
      'deploy/development/deploy-member.mjs',
      'services/member-api/Dockerfile',
      'services/member-api/cloudbuild.json',
    ]

    for (const path of deploymentArtifacts) {
      expect(readFileSync(path, 'utf8')).not.toMatch(
        /-----BEGIN PRIVATE KEY-----|"private_key"\s*:|"private_key_id"\s*:/,
      )
    }
  })

  it('records the exact approved development resource gates in the dry-run plan', () => {
    const result = runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--dry-run',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      resources: {
        billing: 'request-based',
        cpu: '1',
        memory: '512Mi',
        timeoutSeconds: 60,
        concurrency: 20,
        minInstances: 0,
        maxInstances: 2,
      },
      budgetRecord: approvedBudgetRecord,
    })
  })

  it.each([
    [
      'wrong project inventory',
      { PEECARE_DEVELOPMENT_PROJECT_ID: 'demo-peecare' },
      {},
      'target_mismatch',
    ],
    [
      'wrong region inventory',
      { PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'us-central1' },
      {},
      'target_mismatch',
    ],
    [
      'missing budget approval',
      { PEECARE_DEVELOPMENT_BUDGET_RECORD: undefined },
      {},
      'missing_budget_record',
    ],
    [
      'malformed budget approval',
      { PEECARE_DEVELOPMENT_BUDGET_RECORD: 'budgets/development' },
      {},
      'missing_budget_record',
    ],
    ['wrong CPU', {}, { cpu: '2' }, 'invalid_manifest'],
    ['wrong memory', {}, { memory: '1Gi' }, 'invalid_manifest'],
    ['zero timeout', {}, { timeoutSeconds: 0 }, 'invalid_manifest'],
    ['zero concurrency', {}, { concurrency: 0 }, 'invalid_manifest'],
    ['nonzero minimum', {}, { minInstances: 1 }, 'invalid_manifest'],
    ['wrong maximum', {}, { maxInstances: 3 }, 'invalid_manifest'],
    [
      'instance-based billing',
      {},
      { billing: 'instance-based' },
      'invalid_manifest',
    ],
  ])(
    'rejects %s before every cloud mutation',
    (_case, environmentOverrides, resourceOverrides, expectedCode) => {
      const execute = vi.fn()
      const base = loadMemberManifest()
      const manifest = {
        ...base,
        resources: { ...base.resources, ...resourceOverrides },
      } as MemberManifest

      expect(() =>
        runMemberDeploy({
          environment: { ...validEnvironment(), ...environmentOverrides },
          args: [
            '--apply',
            '--image',
            immutableImage,
            '--revision-suffix',
            revisionSuffix,
          ],
          manifest,
          execute,
          write: vi.fn(),
        }),
      ).toThrowError(expect.objectContaining({ code: expectedCode }))
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('rejects a missing image digest before every cloud mutation', () => {
    const execute = vi.fn()

    expect(() =>
      runMemberDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        manifest: loadMemberManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError()
    expect(execute).not.toHaveBeenCalled()
  })

  it('passes the exact approved resource limits to Cloud Run', () => {
    const serviceAccount =
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
    const execute = vi.fn((_command: string, args: readonly string[]) => ({
      status: 0,
      stdout:
        args[1] === 'service-accounts' && args[2] === 'list'
          ? `${serviceAccount}\n`
          : args[0] === 'secrets' && args[1] === 'list'
            ? '[]'
          : args[1] === 'get-iam-policy' || args[2] === 'get-iam-policy'
            ? '{"bindings":[]}'
            : '',
    }))

    runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--apply',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        '--cpu',
        '1',
        '--memory',
        '512Mi',
        '--timeout',
        '60s',
        '--concurrency',
        '20',
        '--min-instances',
        '0',
        '--max-instances',
        '2',
        '--cpu-throttling',
      ]),
    )
  })

  it('declares public transport while preserving revoked-aware member authorization', () => {
    const result = runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--dry-run',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      network: {
        ingress: 'all',
        allowUnauthenticated: true,
        publicHealthPath: '/health',
        protectedMutationPath: '/v1/devices/:deviceId/display-name',
        applicationAuth: 'firebase-id-token-revoked-aware-owner',
        allowedOrigin: 'https://petcare-c7483.web.app',
      },
    })
  })

  it('configures public Cloud Run invocation without weakening application authorization', () => {
    const serviceAccount =
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com'
    const execute = vi.fn((_command: string, args: readonly string[]) => ({
      status: 0,
      stdout:
        args[1] === 'service-accounts' && args[2] === 'list'
          ? `${serviceAccount}\n`
          : args[0] === 'secrets' && args[1] === 'list'
            ? '[]'
          : args[1] === 'get-iam-policy' || args[2] === 'get-iam-policy'
            ? '{"bindings":[]}'
            : '',
    }))

    runMemberDeploy({
      environment: validEnvironment(),
      args: [
        '--apply',
        '--image',
        immutableImage,
        '--revision-suffix',
        revisionSuffix,
      ],
      manifest: loadMemberManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining(['--ingress', 'all', '--allow-unauthenticated']),
    )
  })
})
