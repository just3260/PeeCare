import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  createCloudRunServiceSpec,
  loadTestToolManifest,
  normalizeRevisionInspection,
  runTestToolDeploy,
  runTestToolDeployCli,
  runTestToolRollback,
} from './deploy-test-tool.mjs'

const image =
  `asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@sha256:${'a'.repeat(64)}`
const secretRef =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/7'
const budget =
  'billingAccounts/000000-111111-222222/budgets/33333333-4444-5555-6666-777777777777'
const suffix = '00001-abc'

function environment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BUDGET_RECORD: budget,
    PEECARE_TEST_TOOL_INGESTION_SECRET_REF: secretRef,
  }
}

function successfulExecute(identity = '') {
  return vi.fn((_command: string, args: readonly string[]) => {
    if (args.includes('service-accounts') && args.includes('list')) {
      return { status: 0, stdout: identity }
    }
    if (args.includes('service-accounts') && args.includes('describe')) {
      return { status: 0, stdout: JSON.stringify({ email: identity, disabled: false }) }
    }
    if (args.includes('service-accounts') && args.includes('keys')) {
      return { status: 0, stdout: '[]' }
    }
    if (args.includes('get-iam-policy')) {
      return { status: 0, stdout: JSON.stringify({ bindings: [] }) }
    }
    if (args.includes('artifacts')) {
      return { status: 0, stdout: JSON.stringify({
        image_summary: { fully_qualified_digest: image, digest: `sha256:${'a'.repeat(64)}` },
      }) }
    }
    if (args.includes('versions') && args.includes('describe')) {
      return { status: 0, stdout: JSON.stringify({ name: secretRef, state: 'ENABLED' }) }
    }
    if (args.includes('budgets') && args.includes('describe')) {
      return { status: 0, stdout: JSON.stringify({ name: budget }) }
    }
    return { status: 0, stdout: '' }
  })
}

function isMutation(args: readonly string[]): boolean {
  return args.includes('create') || args.includes('add-iam-policy-binding') ||
    args.includes('replace')
}

function revisionRecord(overrides: {
  readonly annotation?: string
  readonly items?: readonly Record<string, unknown>[]
  readonly mounts?: readonly Record<string, unknown>[]
  readonly volumes?: readonly Record<string, unknown>[]
} = {}) {
  const secretVolume = {
    name: 'ingestion-secret',
    secret: {
      secretName: 'peecare-emqx-webhook-current',
      items: overrides.items ?? [{ key: '7', path: 'ingestion-secret', mode: 384 }],
    },
  }
  return {
    metadata: {
      name: 'peecare-test-tool-development-00001-abc',
      annotations: {
        'run.googleapis.com/execution-environment': overrides.annotation ?? 'gen1',
      },
    },
    spec: {
      serviceAccountName: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      containers: [{
        image,
        volumeMounts: overrides.mounts ?? [
          { name: 'ingestion-secret', mountPath: '/var/run/secrets/peecare' },
        ],
      }],
      volumes: overrides.volumes ?? [secretVolume],
    },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  }
}

function approvedRuntimeAccess() {
  const email = 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com'
  const member = `serviceAccount:${email}`
  return {
    identity: { email, disabled: false },
    userManagedKeys: [],
    projectPolicy: { bindings: [
      { role: 'roles/datastore.user', members: [member] },
      { role: 'roles/firebaseauth.viewer', members: [member] },
    ] },
    secretPolicy: { bindings: [{
      role: 'roles/secretmanager.secretAccessor',
      members: [member],
      condition: {
        title: 'peecare-test-tool-secret-version-7',
        expression:
          'resource.name == "projects/348528459946/secrets/peecare-emqx-webhook-current/versions/7"',
      },
    }] },
  }
}

