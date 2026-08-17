import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { arch as hostArchitecture } from 'node:os'
import { delimiter, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

import {
  createOperatorTestToolConfig,
  createTestToolServer,
} from './test-tool.mjs'

const DEFAULT_PROFILE = 'development-cloud'
const LOCAL_PROFILE = 'local'
const DEVELOPMENT_CLOUD_PROFILE = 'development-cloud'
const DEFAULT_PORT = 5055
const LOOPBACK_HOST = '127.0.0.1'
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64'])
const execFileAsync = promisify(execFile)
const INHERITED_CREDENTIAL_ENVIRONMENT = new Set([
  'GOOGLE_APPLICATION_CREDENTIALS',
  'FIRESTORE_EMULATOR_HOST',
])

export class TestToolOperatorError extends Error {
  constructor(code) {
    super(code)
    this.name = 'TestToolOperatorError'
    this.code = code
  }
}

function fail(code) {
  throw new TestToolOperatorError(code)
}

function parseSystemVersion(value) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/u.test(value)) {
    return null
  }
  const components = value.split('.').map(Number)
  return components.length === 2 ? [...components, 0] : components
}

function parseManifestVersion(value) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(value)) {
    return null
  }
  return value.split('.').map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function validateManifestRuntime(manifest) {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    !SUPPORTED_ARCHITECTURES.has(manifest.architecture) ||
    parseManifestVersion(manifest.minimumMacOS) === null
  ) {
    fail('architecture_mismatch')
  }
  return manifest
}

export function evaluateMacOSPreflight({ probe, manifest }) {
  const validatedManifest = validateManifestRuntime(manifest)
  const minimum = parseManifestVersion(validatedManifest.minimumMacOS)
  const version =
    probe?.swVers?.status === 0
      ? String(probe.swVers.stdout ?? '').trim()
      : ''
  const parsedVersion = parseSystemVersion(version)
  if (parsedVersion === null || compareVersions(parsedVersion, minimum) < 0) {
    fail('unsupported_macos')
  }
  if (
    probe?.translated === true ||
    probe?.processArchitecture !== validatedManifest.architecture ||
    probe?.nativeArchitecture !== validatedManifest.architecture
  ) {
    fail('architecture_mismatch')
  }
  return Object.freeze({
    architecture: validatedManifest.architecture,
    macOSVersion: version,
    minimumMacOS: validatedManifest.minimumMacOS,
  })
}

function requiredValue(args, index) {
  const value = args[index + 1]
  if (
    typeof value !== 'string' ||
    value.startsWith('--')
  ) {
    fail('invalid_arguments')
  }
  return value
}

export function parseOperatorArguments(args) {
  if (!Array.isArray(args)) fail('invalid_arguments')
  const options = new Map()
  let noOpen = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--no-open') {
      if (noOpen) fail('invalid_arguments')
      noOpen = true
      continue
    }
    if (!['--profile', '--secret-version', '--secret-file', '--port'].includes(argument)) {
      fail('invalid_arguments')
    }
    if (options.has(argument)) fail('invalid_arguments')
    const value = requiredValue(args, index)
    options.set(argument, value)
    index += 1
  }

  const profile = options.get('--profile') ?? DEFAULT_PROFILE
  if (![LOCAL_PROFILE, DEVELOPMENT_CLOUD_PROFILE].includes(profile)) {
    fail('invalid_arguments')
  }

  const secretVersion = options.get('--secret-version')
  const secretFile = options.get('--secret-file')
  let credential
  if (profile === LOCAL_PROFILE) {
    if (secretVersion !== undefined || secretFile !== undefined) fail('invalid_arguments')
  } else {
    if ((secretVersion === undefined) === (secretFile === undefined)) {
      fail('invalid_arguments')
    }
    if (secretVersion !== undefined) {
      if (!/^[1-9][0-9]*$/u.test(secretVersion)) fail('secret_version_invalid')
      credential = Object.freeze({ kind: 'gcloud', version: secretVersion })
    } else {
      if (!isAbsolute(secretFile)) fail('invalid_arguments')
      credential = Object.freeze({ kind: 'file', path: secretFile })
    }
  }

  let port
  if (options.has('--port')) {
    const rawPort = options.get('--port')
    if (!/^[1-9][0-9]*$/u.test(rawPort)) fail('invalid_arguments')
    port = Number(rawPort)
    if (!Number.isSafeInteger(port) || port > 65_535) fail('invalid_arguments')
  }

  return Object.freeze({
    profile,
    credential,
    port,
    openBrowser: !noOpen,
  })
}

