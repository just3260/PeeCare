import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { runWebDeploy } from './deploy-web.mjs'

const approvedFirebaseRc = {
  projects: {
    default: 'demo-peecare',
    development: 'petcare-c7483',
  },
  targets: {
    'petcare-c7483': {
      hosting: {
        development: ['petcare-c7483'],
      },
    },
  },
}

const approvedFirebaseConfig = {
  hosting: {
    target: 'development',
    public: 'dist',
    rewrites: [{ source: '**', destination: '/index.html' }],
    headers: [
      {
        source: '/assets/**',
        headers: [{ key: 'Cache-Control', value: 'public,max-age=31536000,immutable' }],
      },
    ],
  },
}

function validEnvironment(): Record<string, string> {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_HOSTING_TARGET: 'development',
    VITE_FIREBASE_ENVIRONMENT: 'development',
    VITE_FIREBASE_APPROVED_PROJECT_ID: 'petcare-c7483',
    VITE_FIREBASE_PROJECT_ID: 'petcare-c7483',
    VITE_FIREBASE_API_KEY: 'public-firebase-client-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'petcare-c7483.firebaseapp.com',
    VITE_FIREBASE_APP_ID: '1:348528459946:web:abc123',
    VITE_MEMBER_API_URL: 'https://peecare-member-development.example.run.app',
    VITE_TEST_TOOL_API_URL:
      'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
  }
}

const now = new Date('2026-08-11T08:00:00.000Z')

function healthyTestToolRelease(overrides: Record<string, unknown> = {}) {
  const imageDigest = `sha256:${'a'.repeat(64)}`
  return {
    status: 'healthy',
    projectId: 'petcare-c7483',
    region: 'asia-east1',
    service: 'peecare-test-tool-development',
    revision: 'peecare-test-tool-development-00001-abc',
    image:
      `asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@${imageDigest}`,
    imageDigest,
    runtimeIdentity:
      'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
    verifiedOrigin:
      'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
    verifiedAt: '2026-08-11T07:30:00.000Z',
    smoke: {
      publicHealth: 'passed',
      exactCors: 'passed',
      unauthorizedZeroWrite: 'passed',
      foreignDeviceDenial: 'passed',
      unmarkedDeviceDenial: 'passed',
      urinationStored: 'passed',
      batteryStored: 'passed',
      rateLimit: 'passed',
      firestoreProjection: 'passed',
      webProjection: 'passed',
      logPrivacy: 'passed',
    },
    ...overrides,
  }
}

function webDeployOptions(overrides: Record<string, unknown> = {}) {
  return {
    environment: validEnvironment(),
    args: ['--dry-run'],
    firebaseConfig: approvedFirebaseConfig,
    firebaseRc: approvedFirebaseRc,
    testToolReleaseRecord: healthyTestToolRelease(),
    now: () => now,
    execute: vi.fn(() => ({ status: 0 })),
    readBuildArtifacts: cleanArtifacts,
    write: vi.fn(),
    ...overrides,
  }
}

function cleanArtifacts() {
  return [
    {
      path: 'assets/index-a1b2c3d4.js',
      contents:
        'const environment="development",projectId="petcare-c7483",testTool="https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app",route="/test-tool"',
    },
    { path: 'index.html', contents: '<div id="app"></div>' },
  ]
}

