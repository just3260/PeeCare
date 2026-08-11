import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { loadTestToolManifest } from './deploy-test-tool.mjs'
import {
  createEphemeralTokenStore,
  createOperatorCloudDependencies,
  createOperatorFirebaseAppOptions,
  createOperatorRevisionInspector,
  runOneTimeOperatorVerification,
  runOneTimeOperatorVerificationCli,
  selectExistingForeignUser,
} from './verify-test-tool-operator.mjs'

const revision = 'peecare-test-tool-development-00002-rte'
const digest = 'sha256:2c851bfe35753ab6a345f8fca387b9e6dc228e14ff0c0173189ac0b00d0eee3f'
const image = `asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@${digest}`
const secretRef =
  'projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/1'
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

function smokeAdapter() {
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
      serviceUrl:
        'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
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

function dependencies(overrides: Record<string, unknown> = {}) {
  const smoke = smokeAdapter()
  const inspectedRevision = {
    ready: true,
    serving: true,
    projectId: 'petcare-c7483',
    region: 'asia-east1',
    service: 'peecare-test-tool-development',
    revision,
    image,
    runtimeIdentity:
      'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
    serviceUrl:
      'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
    secretRef,
  }
  return {
    inspectExactTarget: vi.fn(async () => inspectedRevision),
    readAssignedDevice: vi.fn(async () => ({ ownerUid: 'owner-private-uid' })),
    readExistingUser: vi.fn(async () => ({ uid: 'owner-private-uid' })),
    findExistingForeignUser: vi.fn(async () => ({ uid: 'foreign-private-uid' })),
    createCustomToken: vi.fn(async (uid: string) => `custom-${uid}`),
    exchangeCustomToken: vi.fn(async (token: string) => `id-${token}`),
    readInspectedSecret: vi.fn(async () => 'resolved-secret-value'),
    createSmokeAdapter: vi.fn(() => smoke),
    smoke,
    ...overrides,
  }
}

describe('one-time Test Tool operator verification', () => {
  it('binds eleven checks to revision 00002-rte without exposing protected material', async () => {
    const deps = dependencies()
    const tokenStore = createEphemeralTokenStore()
    const output: string[] = []

    const result = await runOneTimeOperatorVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      dependencies: deps,
      tokenStore,
      now: () => new Date('2026-08-12T08:00:00.000Z'),
      write: (line) => output.push(line),
    })

    expect(result).toMatchObject({
      status: 'healthy',
      revision,
      imageDigest: digest,
      smoke: Object.fromEntries(smokeNames.map((name) => [name, 'passed'])),
    })
    expect(deps.readExistingUser).toHaveBeenCalledWith('owner-private-uid')
    expect(deps.inspectExactTarget).toHaveBeenCalledWith({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
    })
    expect(deps.findExistingForeignUser).toHaveBeenCalledWith('owner-private-uid')
    expect(deps.createCustomToken).toHaveBeenCalledTimes(2)
    expect(deps.createSmokeAdapter).toHaveBeenCalledWith(expect.objectContaining({
      inspectedRevision: expect.objectContaining({ revision, image }),
      ownerToken: 'id-custom-owner-private-uid',
      foreignToken: 'id-custom-foreign-private-uid',
      inspectedSecretValue: 'resolved-secret-value',
    }))
    expect(tokenStore.hasProtectedMaterial()).toBe(false)
    expect(output).toHaveLength(1)
    expect(output[0]).not.toMatch(
      /owner-private|foreign-private|custom-|id-custom|resolved-secret|eventId|deviceId/i,
    )
  })

  it('fails before token exchange, marker, or evidence when no foreign account exists', async () => {
    const deps = dependencies({ findExistingForeignUser: vi.fn(async () => null) })
    const tokenStore = createEphemeralTokenStore()
    const write = vi.fn()

    await expect(runOneTimeOperatorVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      dependencies: deps,
      tokenStore,
      write,
    })).rejects.toMatchObject({ code: 'foreign_principal_unavailable' })

    expect(deps.createCustomToken).not.toHaveBeenCalled()
    expect(deps.createSmokeAdapter).not.toHaveBeenCalled()
    expect(deps.smoke.markBetaDevice).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(tokenStore.hasProtectedMaterial()).toBe(false)
  })

  it('clears all tokens and emits no healthy evidence when the exact target drifts', async () => {
    const deps = dependencies()
    deps.smoke.inspectRevision.mockResolvedValue({
      ...(await smokeAdapter().inspectRevision()),
      revision: 'peecare-test-tool-development-00003-bad',
    })
    const tokenStore = createEphemeralTokenStore()
    const write = vi.fn()

    await expect(runOneTimeOperatorVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      dependencies: deps,
      tokenStore,
      write,
    })).rejects.toMatchObject({ code: 'revision_mismatch' })

    expect(deps.smoke.markBetaDevice).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(tokenStore.hasProtectedMaterial()).toBe(false)
  })

  it('maps denied remote signing to a stable sanitized failure before smoke', async () => {
    const denied = Object.assign(new Error('private signer details'), {
      code: 'auth/insufficient-permission',
    })
    const deps = dependencies({
      createCustomToken: vi.fn(async () => { throw denied }),
    })
    const tokenStore = createEphemeralTokenStore()

    await expect(runOneTimeOperatorVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      dependencies: deps,
      tokenStore,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'custom_token_signing_failed' })

    expect(deps.createSmokeAdapter).not.toHaveBeenCalled()
    expect(tokenStore.hasProtectedMaterial()).toBe(false)
  })

  it.each([
    ['token exchange', { exchangeCustomToken: vi.fn(async () => { throw new Error('private token') }) }, 'token_exchange_failed'],
    ['secret inspection', { readInspectedSecret: vi.fn(async () => { throw new Error('private secret') }) }, 'secret_inspection_failed'],
  ])('maps %s errors to a stable sanitized code', async (_case, override, code) => {
    const deps = dependencies(override)
    const tokenStore = createEphemeralTokenStore()

    await expect(runOneTimeOperatorVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      dependencies: deps,
      tokenStore,
      write: vi.fn(),
    })).rejects.toMatchObject({ code })

    expect(deps.createSmokeAdapter).not.toHaveBeenCalled()
    expect(tokenStore.hasProtectedMaterial()).toBe(false)
  })

  it('rejects dependency ports that could mutate Firebase Auth identities', async () => {
    const deps = dependencies({ updateUser: vi.fn() })

    await expect(runOneTimeOperatorVerification({
      environment: environment(),
      args: ['--apply', '--revision', revision, '--image', image],
      manifest: loadTestToolManifest(),
      dependencies: deps,
      write: vi.fn(),
    })).rejects.toMatchObject({ code: 'operator_adapter_invalid' })

    expect(deps.readAssignedDevice).not.toHaveBeenCalled()
  })
})