function rejectUnsafeInheritedEnvironment(environment) {
  for (const name of Object.keys(environment ?? {})) {
    if (
      INHERITED_CREDENTIAL_ENVIRONMENT.has(name) ||
      /^FIREBASE_.*_EMULATOR_HOST$/u.test(name)
    ) {
      fail('gcloud_identity_invalid')
    }
  }
}

function sanitizedEvent({ status, code, profile, manifest, url }) {
  return Object.freeze({
    status,
    ...(code === undefined ? {} : { code }),
    profile,
    architecture: manifest.architecture,
    minimumMacOS: manifest.minimumMacOS,
    ...(url === undefined ? {} : { url }),
  })
}

async function listenWithFallback({ options, dependencies }) {
  const requestedPort = options.port ?? DEFAULT_PORT
  try {
    return await dependencies.listen({
      host: LOOPBACK_HOST,
      port: requestedPort,
      profile: options.profile,
      secretHolder: options.secretHolder,
    })
  } catch (error) {
    if (options.port === undefined && error?.code === 'EADDRINUSE') {
      try {
        return await dependencies.listen({
          host: LOOPBACK_HOST,
          port: 0,
          profile: options.profile,
          secretHolder: options.secretHolder,
        })
      } catch {
        fail('port_bind_failed')
      }
    }
    fail('port_bind_failed')
  }
}

function loopbackUrl(server) {
  const address = server?.address
  if (
    address === null ||
    typeof address !== 'object' ||
    address.address !== LOOPBACK_HOST ||
    !Number.isInteger(address.port) ||
    address.port < 1 ||
    address.port > 65_535
  ) {
    fail('port_bind_failed')
  }
  return `http://${LOOPBACK_HOST}:${address.port}`
}

export async function runTestToolOperator({
  args,
  environment = {},
  manifest,
  dependencies,
  writeEvent = () => {},
}) {
  const options = parseOperatorArguments(args)
  validateManifestRuntime(manifest)
  if (options.credential?.kind === 'gcloud') {
    rejectUnsafeInheritedEnvironment(environment)
  }

  let secretHolder
  let server
  const unsubscribers = []
  try {
    const probe = await dependencies.probeRuntime()
    evaluateMacOSPreflight({ probe, manifest })

    if (options.credential?.kind === 'gcloud') {
      const gcloudPath = await dependencies.resolveGcloud()
      if (typeof gcloudPath !== 'string' || !isAbsolute(gcloudPath)) {
        fail('gcloud_unavailable')
      }
      secretHolder = await resolveGcloudSecret({
        version: options.credential.version,
        environment,
        gcloudPath,
        executeFile: dependencies.executeFile,
        createHolder: dependencies.createSecretHolder,
      })
    } else if (options.credential?.kind === 'file') {
      secretHolder = readOwnerOnlySecret({
        path: options.credential.path,
        inspectSecretFile: dependencies.inspectSecretFile,
        readSecretFile: dependencies.readSecretFile,
        createHolder: dependencies.createSecretHolder,
      })
    }

    server = await listenWithFallback({
      options: { ...options, secretHolder },
      dependencies,
    })
    const url = loopbackUrl(server)
    const stop = async () => {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
      if (server !== undefined) {
        const closing = server
        server = undefined
        await closing.close()
      }
      secretHolder?.clear()
    }

    if (typeof server.onError === 'function') {
      unsubscribers.push(server.onError(stop))
    }
    if (typeof dependencies.onSignal === 'function') {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        unsubscribers.push(dependencies.onSignal(signal, stop))
      }
    }

    writeEvent(
      sanitizedEvent({ status: 'ready', profile: options.profile, manifest, url }),
    )
    if (options.openBrowser) {
      try {
        await dependencies.openBrowser('/usr/bin/open', [url], { shell: false })
      } catch {
        writeEvent(
          sanitizedEvent({
            status: 'warning',
            code: 'browser_open_failed',
            profile: options.profile,
            manifest,
            url,
          }),
        )
      }
    }
    return Object.freeze({ url, stop })
  } catch (error) {
    if (server !== undefined) await server.close().catch(() => {})
    secretHolder?.clear()
    const operatorError =
      error instanceof TestToolOperatorError
        ? error
        : new TestToolOperatorError('port_bind_failed')
    writeEvent(
      sanitizedEvent({
        status: 'error',
        code: operatorError.code,
        profile: options.profile,
        manifest,
      }),
    )
    throw operatorError
  }
}

