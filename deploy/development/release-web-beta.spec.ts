import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  BetaReleaseError,
  authenticateExistingBetaTester,
  createApprovedBetaCliEnvironment,
  createBetaReleaseRecord,
  createBetaRollbackDryRun,
  createFailedBetaReleaseEvidence,
  readHiddenBetaTesterCredentials,
  prepareBetaHostingHistory,
  readLiveBetaHostingVersions,
  runBetaTesterAuthentication,
  runBetaTesterAuthenticationCli,
  runBetaTesterJourney,
  runBetaUploadBoundary,
  createBetaCloudInspector,
  runIsolatedBetaTesterJourney,
  runBetaPreflight,
  runBetaReleaseCli,
  runBetaHostingRelease,
  validateBetaTesterInventory,
  verifyLiveBetaHostingAvailability,
  verifySingleTesterOwnershipBoundary,
} from './release-web-beta.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const inventoryPath = 'deploy/development/beta-tester-inventory.local.json'
const verifiedTestToolRoute = Object.freeze({
  path: '/test-tool',
  status: 'verified',
})
const verifiedTestToolApi = Object.freeze({
  projectId: 'petcare-c7483',
  region: 'asia-east1',
  service: 'peecare-test-tool-development',
  revision: 'peecare-test-tool-development-00042-abc',
  imageDigest: `sha256:${'d'.repeat(64)}`,
  verifiedOrigin:
    'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
})

function tester(index: number) {
  return {
    alias: `tester-${index}`,
    deviceId: `PC-DEV-${String(index).padStart(6, '0')}`,
  }
}

function inventory(count = 1): Record<string, unknown> {
  return {
    environment: 'development',
    marker: 'peecare-development-web-beta-v1',
    testers: Array.from({ length: count }, (_, index) => tester(index + 1)),
  }
}

describe('non-PII beta tester inventory', () => {
  it.each([
    [0, false],
    [1, true],
    [2, false],
  ])('validates the specified %i-tester boundary', (count, accepted) => {
    if (accepted) {
      expect(validateBetaTesterInventory(inventory(count))).toHaveLength(count)
      return
    }

    expect(() => validateBetaTesterInventory(inventory(count))).toThrowError(
      expect.objectContaining({ code: 'inventory_invalid' }),
    )
  })

  it.each([
    ['email key', 'email', 'tester@example.com'],
    ['Firebase UID key', 'uid', '4LwYpQ8z2xTnBf6sVj1kHm3cR9Aa'],
    ['credential key', 'password', 'correct-horse-battery-staple'],
    ['secret-like key', 'webhookSecret', 'opaque-value'],
    ['email value', 'alias', 'tester@example.com'],
    ['private-key value', 'alias', '-----BEGIN PRIVATE KEY-----'],
    ['token-like value', 'alias', 'eyJhbGciOiJSUzI1NiJ9.payload.signature'],
  ])('rejects %s', (_case, key, value) => {
    const candidate = inventory() as { testers: Array<Record<string, string>> }
    candidate.testers[0][key] = value

    expect(() => validateBetaTesterInventory(candidate)).toThrowError(
      expect.objectContaining({ code: 'inventory_invalid' }),
    )
  })

  it.each(['PC-000001', 'PC-PROD-0001', 'production-device-1', 'PROD-000001'])(
    'rejects production-shaped device identifier %s',
    (deviceId) => {
      const candidate = inventory() as { testers: Array<Record<string, string>> }
      candidate.testers[0].deviceId = deviceId

      expect(() => validateBetaTesterInventory(candidate)).toThrowError(
        expect.objectContaining({ code: 'inventory_invalid' }),
      )
    },
  )

  it('publishes a schema and non-PII example that validate through the runtime boundary', () => {
    const schema = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'deploy/development/beta-tester-inventory.schema.json'), 'utf8'),
    )
    const example = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'deploy/development/beta-tester-inventory.example.json'), 'utf8'),
    )

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    })
    expect(validateBetaTesterInventory(example)).toEqual([
      { alias: 'tester-1', deviceId: 'PC-DEV-000001' },
    ])
    expect(JSON.stringify(example)).not.toMatch(
      /(?:@|password|credential|secret|token|private[_-]?key|firebase[_-]?uid)/i,
    )
  })

  it('accepts the canonical development device assigned by opaque alias', () => {
    expect(validateBetaTesterInventory(inventory())).toEqual([
      { alias: 'tester-1', deviceId: 'PC-DEV-000001' },
    ])
  })

  it('keeps the populated local inventory path ignored by Git', () => {
    expect(
      execFileSync('git', ['check-ignore', '--no-index', inventoryPath], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim(),
    ).toBe(inventoryPath)
  })

  it('uses a typed stable failure for malformed inventory', () => {
    try {
      validateBetaTesterInventory(null)
    } catch (error) {
      expect(error).toBeInstanceOf(BetaReleaseError)
      expect(error).toMatchObject({ code: 'inventory_invalid' })
    }
  })
})

function approvedEnvironment(): Record<string, string> {
  return {
    PEECARE_DEVELOPMENT_HOSTING_TARGET: 'development',
    VITE_FIREBASE_ENVIRONMENT: 'development',
    VITE_FIREBASE_APPROVED_PROJECT_ID: 'petcare-c7483',
    VITE_FIREBASE_PROJECT_ID: 'petcare-c7483',
    VITE_FIREBASE_AUTH_DOMAIN: 'petcare-c7483.firebaseapp.com',
    VITE_FIREBASE_API_KEY: 'public-firebase-web-key',
    VITE_FIREBASE_APP_ID: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
    VITE_MEMBER_API_URL:
      'https://peecare-member-development-348528459946.asia-east1.run.app',
    VITE_TEST_TOOL_API_URL:
      'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
  }
}

describe('approved beta command environment', () => {
  it('hydrates only the approved public Web configuration from inspected config', () => {
    const base = {
      PEECARE_TEST_TOOL_RELEASE_RECORD: '/private/tmp/test-tool-release.json',
      PEECARE_BETA_FIRST_RELEASE_CONFIRMATION: 'operator-confirmation',
    }

    const environment = createApprovedBetaCliEnvironment(base, {
      projectId: 'petcare-c7483',
      appId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
      apiKey: 'public-firebase-web-key',
      authDomain: 'petcare-c7483.firebaseapp.com',
      storageBucket: 'ignored-public-field',
    })

    expect(environment).toMatchObject({
      ...base,
      ...approvedEnvironment(),
    })
    expect(base).not.toHaveProperty('VITE_FIREBASE_API_KEY')
  })

  it.each([
    ['foreign project', { projectId: 'other-project' }],
    ['foreign app', { appId: '1:2:web:foreign' }],
    ['foreign auth domain', { authDomain: 'other.firebaseapp.com' }],
    ['missing API key', { apiKey: '' }],
  ])('rejects %s before returning an environment', (_case, override) => {
    expect(() => createApprovedBetaCliEnvironment({}, {
      projectId: 'petcare-c7483',
      appId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
      apiKey: 'public-firebase-web-key',
      authDomain: 'petcare-c7483.firebaseapp.com',
      ...override,
    })).toThrowError(expect.objectContaining({ code: 'cloud_prerequisite_failed' }))
  })
})