describe('one-time operator cloud adapters', () => {
  it('uses the dedicated existing runtime identity as the custom-token signer', () => {
    const credential = { getAccessToken: vi.fn() }
    expect(createOperatorFirebaseAppOptions(credential)).toEqual({
      credential,
      projectId: 'petcare-c7483',
      serviceAccountId:
        'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
    })
  })

  it('selects only an enabled existing non-owner account without changing it', () => {
    expect(selectExistingForeignUser('owner-private-uid', [
      { uid: 'owner-private-uid', disabled: false },
      { uid: 'disabled-private-uid', disabled: true },
      { uid: 'foreign-private-uid', disabled: false },
    ])).toEqual({ uid: 'foreign-private-uid' })
    expect(selectExistingForeignUser('owner-private-uid', [
      { uid: 'owner-private-uid', disabled: false },
      { uid: 'disabled-private-uid', disabled: true },
    ])).toBeNull()
  })

  it('inspects the exact serving revision, immutable image, and numeric secret mount', async () => {
    const execute = vi.fn((args: readonly string[]) => {
      if (args[1] === 'services') {
        return JSON.stringify({
          status: {
            latestReadyRevisionName: revision,
            url: 'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
            traffic: [{ revisionName: revision, percent: 100 }],
          },
        })
      }
      return JSON.stringify({
        metadata: {
          name: revision,
          annotations: { 'run.googleapis.com/execution-environment': 'gen1' },
        },
        spec: {
          serviceAccountName:
            'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
          containers: [{
            image,
            volumeMounts: [{
              name: 'ingestion-secret',
              mountPath: '/var/run/secrets/peecare',
            }],
          }],
          volumes: [{
            name: 'ingestion-secret',
            secret: {
              secretName: 'peecare-emqx-webhook-current',
              items: [{ key: '1', path: 'ingestion-secret', mode: 256 }],
            },
          }],
        },
        status: { conditions: [{ type: 'Ready', status: 'True' }] },
      })
    })

    await expect(createOperatorRevisionInspector(execute)({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
    })).resolves.toEqual({
      ready: true,
      serving: true,
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
      image,
      runtimeIdentity:
        'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
      serviceUrl:
        'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
      secretRef,
    })
  })

  it.each([
    ['service describe', 'services', 'service_inspection_failed'],
    ['revision describe', 'revisions', 'revision_inspection_failed'],
  ])('maps %s failures to a stable code', async (_case, failingResource, code) => {
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args[1] === failingResource) throw new Error('private cloud detail')
      return JSON.stringify({})
    })

    await expect(createOperatorRevisionInspector(execute)({
      projectId: 'petcare-c7483',
      region: 'asia-east1',
      service: 'peecare-test-tool-development',
      revision,
    })).rejects.toMatchObject({ code })
  })

  it('exposes existing-only Auth, token exchange, and in-memory secret ports', async () => {
    const auth = {
      getUser: vi.fn(async (uid: string) => ({ uid, disabled: false })),
      listUsers: vi.fn(async (_limit: number, pageToken?: string) =>
        pageToken === undefined
          ? {
              users: [
                { uid: 'owner-private-uid', disabled: false },
                { uid: 'disabled-private-uid', disabled: true },
              ],
              pageToken: 'next-page',
            }
          : {
              users: [{ uid: 'foreign-private-uid', disabled: false }],
              pageToken: undefined,
            }),
      createCustomToken: vi.fn(async (uid: string) => `custom-${uid}`),
    }
    const authorizedJson = vi.fn(async (url: string) => {
      if (url.includes('/webApps/')) {
        return { appId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3', apiKey: 'public-web-key' }
      }
      if (url.endsWith(':access')) {
        return { payload: { data: Buffer.from('resolved-secret-value').toString('base64') } }
      }
      return { entries: [] }
    })
    const request = vi.fn(async (url: string) => ({
      ok: url.includes('signInWithCustomToken'),
      status: 200,
      headers: new Headers(),
      json: async () => ({ idToken: 'exchanged-id-token' }),
    }))
    const deps = createOperatorCloudDependencies({
      environment: environment(),
      auth,
      readDocument: vi.fn(async (path: string) =>
        path === 'devices/PC-DEV-000001'
          ? { deviceId: 'PC-DEV-000001', ownerUid: 'owner-private-uid' }
          : null),
      writeExactMarker: vi.fn(),
      authorizedJson,
      request,
      execute: vi.fn(),
      wait: vi.fn(),
    })

    await expect(deps.readAssignedDevice()).resolves.toMatchObject({
      ownerUid: 'owner-private-uid',
    })
    await expect(deps.readExistingUser('owner-private-uid')).resolves.toEqual({
      uid: 'owner-private-uid',
    })
    await expect(deps.findExistingForeignUser('owner-private-uid')).resolves.toEqual({
      uid: 'foreign-private-uid',
    })
    await expect(deps.createCustomToken('owner-private-uid')).resolves.toBe(
      'custom-owner-private-uid',
    )
    await expect(deps.exchangeCustomToken('custom-owner-private-uid')).resolves.toBe(
      'exchanged-id-token',
    )
    await expect(deps.readInspectedSecret()).resolves.toBe('resolved-secret-value')
    expect(Object.keys(deps).sort()).toEqual([
      'createCustomToken',
      'createSmokeAdapter',
      'exchangeCustomToken',
      'findExistingForeignUser',
      'inspectExactTarget',
      'readAssignedDevice',
      'readExistingUser',
      'readInspectedSecret',
    ])
    expect(auth.listUsers).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][0]).toContain('signInWithCustomToken')
  })
})