export function createSecretHolder(initialValue) {
  let value = initialValue
  return Object.freeze({
    withSecret(consumer) {
      if (typeof value !== 'string' || typeof consumer !== 'function') {
        fail('secret_value_invalid')
      }
      return consumer(value)
    },
    clear() {
      value = undefined
    },
    hasSecret() {
      return typeof value === 'string'
    },
  })
}

function isCredentialHolder(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.withSecret === 'function' &&
    typeof value.clear === 'function'
  )
}

function resolveExecutable(name, environment = process.env) {
  const searchPath = String(environment.PATH ?? '')
  for (const directory of searchPath.split(delimiter)) {
    if (!isAbsolute(directory)) continue
    const candidate = resolve(directory, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}

function executeFile(command, args, options) {
  return execFileAsync(command, args, options).then(({ stdout, stderr }) => ({
    status: 0,
    stdout,
    stderr,
  })).catch((error) => ({
    status: Number.isInteger(error?.code) ? error.code : 1,
    stdout: typeof error?.stdout === 'string' ? error.stdout : '',
    stderr: typeof error?.stderr === 'string' ? error.stderr : '',
  }))
}

async function probeRuntime() {
  const swVers = await executeFile('/usr/bin/sw_vers', ['-productVersion'], {
    encoding: 'utf8',
    maxBuffer: 1_024,
    shell: false,
  })
  const nativeArchitecture = hostArchitecture()
  let translated = false
  if (process.arch === 'x64') {
    const translation = await executeFile('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], {
      encoding: 'utf8',
      maxBuffer: 32,
      shell: false,
    })
    translated = translation.status === 0 && translation.stdout.trim() === '1'
  }
  return Object.freeze({
    swVers,
    processArchitecture: process.arch,
    nativeArchitecture: translated ? 'arm64' : nativeArchitecture,
    translated,
  })
}

async function listen({ host, port, profile, secretHolder, assets }) {
  if (host !== LOOPBACK_HOST) fail('port_bind_failed')
  const config = createOperatorTestToolConfig({ profile, secretHolder })
  const server = createTestToolServer({ config, assets })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK_HOST, resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
    await new Promise((resolveClose) => server.close(resolveClose))
    fail('port_bind_failed')
  }
  return Object.freeze({
    address: Object.freeze({
      address: address.address,
      family: address.family,
      port: address.port,
    }),
    onError(handler) {
      server.once('error', handler)
      return () => server.off('error', handler)
    },
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  })
}

function openBrowser(command, args, options) {
  if (command !== '/usr/bin/open' || options?.shell !== false) {
    return Promise.reject(new Error('browser_open_failed'))
  }
  return new Promise((resolveOpen, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveOpen()
      else reject(new Error('browser_open_failed'))
    })
  })
}

export function createDefaultOperatorDependencies({
  environment = process.env,
  assets,
} = {}) {
  return Object.freeze({
    probeRuntime,
    resolveGcloud: async () => resolveExecutable('gcloud', environment),
    executeFile,
    inspectSecretFile: statSync,
    readSecretFile: readFileSync,
    createSecretHolder,
    listen: (input) => listen({ ...input, assets }),
    openBrowser,
    onSignal(signal, handler) {
      process.once(signal, handler)
      return () => process.off(signal, handler)
    },
  })
}

async function executeGcloud(executeFile, gcloudPath, args, failureCode, maxBuffer) {
  let result
  try {
    result = await executeFile(gcloudPath, args, {
      encoding: 'utf8',
      maxBuffer,
      shell: false,
    })
  } catch {
    fail(failureCode)
  }
  if (
    result === null ||
    typeof result !== 'object' ||
    result.status !== 0 ||
    typeof result.stdout !== 'string' ||
    typeof result.stderr !== 'string'
  ) {
    fail(failureCode)
  }
  return result.stdout
}

