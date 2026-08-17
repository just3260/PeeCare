import { describe, expect, it, vi } from 'vitest'

import {
  createDefaultOperatorDependencies,
  createSecretHolder,
  evaluateMacOSPreflight,
  parseOperatorArguments,
  resolveGcloudSecret,
  runTestToolOperator,
  type RuntimeProbe,
} from './test-tool-operator.mjs'

const MINIMUM_MACOS = '14.8.8'
const X64_MINIMUM_MACOS = '14.6.0'
const APPROVED_PROJECT = 'petcare-c7483'
const APPROVED_SECRET = 'peecare-emqx-webhook-current'
const PERSONAL_ACCOUNT = 'operator@example.com'
const SECRET = 'approved-development-secret'

function runtimeProbe(overrides: Partial<RuntimeProbe> = {}): RuntimeProbe {
  return {
    swVers: { status: 0, stdout: `${MINIMUM_MACOS}\n` },
    processArchitecture: 'arm64',
    nativeArchitecture: 'arm64',
    translated: false,
    ...overrides,
  }
}

describe('macOS operator runtime preflight', () => {
  it.each([
    ['arm64', MINIMUM_MACOS, '14.8.7', false],
    ['arm64', MINIMUM_MACOS, '14.8.8', true],
    ['x64', X64_MINIMUM_MACOS, '14.5.9', false],
    ['x64', X64_MINIMUM_MACOS, '14.6', true],
    ['x64', X64_MINIMUM_MACOS, '14.6.0', true],
  ] as const)(
    'applies the embedded %s floor %s to host %s before gcloud or listen',
    async (architecture, minimumMacOS, systemVersion, accepted) => {
      const dependencies = operatorDependencies({
        probeRuntime: vi.fn(async () => runtimeProbe({
          swVers: { status: 0, stdout: `${systemVersion}\n` },
          processArchitecture: architecture,
          nativeArchitecture: architecture,
        })),
      })
      const operation = runTestToolOperator({
        args: ['--secret-version', '7', '--no-open'],
        environment: {},
        manifest: validManifest(architecture, minimumMacOS),
        dependencies,
        writeEvent: vi.fn(),
      })

      if (accepted) {
        const session = await operation
        expect(dependencies.resolveGcloud).toHaveBeenCalledTimes(1)
        expect(dependencies.listen).toHaveBeenCalledTimes(1)
        await session.stop()
      } else {
        await expect(operation).rejects.toMatchObject({ code: 'unsupported_macos' })
        expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
        expect(dependencies.executeFile).not.toHaveBeenCalled()
        expect(dependencies.listen).not.toHaveBeenCalled()
      }
    },
  )

  it.each([
    ['14.8.7', false],
    ['14.8.8', true],
    ['14.8.9', true],
    ['14.8', false],
    ['15.0', true],
    ['15.0.0', true],
    ['26.4', true],
  ])(
    'applies the macOS 14.8.8 boundary to %s',
    (systemVersion, accepted) => {
      const probe = runtimeProbe({
        swVers: { status: 0, stdout: `${systemVersion}\n` },
      })

      if (accepted) {
        expect(
          evaluateMacOSPreflight({
            probe,
            manifest: {
              architecture: 'arm64',
              minimumMacOS: MINIMUM_MACOS,
            },
          }),
        ).toEqual({
          architecture: 'arm64',
          macOSVersion: systemVersion,
          minimumMacOS: MINIMUM_MACOS,
        })
      } else {
        expect(() =>
          evaluateMacOSPreflight({
            probe,
            manifest: {
              architecture: 'arm64',
              minimumMacOS: MINIMUM_MACOS,
            },
          }),
        ).toThrow(expect.objectContaining({ code: 'unsupported_macos' }))
      }
    },
  )

  it.each([
    ['malformed output', { status: 0, stdout: 'Sonoma 14.8.8\n' }],
    ['one-component output', { status: 0, stdout: '15\n' }],
    ['four-component output', { status: 0, stdout: '15.0.0.1\n' }],
    ['missing output', { status: 0, stdout: '' }],
    ['nonzero sw_vers', { status: 1, stdout: '14.8.8\n' }],
  ])('fails closed for %s', (_label, swVers) => {
    expect(() =>
      evaluateMacOSPreflight({
        probe: runtimeProbe({ swVers }),
        manifest: {
          architecture: 'arm64',
          minimumMacOS: MINIMUM_MACOS,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_macos' }))
  })

  it.each([
    ['arm64', 'arm64'],
    ['x64', 'x64'],
  ] as const)(
    'accepts a native %s process for the matching %s artifact',
    (processArchitecture, artifactArchitecture) => {
      expect(
        evaluateMacOSPreflight({
          probe: runtimeProbe({
            processArchitecture,
            nativeArchitecture: artifactArchitecture,
          }),
          manifest: {
            architecture: artifactArchitecture,
            minimumMacOS: MINIMUM_MACOS,
          },
        }),
      ).toMatchObject({ architecture: artifactArchitecture })
    },
  )

  it.each([
    [
      'an arm64 process using an x64 artifact',
      runtimeProbe({ processArchitecture: 'arm64', nativeArchitecture: 'arm64' }),
      'x64',
    ],
    [
      'an x64 process using an arm64 artifact',
      runtimeProbe({ processArchitecture: 'x64', nativeArchitecture: 'x64' }),
      'arm64',
    ],
    [
      'an x64 artifact translated on Apple Silicon',
      runtimeProbe({
        processArchitecture: 'x64',
        nativeArchitecture: 'arm64',
        translated: true,
      }),
      'x64',
    ],
  ] as const)('rejects %s', (_label, probe, architecture) => {
    expect(() =>
      evaluateMacOSPreflight({
        probe,
        manifest: { architecture, minimumMacOS: MINIMUM_MACOS },
      }),
    ).toThrow(expect.objectContaining({ code: 'architecture_mismatch' }))
  })

  it.each([
    ['arm64', MINIMUM_MACOS, '15.0'],
    ['arm64', MINIMUM_MACOS, '15.0.0'],
    ['arm64', MINIMUM_MACOS, '26.4'],
    ['x64', X64_MINIMUM_MACOS, '15.0'],
    ['x64', X64_MINIMUM_MACOS, '15.0.0'],
    ['x64', X64_MINIMUM_MACOS, '26.4'],
  ] as const)(
    'passes the %s normalized %s version gate before gcloud and listen',
    async (architecture, minimumMacOS, systemVersion) => {
      const dependencies = operatorDependencies({
        probeRuntime: vi.fn(async () => runtimeProbe({
          swVers: { status: 0, stdout: `${systemVersion}\n` },
          processArchitecture: architecture,
          nativeArchitecture: architecture,
        })),
      })

      const session = await runTestToolOperator({
        args: ['--secret-version', '7', '--no-open'],
        environment: {},
        manifest: validManifest(architecture, minimumMacOS),
        dependencies,
        writeEvent: vi.fn(),
      })

      expect(dependencies.probeRuntime).toHaveBeenCalledTimes(1)
      expect(dependencies.resolveGcloud).toHaveBeenCalledTimes(1)
      expect(dependencies.listen).toHaveBeenCalledTimes(1)
      expect(dependencies.probeRuntime.mock.invocationCallOrder[0]).toBeLessThan(
        dependencies.resolveGcloud.mock.invocationCallOrder[0],
      )
      expect(dependencies.probeRuntime.mock.invocationCallOrder[0]).toBeLessThan(
        dependencies.listen.mock.invocationCallOrder[0],
      )
      await session.stop()
    },
  )

  it.each(['14.8', '15', '15.0.0.1', 'fifteen.zero'])(
    'rejects %s before gcloud or listen',
    async (systemVersion) => {
      const dependencies = operatorDependencies({
        probeRuntime: vi.fn(async () => runtimeProbe({
          swVers: { status: 0, stdout: `${systemVersion}\n` },
        })),
      })

      await expect(
        runTestToolOperator({
          args: ['--secret-version', '7', '--no-open'],
          environment: {},
          manifest: validManifest(),
          dependencies,
          writeEvent: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: 'unsupported_macos' })

      expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
      expect(dependencies.executeFile).not.toHaveBeenCalled()
      expect(dependencies.listen).not.toHaveBeenCalled()
    },
  )
})

function successfulGcloudResult(args: string[]) {
  if (args[0] === 'version') {
    return { status: 0, stdout: JSON.stringify({ 'Google Cloud SDK': '543.0.0' }), stderr: '' }
  }
  if (args[0] === 'auth') {
    return {
      status: 0,
      stdout: JSON.stringify([{ account: PERSONAL_ACCOUNT, status: 'ACTIVE' }]),
      stderr: '',
    }
  }
  if (args[0] === 'config') {
    return { status: 0, stdout: `${APPROVED_PROJECT}\n`, stderr: '' }
  }
  if (args[0] === 'secrets') {
    return { status: 0, stdout: `${SECRET}\n`, stderr: '' }
  }
  throw new Error(`unexpected gcloud operation: ${args[0]}`)
}

function operatorDependencies(
  overrides: Record<string, unknown> = {},
) {
  return {
    probeRuntime: vi.fn(async () => runtimeProbe()),
    resolveGcloud: vi.fn(async () => '/opt/homebrew/bin/gcloud'),
    executeFile: vi.fn(async (_command: string, args: string[]) =>
      successfulGcloudResult(args),
    ),
    inspectSecretFile: vi.fn(() => ({ isFile: () => true, mode: 0o100600 })),
    readSecretFile: vi.fn(() => `${SECRET}\n`),
    createSecretHolder,
    listen: vi.fn(async () => ({
      address: { address: '127.0.0.1', family: 'IPv4', port: 5055 },
      close: vi.fn(async () => {}),
    })),
    openBrowser: vi.fn(async () => {}),
    ...overrides,
  }
}

function validManifest(
  architecture = 'arm64',
  minimumMacOS = architecture === 'arm64' ? MINIMUM_MACOS : X64_MINIMUM_MACOS,
) {
  return { architecture, minimumMacOS }
}

describe('operator credential policy', () => {
  it('defaults to development-cloud with one numeric gcloud secret version', () => {
    expect(parseOperatorArguments(['--secret-version', '7'])).toEqual({
      profile: 'development-cloud',
      credential: { kind: 'gcloud', version: '7' },
      port: undefined,
      openBrowser: true,
    })
  })

  it('accepts local mode only when it has no credential provider', () => {
    expect(parseOperatorArguments(['--profile', 'local', '--no-open'])).toEqual({
      profile: 'local',
      credential: undefined,
      port: undefined,
      openBrowser: false,
    })
  })

  it('accepts one explicit absolute owner-only file provider', () => {
    expect(
      parseOperatorArguments([
        '--profile',
        'development-cloud',
        '--secret-file',
        '/private/tmp/ingestion-secret',
      ]),
    ).toEqual({
      profile: 'development-cloud',
      credential: {
        kind: 'file',
        path: '/private/tmp/ingestion-secret',
      },
      port: undefined,
      openBrowser: true,
    })
  })

  it('loads the explicit owner-only file provider without resolving or invoking gcloud', async () => {
    const secretHolder = createSecretHolder(SECRET)
    const dependencies = operatorDependencies({
      createSecretHolder: vi.fn(() => secretHolder),
    })

    const session = await runTestToolOperator({
      args: ['--secret-file', '/private/tmp/ingestion-secret', '--no-open'],
      environment: {},
      manifest: validManifest(),
      dependencies,
      writeEvent: vi.fn(),
    })

    expect(dependencies.inspectSecretFile).toHaveBeenCalledWith(
      '/private/tmp/ingestion-secret',
    )
    expect(dependencies.readSecretFile).toHaveBeenCalledWith(
      '/private/tmp/ingestion-secret',
      'utf8',
    )
    expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
    expect(dependencies.executeFile).not.toHaveBeenCalled()
    expect(dependencies.listen).toHaveBeenCalledWith(
      expect.objectContaining({ secretHolder }),
    )
    await session.stop()
    expect(secretHolder.hasSecret()).toBe(false)
  })

  it.each([
    ['not a file', { isFile: () => false, mode: 0o100600 }, `${SECRET}\n`],
    ['group-readable', { isFile: () => true, mode: 0o100640 }, `${SECRET}\n`],
    ['empty', { isFile: () => true, mode: 0o100600 }, ''],
    ['multiline', { isFile: () => true, mode: 0o100600 }, 'one\ntwo\n'],
  ])('rejects a %s secret file before listen', async (_label, stats, contents) => {
    const dependencies = operatorDependencies({
      inspectSecretFile: vi.fn(() => stats),
      readSecretFile: vi.fn(() => contents),
    })

    await expect(
      runTestToolOperator({
        args: ['--secret-file', '/private/tmp/ingestion-secret', '--no-open'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'secret_value_invalid' })

    expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
    expect(dependencies.executeFile).not.toHaveBeenCalled()
    expect(dependencies.listen).not.toHaveBeenCalled()
  })

  it.each([
    ['missing development credential', []],
    [
      'ambiguous development credentials',
      ['--secret-version', '7', '--secret-file', '/private/tmp/secret'],
    ],
    ['irrelevant local gcloud credential', ['--profile', 'local', '--secret-version', '7']],
    [
      'irrelevant local file credential',
      ['--profile', 'local', '--secret-file', '/private/tmp/secret'],
    ],
    ['relative secret file', ['--secret-file', 'relative-secret']],
    ['unknown option', ['--secret-version', '7', '--debug']],
    ['positional argument', ['--secret-version', '7', 'unexpected']],
    ['duplicate option', ['--secret-version', '7', '--secret-version', '8']],
  ])('rejects %s before any external operation', async (_label, args) => {
    const dependencies = operatorDependencies()

    await expect(
      runTestToolOperator({
        args,
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_arguments' })

    expect(dependencies.probeRuntime).not.toHaveBeenCalled()
    expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
    expect(dependencies.executeFile).not.toHaveBeenCalled()
    expect(dependencies.readSecretFile).not.toHaveBeenCalled()
    expect(dependencies.listen).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', 'latest', '1.0', 'abc', '']) (
    'rejects secret version %j before gcloud and listen',
    async (version) => {
      const dependencies = operatorDependencies()

      await expect(
        runTestToolOperator({
          args: ['--secret-version', version],
          environment: {},
          manifest: validManifest(),
          dependencies,
          writeEvent: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: 'secret_version_invalid' })

      expect(dependencies.probeRuntime).not.toHaveBeenCalled()
      expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
      expect(dependencies.executeFile).not.toHaveBeenCalled()
      expect(dependencies.listen).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['GOOGLE_APPLICATION_CREDENTIALS', '/private/tmp/service-account.json'],
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080'],
    ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099'],
    ['FIREBASE_DATABASE_EMULATOR_HOST', '127.0.0.1:9000'],
  ])('rejects inherited %s before gcloud and listen', async (name, value) => {
    const dependencies = operatorDependencies()

    await expect(
      runTestToolOperator({
        args: ['--secret-version', '7'],
        environment: { [name]: value },
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'gcloud_identity_invalid' })

    expect(dependencies.resolveGcloud).not.toHaveBeenCalled()
    expect(dependencies.executeFile).not.toHaveBeenCalled()
    expect(dependencies.listen).not.toHaveBeenCalled()
  })

  it('uses only the fixed no-shell personal gcloud operations and target', async () => {
    const executeFile = vi.fn(async (_command: string, args: string[]) =>
      successfulGcloudResult(args),
    )

    const holder = await resolveGcloudSecret({
      version: '7',
      environment: {},
      gcloudPath: '/opt/homebrew/bin/gcloud',
      executeFile,
      createHolder: createSecretHolder,
    })

    expect(executeFile.mock.calls).toEqual([
      [
        '/opt/homebrew/bin/gcloud',
        ['version', '--format=json'],
        expect.objectContaining({ shell: false }),
      ],
      [
        '/opt/homebrew/bin/gcloud',
        ['auth', 'list', '--filter=status:ACTIVE', '--format=json'],
        expect.objectContaining({ shell: false }),
      ],
      [
        '/opt/homebrew/bin/gcloud',
        ['config', 'get-value', 'project'],
        expect.objectContaining({ shell: false }),
      ],
      [
        '/opt/homebrew/bin/gcloud',
        [
          'secrets',
          'versions',
          'access',
          '7',
          '--secret',
          APPROVED_SECRET,
          '--project',
          APPROVED_PROJECT,
        ],
        expect.objectContaining({ shell: false }),
      ],
    ])
    expect(holder.withSecret((value: string) => value)).toBe(SECRET)
    holder.clear()
    expect(holder.hasSecret()).toBe(false)
  })

  it('fails closed when gcloud cannot be resolved without executing or listening', async () => {
    const dependencies = operatorDependencies({
      resolveGcloud: vi.fn(async () => null),
    })

    await expect(
      runTestToolOperator({
        args: ['--secret-version', '7'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'gcloud_unavailable' })

    expect(dependencies.executeFile).not.toHaveBeenCalled()
    expect(dependencies.listen).not.toHaveBeenCalled()
  })

  it.each([
    ['unsupported gcloud', 'version', 'gcloud_unsupported'],
    ['denied Secret Manager access', 'secrets', 'secret_access_denied'],
  ])(
    'maps %s to a sanitized code without listening',
    async (_label, failedOperation, code) => {
      const privateOutput = `${PERSONAL_ACCOUNT} token=${SECRET}`
      const executeFile = vi.fn(async (_command: string, args: string[]) =>
        args[0] === failedOperation
          ? { status: 1, stdout: privateOutput, stderr: privateOutput }
          : successfulGcloudResult(args),
      )
      const writeEvent = vi.fn()
      const dependencies = operatorDependencies({ executeFile })

      await expect(
        runTestToolOperator({
          args: ['--secret-version', '7'],
          environment: {},
          manifest: validManifest(),
          dependencies,
          writeEvent,
        }),
      ).rejects.toMatchObject({ code })

      expect(dependencies.listen).not.toHaveBeenCalled()
      const terminalOutput = writeEvent.mock.calls.flat().join('\n')
      expect(terminalOutput).not.toContain(SECRET)
      expect(terminalOutput).not.toContain(PERSONAL_ACCOUNT)
      expect(terminalOutput).not.toMatch(/token=/i)
    },
  )

  it.each([
    [
      'no active account',
      (args: string[]) =>
        args[0] === 'auth'
          ? { status: 0, stdout: '[]', stderr: '' }
          : successfulGcloudResult(args),
      'gcloud_not_authenticated',
    ],
    [
      'multiple active accounts',
      (args: string[]) =>
        args[0] === 'auth'
          ? {
              status: 0,
              stdout: JSON.stringify([
                { account: PERSONAL_ACCOUNT, status: 'ACTIVE' },
                { account: 'second@example.com', status: 'ACTIVE' },
              ]),
              stderr: '',
            }
          : successfulGcloudResult(args),
      'gcloud_identity_invalid',
    ],
    [
      'service account identity',
      (args: string[]) =>
        args[0] === 'auth'
          ? {
              status: 0,
              stdout: JSON.stringify([
                {
                  account: 'runtime@petcare-c7483.iam.gserviceaccount.com',
                  status: 'ACTIVE',
                },
              ]),
              stderr: '',
            }
          : successfulGcloudResult(args),
      'gcloud_identity_invalid',
    ],
    [
      'foreign project',
      (args: string[]) =>
        args[0] === 'config'
          ? { status: 0, stdout: 'foreign-project\n', stderr: '' }
          : successfulGcloudResult(args),
      'project_mismatch',
    ],
    [
      'unset project',
      (args: string[]) =>
        args[0] === 'config'
          ? { status: 0, stdout: '(unset)\n', stderr: '' }
          : successfulGcloudResult(args),
      'project_mismatch',
    ],
  ])(
    'rejects %s without Secret Manager access or listen',
    async (_label, resultForArgs, code) => {
      const executeFile = vi.fn(async (_command: string, args: string[]) =>
        resultForArgs(args),
      )
      const dependencies = operatorDependencies({ executeFile })

      await expect(
        runTestToolOperator({
          args: ['--secret-version', '7'],
          environment: {},
          manifest: validManifest(),
          dependencies,
          writeEvent: vi.fn(),
        }),
      ).rejects.toMatchObject({ code })

      expect(
        executeFile.mock.calls.filter(([, args]) => args[0] === 'secrets'),
      ).toHaveLength(0)
      expect(dependencies.listen).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['empty', ''],
    ['whitespace', '   \n'],
    ['multiline', 'line-one\nline-two\n'],
    ['non-visible ASCII', 'approved-密碼\n'],
    ['over 512 bytes', `${'x'.repeat(513)}\n`],
  ])('rejects a %s secret without listening', async (_label, secretOutput) => {
    const executeFile = vi.fn(async (_command: string, args: string[]) =>
      args[0] === 'secrets'
        ? { status: 0, stdout: secretOutput, stderr: '' }
        : successfulGcloudResult(args),
    )
    const dependencies = operatorDependencies({ executeFile })

    await expect(
      runTestToolOperator({
        args: ['--secret-version', '7'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'secret_value_invalid' })

    expect(dependencies.listen).not.toHaveBeenCalled()
  })

  it('clears an acquired secret when startup fails and redacts all terminal output', async () => {
    const holder = createSecretHolder(SECRET)
    const writeEvent = vi.fn()
    const executeFile = vi.fn(async (_command: string, args: string[]) =>
      args[0] === 'secrets'
        ? { status: 0, stdout: `${SECRET}\n`, stderr: `token=${SECRET}` }
        : successfulGcloudResult(args),
    )
    const dependencies = operatorDependencies({
      executeFile,
      createSecretHolder: vi.fn(() => holder),
      listen: vi.fn(async () => {
        throw Object.assign(new Error(`failed near ${PERSONAL_ACCOUNT} ${SECRET}`), {
          code: 'EACCES',
        })
      }),
    })

    await expect(
      runTestToolOperator({
        args: ['--secret-version', '7'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent,
      }),
    ).rejects.toMatchObject({ code: 'port_bind_failed' })

    expect(holder.hasSecret()).toBe(false)
    const terminalOutput = writeEvent.mock.calls.flat().join('\n')
    expect(terminalOutput).not.toContain(SECRET)
    expect(terminalOutput).not.toContain(PERSONAL_ACCOUNT)
    expect(terminalOutput).not.toMatch(/token=/i)
  })
})

function signalHarness() {
  const handlers = new Map<string, () => Promise<void> | void>()
  return {
    handlers,
    onSignal: vi.fn((signal: string, handler: () => Promise<void> | void) => {
      handlers.set(signal, handler)
      return () => handlers.delete(signal)
    }),
  }
}

function listeningServer(port = 5055) {
  return {
    address: { address: '127.0.0.1', family: 'IPv4', port },
    close: vi.fn(async () => {}),
  }
}

describe('loopback and browser lifecycle', () => {
  it('the default listener binds only loopback and releases its ephemeral port', async () => {
    const dependencies = createDefaultOperatorDependencies()
    const server = await dependencies.listen({
      host: '127.0.0.1',
      port: 0,
      profile: 'local',
      secretHolder: undefined,
    })

    expect(server.address).toMatchObject({ address: '127.0.0.1' })
    const url = `http://127.0.0.1:${server.address.port}`
    expect((await fetch(`${url}/api/config`)).status).toBe(200)

    await server.close()
    await expect(fetch(`${url}/api/config`)).rejects.toThrow()
  })

  it('tries 5055 and falls back exactly once to an ephemeral loopback port', async () => {
    const fallbackServer = listeningServer(61_234)
    const listen = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EADDRINUSE' }))
      .mockResolvedValueOnce(fallbackServer)
    const openBrowser = vi.fn(async () => {})
    const dependencies = operatorDependencies({ listen, openBrowser })

    const session = await runTestToolOperator({
      args: ['--profile', 'local'],
      environment: {},
      manifest: validManifest(),
      dependencies,
      writeEvent: vi.fn(),
    })

    expect(listen.mock.calls).toEqual([
      [expect.objectContaining({ host: '127.0.0.1', port: 5055 })],
      [expect.objectContaining({ host: '127.0.0.1', port: 0 })],
    ])
    expect(session.url).toBe('http://127.0.0.1:61234')
    expect(openBrowser).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['http://127.0.0.1:61234'],
      expect.objectContaining({ shell: false }),
    )
    await session.stop()
  })

  it('does not retry a failed explicit port', async () => {
    const listen = vi.fn(async () => {
      throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' })
    })
    const dependencies = operatorDependencies({ listen })

    await expect(
      runTestToolOperator({
        args: ['--profile', 'local', '--port', '5056', '--no-open'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'port_bind_failed' })

    expect(listen).toHaveBeenCalledTimes(1)
    expect(listen).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 5056 }),
    )
  })

  it('does not use the ephemeral fallback for non-address-in-use failures', async () => {
    const listen = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    const dependencies = operatorDependencies({ listen })

    await expect(
      runTestToolOperator({
        args: ['--profile', 'local', '--no-open'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'port_bind_failed' })

    expect(listen).toHaveBeenCalledTimes(1)
  })

  it('keeps the loopback server running when browser open fails', async () => {
    const server = listeningServer()
    const openBrowser = vi.fn(async () => {
      throw new Error(`managed policy exposed ${PERSONAL_ACCOUNT} ${SECRET}`)
    })
    const writeEvent = vi.fn()
    const dependencies = operatorDependencies({
      listen: vi.fn(async () => server),
      openBrowser,
    })

    const session = await runTestToolOperator({
      args: ['--profile', 'local'],
      environment: {},
      manifest: validManifest(),
      dependencies,
      writeEvent,
    })

    expect(session.url).toBe('http://127.0.0.1:5055')
    expect(server.close).not.toHaveBeenCalled()
    expect(writeEvent).toHaveBeenCalledWith({
      status: 'warning',
      code: 'browser_open_failed',
      profile: 'local',
      architecture: 'arm64',
      minimumMacOS: MINIMUM_MACOS,
      url: 'http://127.0.0.1:5055',
    })
    await session.stop()
  })

  it.each(['SIGINT', 'SIGTERM']) (
    'closes the listener and clears the holder on %s',
    async (signal) => {
      const holder = createSecretHolder(SECRET)
      const server = listeningServer()
      const signals = signalHarness()
      const dependencies = operatorDependencies({
        createSecretHolder: vi.fn(() => holder),
        listen: vi.fn(async () => server),
        openBrowser: vi.fn(async () => {}),
        onSignal: signals.onSignal,
      })

      await runTestToolOperator({
        args: ['--secret-version', '7', '--no-open'],
        environment: {},
        manifest: validManifest(),
        dependencies,
        writeEvent: vi.fn(),
      })

      expect(signals.handlers.has('SIGINT')).toBe(true)
      expect(signals.handlers.has('SIGTERM')).toBe(true)
      await signals.handlers.get(signal)?.()

      expect(server.close).toHaveBeenCalledTimes(1)
      expect(holder.hasSecret()).toBe(false)
    },
  )

  it('closes the listener and clears the holder on a post-listen server error', async () => {
    const holder = createSecretHolder(SECRET)
    let onError: (() => Promise<void> | void) | undefined
    const server = {
      ...listeningServer(),
      onError: vi.fn((handler: () => Promise<void> | void) => {
        onError = handler
        return () => { onError = undefined }
      }),
    }
    const dependencies = operatorDependencies({
      createSecretHolder: vi.fn(() => holder),
      listen: vi.fn(async () => server),
    })

    await runTestToolOperator({
      args: ['--secret-version', '7', '--no-open'],
      environment: {},
      manifest: validManifest(),
      dependencies,
      writeEvent: vi.fn(),
    })
    await onError?.()

    expect(server.close).toHaveBeenCalledTimes(1)
    expect(holder.hasSecret()).toBe(false)
  })

  it('emits only the stable terminal event schema and safe loopback URL', async () => {
    const writeEvent = vi.fn()
    const dependencies = operatorDependencies({
      listen: vi.fn(async () => listeningServer(60_001)),
      openBrowser: vi.fn(async () => {}),
    })

    const session = await runTestToolOperator({
      args: ['--secret-version', '7', '--no-open'],
      environment: {},
      manifest: validManifest(),
      dependencies,
      writeEvent,
    })

    const allowedFields = new Set([
      'status',
      'code',
      'profile',
      'architecture',
      'minimumMacOS',
      'url',
    ])
    for (const [event] of writeEvent.mock.calls) {
      expect(Object.keys(event).every((field) => allowedFields.has(field))).toBe(true)
      if ('url' in event) expect(event.url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/u)
    }
    const output = JSON.stringify(writeEvent.mock.calls)
    expect(output).not.toContain(SECRET)
    expect(output).not.toContain(PERSONAL_ACCOUNT)
    expect(output).not.toMatch(/credential|identity|token/i)
    await session.stop()
  })
})