describe('one-time operator CLI', () => {
  it('rejects a non-exact invocation before initializing cloud dependencies', async () => {
    const createDependencies = vi.fn()
    const errors: string[] = []

    const result = await runOneTimeOperatorVerificationCli({
      args: ['--apply'],
      environment: environment(),
      createDependencies,
      write: vi.fn(),
      writeError: (line) => errors.push(line),
    })

    expect(result).toEqual({ status: 'error', code: 'operator_apply_required' })
    expect(createDependencies).not.toHaveBeenCalled()
    expect(errors).toEqual([
      JSON.stringify({ status: 'error', code: 'operator_apply_required' }),
    ])
  })

  it('sanitizes unexpected cloud failures instead of reflecting their messages', async () => {
    const errors: string[] = []
    const result = await runOneTimeOperatorVerificationCli({
      args: ['--apply', '--revision', revision, '--image', image],
      environment: environment(),
      createDependencies: vi.fn(async () => {
        throw new Error('private-owner-uid id-token resolved-secret-value')
      }),
      write: vi.fn(),
      writeError: (line) => errors.push(line),
    })

    expect(result).toEqual({ status: 'error', code: 'operator_verification_failed' })
    expect(errors.join('\n')).not.toMatch(/private-owner|id-token|resolved-secret/i)
  })

  it('keeps the approved bootstrap entry point and boundaries explicit', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    const runbook = readFileSync('deploy/development/TEST_TOOL_RUNBOOK.md', 'utf8')

    expect(packageJson.scripts['test-tool:development:verify:operator']).toBe(
      'node deploy/development/verify-test-tool-operator.mjs',
    )
    expect(runbook).toMatch(/one-time operator harness/i)
    expect(runbook).toMatch(/existing owner.*existing non-owner/is)
    expect(runbook).toMatch(/process memory/i)
    expect(runbook).toMatch(/never (?:creates|updates|deletes|resets).*account/i)
    expect(runbook).toMatch(/isolated browser/i)
  })
})
