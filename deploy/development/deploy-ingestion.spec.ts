import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  loadIngestionManifest,
  runIngestionDeploy,
  type IngestionManifest,
} from './deploy-ingestion.mjs'

const immutableImage =
  'asia-east1-docker.pkg.dev/petcare-c7483/peecare/ingestion-api@sha256:' +
  'a'.repeat(64)
const approvedBudgetRecord =
  'billingAccounts/000000-111111-222222/budgets/33333333-4444-5555-6666-777777777777'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BUDGET_RECORD: approvedBudgetRecord,
    PEECARE_INGESTION_SECRET_CURRENT_REF:
      'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
    PEECARE_INGESTION_SECRET_PREVIOUS_REF:
      'projects/petcare-c7483/secrets/emqx-webhook-previous/versions/7',
  }
}

describe('development ingestion deployment', () => {
  it.each(['--dry-run', '--apply'])('rejects the specified mutable latest tag in %s mode before any gcloud mutation', (mode) => {
    const execute = vi.fn()

    expect(() =>
      runIngestionDeploy({
        environment: validEnvironment(),
        args: [
          mode,
          '--image',
          'asia-east1-docker.pkg.dev/petcare-c7483/peecare/ingestion-api:latest',
        ],
        manifest: loadIngestionManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'immutable_image_required' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('records the exact immutable digest in the dry-run plan without mutation', () => {
    const execute = vi.fn()
    const output: string[] = []

    const result = runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--dry-run', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute,
      write: (line) => output.push(line),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'ready',
      dryRun: true,
      image: immutableImage,
      imageDigest: `sha256:${'a'.repeat(64)}`,
    })
    expect(JSON.parse(output[0])).toEqual(result)
  })

  it('deploys and records the exact immutable digest in apply mode', () => {
    const execute = vi.fn(() => ({ status: 0 }))

    const result = runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--apply', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        'run',
        'deploy',
        'peecare-ingestion-development',
        '--image',
        immutableImage,
      ]),
    )
    expect(result).toMatchObject({
      status: 'deployed',
      image: immutableImage,
      imageDigest: `sha256:${'a'.repeat(64)}`,
    })
  })

  it('emits the dedicated identity, least-privilege IAM, and versioned secret references without values or key material', () => {
    const environment = {
      ...validEnvironment(),
      EMQX_WEBHOOK_SECRET_CURRENT: 'resolved-current-secret-value',
      EMQX_WEBHOOK_SECRET_PREVIOUS: 'resolved-previous-secret-value',
      GOOGLE_APPLICATION_CREDENTIALS: '{"private_key":"not-for-runtime"}',
    }

    const result = runIngestionDeploy({
      environment,
      args: ['--dry-run', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      runtimeIdentity:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
      iam: {
        projectRoles: ['roles/datastore.user'],
        secretAccessorRole: 'roles/secretmanager.secretAccessor',
      },
      secretRefs: {
        EMQX_WEBHOOK_SECRET_CURRENT:
          'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
        EMQX_WEBHOOK_SECRET_PREVIOUS:
          'projects/petcare-c7483/secrets/emqx-webhook-previous/versions/7',
      },
    })
    expect(JSON.stringify(result)).not.toContain('resolved-current-secret-value')
    expect(JSON.stringify(result)).not.toContain('resolved-previous-secret-value')
    expect(JSON.stringify(result)).not.toContain('private_key')
  })

  it('accepts the approved numeric project identifier in a Secret Manager version resource', () => {
    const currentRef =
      'projects/348528459946/secrets/peecare-emqx-webhook-current/versions/1'

    const result = runIngestionDeploy({
      environment: {
        ...validEnvironment(),
        PEECARE_INGESTION_SECRET_CURRENT_REF: currentRef,
        PEECARE_INGESTION_SECRET_PREVIOUS_REF: undefined,
      },
      args: ['--dry-run', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result.secretRefs).toEqual({
      EMQX_WEBHOOK_SECRET_CURRENT: currentRef,
    })
  })

  it.each([
    ['missing current ref', { PEECARE_INGESTION_SECRET_CURRENT_REF: undefined }],
    [
      'mutable current ref',
      {
        PEECARE_INGESTION_SECRET_CURRENT_REF:
          'projects/petcare-c7483/secrets/emqx-webhook-current/versions/latest',
      },
    ],
    [
      'duplicate rotation refs',
      {
        PEECARE_INGESTION_SECRET_PREVIOUS_REF:
          'projects/petcare-c7483/secrets/emqx-webhook-current/versions/1',
      },
    ],
  ])('rejects %s before mutation', (_case, overrides) => {
    const execute = vi.fn()

    expect(() =>
      runIngestionDeploy({
        environment: { ...validEnvironment(), ...overrides },
        args: ['--apply', '--image', immutableImage],
        manifest: loadIngestionManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_secret_reference' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('deploys with the dedicated service account and Secret Manager mounts', () => {
    const execute = vi.fn(() => ({
      status: 0,
      stdout:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com\n',
    }))

    runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--apply', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        '--service-account',
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
        '--set-secrets',
        'EMQX_WEBHOOK_SECRET_CURRENT=emqx-webhook-current:1,EMQX_WEBHOOK_SECRET_PREVIOUS=emqx-webhook-previous:7',
      ]),
    )
    expect(execute).toHaveBeenCalledWith('gcloud', [
      'projects',
      'add-iam-policy-binding',
      'petcare-c7483',
      '--member',
      'serviceAccount:peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
      '--role',
      'roles/datastore.user',
      '--condition=None',
      '--quiet',
    ])
    expect(execute).toHaveBeenCalledWith('gcloud', [
      'secrets',
      'add-iam-policy-binding',
      'emqx-webhook-current',
      '--project',
      'petcare-c7483',
      '--member',
      'serviceAccount:peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
      '--role',
      'roles/secretmanager.secretAccessor',
      '--condition=None',
      '--quiet',
    ])
    expect(execute).toHaveBeenCalledWith('gcloud', [
      'secrets',
      'add-iam-policy-binding',
      'emqx-webhook-previous',
      '--project',
      'petcare-c7483',
      '--member',
      'serviceAccount:peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com',
      '--role',
      'roles/secretmanager.secretAccessor',
      '--condition=None',
      '--quiet',
    ])
  })

  it('creates the dedicated runtime identity when the approved account is absent', () => {
    const execute = vi.fn((_command: string, args: readonly string[]) => ({
      status: 0,
      stdout: args[1] === 'service-accounts' && args[2] === 'list' ? '' : undefined,
    }))

    runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--apply', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith('gcloud', [
      'iam',
      'service-accounts',
      'create',
      'peecare-ingestion-runtime',
      '--project',
      'petcare-c7483',
      '--display-name',
      'PeeCare development ingestion runtime',
      '--quiet',
    ])
  })

  it('records the exact approved development resource gates in the dry-run plan', () => {
    const result = runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--dry-run', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-ingestion-development',
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
      { PEECARE_DEVELOPMENT_BUDGET_RECORD: 'billingBudgets/petcare-development' },
      {},
      'missing_budget_record',
    ],
    ['wrong service', {}, { service: 'peecare-ingestion' }, 'invalid_manifest'],
    ['wrong CPU', {}, { cpu: '2' }, 'invalid_manifest'],
    ['wrong memory', {}, { memory: '1Gi' }, 'invalid_manifest'],
    ['wrong timeout', {}, { timeoutSeconds: 0 }, 'invalid_manifest'],
    ['wrong concurrency', {}, { concurrency: 0 }, 'invalid_manifest'],
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
    (_case, environmentOverrides, manifestOverrides, expectedCode) => {
      const execute = vi.fn()
      const base = loadIngestionManifest()
      const manifest = {
        ...base,
        metadata: {
          ...base.metadata,
          ...(manifestOverrides.service
            ? { service: manifestOverrides.service }
            : {}),
        },
        resources: { ...base.resources, ...manifestOverrides },
      } as IngestionManifest

      expect(() =>
        runIngestionDeploy({
          environment: { ...validEnvironment(), ...environmentOverrides },
          args: ['--apply', '--image', immutableImage],
          manifest,
          execute,
          write: vi.fn(),
        }),
      ).toThrowError(expect.objectContaining({ code: expectedCode }))
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('passes the exact approved resource limits to Cloud Run', () => {
    const execute = vi.fn(() => ({
      status: 0,
      stdout:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com\n',
    }))

    runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--apply', '--image', immutableImage],
      manifest: loadIngestionManifest(),
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

  it('declares public network ingress while preserving application Bearer authentication', () => {
    const result = runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--dry-run', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      network: {
        ingress: 'all',
        allowUnauthenticated: true,
        publicHealthPath: '/health',
        protectedWebhookPath: '/v1/emqx/events',
        applicationAuth: 'bearer-current-or-previous',
      },
    })
  })

  it('configures Cloud Run for public ingress without describing network IAM as webhook authentication', () => {
    const execute = vi.fn(() => ({
      status: 0,
      stdout:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com\n',
    }))

    runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--apply', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining(['--ingress', 'all', '--allow-unauthenticated']),
    )
  })

  it('emits only the exact production runtime environment contract', () => {
    const result = runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--dry-run', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute: vi.fn(),
      write: vi.fn(),
    })

    expect(result).toMatchObject({
      runtimeEnvironment: {
        values: {
          NODE_ENV: 'production',
          GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
        },
        secretNames: [
          'EMQX_WEBHOOK_SECRET_CURRENT',
          'EMQX_WEBHOOK_SECRET_PREVIOUS',
        ],
        platformProvided: ['PORT'],
      },
    })
    expect(Object.keys(result.runtimeEnvironment.values)).toEqual([
      'NODE_ENV',
      'GOOGLE_CLOUD_PROJECT',
    ])
    expect(JSON.stringify(result)).not.toContain('FIRESTORE_EMULATOR_HOST')
  })

  it.each([
    ['manifest Emulator variable', 'FIRESTORE_EMULATOR_HOST', '127.0.0.1:8085'],
    ['unknown manifest variable', 'LOG_LEVEL', 'debug'],
  ])('rejects a %s before mutation', (_case, name, value) => {
    const execute = vi.fn()
    const base = loadIngestionManifest()
    const manifest = {
      ...base,
      runtimeEnvironment: {
        ...base.runtimeEnvironment,
        values: { ...base.runtimeEnvironment.values, [name]: value },
      },
    } as IngestionManifest

    expect(() =>
      runIngestionDeploy({
        environment: validEnvironment(),
        args: ['--apply', '--image', immutableImage],
        manifest,
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_runtime_environment' }),
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an operator Emulator variable before mutation', () => {
    const execute = vi.fn()

    expect(() =>
      runIngestionDeploy({
        environment: {
          ...validEnvironment(),
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
        },
        args: ['--apply', '--image', immutableImage],
        manifest: loadIngestionManifest(),
        execute,
        write: vi.fn(),
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'emulator_environment_forbidden' }),
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('sets exact production values while leaving PORT platform-provided', () => {
    const execute = vi.fn(() => ({
      status: 0,
      stdout:
        'peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com\n',
    }))

    runIngestionDeploy({
      environment: validEnvironment(),
      args: ['--apply', '--image', immutableImage],
      manifest: loadIngestionManifest(),
      execute,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith(
      'gcloud',
      expect.arrayContaining([
        '--set-env-vars',
        'NODE_ENV=production,GOOGLE_CLOUD_PROJECT=petcare-c7483',
      ]),
    )
    const calls = JSON.stringify(execute.mock.calls)
    expect(calls).not.toContain('FIRESTORE_EMULATOR_HOST')
    expect(calls).not.toContain('PORT=')
  })

  it('exposes the deployment command through the repository package interface', () => {
    const packageJson = JSON.parse(
      readFileSync('package.json', 'utf8'),
    )

    expect(packageJson.scripts['ingestion:development:deploy']).toBe(
      'node deploy/development/deploy-ingestion.mjs',
    )
  })

  it('builds the ingestion image from the repository-root Docker context', () => {
    const cloudBuild = JSON.parse(
      readFileSync('services/ingestion-api/cloudbuild.json', 'utf8'),
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
            'services/ingestion-api/Dockerfile',
            '--tag',
            '${_IMAGE}',
            '.',
          ],
        },
        {
          name: 'gcr.io/cloud-builders/docker',
          args: [
            'run',
            '--rm',
            '${_IMAGE}',
            'node',
            '--input-type=module',
            '--eval',
            "import('@peecare/device-events-contract').then(({ loadValidators }) => loadValidators())",
          ],
        },
      ],
      images: ['${_IMAGE}'],
    })
  })

  it('installs production dependencies beside the linked event contract in the runtime image', () => {
    const dockerfile = readFileSync(
      'services/ingestion-api/Dockerfile',
      'utf8',
    )
    const runtimeStage = dockerfile.slice(
      dockerfile.lastIndexOf('FROM node:22-alpine'),
    )

    expect(runtimeStage).toContain(
      'RUN npm --prefix /app/contracts/device-events ci --omit=dev',
    )
  })
})