function approvedCloudInventory() {
  return {
    projectId: 'petcare-c7483',
    hostingSite: 'petcare-c7483',
    hostingTarget: 'development',
    webAppId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
    webApiKeyMatches: true,
    authDomain: 'petcare-c7483.firebaseapp.com',
    firestoreRegion: 'asia-east1',
    memberApi: {
      origin: 'https://peecare-member-development-348528459946.asia-east1.run.app',
      healthy: true,
    },
    devices: [1].map((index) => ({
      deviceId: `PC-DEV-${String(index).padStart(6, '0')}`,
      owned: true,
      developmentMarked: true,
    })),
  }
}

describe('read-only beta cloud preflight', () => {
  it('returns a sanitized exact-target plan before any build or upload', async () => {
    const build = vi.fn()
    const upload = vi.fn()
    const output: string[] = []

    const result = await runBetaPreflight({
      environment: approvedEnvironment(),
      args: ['--dry-run'],
      inventory: inventory(),
      inspectCloud: vi.fn(async () => approvedCloudInventory()),
      build,
      upload,
      write: (line: string) => output.push(line),
    })

    expect(result).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      hostingSite: 'petcare-c7483',
      hostingTarget: 'development',
      webAppId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
      authDomain: 'petcare-c7483.firebaseapp.com',
      firestoreRegion: 'asia-east1',
      memberApiOrigin:
        'https://peecare-member-development-348528459946.asia-east1.run.app',
      testerCount: 1,
      testerAliases: ['tester-1'],
      checkedDeviceCount: 1,
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(JSON.stringify(result)).not.toMatch(
      /(?:PC-(?:DEV-)?[0-9]|ownerUid|email|password|credential|token|secret|AIza)/i,
    )
    expect(build).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it.each([
    ['project', { projectId: 'production-project' }],
    ['Hosting site', { hostingSite: 'peecare-production' }],
    ['Hosting target', { hostingTarget: 'production' }],
    ['Web app', { webAppId: '1:348528459946:web:wrong' }],
    ['Web API key', { webApiKeyMatches: false }],
    ['Auth domain', { authDomain: 'production.example.com' }],
    ['Firestore region', { firestoreRegion: 'us-central1' }],
    [
      'Member API origin',
      {
        memberApi: {
          ...approvedCloudInventory().memberApi,
          origin: 'https://peecare-member-production.example.run.app',
        },
      },
    ],
    [
      'Member API health',
      { memberApi: { ...approvedCloudInventory().memberApi, healthy: false } },
    ],
    [
      'device ownership',
      {
        devices: approvedCloudInventory().devices.map((device, index) =>
          index === 0 ? { ...device, owned: false } : device,
        ),
      },
    ],
    [
      'development marker',
      {
        devices: approvedCloudInventory().devices.map((device, index) =>
          index === 0 ? { ...device, developmentMarked: false } : device,
        ),
      },
    ],
  ])('fails %s mismatch with zero build/upload', async (_case, override) => {
    const build = vi.fn()
    const upload = vi.fn()
    const cloud = { ...approvedCloudInventory(), ...override }

    await expect(
      runBetaPreflight({
        environment: approvedEnvironment(),
        args: ['--dry-run'],
        inventory: inventory(),
        inspectCloud: vi.fn(async () => cloud),
        build,
        upload,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'cloud_prerequisite_failed' })
    expect(build).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it.each([
    ['operator Hosting target', { PEECARE_DEVELOPMENT_HOSTING_TARGET: 'production' }],
    ['Firebase environment', { VITE_FIREBASE_ENVIRONMENT: 'production' }],
    ['approved project', { VITE_FIREBASE_APPROVED_PROJECT_ID: 'production-project' }],
    ['Firebase project', { VITE_FIREBASE_PROJECT_ID: 'production-project' }],
    ['Web app', { VITE_FIREBASE_APP_ID: '1:348528459946:web:wrong' }],
    ['Auth domain', { VITE_FIREBASE_AUTH_DOMAIN: 'production.example.com' }],
    ['Member API origin', { VITE_MEMBER_API_URL: 'http://localhost:8080' }],
  ])('rejects wrong %s configuration before cloud inspection', async (_case, override) => {
    const inspectCloud = vi.fn()
    const build = vi.fn()
    const upload = vi.fn()

    await expect(
      runBetaPreflight({
        environment: { ...approvedEnvironment(), ...override },
        args: ['--dry-run'],
        inventory: inventory(),
        inspectCloud,
        build,
        upload,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'cloud_prerequisite_failed' })
    expect(inspectCloud).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('normalizes inspector failures to a stable code without leaking the cause', async () => {
    const write = vi.fn()

    await expect(
      runBetaPreflight({
        environment: approvedEnvironment(),
        args: ['--dry-run'],
        inventory: inventory(),
        inspectCloud: vi.fn(async () => {
          throw new Error('access token must-not-leak')
        }),
        build: vi.fn(),
        upload: vi.fn(),
        write,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'cloud_prerequisite_failed',
        message: expect.not.stringContaining('must-not-leak'),
      }),
    )
    expect(write).not.toHaveBeenCalled()
  })
})

describe('Firebase beta cloud inventory adapter', () => {
  it('reads only the approved cloud resources and reduces devices to ownership markers', async () => {
    const authorizedJson = vi.fn(async (url: string) => {
      if (url.includes('/webApps/')) {
        return {
          projectId: 'petcare-c7483',
          appId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
          apiKey: 'public-firebase-web-key',
          authDomain: 'petcare-c7483.firebaseapp.com',
        }
      }
      if (url.includes('firebasehosting.googleapis.com')) {
        return {
          name: 'projects/petcare-c7483/sites/petcare-c7483',
          defaultUrl: 'https://petcare-c7483.web.app',
          appId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
        }
      }
      if (url.includes('firestore.googleapis.com')) {
        return {
          name: 'projects/petcare-c7483/databases/(default)',
          locationId: 'asia-east1',
        }
      }
      return {
        authorizedDomains: ['petcare-c7483.firebaseapp.com', 'petcare-c7483.web.app'],
      }
    })
    const readDevice = vi.fn(async (deviceId: string) => ({
      exists: true,
      data: {
        deviceId,
        ownerUid: `owner-${deviceId}`,
        ingestionStatus: 'enabled',
      },
    }))
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const inspect = createBetaCloudInspector({
      authorizedJson,
      readDevice,
      request,
      firebaseRc: {
        targets: {
          'petcare-c7483': { hosting: { development: ['petcare-c7483'] } },
        },
      },
    })

    const result = await inspect({
      projectId: 'petcare-c7483',
      hostingSite: 'petcare-c7483',
      hostingTarget: 'development',
      webAppId: '1:348528459946:web:3cd4fe2b9140a3e81f10d3',
      webApiKey: 'public-firebase-web-key',
      authDomain: 'petcare-c7483.firebaseapp.com',
      firestoreRegion: 'asia-east1',
      memberApiOrigin:
        'https://peecare-member-development-348528459946.asia-east1.run.app',
      deviceIds: ['PC-DEV-000001'],
    })

    expect(result).toEqual(approvedCloudInventory())
    expect(readDevice.mock.calls.map(([deviceId]) => deviceId)).toEqual([
      'PC-DEV-000001',
    ])
    expect(request).toHaveBeenCalledWith(
      'https://peecare-member-development-348528459946.asia-east1.run.app/health',
      expect.objectContaining({ redirect: 'error' }),
    )
    expect(JSON.stringify(result)).not.toContain('owner-PC-')
    expect(authorizedJson.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/projects/-/webApps/'),
        expect.stringContaining('/projects/-/sites/petcare-c7483'),
        expect.stringContaining('/databases/(default)'),
        expect.stringContaining('/projects/petcare-c7483/config'),
      ]),
    )
  })
})

describe('beta dry-run command boundary', () => {
  it('exposes the root dry-run command and loads only the gitignored inventory path', async () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
    const readJson = vi.fn((path: string) => {
      if (path.endsWith('beta-tester-inventory.local.json')) return inventory()
      throw new Error(`unexpected path ${path}`)
    })

    const priorHostingVersion = 'sites/petcare-c7483/versions/beta-001'
    const readHostingVersions = vi.fn(async () => [priorHostingVersion])
    const result = await runBetaReleaseCli({
      environment: approvedEnvironment(),
      args: ['--dry-run'],
      readJson,
      inspectCloud: vi.fn(async () => approvedCloudInventory()),
      runReleaseGate: vi.fn(async () => ({ status: 'passed' })),
      inspectCloudBuild: vi.fn(async () => ({
        status: 'ready',
        buildHash: `sha256:${'a'.repeat(64)}`,
        testToolRoute: verifiedTestToolRoute,
        testToolApi: verifiedTestToolApi,
      })),
      uploadHosting: vi.fn(),
      verifyLiveRoutes: vi.fn(),
      readHostingVersions,
      write: vi.fn(),
    })

    expect(packageJson.scripts['web:development:beta:dry-run']).toBe(
      'node deploy/development/release-web-beta.mjs --dry-run',
    )
    expect(readJson).toHaveBeenCalledOnce()
    expect(readJson.mock.calls[0][0]).toMatch(
      /deploy\/development\/beta-tester-inventory\.local\.json$/,
    )
    expect(result).toMatchObject({
      status: 'ready',
      dryRun: true,
      testerCount: 1,
      priorHostingVersion,
    })
    expect(readHostingVersions).toHaveBeenCalledOnce()
  })

  it('returns inventory_invalid when the local inventory is absent before cloud inspection', async () => {
    const inspectCloud = vi.fn()

    await expect(
      runBetaReleaseCli({
        environment: approvedEnvironment(),
        args: ['--dry-run'],
        readJson: vi.fn(() => {
          throw Object.assign(new Error('not found'), { code: 'ENOENT' })
        }),
        inspectCloud,
        write: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'inventory_invalid' })
    expect(inspectCloud).not.toHaveBeenCalled()
  })

  it.each([[], ['--dry-run', '--apply'], ['--unknown']])(
    'requires exactly one supported release mode for args %j',
    async (args) => {
      const readJson = vi.fn()
      await expect(
        runBetaReleaseCli({
          environment: approvedEnvironment(),
          args,
          readJson,
          inspectCloud: vi.fn(),
          runReleaseGate: vi.fn(),
          inspectCloudBuild: vi.fn(),
          uploadHosting: vi.fn(),
          verifyLiveRoutes: vi.fn(),
          write: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: 'explicit_mode_required' })
      expect(readJson).not.toHaveBeenCalled()
    },
  )
})

// Task 2.1: hidden and ephemeral tester authentication boundary.
function fakeCredentialTty({ inputIsTTY = true, outputIsTTY = true } = {}) {
  const input = new EventEmitter() as EventEmitter & {
    isTTY: boolean
    setRawMode: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
  }
  input.isTTY = inputIsTTY
  input.setRawMode = vi.fn()
  input.resume = vi.fn()
  input.pause = vi.fn()
  return {
    input,
    output: { isTTY: outputIsTTY, write: vi.fn() },
  }
}

function enterHiddenFields(
  input: EventEmitter,
  email = 'beta.operator@example.test',
  password = 'sentinel-password',
) {
  queueMicrotask(() => {
    input.emit('data', Buffer.from(`${email}\n`))
    setTimeout(() => input.emit('data', Buffer.from(`${password}\n`)), 0)
  })
}

describe('ephemeral beta tester authentication', () => {
  it('authenticates an existing tester without returning or persisting token material', async () => {
    const request = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        idToken: 'private-id-token',
        refreshToken: 'private-refresh-token',
        localId: 'private-firebase-uid',
      }),
    }))
    const credentials = {
      email: 'beta.operator@example.test',
      password: 'sentinel-password',
    }

    await expect(authenticateExistingBetaTester({
      webApiKey: 'public-firebase-web-key',
      credentials,
      request,
    })).resolves.toBeUndefined()

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('accounts:signInWithPassword?key='),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ...credentials, returnSecureToken: true }),
      }),
    )
  })

  it('reads email and password for exactly one alias from a hidden fake TTY', async () => {
    const tty = fakeCredentialTty()
    enterHiddenFields(tty.input)

    const credentials = await readHiddenBetaTesterCredentials({
      alias: 'tester-1',
      ...tty,
    })

    expect(credentials).toEqual({
      email: 'beta.operator@example.test',
      password: 'sentinel-password',
    })
    expect(tty.input.setRawMode.mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ])
    expect(tty.output.write.mock.calls.flat().join('')).toContain('tester-1')
    expect(tty.output.write.mock.calls.flat().join('')).not.toMatch(
      /beta\.operator@example\.test|sentinel-password/,
    )
  })

  it.each([[], ['tester-1', 'tester-2']])(
    'rejects an alias list of length %i before prompting',
    async (aliases) => {
      const tty = fakeCredentialTty()

      await expect(
        runBetaTesterAuthentication({
          aliases,
          argv: [],
          environment: {},
          ...tty,
          authenticate: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: 'credential_input_unavailable' })
      expect(tty.output.write).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['credential argument', ['--email=beta.operator@example.test'], {}],
    ['environment file argument', ['--env-file=.tester.env'], {}],
    ['JSON argument', ['--credentials-json=credentials.json'], {}],
    [
      'credential environment variable',
      [],
      { PEECARE_BETA_TESTER_PASSWORD: 'sentinel-password' },
    ],
  ])('rejects %s before prompting or authenticating', async (_case, argv, environment) => {
    const tty = fakeCredentialTty()
    const authenticate = vi.fn()

    await expect(
      runBetaTesterAuthentication({
        aliases: ['tester-1'],
        argv,
        environment,
        ...tty,
        authenticate,
      }),
    ).rejects.toMatchObject({ code: 'credential_input_unavailable' })
    expect(tty.output.write).not.toHaveBeenCalled()
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('rejects unexpected file or JSON credential source options', async () => {
    const tty = fakeCredentialTty()
    const authenticate = vi.fn()

    await expect(
      runBetaTesterAuthentication({
        aliases: ['tester-1'],
        argv: [],
        environment: {},
        ...tty,
        authenticate,
        credentialFile: '.tester.env',
      } as never),
    ).rejects.toMatchObject({ code: 'credential_input_unavailable' })
    expect(tty.output.write).not.toHaveBeenCalled()
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('rejects a non-TTY before reading either hidden field', async () => {
    const tty = fakeCredentialTty({ inputIsTTY: false })

    await expect(
      readHiddenBetaTesterCredentials({ alias: 'tester-1', ...tty }),
    ).rejects.toMatchObject({ code: 'credential_input_unavailable' })
    expect(tty.input.setRawMode).not.toHaveBeenCalled()
  })

  it('normalizes cancellation and never authenticates', async () => {
    const tty = fakeCredentialTty()
    const authenticate = vi.fn()
    queueMicrotask(() => tty.input.emit('data', Buffer.from([0x03])))

    await expect(
      runBetaTesterAuthentication({
        aliases: ['tester-1'],
        argv: [],
        environment: {},
        ...tty,
        authenticate,
      }),
    ).rejects.toMatchObject({ code: 'credential_input_unavailable' })
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('normalizes login failure, clears credentials, and does not leak the cause', async () => {
    const credentials = {
      email: 'beta.operator@example.test',
      password: 'sentinel-password',
    }
    const tty = fakeCredentialTty()
    enterHiddenFields(tty.input, credentials.email, credentials.password)
    let capturedCredentials: typeof credentials | undefined
    const authenticate = vi.fn(async (mutableCredentials) => {
      capturedCredentials = mutableCredentials
      expect(mutableCredentials).toEqual(credentials)
      throw new Error(
        'Firebase rejected beta.operator@example.test with sentinel-password',
      )
    })

    await expect(
      runBetaTesterAuthentication({
        aliases: ['tester-1'],
        argv: [],
        environment: {},
        ...tty,
        authenticate,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'tester_authentication_failed',
        message: expect.not.stringMatching(
          /beta\.operator@example\.test|sentinel-password/,
        ),
      }),
    )
    expect(capturedCredentials).toEqual({ email: null, password: null })
  })

  it('returns only a sanitized stage and clears mutable credential references after login', async () => {
    const credentials = {
      email: 'beta.operator@example.test',
      password: 'sentinel-password',
    }
    const tty = fakeCredentialTty()
    enterHiddenFields(tty.input, credentials.email, credentials.password)
    let capturedCredentials: typeof credentials | undefined
    const authenticate = vi.fn(async (mutableCredentials) => {
      capturedCredentials = mutableCredentials
      expect(mutableCredentials).toEqual(credentials)
      return {
        uid: 'firebase-uid-must-not-leak',
        idToken: 'firebase-id-token-must-not-leak',
      }
    })

    const result = await runBetaTesterAuthentication({
      aliases: ['tester-1'],
      argv: [],
      environment: {},
      ...tty,
      authenticate,
    })

    expect(result).toEqual({ alias: 'tester-1', status: 'authenticated' })
    expect(JSON.stringify(result)).not.toMatch(/uid|token|@|sentinel-password/i)
    expect(capturedCredentials).toEqual({ email: null, password: null })
  })

  it.each([
    ['successful login', false],
    ['failed login', true],
  ])('keeps stdout and stderr secret-free for %s', async (_case, fails) => {
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const credentials = {
      email: 'beta.operator@example.test',
      password: 'sentinel-password',
    }
    const tty = fakeCredentialTty()
    enterHiddenFields(tty.input, credentials.email, credentials.password)

    const exitCode = await runBetaTesterAuthenticationCli({
      aliases: ['tester-1'],
      argv: [],
      environment: {},
      ...tty,
      stdout,
      stderr,
      authenticate: vi.fn(async () => {
        if (fails) {
          throw new Error(
            'firebase-id-token-must-not-leak beta.operator@example.test sentinel-password',
          )
        }
        return {
          uid: 'firebase-uid-must-not-leak',
          idToken: 'firebase-id-token-must-not-leak',
        }
      }),
    })

    expect(exitCode).toBe(fails ? 1 : 0)
    const processOutput = [stdout, stderr]
      .flatMap((stream) => stream.write.mock.calls.flat())
      .join('')
    expect(processOutput).not.toMatch(
      /beta\.operator@example\.test|sentinel-password|firebase-(?:uid|id-token)-must-not-leak/,
    )
    expect(processOutput).toContain(
      fails ? 'tester_authentication_failed' : 'authenticated',
    )
  })
})

describe('single beta tester browser context lifecycle', () => {
  function instrumentBrowser({ teardownFailure } = { teardownFailure: '' }) {
    const calls: string[] = []
    const context = {
      clearAuthPersistence: vi.fn(async () => {
        calls.push('clearAuthPersistence')
        if (teardownFailure === 'clearAuthPersistence') throw new Error('sensitive auth detail')
      }),
      clearIndexedDB: vi.fn(async () => {
        calls.push('clearIndexedDB')
        if (teardownFailure === 'clearIndexedDB') throw new Error('sensitive database detail')
      }),
      clearCacheStorage: vi.fn(async () => {
        calls.push('clearCacheStorage')
        if (teardownFailure === 'clearCacheStorage') throw new Error('sensitive cache detail')
      }),
      clearServiceWorkerMemberState: vi.fn(async () => {
        calls.push('clearServiceWorkerMemberState')
        if (teardownFailure === 'clearServiceWorkerMemberState') {
          throw new Error('sensitive member detail')
        }
      }),
      close: vi.fn(async () => {
        calls.push('close')
        if (teardownFailure === 'close') throw new Error('sensitive close detail')
      }),
    }
    const browser = {
      createContext: vi.fn(async () => {
        calls.push('createContext')
        return context
      }),
    }
    return { browser, calls, context }
  }

  it('uses exactly one fresh context and clears all member state before closing after success', async () => {
    const { browser, calls, context } = instrumentBrowser()
    const journey = vi.fn(async (activeContext) => {
      calls.push('journey')
      expect(activeContext).toBe(context)
      return { status: 'passed' }
    })

    await expect(runIsolatedBetaTesterJourney({ browser, journey })).resolves.toEqual({
      status: 'passed',
    })

    expect(browser.createContext).toHaveBeenCalledOnce()
    expect(browser.createContext).toHaveBeenCalledWith()
    expect(journey).toHaveBeenCalledOnce()
    expect(context.clearAuthPersistence).toHaveBeenCalledOnce()
    expect(context.clearIndexedDB).toHaveBeenCalledOnce()
    expect(context.clearCacheStorage).toHaveBeenCalledOnce()
    expect(context.clearServiceWorkerMemberState).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(calls).toEqual([
      'createContext',
      'journey',
      'clearAuthPersistence',
      'clearIndexedDB',
      'clearCacheStorage',
      'clearServiceWorkerMemberState',
      'close',
    ])
  })

  it('clears all member state and closes the context when the journey fails', async () => {
    const { browser, calls, context } = instrumentBrowser()
    const journeyFailure = new BetaReleaseError('tester_device_mismatch', 'safe failure')

    await expect(
      runIsolatedBetaTesterJourney({
        browser,
        journey: vi.fn(async () => {
          calls.push('journey')
          throw journeyFailure
        }),
      }),
    ).rejects.toBe(journeyFailure)

    expect(browser.createContext).toHaveBeenCalledOnce()
    expect(context.clearAuthPersistence).toHaveBeenCalledOnce()
    expect(context.clearIndexedDB).toHaveBeenCalledOnce()
    expect(context.clearCacheStorage).toHaveBeenCalledOnce()
    expect(context.clearServiceWorkerMemberState).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(calls).toEqual([
      'createContext',
      'journey',
      'clearAuthPersistence',
      'clearIndexedDB',
      'clearCacheStorage',
      'clearServiceWorkerMemberState',
      'close',
    ])
  })

  it.each([
    'clearAuthPersistence',
    'clearIndexedDB',
    'clearCacheStorage',
    'clearServiceWorkerMemberState',
    'close',
  ])('returns a stable non-zero failure and still attempts full teardown when %s fails', async (step) => {
    const { browser, calls, context } = instrumentBrowser({ teardownFailure: step })

    await expect(
      runIsolatedBetaTesterJourney({
        browser,
        journey: vi.fn(async () => {
          calls.push('journey')
          return { status: 'passed' }
        }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'browser_context_teardown_failed',
        message: 'Beta tester browser context teardown failed.',
      }),
    )

    expect(context.clearAuthPersistence).toHaveBeenCalledOnce()
    expect(context.clearIndexedDB).toHaveBeenCalledOnce()
    expect(context.clearCacheStorage).toHaveBeenCalledOnce()
    expect(context.clearServiceWorkerMemberState).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(calls.at(-1)).toBe('close')
  })
})

describe('single authenticated beta tester journey', () => {
  function journeyAdapter(overrides: Record<string, unknown> = {}) {
    const registry = {
      deviceId: 'PC-DEV-000001',
      ownerUid: 'owner-uid',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
    }
    return {
      getAuthenticatedUid: vi.fn(async () => 'owner-uid'),
      readAssignedDevice: vi.fn(async () => structuredClone(registry)),
      expectOwnerOverview: vi.fn(async () => undefined),
      expectHistory: vi.fn(async () => undefined),
      expectDailyStats: vi.fn(async () => undefined),
      renameDevice: vi.fn(async () => undefined),
      clearDeviceName: vi.fn(async () => undefined),
      reloadProtectedRoutes: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      ...overrides,
    }
  }

  it('completes the PC-DEV-000001 owner journey and preserves registry fields', async () => {
    const browser = journeyAdapter()

    await expect(
      runBetaTesterJourney({
        alias: 'tester-1',
        deviceId: 'PC-DEV-000001',
        browser,
      }),
    ).resolves.toEqual({ alias: 'tester-1', status: 'passed' })

    expect(browser.expectOwnerOverview).toHaveBeenCalledWith('PC-DEV-000001')
    expect(browser.expectHistory).toHaveBeenCalledWith('PC-DEV-000001')
    expect(browser.expectDailyStats).toHaveBeenCalledWith('PC-DEV-000001')
    expect(browser.renameDevice).toHaveBeenCalledWith(
      'PC-DEV-000001',
      'PeeCare beta verification',
    )
    expect(browser.clearDeviceName).toHaveBeenCalledWith('PC-DEV-000001')
    expect(browser.readAssignedDevice).toHaveBeenCalledTimes(2)
    expect(browser.reloadProtectedRoutes).toHaveBeenCalledOnce()
    expect(browser.signOut).toHaveBeenCalledOnce()
  })

  it('returns tester_device_mismatch before mutation when the UID does not own the assigned device', async () => {
    const browser = journeyAdapter({
      getAuthenticatedUid: vi.fn(async () => 'unexpected-uid'),
    })

    await expect(
      runBetaTesterJourney({
        alias: 'tester-1',
        deviceId: 'PC-DEV-000001',
        browser,
      }),
    ).rejects.toMatchObject({ code: 'tester_device_mismatch' })

    expect(browser.renameDevice).not.toHaveBeenCalled()
    expect(browser.clearDeviceName).not.toHaveBeenCalled()
  })

  it('fails with cleanup-required evidence when marker clearing fails', async () => {
    const browser = journeyAdapter({
      clearDeviceName: vi.fn(async () => {
        throw new Error('member payload must not leak')
      }),
    })

    await expect(
      runBetaTesterJourney({
        alias: 'tester-1',
        deviceId: 'PC-DEV-000001',
        browser,
      }),
    ).rejects.toMatchObject({
      code: 'smoke_failed',
      cleanupRequired: true,
      message: expect.not.stringContaining('payload'),
    })
    expect(browser.renameDevice).toHaveBeenCalledOnce()
    expect(browser.clearDeviceName).toHaveBeenCalledOnce()
    expect(browser.reloadProtectedRoutes).not.toHaveBeenCalled()
  })
})

describe('single-tester exact ownership boundary', () => {
  function ownershipAdapter(overrides: Record<string, unknown> = {}) {
    return {
      readOwnedDeviceIds: vi.fn(async () => ['PC-DEV-000001']),
      readProtectedViewDeviceIds: vi.fn(async () => ({
        overview: ['PC-DEV-000001'],
        history: ['PC-DEV-000001'],
        stats: ['PC-DEV-000001'],
      })),
      runDependentSmoke: vi.fn(async () => undefined),
      ...overrides,
    }
  }

  it('accepts exactly PC-DEV-000001 in the live query and every protected view', async () => {
    const adapter = ownershipAdapter()

    await expect(
      verifySingleTesterOwnershipBoundary({
        assignedDeviceId: 'PC-DEV-000001',
        ...adapter,
      }),
    ).resolves.toEqual({
      status: 'verified',
      deviceCount: 1,
      liveTesterCoverage: 'single-tester',
      multiTesterCoverage: false,
    })
    expect(adapter.runDependentSmoke).toHaveBeenCalledOnce()
  })

  it.each(['owned query', 'protected view'])(
    'returns unexpected_owned_device and stops dependent smoke for an extra device in %s',
    async (source) => {
      const adapter = ownershipAdapter(
        source === 'owned query'
          ? { readOwnedDeviceIds: vi.fn(async () => ['PC-DEV-000001', 'PC-DEV-000002']) }
          : {
              readProtectedViewDeviceIds: vi.fn(async () => ({
                overview: ['PC-DEV-000001'],
                history: ['PC-DEV-000001', 'PC-DEV-000002'],
                stats: ['PC-DEV-000001'],
              })),
            },
      )

      await expect(
        verifySingleTesterOwnershipBoundary({
          assignedDeviceId: 'PC-DEV-000001',
          ...adapter,
        }),
      ).rejects.toMatchObject({ code: 'unexpected_owned_device' })
      expect(adapter.runDependentSmoke).not.toHaveBeenCalled()
    },
  )

  it('short-circuits upload until the Emulator non-owner denial gate passes', async () => {
    const upload = vi.fn()
    const failedGate = vi.fn(async () => ({ status: 'failed', nonOwnerDenied: false }))

    await expect(
      runBetaUploadBoundary({ runNonOwnerDenialGate: failedGate, upload }),
    ).rejects.toMatchObject({ code: 'smoke_failed' })
    expect(upload).not.toHaveBeenCalled()

    const passedGate = vi.fn(async () => ({ status: 'passed', nonOwnerDenied: true }))
    await expect(
      runBetaUploadBoundary({ runNonOwnerDenialGate: passedGate, upload }),
    ).resolves.toEqual({
      status: 'uploaded',
      liveTesterCoverage: 'single-tester',
      multiTesterCoverage: false,
    })
    expect(upload).toHaveBeenCalledOnce()
  })
})

describe('live beta Hosting release orchestration', () => {
  const buildHash = `sha256:${'a'.repeat(64)}`

  it('verifies the same Hosting shell at every required live route', async () => {
    const shell = '<!doctype html><div id="app"></div>'
    const request = vi.fn(async () =>
      new Response(shell, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )

    await expect(
      verifyLiveBetaHostingAvailability({
        origin: 'https://petcare-c7483.web.app',
        request,
      }),
    ).resolves.toEqual({
      status: 'verified',
      routes: ['/', '/history', '/stats', '/sign-in'],
    })
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://petcare-c7483.web.app/',
      'https://petcare-c7483.web.app/history',
      'https://petcare-c7483.web.app/stats',
      'https://petcare-c7483.web.app/sign-in',
    ])
  })

  it('returns hosting_unavailable for a 404 and never accepts a non-shell response', async () => {
    await expect(
      verifyLiveBetaHostingAvailability({
        origin: 'https://petcare-c7483.web.app',
        request: vi.fn(async (url: string) =>
          url.endsWith('/history')
            ? new Response('not found', { status: 404 })
            : new Response('<!doctype html><div id="app"></div>', { status: 200 }),
        ),
      }),
    ).rejects.toMatchObject({ code: 'hosting_unavailable' })
  })

  it.each(['release gate', 'inspected build'])(
    'short-circuits before Hosting upload when the %s fails',
    async (failedStage) => {
      const uploadHosting = vi.fn()
      const runReleaseGate = vi.fn(async () => ({
        status: failedStage === 'release gate' ? 'failed' : 'passed',
      }))
      const inspectCloudBuild = vi.fn(async () => ({
        status: failedStage === 'inspected build' ? 'failed' : 'ready',
        buildHash,
        testToolRoute: verifiedTestToolRoute,
        testToolApi: verifiedTestToolApi,
      }))

      await expect(
        runBetaHostingRelease({
          mode: 'apply',
          runReleaseGate,
          inspectCloudBuild,
          uploadHosting,
          verifyLiveRoutes: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: 'cloud_prerequisite_failed' })
      expect(uploadHosting).not.toHaveBeenCalled()
      if (failedStage === 'release gate') {
        expect(inspectCloudBuild).not.toHaveBeenCalled()
      }
    },
  )

  it('rejects an inspected build without an exact /test-tool route proof before upload', async () => {
    const uploadHosting = vi.fn()

    await expect(
      runBetaHostingRelease({
        mode: 'apply',
        runReleaseGate: vi.fn(async () => ({ status: 'passed' })),
        inspectCloudBuild: vi.fn(async () => ({
          status: 'ready',
          buildHash,
          testToolApi: verifiedTestToolApi,
        })),
        uploadHosting,
        verifyLiveRoutes: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'cloud_prerequisite_failed' })
    expect(uploadHosting).not.toHaveBeenCalled()
  })

  it('rejects an inspected build without an exact Test Tool API identity before upload', async () => {
    const uploadHosting = vi.fn(async () => ({
      version: 'sites/petcare-c7483/versions/beta-001',
    }))

    await expect(runBetaHostingRelease({
      mode: 'apply',
      runReleaseGate: vi.fn(async () => ({ status: 'passed' })),
      inspectCloudBuild: vi.fn(async () => ({
        status: 'ready',
        buildHash,
        testToolRoute: verifiedTestToolRoute,
      })),
      uploadHosting,
      verifyLiveRoutes: vi.fn(async () => ({
        status: 'verified',
        routes: ['/', '/history', '/stats', '/sign-in'],
      })),
    })).rejects.toMatchObject({ code: 'cloud_prerequisite_failed' })
    expect(uploadHosting).not.toHaveBeenCalled()
  })

  it('uploads the inspected build fixture and verifies the selected live version', async () => {
    const uploadHosting = vi.fn(async () => ({
      version: 'sites/petcare-c7483/versions/beta-001',
    }))
    const verifyLiveRoutes = vi.fn(async () => ({
      status: 'verified',
      routes: ['/', '/history', '/stats', '/sign-in'],
    }))

    await expect(
      runBetaHostingRelease({
        mode: 'apply',
        runReleaseGate: vi.fn(async () => ({ status: 'passed' })),
        inspectCloudBuild: vi.fn(async () => ({
          status: 'ready',
          buildHash,
          testToolRoute: verifiedTestToolRoute,
          testToolApi: verifiedTestToolApi,
        })),
        uploadHosting,
        verifyLiveRoutes,
      }),
    ).resolves.toEqual({
      status: 'deployed',
      buildHash,
      testToolRoute: verifiedTestToolRoute,
      testToolApi: verifiedTestToolApi,
      hostingVersion: 'sites/petcare-c7483/versions/beta-001',
      routes: ['/', '/history', '/stats', '/sign-in'],
    })
    expect(uploadHosting).toHaveBeenCalledWith({
      buildHash,
      testToolRoute: verifiedTestToolRoute,
      testToolApi: verifiedTestToolApi,
    })
    expect(verifyLiveRoutes).toHaveBeenCalledWith({
      hostingVersion: 'sites/petcare-c7483/versions/beta-001',
    })
  })

  it('exposes dry-run and release root commands while keeping dry-run mutation-free', async () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
    const uploadHosting = vi.fn()

    await expect(
      runBetaHostingRelease({
        mode: 'dry-run',
        runReleaseGate: vi.fn(async () => ({ status: 'passed' })),
        inspectCloudBuild: vi.fn(async () => ({
          status: 'ready',
          buildHash,
          testToolRoute: verifiedTestToolRoute,
          testToolApi: verifiedTestToolApi,
        })),
        uploadHosting,
        verifyLiveRoutes: vi.fn(),
      }),
    ).resolves.toEqual({
      status: 'ready',
      dryRun: true,
      buildHash,
      testToolRoute: verifiedTestToolRoute,
      testToolApi: verifiedTestToolApi,
    })
    expect(uploadHosting).not.toHaveBeenCalled()
    expect(packageJson.scripts['web:development:beta:release']).toBe(
      'node deploy/development/release-web-beta.mjs --apply',
    )
  })
})

describe('exact beta release evidence and rollback', () => {
  const buildHash = `sha256:${'b'.repeat(64)}`
  const deployedVersion = 'sites/petcare-c7483/versions/beta-002'
  const priorVersion = 'sites/petcare-c7483/versions/beta-001'
  const testToolApi = verifiedTestToolApi
  const checks = {
    availability: 'passed',
    spaAndCache: 'passed',
    testerJourney: 'passed',
    exactOwnership: 'passed',
    memberDataCacheExclusion: 'passed',
    protectedRouteReload: 'passed',
    nonOwnerDenial: 'passed',
    routeRegistration: 'passed',
    signedOutReturnPath: 'passed',
    authenticatedReload: 'passed',
    eligibleDeviceBoundary: 'passed',
    eventProjection: 'passed',
    testToolCacheExclusion: 'passed',
  }

  it('requires exact confirmation before a first release with no rollback', () => {
    expect(() =>
      prepareBetaHostingHistory({ currentVersions: [], confirmation: 'yes' }),
    ).toThrowError(expect.objectContaining({ code: 'first_release_confirmation_required' }))

    expect(
      prepareBetaHostingHistory({
        currentVersions: [],
        confirmation: 'APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK',
      }),
    ).toEqual({ bootstrap: true, rollbackAvailable: false, rollbackVersion: null })
  })

  it('short-circuits first-release upload without confirmation and permits the exact phrase', async () => {
    const uploadHosting = vi.fn(async () => ({ version: deployedVersion }))
    const authenticateTester = vi.fn(async (aliases: readonly string[]) => ({
      alias: aliases[0],
      status: 'authenticated',
    }))
    const base = {
      args: ['--apply'],
      readJson: vi.fn(() => inventory()),
      inspectCloud: vi.fn(async () => approvedCloudInventory()),
      runReleaseGate: vi.fn(async () => ({ status: 'passed' })),
      inspectCloudBuild: vi.fn(async () => ({
        status: 'ready',
        buildHash,
        testToolRoute: verifiedTestToolRoute,
        testToolApi: verifiedTestToolApi,
      })),
      uploadHosting,
      verifyLiveRoutes: vi.fn(async () => ({
        status: 'verified',
        routes: ['/', '/history', '/stats', '/sign-in'],
      })),
      readHostingVersions: vi.fn(async () => []),
      authenticateTester,
      write: vi.fn(),
    }

    await expect(
      runBetaReleaseCli({ environment: approvedEnvironment(), ...base }),
    ).rejects.toMatchObject({ code: 'first_release_confirmation_required' })
    expect(uploadHosting).not.toHaveBeenCalled()
    expect(authenticateTester).not.toHaveBeenCalled()

    const result = await runBetaReleaseCli({
      environment: {
        ...approvedEnvironment(),
        PEECARE_BETA_FIRST_RELEASE_CONFIRMATION:
          'APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK',
      },
      ...base,
    })
    expect(result).toMatchObject({
      status: 'deployed',
      history: { bootstrap: true, rollbackAvailable: false, rollbackVersion: null },
      testerAuthentication: { alias: 'tester-1', status: 'authenticated' },
    })
    expect(authenticateTester).toHaveBeenCalledWith(['tester-1'])
    expect(uploadHosting).toHaveBeenCalledOnce()
  })

  it('binds a later release to exactly one prior live Hosting version', () => {
    expect(
      prepareBetaHostingHistory({ currentVersions: [priorVersion], confirmation: '' }),
    ).toEqual({
      bootstrap: false,
      rollbackAvailable: true,
      rollbackVersion: priorVersion,
    })
    expect(() =>
      prepareBetaHostingHistory({
        currentVersions: [priorVersion, 'sites/petcare-c7483/versions/ambiguous'],
        confirmation: '',
      }),
    ).toThrowError(expect.objectContaining({ code: 'rollback_unavailable' }))
  })

  it('reads release history only from the explicit live channel', async () => {
    const authorizedJson = vi.fn(async () => ({
      releases: [
        { version: { name: deployedVersion } },
        { version: { name: priorVersion } },
      ],
    }))

    await expect(readLiveBetaHostingVersions(authorizedJson, 2)).resolves.toEqual([
      deployedVersion,
      priorVersion,
    ])
    expect(authorizedJson).toHaveBeenCalledWith(
      'https://firebasehosting.googleapis.com/v1beta1/sites/petcare-c7483/channels/live/releases?pageSize=2',
    )
  })

  it.each([
    ['bootstrap', { bootstrap: true, rollbackAvailable: false, rollbackVersion: null }],
    [
      'later',
      { bootstrap: false, rollbackAvailable: true, rollbackVersion: priorVersion },
    ],
  ])('creates a sanitized single-stage %s healthy record', (_case, history) => {
    const record = createBetaReleaseRecord({
      deployment: { status: 'deployed', buildHash, hostingVersion: deployedVersion },
      history,
      testerStages: [{ alias: 'tester-1', status: 'passed' }],
      checks,
      testToolApi,
      now: () => new Date('2026-08-11T06:30:00.000Z'),
    })

    expect(record).toEqual({
      status: 'healthy',
      projectId: 'petcare-c7483',
      hostingSite: 'petcare-c7483',
      buildHash,
      hostingVersion: deployedVersion,
      rollbackAvailable: history.rollbackAvailable,
      rollbackVersion: history.rollbackVersion,
      verifiedAt: '2026-08-11T06:30:00.000Z',
      testToolApi,
      testerStages: [{ alias: 'tester-1', status: 'passed' }],
      checks,
    })
    expect(JSON.stringify(record)).not.toMatch(
      /(?:@|uid|password|credential|token|customName|eventPayload|PC-DEV-)/i,
    )
  })

  it.each([
    ['PII stage', [{ alias: 'tester@example.test', status: 'passed' }], checks],
    [
      'custom name check',
      [{ alias: 'tester-1', status: 'passed' }],
      { ...checks, customName: 'private bathroom' },
    ],
    [
      'event payload check',
      [{ alias: 'tester-1', status: 'passed' }],
      { ...checks, eventPayload: { deviceId: 'PC-DEV-000001' } },
    ],
  ])('rejects %s from a healthy record', (_case, testerStages, unsafeChecks) => {
    expect(() =>
      createBetaReleaseRecord({
        deployment: { status: 'deployed', buildHash, hostingVersion: deployedVersion },
        history: { bootstrap: true, rollbackAvailable: false, rollbackVersion: null },
        testerStages,
        checks: unsafeChecks,
        testToolApi,
        now: () => new Date('2026-08-11T06:30:00.000Z'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'smoke_failed' }))
  })

  it('emits sanitized failed evidence without false health after upload', () => {
    expect(
      createFailedBetaReleaseEvidence({
        hostingVersion: deployedVersion,
        rollbackVersion: priorVersion,
        buildHash,
        testToolApi,
        now: () => new Date('2026-08-11T06:45:00.000Z'),
        code: 'hosting_unavailable',
        checks: { availability: 'failed' },
      }),
    ).toEqual({
      status: 'failed',
      projectId: 'petcare-c7483',
      hostingSite: 'petcare-c7483',
      hostingVersion: deployedVersion,
      rollbackVersion: priorVersion,
      rollbackAvailable: true,
      buildHash,
      testToolApi,
      verifiedAt: '2026-08-11T06:45:00.000Z',
      code: 'hosting_unavailable',
      checks: { availability: 'failed' },
    })
  })

  it('records rollback unavailable explicitly when failed evidence has no prior version', () => {
    expect(createFailedBetaReleaseEvidence({
      hostingVersion: deployedVersion,
      rollbackVersion: null,
      buildHash,
      testToolApi,
      now: () => new Date('2026-08-11T06:45:00.000Z'),
      code: 'test_tool_route_restoration_failed',
      checks: { signedOutReturnPath: 'failed' },
    })).toMatchObject({
      status: 'failed',
      rollbackAvailable: false,
      rollbackVersion: null,
    })
  })

  it.each([
    ['missing API identity', undefined],
    ['foreign API project', { ...testToolApi, projectId: 'other-project' }],
    ['mutable API digest', { ...testToolApi, imageDigest: 'latest' }],
    ['credential-bearing API origin', { ...testToolApi, verifiedOrigin: 'https://user:pass@example.run.app' }],
  ])('rejects %s from healthy and failed evidence', (_case, invalidApi) => {
    expect(() => createBetaReleaseRecord({
      deployment: { status: 'deployed', buildHash, hostingVersion: deployedVersion },
      history: { bootstrap: false, rollbackAvailable: true, rollbackVersion: priorVersion },
      testerStages: [{ alias: 'tester-1', status: 'passed' }],
      checks,
      testToolApi: invalidApi,
      now: () => new Date('2026-08-11T06:30:00.000Z'),
    })).toThrowError(expect.objectContaining({ code: 'smoke_failed' }))
    expect(() => createFailedBetaReleaseEvidence({
      hostingVersion: deployedVersion,
      rollbackVersion: priorVersion,
      buildHash,
      testToolApi: invalidApi,
      now: () => new Date('2026-08-11T06:45:00.000Z'),
      code: 'hosting_unavailable',
      checks: { availability: 'failed' },
    })).toThrowError(expect.objectContaining({ code: 'smoke_failed' }))
  })

  it('refuses missing or ambiguous rollback targets without guessing', () => {
    for (const rollbackVersions of [
      [],
      [deployedVersion],
      [priorVersion, deployedVersion],
    ]) {
      expect(() =>
        createBetaRollbackDryRun({
          currentVersion: deployedVersion,
          rollbackVersions,
        }),
      ).toThrowError(expect.objectContaining({ code: 'rollback_unavailable' }))
    }
  })

  it('creates a reviewed exact-version rollback REST command without mutation', () => {
    const plan = createBetaRollbackDryRun({
      currentVersion: deployedVersion,
      rollbackVersions: [priorVersion],
    })

    expect(plan).toEqual({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      hostingSite: 'petcare-c7483',
      currentVersion: deployedVersion,
      rollbackVersion: priorVersion,
      reviewedCommand: [
        'curl',
        '--request',
        'POST',
        '--header',
        'Authorization: Bearer $(gcloud auth application-default print-access-token)',
        '--header',
        'Content-Type: application/json',
        '--header',
        'x-goog-user-project: petcare-c7483',
        '--data',
        '{}',
        `https://firebasehosting.googleapis.com/v1beta1/sites/petcare-c7483/releases?versionName=${encodeURIComponent(priorVersion)}`,
      ],
    })
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
    expect(packageJson.scripts['web:development:beta:rollback']).toBe(
      'node deploy/development/release-web-beta.mjs --rollback-dry-run',
    )
  })

  it('dispatches rollback-dry-run without reading tester inventory or mutating Hosting', async () => {
    const readJson = vi.fn()
    const write = vi.fn()
    const uploadHosting = vi.fn()

    const plan = await runBetaReleaseCli({
      environment: approvedEnvironment(),
      args: ['--rollback-dry-run'],
      readJson,
      inspectCloud: vi.fn(),
      runReleaseGate: vi.fn(),
      inspectCloudBuild: vi.fn(),
      uploadHosting,
      verifyLiveRoutes: vi.fn(),
      readHostingVersions: vi.fn(async () => [deployedVersion, priorVersion]),
      write,
    })

    expect(plan).toMatchObject({
      status: 'ready',
      dryRun: true,
      currentVersion: deployedVersion,
      rollbackVersion: priorVersion,
    })
    expect(readJson).not.toHaveBeenCalled()
    expect(uploadHosting).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(JSON.stringify(plan))
  })
})

describe('single-tester beta release runbook', () => {
  it('documents the complete operator-owned release and containment sequence', () => {
    const runbook = readFileSync(
      resolve(repositoryRoot, 'deploy/development/BETA_RELEASE_RUNBOOK.md'),
      'utf8',
    )

    for (const required of [
      'PC-DEV-000001',
      'web:development:beta:dry-run',
      'web:development:beta:release',
      'web:development:beta:rollback',
      'APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK',
      'hidden interactive',
      'beta-tester-inventory.local.json',
      'operator creates',
      'cleanup required',
      'multi-tester coverage is deferred',
      'email',
      'UID',
      'credential',
      'PEECARE_TEST_TOOL_RELEASE_RECORD',
      'testToolApi',
      'test_tool_route_absent',
      'signed-out return path',
      'exact Hosting version and build hash',
      'failed evidence',
      'no automatic rollback',
    ]) {
      expect(runbook).toContain(required)
    }
    expect(runbook.indexOf('web:development:beta:dry-run')).toBeLessThan(
      runbook.indexOf('web:development:beta:release'),
    )
    expect(runbook.indexOf('web:development:beta:release')).toBeLessThan(
      runbook.indexOf('web:development:beta:rollback'),
    )
  })
})