function parseGcloudVersion(output) {
  let record
  try {
    record = JSON.parse(output)
  } catch {
    fail('gcloud_unsupported')
  }
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    typeof record['Google Cloud SDK'] !== 'string' ||
    !/^[1-9][0-9]*\.[0-9]+\.[0-9]+$/u.test(record['Google Cloud SDK'])
  ) {
    fail('gcloud_unsupported')
  }
}

function parsePersonalAccount(output) {
  let accounts
  try {
    accounts = JSON.parse(output)
  } catch {
    fail('gcloud_identity_invalid')
  }
  if (!Array.isArray(accounts)) fail('gcloud_identity_invalid')
  if (accounts.length === 0) fail('gcloud_not_authenticated')
  if (
    accounts.length !== 1 ||
    accounts[0] === null ||
    typeof accounts[0] !== 'object' ||
    accounts[0].status !== 'ACTIVE' ||
    typeof accounts[0].account !== 'string' ||
    !/^[^\s@]+@[^\s@]+$/u.test(accounts[0].account) ||
    accounts[0].account.endsWith('.gserviceaccount.com')
  ) {
    fail('gcloud_identity_invalid')
  }
}

function parseSecretValue(output) {
  if (!/^[\u0021-\u007e]{1,512}\n?$/u.test(output)) {
    fail('secret_value_invalid')
  }
  return output.endsWith('\n') ? output.slice(0, -1) : output
}

function readOwnerOnlySecret({
  path,
  inspectSecretFile,
  readSecretFile,
  createHolder,
}) {
  if (
    typeof inspectSecretFile !== 'function' ||
    typeof readSecretFile !== 'function' ||
    typeof createHolder !== 'function'
  ) {
    fail('secret_value_invalid')
  }
  let stats
  let contents
  try {
    stats = inspectSecretFile(path)
    if (!stats?.isFile() || (stats.mode & 0o077) !== 0) {
      fail('secret_value_invalid')
    }
    contents = readSecretFile(path, 'utf8')
  } catch (error) {
    if (error instanceof TestToolOperatorError) throw error
    fail('secret_value_invalid')
  }
  const holder = createHolder(parseSecretValue(contents))
  if (!isCredentialHolder(holder)) fail('secret_value_invalid')
  return holder
}

export async function resolveGcloudSecret({
  version,
  environment = {},
  gcloudPath,
  executeFile,
  createHolder = createSecretHolder,
}) {
  if (!/^[1-9][0-9]*$/u.test(version ?? '')) fail('secret_version_invalid')
  rejectUnsafeInheritedEnvironment(environment)
  if (typeof gcloudPath !== 'string' || !isAbsolute(gcloudPath)) {
    fail('gcloud_unavailable')
  }
  if (typeof executeFile !== 'function' || typeof createHolder !== 'function') {
    fail('gcloud_unsupported')
  }

  const versionOutput = await executeGcloud(
    executeFile,
    gcloudPath,
    ['version', '--format=json'],
    'gcloud_unsupported',
    16_384,
  )
  parseGcloudVersion(versionOutput)

  const accountOutput = await executeGcloud(
    executeFile,
    gcloudPath,
    ['auth', 'list', '--filter=status:ACTIVE', '--format=json'],
    'gcloud_not_authenticated',
    16_384,
  )
  parsePersonalAccount(accountOutput)

  const projectOutput = await executeGcloud(
    executeFile,
    gcloudPath,
    ['config', 'get-value', 'project'],
    'project_mismatch',
    1_024,
  )
  if (projectOutput.trim() !== 'petcare-c7483') fail('project_mismatch')

  const secretOutput = await executeGcloud(
    executeFile,
    gcloudPath,
    [
      'secrets',
      'versions',
      'access',
      version,
      '--secret',
      'peecare-emqx-webhook-current',
      '--project',
      'petcare-c7483',
    ],
    'secret_access_denied',
    1_024,
  )
  const holder = createHolder(parseSecretValue(secretOutput))
  if (!isCredentialHolder(holder)) fail('secret_value_invalid')
  return holder
}