describe('development Test Tool API deployment', () => {
  it('loads the exact independent immutable service contract', () => {
    expect(loadTestToolManifest()).toMatchObject({
      metadata: {
        projectId: 'petcare-c7483',
        projectNumber: '348528459946',
        region: 'asia-east1',
        service: 'peecare-test-tool-development',
      },
      runtimeIdentity: {
        serviceAccount:
          'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      },
      resources: { billing: 'request-based', minInstances: 0, maxInstances: 2, concurrency: 20 },
      secretMount: {
        secretName: 'peecare-emqx-webhook-current',
        runtimePath: '/var/run/secrets/peecare/ingestion-secret',
        defaultMode: 384,
      },
    })
  })

  it('emits a sanitized zero-mutation dry-run plan', () => {
    const execute = vi.fn()
    const output: string[] = []
    const result = runTestToolDeploy({
      environment: environment(),
      args: ['--dry-run', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(),
      execute,
      write: (line) => output.push(line),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision: 'peecare-test-tool-development-00001-abc',
      image,
      imageDigest: `sha256:${'a'.repeat(64)}`,
      runtimeIdentity:
        'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      secretRef,
      budgetRecord: budget,
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(output[0]).not.toMatch(/resolved.?secret|secret.?value|private.?key|bearer\s/i)
  })

  it.each(['--dry-run', '--apply'])('rejects mutable images in %s before cloud calls', (mode) => {
    const execute = vi.fn()
    expect(() => runTestToolDeploy({
      environment: environment(),
      args: [mode, '--image', image.replace(/@sha256:.+$/, ':latest'), '--revision-suffix', suffix],
      manifest: loadTestToolManifest(),
      execute,
      write: vi.fn(),
    })).toThrowError(expect.objectContaining({ code: 'immutable_image_required' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong project', { PEECARE_DEVELOPMENT_PROJECT_ID: 'demo-peecare' }, 'target_mismatch'],
    ['wrong region', { PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'us-central1' }, 'target_mismatch'],
    ['missing budget', { PEECARE_DEVELOPMENT_BUDGET_RECORD: undefined }, 'missing_budget_record'],
    ['latest secret', { PEECARE_TEST_TOOL_INGESTION_SECRET_REF: secretRef.replace('/7', '/latest') }, 'invalid_secret_reference'],
    ['wrong secret', { PEECARE_TEST_TOOL_INGESTION_SECRET_REF: secretRef.replace('emqx-webhook-current', 'other') }, 'invalid_secret_reference'],
  ])('rejects %s before any cloud mutation', (_case, override, code) => {
    const execute = vi.fn()
    expect(() => runTestToolDeploy({
      environment: { ...environment(), ...override },
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(),
      execute,
      write: vi.fn(),
    })).toThrowError(expect.objectContaining({ code }))
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['resolved generic secret', { INGESTION_SECRET: 'must-never-propagate' }],
    ['webhook secret', { EMQX_WEBHOOK_SECRET: 'must-never-propagate' }],
    ['token', { CLOUD_ACCESS_TOKEN: 'must-never-propagate' }],
    ['password', { OPERATOR_PASSWORD: 'must-never-propagate' }],
  ])('rejects %s in the operator environment before adapter calls', (_case, unsafe) => {
    const execute = vi.fn()
    const output: string[] = []
    expect(() => runTestToolDeploy({
      environment: { ...environment(), ...unsafe },
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute,
      write: (line) => output.push(line),
    })).toThrowError(expect.objectContaining({ code: 'forbidden_runtime_configuration' }))
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(output)).not.toContain('must-never-propagate')
  })

  it.each([
    ['missing image', 'image'],
    ['disabled secret', 'secret'],
    ['wrong budget', 'budget'],
  ])('read-only preflight rejects a valid-looking %s before cloud mutation', (_case, failure) => {
    const execute = successfulExecute()
    execute.mockImplementation((_command, args) => {
      if (failure === 'image' && args.includes('artifacts')) return { status: 1, stdout: '' }
      if (failure === 'secret' && args.includes('versions')) {
        return { status: 0, stdout: JSON.stringify({ name: secretRef, state: 'DISABLED' }) }
      }
      if (failure === 'budget' && args.includes('budgets')) {
        return { status: 0, stdout: JSON.stringify({ name: `${budget}-other` }) }
      }
      return successfulExecute()(_command, args)
    })

    expect(() => runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute, write: vi.fn(),
    })).toThrowError(expect.objectContaining({
      code: failure === 'image'
        ? 'image_preflight_failed'
        : failure === 'secret' ? 'secret_preflight_failed' : 'budget_preflight_failed',
    }))
    expect(execute.mock.calls.some(([, args]) => isMutation(args))).toBe(false)
  })

  it('normalizes an approved project-number secret reference before records and deployment', () => {
    const result = runTestToolDeploy({
      environment: {
        ...environment(),
        PEECARE_TEST_TOOL_INGESTION_SECRET_REF:
          secretRef.replace('petcare-c7483', '348528459946'),
      },
      args: ['--dry-run', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute: vi.fn(), write: vi.fn(),
    })
    expect(result.secretRef).toBe(secretRef)
  })

  it('generates a platform-compatible gen1 0600 numeric secret volume', () => {
    const manifest = loadTestToolManifest()
    const spec = createCloudRunServiceSpec(
      manifest, image, suffix, { reference: secretRef, version: '7' },
    )
    expect(spec.spec.template).toMatchObject({
      metadata: { annotations: { 'run.googleapis.com/execution-environment': 'gen1' } },
      spec: {
        containers: [{ volumeMounts: [{
          name: 'ingestion-secret', mountPath: '/var/run/secrets/peecare',
        }] }],
        volumes: [{ secret: { items: [{ key: '7', path: 'ingestion-secret', mode: 384 }] } }],
      },
    })
  })

  it('rejects a changed runtime identity before mutation', () => {
    const base = loadTestToolManifest()
    const execute = vi.fn()
    expect(() => runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: {
        ...base,
        runtimeIdentity: { ...base.runtimeIdentity, accountId: 'shared-runtime' },
      },
      execute,
      write: vi.fn(),
    })).toThrowError(expect.objectContaining({ code: 'invalid_manifest' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('creates the dedicated identity, grants exact IAM, mounts one numeric secret, and deploys bounded resources', () => {
    const execute = successfulExecute()
    const cleanup = vi.fn()
    const stage = vi.fn(() => ({ path: '/private/tmp/test-tool-service.json', cleanup }))
    const result = runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(),
      execute,
      stage,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenCalledWith('gcloud', expect.arrayContaining([
      'run', 'services', 'replace', '/private/tmp/test-tool-service.json',
    ]))
    for (const role of ['roles/datastore.user', 'roles/firebaseauth.viewer']) {
      expect(execute).toHaveBeenCalledWith('gcloud', expect.arrayContaining([
        'projects', 'add-iam-policy-binding', 'petcare-c7483', '--role', role,
      ]))
    }
    expect(execute).toHaveBeenCalledWith('gcloud', expect.arrayContaining([
      'secrets', 'add-iam-policy-binding', 'peecare-emqx-webhook-current',
      '--role', 'roles/secretmanager.secretAccessor',
    ]))
    expect(execute).toHaveBeenCalledWith('gcloud', expect.arrayContaining([
      '--condition',
      'expression=resource.name == "projects/348528459946/secrets/peecare-emqx-webhook-current/versions/7",title=peecare-test-tool-secret-version-7',
    ]))
    expect(result).toMatchObject({ status: 'deployed', revision: 'peecare-test-tool-development-00001-abc' })
    const serviceSpec = stage.mock.calls[0][0]
    expect(serviceSpec).toMatchObject({
      metadata: {
        namespace: '348528459946',
        annotations: { 'run.googleapis.com/invoker-iam-disabled': 'true' },
      },
      spec: {
        template: {
          metadata: { annotations: { 'run.googleapis.com/execution-environment': 'gen1' } },
          spec: {
            serviceAccountName: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
            containerConcurrency: 20,
            containers: [{ image }],
            volumes: [{ secret: {
              secretName: 'peecare-emqx-webhook-current',
              items: [{ key: '7', path: 'ingestion-secret', mode: 384 }],
            } }],
          },
        },
      },
    })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(JSON.stringify(execute.mock.calls)).not.toContain('resolved-secret-value')
    expect(execute.mock.calls.some(([, args]) =>
      args.includes('run') && args.includes('services') &&
      args.includes('add-iam-policy-binding'))).toBe(false)
  })

  it.each([
    ['disabled identity', 'disabled'],
    ['user-managed key', 'user-key'],
    ['extra project role', 'project-role'],
    ['unconditional secret access', 'secret-role'],
  ])('rejects an existing identity with %s before mutation', (_case, failure) => {
    const email = 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com'
    const execute = successfulExecute(email)
    execute.mockImplementation((_command, args) => {
      if (args.includes('service-accounts') && args.includes('describe')) {
        return { status: 0, stdout: JSON.stringify({
          email, disabled: failure === 'disabled',
        }) }
      }
      if (args.includes('service-accounts') && args.includes('keys')) {
        return { status: 0, stdout: JSON.stringify(
          failure === 'user-key' ? [{ keyType: 'USER_MANAGED' }] : [],
        ) }
      }
      if (args.includes('projects') && args.includes('get-iam-policy')) {
        return { status: 0, stdout: JSON.stringify({ bindings: failure === 'project-role'
          ? [{ role: 'roles/owner', members: [`serviceAccount:${email}`] }]
          : [] }) }
      }
      if (args.includes('secrets') && args.includes('get-iam-policy')) {
        return { status: 0, stdout: JSON.stringify({ bindings: failure === 'secret-role'
          ? [{ role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:${email}`] }]
          : [] }) }
      }
      return successfulExecute(email)(_command, args)
    })

    expect(() => runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute, write: vi.fn(),
    })).toThrowError(expect.objectContaining({
      code: ['disabled', 'user-key'].includes(failure)
        ? 'runtime_identity_failed'
        : 'runtime_identity_overprivileged',
    }))
    expect(execute.mock.calls.some(([, args]) => isMutation(args))).toBe(false)
  })

  it('preserves a successful deployment and reports only a sanitized cleanup warning', () => {
    const cleanup = vi.fn(() => { throw new Error('private cleanup path') })
    const result = runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute: successfulExecute(), write: vi.fn(),
      stage: vi.fn(() => ({ path: '/private/tmp/service.json', cleanup })),
    })
    expect(result).toMatchObject({ status: 'deployed', warning: 'staging_cleanup_failed' })
    expect(JSON.stringify(result)).not.toContain('private cleanup path')
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('stages the exact service artifact before any IAM mutation', () => {
    const execute = successfulExecute()
    const stage = vi.fn(() => { throw new Error('disk unavailable') })
    expect(() => runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute, stage, write: vi.fn(),
    })).toThrow('disk unavailable')
    expect(execute.mock.calls.some(([, args]) => isMutation(args))).toBe(false)
  })

  it('preserves the primary replace failure when cleanup also fails', () => {
    const execute = successfulExecute()
    execute.mockImplementation((_command, args) => args.includes('replace')
      ? { status: 1, stdout: '' }
      : successfulExecute()(_command, args))
    const cleanup = vi.fn(() => { throw new Error('private cleanup path') })
    expect(() => runTestToolDeploy({
      environment: environment(),
      args: ['--apply', '--image', image, '--revision-suffix', suffix],
      manifest: loadTestToolManifest(), execute, write: vi.fn(),
      stage: vi.fn(() => ({ path: '/private/tmp/service.json', cleanup })),
    })).toThrowError(expect.objectContaining({ code: 'cloud_run_deploy_failed' }))
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('keeps the Cloud Build context immutable and repository-root scoped', () => {
    expect(JSON.parse(readFileSync('services/test-tool-api/cloudbuild.json', 'utf8'))).toEqual({
      steps: [{
        name: 'gcr.io/cloud-builders/docker',
        args: ['build', '--platform', 'linux/amd64', '--file', 'services/test-tool-api/Dockerfile', '--tag', '${_IMAGE}', '.'],
      }],
      images: ['${_IMAGE}'],
    })
  })

  it('resolves one inspected prior immutable revision without changing traffic', async () => {
    const executeTrafficMutation = vi.fn()
    const record = {
      status: 'healthy', projectId: 'petcare-c7483', region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision: 'peecare-test-tool-development-00002-def',
      imageDigest: `sha256:${'c'.repeat(64)}`, secretRef,
      priorHealthyRevision: {
        revision: 'peecare-test-tool-development-00001-abc',
        imageDigest: `sha256:${'b'.repeat(64)}`, secretRef,
      },
    }
    const result = await runTestToolRollback({
      args: ['--rollback-dry-run'], manifest: loadTestToolManifest(), releaseRecord: record,
      inspectRevision: vi.fn(async () => ({
        revision: record.priorHealthyRevision.revision,
        image: image.replace('a'.repeat(64), 'b'.repeat(64)),
        runtimeIdentity: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
        secretRef,
        secretMountContract: true,
        ready: true,
      })),
      inspectSecretAccess: vi.fn(async () => ({
        name: secretRef,
        state: 'ENABLED',
        condition: {
          title: 'peecare-test-tool-secret-version-7',
          expression:
            'resource.name == "projects/348528459946/secrets/peecare-emqx-webhook-current/versions/7"',
        },
      })),
      inspectRuntimeAccess: vi.fn(async () => approvedRuntimeAccess()),
      executeTrafficMutation,
      write: vi.fn(),
    })
    expect(executeTrafficMutation).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'ready', dryRun: true, targetRevision: record.priorHealthyRevision.revision })
  })

  it.each([
    ['disabled version', { state: 'DISABLED' }],
    ['wrong version name', { name: secretRef.replace('/7', '/8') }],
    ['unconditional accessor', { condition: undefined }],
    ['different version condition', { condition: {
      title: 'peecare-test-tool-secret-version-8',
      expression:
        'resource.name == "projects/348528459946/secrets/peecare-emqx-webhook-current/versions/8"',
    } }],
  ])('refuses rollback when secret access is %s', async (_case, accessOverride) => {
    const record = {
      status: 'healthy', projectId: 'petcare-c7483', region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision: 'peecare-test-tool-development-00002-def',
      imageDigest: `sha256:${'c'.repeat(64)}`, secretRef,
      priorHealthyRevision: {
        revision: 'peecare-test-tool-development-00001-abc',
        imageDigest: `sha256:${'b'.repeat(64)}`, secretRef,
      },
    }
    await expect(runTestToolRollback({
      args: ['--rollback-dry-run'], manifest: loadTestToolManifest(), releaseRecord: record,
      inspectRevision: vi.fn(async () => ({
        revision: record.priorHealthyRevision.revision,
        image: image.replace('a'.repeat(64), 'b'.repeat(64)),
        runtimeIdentity: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
        secretRef, secretMountContract: true, ready: true,
      })),
      inspectSecretAccess: vi.fn(async () => ({
        name: secretRef,
        state: 'ENABLED',
        condition: {
          title: 'peecare-test-tool-secret-version-7',
          expression:
            'resource.name == "projects/348528459946/secrets/peecare-emqx-webhook-current/versions/7"',
        },
        ...accessOverride,
      })),
      inspectRuntimeAccess: vi.fn(async () => approvedRuntimeAccess()),
      executeTrafficMutation: vi.fn(), write: vi.fn(),
    })).rejects.toMatchObject({ code: 'rollback_unavailable' })
  })

  it.each([
    ['disabled identity', (runtime: ReturnType<typeof approvedRuntimeAccess>) => ({
      ...runtime, identity: { ...runtime.identity, disabled: true },
    })],
    ['extra owner role', (runtime: ReturnType<typeof approvedRuntimeAccess>) => ({
      ...runtime,
      projectPolicy: { bindings: [
        ...runtime.projectPolicy.bindings,
        { role: 'roles/owner', members: [
          'serviceAccount:peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
        ] },
      ] },
    })],
    ['project secret accessor', (runtime: ReturnType<typeof approvedRuntimeAccess>) => ({
      ...runtime,
      projectPolicy: { bindings: [
        ...runtime.projectPolicy.bindings,
        { role: 'roles/secretmanager.secretAccessor', members: [
          'serviceAccount:peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
        ] },
      ] },
    })],
  ])('refuses rollback with %s and emits no traffic command', async (_case, alter) => {
    const executeTrafficMutation = vi.fn()
    const record = {
      status: 'healthy', projectId: 'petcare-c7483', region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision: 'peecare-test-tool-development-00002-def',
      imageDigest: `sha256:${'c'.repeat(64)}`, secretRef,
      priorHealthyRevision: {
        revision: 'peecare-test-tool-development-00001-abc',
        imageDigest: `sha256:${'b'.repeat(64)}`, secretRef,
      },
    }
    await expect(runTestToolRollback({
      args: ['--rollback-dry-run'], manifest: loadTestToolManifest(), releaseRecord: record,
      inspectRevision: vi.fn(async () => ({
        revision: record.priorHealthyRevision.revision,
        image: image.replace('a'.repeat(64), 'b'.repeat(64)),
        runtimeIdentity: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
        secretRef, secretMountContract: true, ready: true,
      })),
      inspectSecretAccess: vi.fn(async () => ({
        name: secretRef, state: 'ENABLED',
        condition: approvedRuntimeAccess().secretPolicy.bindings[0].condition,
      })),
      inspectRuntimeAccess: vi.fn(async () => alter(approvedRuntimeAccess())),
      executeTrafficMutation, write: vi.fn(),
    })).rejects.toMatchObject({ code: 'rollback_unavailable' })
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })

  it('normalizes the real gcloud v1 Revision secret-volume shape', () => {
    expect(normalizeRevisionInspection(
      revisionRecord(), 'petcare-c7483', 'ignored',
    )).toEqual({
      revision: 'peecare-test-tool-development-00001-abc',
      image,
      runtimeIdentity: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      secretRef,
      secretMountContract: true,
      ready: true,
    })
  })

  it.each([
    ['decoy numeric item', { items: [
      { key: '7', path: 'decoy', mode: 384 },
      { key: '8', path: 'ingestion-secret', mode: 384 },
    ] }],
    ['wrong path', { items: [{ key: '7', path: 'decoy', mode: 384 }] }],
    ['wrong mode', { items: [{ key: '7', path: 'ingestion-secret', mode: 292 }] }],
    ['wrong mount', { mounts: [{ name: 'ingestion-secret', mountPath: '/other' }] }],
    ['gen2', { annotation: 'gen2' }],
  ])('rejects rollback mount ambiguity: %s', (_case, override) => {
    expect(normalizeRevisionInspection(
      revisionRecord(override), 'petcare-c7483', 'ignored',
    )).toMatchObject({ secretRef: null, secretMountContract: false })
  })

  it('contains async rollback inspection failure inside the sanitized CLI boundary', async () => {
    const errors: string[] = []
    const result = await runTestToolDeployCli({
      argv: ['--rollback-dry-run'],
      environment: {
        PEECARE_TEST_TOOL_RELEASE_RECORD:
          'deploy/development/fixtures/test-tool-rollback-release.json',
      },
      execute: vi.fn(() => ({ status: 1, stdout: '', stderr: 'sensitive gcloud path' })),
      stdout: vi.fn(),
      stderr: (line) => errors.push(line),
    })
    expect(result).toEqual({ status: 'error', code: 'rollback_unavailable' })
    expect(errors).toEqual(['{"status":"error","code":"rollback_unavailable"}'])
    expect(JSON.stringify(errors)).not.toContain('sensitive gcloud path')
  })

  it.each([
    ['missing prior', { priorHealthyRevision: null }],
    ['wrong service', { service: 'peecare-member-development' }],
    ['same revision', { priorHealthyRevision: { revision: 'peecare-test-tool-development-00002-def', imageDigest: `sha256:${'b'.repeat(64)}`, secretRef } }],
  ])('rejects rollback ambiguity: %s', async (_case, override) => {
    const executeTrafficMutation = vi.fn()
    await expect(runTestToolRollback({
      args: ['--rollback-dry-run'], manifest: loadTestToolManifest(),
      releaseRecord: {
        status: 'healthy', projectId: 'petcare-c7483', region: 'asia-east1',
        service: 'peecare-test-tool-development',
        revision: 'peecare-test-tool-development-00002-def',
        imageDigest: `sha256:${'c'.repeat(64)}`, secretRef,
        priorHealthyRevision: { revision: 'peecare-test-tool-development-00001-abc', imageDigest: `sha256:${'b'.repeat(64)}`, secretRef },
        ...override,
      },
      inspectRevision: vi.fn(), executeTrafficMutation, write: vi.fn(),
    })).rejects.toMatchObject({ code: 'rollback_unavailable' })
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })

  it.each([
    ['changed image', { image: image.replace('a'.repeat(64), 'c'.repeat(64)) }],
    ['shared identity', { runtimeIdentity: 'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com' }],
    ['changed secret', { secretRef: secretRef.replace('/7', '/8') }],
    ['not ready', { ready: false }],
    ['foreign repository with same digest', {
      image: `evil.example/foreign@sha256:${'b'.repeat(64)}`,
    }],
  ])('rejects an inspected rollback target with %s', async (_case, inspectedOverride) => {
    const executeTrafficMutation = vi.fn()
    const record = {
      status: 'healthy', projectId: 'petcare-c7483', region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision: 'peecare-test-tool-development-00002-def',
      imageDigest: `sha256:${'c'.repeat(64)}`, secretRef,
      priorHealthyRevision: {
        revision: 'peecare-test-tool-development-00001-abc',
        imageDigest: `sha256:${'b'.repeat(64)}`, secretRef,
      },
    }
    await expect(runTestToolRollback({
      args: ['--rollback-dry-run'], manifest: loadTestToolManifest(), releaseRecord: record,
      inspectRevision: vi.fn(async () => ({
        revision: record.priorHealthyRevision.revision,
        image: image.replace('a'.repeat(64), 'b'.repeat(64)),
        runtimeIdentity: 'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
        secretRef,
        secretMountContract: true,
        ready: true,
        ...inspectedOverride,
      })),
      inspectSecretAccess: vi.fn(async () => ({
        name: secretRef,
        state: 'ENABLED',
        condition: {
          title: 'peecare-test-tool-secret-version-7',
          expression:
            'resource.name == "projects/348528459946/secrets/peecare-emqx-webhook-current/versions/7"',
        },
      })),
      inspectRuntimeAccess: vi.fn(async () => approvedRuntimeAccess()),
      executeTrafficMutation,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'rollback_unavailable' })
    expect(executeTrafficMutation).not.toHaveBeenCalled()
  })
})