describe('runWebDeploy development target preflight', () => {
  it('hands the exact healthy immutable Test Tool API origin to the Web build', () => {
    const options = webDeployOptions()

    const result = runWebDeploy(options as never)

    expect(options.execute).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({
        environment: expect.objectContaining({
          VITE_TEST_TOOL_API_URL:
            'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
        }),
      }),
    )
    expect(result).toMatchObject({
      testToolApi: {
        projectId: 'petcare-c7483',
        region: 'asia-east1',
        service: 'peecare-test-tool-development',
        revision: 'peecare-test-tool-development-00001-abc',
        imageDigest: `sha256:${'a'.repeat(64)}`,
        verifiedOrigin:
          'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
      },
      testToolRoute: { path: '/test-tool', status: 'verified' },
    })
    expect(Object.keys(result.testToolApi)).toEqual([
      'projectId',
      'region',
      'service',
      'revision',
      'imageDigest',
      'verifiedOrigin',
    ])
    expect(JSON.stringify(result.testToolApi)).not.toMatch(
      /runtimeIdentity|image(?:"|Url)|smoke|credential|token|secret/i,
    )
  })

  it('revalidates release freshness after the build and refuses a now-stale upload', () => {
    const beforeExpiry = new Date('2026-08-11T08:00:00.000Z')
    const afterExpiry = new Date('2026-08-11T08:00:00.002Z')
    const currentTime = vi
      .fn()
      .mockReturnValueOnce(beforeExpiry)
      .mockReturnValueOnce(afterExpiry)
    const execute = vi.fn(() => ({ status: 0 }))
    const options = webDeployOptions({
      args: ['--apply'],
      testToolReleaseRecord: healthyTestToolRelease({
        verifiedAt: '2026-08-10T08:00:00.001Z',
      }),
      now: currentTime,
      execute,
    })

    expect(() => runWebDeploy(options as never)).toThrowError(
      expect.objectContaining({ code: 'unverified_test_tool_release' }),
    )
    expect(currentTime).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalledWith(
      'firebase',
      expect.anything(),
      expect.anything(),
    )
  })

  it('uploads an immutable staged snapshot even if live dist changes after inspection', () => {
    const execute = vi.fn(() => ({ status: 0 }))
    let liveArtifacts = cleanArtifacts()
    const cleanup = vi.fn()
    const stageBuildArtifacts = vi.fn(({ artifacts }) => {
      expect(artifacts.map((artifact: { contents: Buffer }) => artifact.contents.toString('utf8')))
        .toEqual(cleanArtifacts().map((artifact) => String(artifact.contents)))
      liveArtifacts = [{ path: 'assets/index.js', contents: 'EMQX_WEBHOOK_SECRET=late-mutation' }]
      return { configPath: '/private/tmp/verified-web-snapshot/firebase.json', cleanup }
    })
    const options = webDeployOptions({
      args: ['--apply'],
      execute,
      readBuildArtifacts: () => liveArtifacts,
      stageBuildArtifacts,
    })

    expect(runWebDeploy(options as never)).toMatchObject({ status: 'deployed' })
    expect(stageBuildArtifacts).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenLastCalledWith(
      'firebase',
      expect.arrayContaining([
        '--config',
        '/private/tmp/verified-web-snapshot/firebase.json',
      ]),
      expect.anything(),
    )
    expect(cleanup).toHaveBeenCalledOnce()
    expect(JSON.stringify(liveArtifacts)).toContain('late-mutation')
  })

  it.each([
    ['missing URL', { VITE_TEST_TOOL_API_URL: undefined }, healthyTestToolRelease()],
    ['missing release record', {}, undefined],
    ['HTTP', {}, healthyTestToolRelease({ verifiedOrigin: 'http://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app' })],
    ['loopback', {}, healthyTestToolRelease({ verifiedOrigin: 'https://127.0.0.1:8088' })],
    ['credentials', {}, healthyTestToolRelease({ verifiedOrigin: 'https://user:pass@peecare-test-tool-development-5hvpf2z3tq-de.a.run.app' })],
    ['path', {}, healthyTestToolRelease({ verifiedOrigin: 'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app/v1' })],
    ['wrong project', {}, healthyTestToolRelease({ projectId: 'other-project' })],
    ['wrong service', {}, healthyTestToolRelease({ service: 'peecare-member-development' })],
    ['wrong origin binding', { VITE_TEST_TOOL_API_URL: 'https://other.invalid' }, healthyTestToolRelease()],
    ['mutable image', {}, healthyTestToolRelease({ image: 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api:latest' })],
    ['wrong image repository', {}, healthyTestToolRelease({ image: `asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:${'a'.repeat(64)}` })],
    ['incomplete smoke', {}, healthyTestToolRelease({ smoke: { publicHealth: 'passed' } })],
    ['stale record', {}, healthyTestToolRelease({ verifiedAt: '2026-08-10T07:59:59.999Z' })],
    ['future record', {}, healthyTestToolRelease({ verifiedAt: '2026-08-11T08:05:00.001Z' })],
    ['non-canonical timestamp', {}, healthyTestToolRelease({ verifiedAt: '2026-08-11 07:30:00Z' })],
  ])('rejects %s before build or Hosting upload', (_case, environmentOverride, releaseRecord) => {
    const execute = vi.fn()
    const options = webDeployOptions({
      environment: { ...validEnvironment(), ...environmentOverride },
      args: ['--apply'],
      testToolReleaseRecord: releaseRecord,
      execute,
    })

    expect(() => runWebDeploy(options as never)).toThrowError(
      expect.objectContaining({ code: 'unverified_test_tool_release' }),
    )
    expect(execute).not.toHaveBeenCalled()
  })
  it('keeps MQTT clients out of browser production dependencies', () => {
    const dependencies = JSON.parse(readFileSync('package.json', 'utf8')).dependencies

    expect(Object.keys(dependencies)).not.toContain('mqtt')
    expect(Object.keys(dependencies)).not.toContain('mqtt.js')
  })

  it('keeps Emulator connector imports out of the hosted cloud adapter', () => {
    const cloudAdapter = readFileSync('src/platform/firebase/client.ts', 'utf8')

    expect(cloudAdapter).not.toMatch(/connect(?:Auth|Firestore)Emulator/)
    expect(cloudAdapter).not.toContain("from './local-client'")
  })

  it('commits the approved development project-to-Hosting-site mapping', () => {
    const firebaseRc = JSON.parse(readFileSync('.firebaserc', 'utf8'))
    const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'))

    expect(firebaseRc.targets).toEqual({
      'petcare-c7483': {
        hosting: {
          development: ['petcare-c7483'],
        },
      },
    })
    expect(firebaseConfig.hosting).toMatchObject({
      target: 'development',
      public: 'dist',
    })
  })

  it('exposes explicit dry-run and apply commands for the development web target', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts

    expect(scripts['web:development:dry-run']).toBe(
      'node deploy/development/deploy-web.mjs --dry-run',
    )
    expect(scripts['web:development:deploy']).toBe(
      'node deploy/development/deploy-web.mjs --apply',
    )
  })

  it('builds locally and reports the exact target, build hash, and files in dry-run mode', () => {
    const execute = vi.fn(() => ({ status: 0 }))
    const output: string[] = []

    const result = runWebDeploy({
      environment: validEnvironment(),
      args: ['--dry-run'],
      firebaseConfig: approvedFirebaseConfig,
      firebaseRc: approvedFirebaseRc,
      testToolReleaseRecord: healthyTestToolRelease(),
      now: () => now,
      execute,
      readBuildArtifacts: cleanArtifacts,
      write: (line) => output.push(line),
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({
        environment: expect.objectContaining({
          VITE_FIREBASE_ENVIRONMENT: 'development',
          VITE_FIREBASE_PROJECT_ID: 'petcare-c7483',
        }),
      }),
    )
    expect(result).toMatchObject({
      status: 'ready',
      dryRun: true,
      projectId: 'petcare-c7483',
      hostingTarget: 'development',
      hostingSite: 'petcare-c7483',
      files: ['assets/index-a1b2c3d4.js', 'index.html'],
      buildHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      firebaseServices: {
        environment: 'development',
        projectId: 'petcare-c7483',
        emulatorEndpoints: [],
      },
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(execute).not.toHaveBeenCalledWith('firebase', expect.anything(), expect.anything())
  })

  it.each([
    ['operator project', { PEECARE_DEVELOPMENT_PROJECT_ID: 'demo-peecare' }, approvedFirebaseRc, approvedFirebaseConfig],
    ['operator target', { PEECARE_DEVELOPMENT_HOSTING_TARGET: 'production' }, approvedFirebaseRc, approvedFirebaseConfig],
    [
      'Hosting alias',
      {},
      {
        ...approvedFirebaseRc,
        targets: {
          'petcare-c7483': { hosting: { development: ['peecare-production'] } },
        },
      },
      approvedFirebaseConfig,
    ],
    [
      'firebase.json target',
      {},
      approvedFirebaseRc,
      { hosting: { ...approvedFirebaseConfig.hosting, target: 'production' } },
    ],
  ])('rejects a mismatched %s before any command executes', (_case, environment, firebaseRc, firebaseConfig) => {
    const execute = vi.fn()

    expect(() =>
      runWebDeploy({
        environment: { ...validEnvironment(), ...environment },
        args: ['--apply'],
        firebaseConfig,
        firebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: cleanArtifacts,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'target_mismatch' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['redirects', { redirects: [{ source: '**', destination: '/other', type: 302 }] }],
    ['framework source', { source: '.' }],
    ['clean URL behavior', { cleanUrls: true }],
  ])('rejects unexpected Hosting capability %s before build or upload', (_case, extra) => {
    const execute = vi.fn()

    expect(() =>
      runWebDeploy({
        ...webDeployOptions({ execute }),
        firebaseConfig: {
          hosting: { ...approvedFirebaseConfig.hosting, ...extra },
        },
      } as never),
    ).toThrowError(expect.objectContaining({ code: 'target_mismatch' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects secret-like Vite environment values before the build or upload', () => {
    const execute = vi.fn()

    expect(() =>
      runWebDeploy({
        environment: {
          ...validEnvironment(),
          VITE_EMQX_WEBHOOK_SECRET: 'must-not-enter-public-build',
        },
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: cleanArtifacts,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'forbidden_build_environment' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['VITE_FIREBASE_USE_EMULATORS', 'false'],
    ['VITE_FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1'],
    ['VITE_FIREBASE_FIRESTORE_EMULATOR_HOST', '127.0.0.1'],
  ])('rejects development build Emulator setting %s before any command', (key, value) => {
    const execute = vi.fn()

    expect(() =>
      runWebDeploy({
        environment: { ...validEnvironment(), [key]: value },
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: cleanArtifacts,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'forbidden_build_environment' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['MQTT package import', 'import mqtt from"mqtt"'],
    ['MQTT client call', 'mqtt.connect("wss://example.invalid/mqtt")'],
    ['websocket Broker URL', 'wss://broker.example.invalid:8084/mqtt'],
    ['MQTT username', 'MQTT_USERNAME="browser-user"'],
    ['MQTT password', 'mqttPassword="browser-password"'],
    ['direct subscription', 'client.subscribe("devices/+/events")'],
  ])('rejects browser %s from the inspected Hosting bundle', (_case, contents) => {
    const execute = vi.fn(() => ({ status: 0 }))

    expect(() =>
      runWebDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: () => [
          {
            path: 'assets/index-a1b2c3d4.js',
            contents: `const environment="development",projectId="petcare-c7483";${contents}`,
          },
        ],
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'prohibited_build_artifact' }))
    expect(execute).not.toHaveBeenCalledWith('firebase', expect.anything(), expect.anything())
  })

  it.each([
    ['development discriminator', 'const projectId="petcare-c7483"'],
    ['approved project', 'const environment="development"'],
    [
      'verified Test Tool API origin',
      'const environment="development",projectId="petcare-c7483"',
    ],
  ])('rejects a bundle missing its %s', (_case, contents) => {
    const execute = vi.fn(() => ({ status: 0 }))

    expect(() =>
      runWebDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: () => [{ path: 'assets/index-a1b2c3d4.js', contents }],
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'cloud_adapter_not_verified' }))
    expect(execute).not.toHaveBeenCalledWith('firebase', expect.anything(), expect.anything())
  })

  it('rejects a production bundle that can serve the shell but omits /test-tool', () => {
    const execute = vi.fn(() => ({ status: 0 }))

    expect(() =>
      runWebDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: () => [
          {
            path: 'assets/index-a1b2c3d4.js',
            contents:
              'const environment="development",projectId="petcare-c7483",testTool="https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app"',
          },
          { path: 'index.html', contents: '<div id="app"></div>' },
        ],
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'test_tool_route_absent' }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalledWith('firebase', expect.anything(), expect.anything())
  })

  it.each([
    ['Emulator host', [{ path: 'assets/index.js', contents: 'http://127.0.0.1:8085' }]],
    ['source environment file', [{ path: '.env.production', contents: 'VITE_FIREBASE_API_KEY=public' }]],
    ['private key', [{ path: 'assets/index.js', contents: '-----BEGIN PRIVATE KEY-----' }]],
    ['webhook secret', [{ path: 'assets/index.js', contents: 'EMQX_WEBHOOK_SECRET=leaked' }]],
    ['Admin credential', [{ path: 'service-account.json', contents: '{"private_key_id":"abc"}' }]],
    ['camelCase Admin credential', [{ path: 'assets/index.js', contents: 'const privateKey="leaked"' }]],
  ])('aborts before Hosting upload when the build contains a prohibited %s', (_case, artifacts) => {
    const execute = vi.fn(() => ({ status: 0 }))

    expect(() =>
      runWebDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        testToolReleaseRecord: healthyTestToolRelease(),
        now: () => now,
        execute,
        readBuildArtifacts: () => artifacts,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'prohibited_build_artifact' }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalledWith('firebase', expect.anything(), expect.anything())
  })

  it('uploads only the inspected clean build to the approved development target', () => {
    let stagedConfig: unknown
    let stagedAsset = ''
    const execute = vi.fn((command: string, args: string[]) => {
      if (command === 'firebase') {
        const configPath = args[2]
        stagedConfig = JSON.parse(readFileSync(configPath, 'utf8'))
        stagedAsset = readFileSync(
          resolve(dirname(configPath), 'public/assets/index-a1b2c3d4.js'),
          'utf8',
        )
      }
      return { status: 0 }
    })

    const result = runWebDeploy({
      environment: validEnvironment(),
      args: ['--apply'],
      firebaseConfig: approvedFirebaseConfig,
      firebaseRc: approvedFirebaseRc,
      testToolReleaseRecord: healthyTestToolRelease(),
      now: () => now,
      execute,
      readBuildArtifacts: cleanArtifacts,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenLastCalledWith(
      'firebase',
      [
        'deploy',
        '--config',
        expect.any(String),
        '--project',
        'petcare-c7483',
        '--only',
        'hosting',
        '--non-interactive',
      ],
      expect.objectContaining({ environment: expect.any(Object) }),
    )
    expect(stagedConfig).toEqual({
      hosting: {
        site: 'petcare-c7483',
        public: 'public',
        rewrites: approvedFirebaseConfig.hosting.rewrites,
        headers: approvedFirebaseConfig.hosting.headers,
      },
    })
    expect(stagedAsset).toBe(String(cleanArtifacts()[0].contents))
    expect(result).toMatchObject({ status: 'deployed', projectId: 'petcare-c7483' })
  })

  it('reports a sanitized cleanup warning without disguising a successful upload', () => {
    const cleanup = vi.fn(() => {
      throw new Error('/private/tmp/staging-secret-path')
    })
    const output: string[] = []
    const result = runWebDeploy({
      ...webDeployOptions({ args: ['--apply'] }),
      stageBuildArtifacts: () => ({
        configPath: '/private/tmp/verified-snapshot/firebase.json',
        cleanup,
      }),
      write: (line: string) => output.push(line),
    } as never)

    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: 'deployed',
      cleanupWarning: 'staging_cleanup_failed',
    })
    expect(JSON.parse(output[0])).toEqual(result)
    expect(JSON.stringify(result)).not.toContain('staging-secret-path')
  })

  it('preserves hosting_deploy_failed when cleanup also throws', () => {
    const cleanup = vi.fn(() => {
      throw new Error('cleanup failure')
    })
    const execute = vi.fn((command: string) => ({ status: command === 'firebase' ? 1 : 0 }))

    expect(() =>
      runWebDeploy({
        ...webDeployOptions({ args: ['--apply'], execute }),
        stageBuildArtifacts: () => ({
          configPath: '/private/tmp/verified-snapshot/firebase.json',
          cleanup,
        }),
      } as never),
    ).toThrowError(expect.objectContaining({ code: 'hosting_deploy_failed' }))
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('retries a transient staging cleanup failure without emitting a false warning', () => {
    const cleanup = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('transient cleanup failure')
      })
      .mockImplementationOnce(() => undefined)

    const result = runWebDeploy({
      ...webDeployOptions({ args: ['--apply'] }),
      stageBuildArtifacts: () => ({
        configPath: '/private/tmp/verified-snapshot/firebase.json',
        cleanup,
      }),
    } as never)

    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'deployed' })
    expect(result).not.toHaveProperty('cleanupWarning')
  })
})
