import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

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
  }
}

function cleanArtifacts() {
  return [
    {
      path: 'assets/index-a1b2c3d4.js',
      contents: 'const environment="development",projectId="petcare-c7483"',
    },
    { path: 'index.html', contents: '<div id="app"></div>' },
  ]
}

describe('runWebDeploy development target preflight', () => {
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
        execute,
        readBuildArtifacts: cleanArtifacts,
        write: vi.fn(),
      }),
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
  ])('rejects a bundle missing its %s', (_case, contents) => {
    const execute = vi.fn(() => ({ status: 0 }))

    expect(() =>
      runWebDeploy({
        environment: validEnvironment(),
        args: ['--apply'],
        firebaseConfig: approvedFirebaseConfig,
        firebaseRc: approvedFirebaseRc,
        execute,
        readBuildArtifacts: () => [{ path: 'assets/index-a1b2c3d4.js', contents }],
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'cloud_adapter_not_verified' }))
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
        execute,
        readBuildArtifacts: () => artifacts,
        write: vi.fn(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'prohibited_build_artifact' }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalledWith('firebase', expect.anything(), expect.anything())
  })

  it('uploads only the inspected clean build to the approved development target', () => {
    const execute = vi.fn(() => ({ status: 0 }))

    const result = runWebDeploy({
      environment: validEnvironment(),
      args: ['--apply'],
      firebaseConfig: approvedFirebaseConfig,
      firebaseRc: approvedFirebaseRc,
      execute,
      readBuildArtifacts: cleanArtifacts,
      write: vi.fn(),
    })

    expect(execute).toHaveBeenLastCalledWith(
      'firebase',
      [
        'deploy',
        '--project',
        'petcare-c7483',
        '--only',
        'hosting:development',
        '--non-interactive',
      ],
      expect.objectContaining({ environment: expect.any(Object) }),
    )
    expect(result).toMatchObject({ status: 'deployed', projectId: 'petcare-c7483' })
  })
})
