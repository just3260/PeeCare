import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(MODULE_DIRECTORY, '../..')
const DEFAULT_BUILD_DIRECTORY = resolve(REPOSITORY_ROOT, 'dist')

const APPROVED_TARGET = Object.freeze({
  projectId: 'petcare-c7483',
  hostingTarget: 'development',
  hostingSite: 'petcare-c7483',
  publicDirectory: 'dist',
})

const PUBLIC_BUILD_KEYS = Object.freeze([
  'VITE_FIREBASE_ENVIRONMENT',
  'VITE_FIREBASE_APPROVED_PROJECT_ID',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_APP_ID',
  'VITE_MEMBER_API_URL',
  'VITE_TEST_TOOL_API_URL',
])

const APPROVED_TEST_TOOL_API = Object.freeze({
  projectId: 'petcare-c7483',
  region: 'asia-east1',
  service: 'peecare-test-tool-development',
  runtimeIdentity:
    'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
  origin:
    'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app',
})
const TEST_TOOL_RELEASE_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const TEST_TOOL_RELEASE_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000
const TEST_TOOL_REVISION_PATTERN = /^peecare-test-tool-development-[a-z0-9-]+$/
const VERIFIED_TEST_TOOL_ROUTE = Object.freeze({
  path: '/test-tool',
  status: 'verified',
})
const IMMUTABLE_IMAGE_PATTERN =
  /^asia-east1-docker\.pkg\.dev\/petcare-c7483\/peecare\/test-tool-api@sha256:[0-9a-f]{64}$/
const REQUIRED_TEST_TOOL_SMOKE_CHECKS = Object.freeze([
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
])

const PROHIBITED_BUILD_CONTENT = Object.freeze([
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):(?:4000|8085|9099)\b/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /["']?(?:private[_-]?key(?:[_-]?id)?|client[_-]?email)["']?\s*[:=]/i,
  /EMQX_WEBHOOK_SECRET/i,
  /(?:\bfrom\s*|\brequire\s*\(\s*)["']mqtt(?:\/[^"']*)?["']/i,
  /\bmqtt\s*\.\s*connect\s*\(/i,
  /wss?:\/\/[^\s"']*(?:broker|\/mqtt)(?:[^\s"']*)/i,
  /\bmqtt[_-]?(?:username|user|password|pass|credential)\b\s*[:=]/i,
  /\.subscribe\s*\(\s*["'][^"']*(?:devices|mqtt|events)\//i,
])

export class WebDeploymentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WebDeploymentError'
    this.code = code
  }
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw new WebDeploymentError(
      'target_mismatch',
      `${fieldName} must exactly match the approved development Hosting target.`,
    )
  }
}

function requireNonEmpty(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WebDeploymentError(
      'invalid_build_configuration',
      `${fieldName} is required for the development web build.`,
    )
  }
}

function validateTarget(environment, firebaseConfig, firebaseRc) {
  requireExact(
    environment.PEECARE_DEVELOPMENT_PROJECT_ID,
    APPROVED_TARGET.projectId,
    'PEECARE_DEVELOPMENT_PROJECT_ID',
  )
  requireExact(
    environment.PEECARE_DEVELOPMENT_HOSTING_TARGET,
    APPROVED_TARGET.hostingTarget,
    'PEECARE_DEVELOPMENT_HOSTING_TARGET',
  )
  requireExact(
    firebaseRc?.projects?.development,
    APPROVED_TARGET.projectId,
    '.firebaserc development project',
  )
  const sites =
    firebaseRc?.targets?.[APPROVED_TARGET.projectId]?.hosting?.[
      APPROVED_TARGET.hostingTarget
    ]
  if (
    !Array.isArray(sites) ||
    sites.length !== 1 ||
    sites[0] !== APPROVED_TARGET.hostingSite
  ) {
    throw new WebDeploymentError(
      'target_mismatch',
      'The development Hosting target must map to the single approved development site.',
    )
  }
  const hostingConfig = firebaseConfig?.hosting
  const hostingKeys = hostingConfig !== null && typeof hostingConfig === 'object'
    ? Object.keys(hostingConfig).sort()
    : []
  const expectedHostingKeys = ['headers', 'public', 'rewrites', 'target']
  if (
    hostingKeys.length !== expectedHostingKeys.length ||
    !hostingKeys.every((key, index) => key === expectedHostingKeys[index]) ||
    !Array.isArray(hostingConfig.headers) ||
    !Array.isArray(hostingConfig.rewrites)
  ) {
    throw new WebDeploymentError(
      'target_mismatch',
      'firebase.json Hosting config must contain only the approved target, public, headers, and rewrites fields.',
    )
  }
  requireExact(
    hostingConfig.target,
    APPROVED_TARGET.hostingTarget,
    'firebase.json Hosting target',
  )
  requireExact(
    hostingConfig.public,
    APPROVED_TARGET.publicDirectory,
    'firebase.json Hosting public directory',
  )
}

function validateBuildEnvironment(environment) {
  requireExact(
    environment.VITE_FIREBASE_ENVIRONMENT,
    'development',
    'VITE_FIREBASE_ENVIRONMENT',
  )
  requireExact(
    environment.VITE_FIREBASE_APPROVED_PROJECT_ID,
    APPROVED_TARGET.projectId,
    'VITE_FIREBASE_APPROVED_PROJECT_ID',
  )
  requireExact(
    environment.VITE_FIREBASE_PROJECT_ID,
    APPROVED_TARGET.projectId,
    'VITE_FIREBASE_PROJECT_ID',
  )
  requireExact(
    environment.VITE_FIREBASE_AUTH_DOMAIN,
    `${APPROVED_TARGET.projectId}.firebaseapp.com`,
    'VITE_FIREBASE_AUTH_DOMAIN',
  )
  requireNonEmpty(environment.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY')
  requireNonEmpty(environment.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID')
  requireNonEmpty(environment.VITE_MEMBER_API_URL, 'VITE_MEMBER_API_URL')

  if (
    Object.keys(environment).some(
      (key) =>
        key.startsWith('VITE_') &&
        key !== 'VITE_FIREBASE_API_KEY' &&
        /(?:SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|TOKEN)/i.test(key),
    ) ||
    environment.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
    environment.FIRESTORE_EMULATOR_HOST !== undefined ||
    environment.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
    Object.keys(environment).some((key) =>
      /^VITE_FIREBASE_(?:USE_EMULATORS|AUTH_EMULATOR_|FIRESTORE_EMULATOR_)/.test(key),
    )
  ) {
    throw new WebDeploymentError(
      'forbidden_build_environment',
      'Public web builds reject secret-like Vite values, key files, and Emulator settings.',
    )
  }
}

function unverifiedTestToolRelease() {
  throw new WebDeploymentError(
    'unverified_test_tool_release',
    'The development Web build requires a current healthy immutable Test Tool API release.',
  )
}

function validateTestToolOrigin(value) {
  if (typeof value !== 'string') unverifiedTestToolRelease()
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    unverifiedTestToolRelease()
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    value !== parsed.origin ||
    parsed.origin !== APPROVED_TEST_TOOL_API.origin
  ) {
    unverifiedTestToolRelease()
  }
  return parsed.origin
}

function validateTestToolRelease(environment, releaseRecord, now) {
  const verifiedOrigin = validateTestToolOrigin(releaseRecord?.verifiedOrigin)
  const verifiedAt = Date.parse(releaseRecord?.verifiedAt)
  const current = now()
  const currentMs = current instanceof Date ? current.getTime() : Number.NaN
  const smokeEntries = releaseRecord?.smoke !== null &&
    typeof releaseRecord?.smoke === 'object'
      ? Object.entries(releaseRecord.smoke)
      : []
  if (
    releaseRecord?.status !== 'healthy' ||
    releaseRecord.projectId !== APPROVED_TEST_TOOL_API.projectId ||
    releaseRecord.projectId !== environment.PEECARE_DEVELOPMENT_PROJECT_ID ||
    releaseRecord.region !== APPROVED_TEST_TOOL_API.region ||
    releaseRecord.service !== APPROVED_TEST_TOOL_API.service ||
    !TEST_TOOL_REVISION_PATTERN.test(releaseRecord.revision ?? '') ||
    releaseRecord.runtimeIdentity !== APPROVED_TEST_TOOL_API.runtimeIdentity ||
    typeof releaseRecord.image !== 'string' ||
    !IMMUTABLE_IMAGE_PATTERN.test(releaseRecord.image) ||
    !/^sha256:[0-9a-f]{64}$/.test(releaseRecord.imageDigest ?? '') ||
    !releaseRecord.image.endsWith(`@${releaseRecord.imageDigest}`) ||
    !Number.isFinite(verifiedAt) ||
    new Date(verifiedAt).toISOString() !== releaseRecord.verifiedAt ||
    !Number.isFinite(currentMs) ||
    verifiedAt < currentMs - TEST_TOOL_RELEASE_MAX_AGE_MS ||
    verifiedAt > currentMs + TEST_TOOL_RELEASE_FUTURE_TOLERANCE_MS ||
    smokeEntries.length !== REQUIRED_TEST_TOOL_SMOKE_CHECKS.length ||
    REQUIRED_TEST_TOOL_SMOKE_CHECKS.some(
      (name) => releaseRecord.smoke[name] !== 'passed',
    ) ||
    environment.VITE_TEST_TOOL_API_URL !== verifiedOrigin
  ) {
    unverifiedTestToolRelease()
  }
  return Object.freeze({
    projectId: releaseRecord.projectId,
    region: releaseRecord.region,
    service: releaseRecord.service,
    revision: releaseRecord.revision,
    imageDigest: releaseRecord.imageDigest,
    verifiedOrigin,
  })
}

function buildEnvironment(environment) {
  const result = {
    NODE_ENV: 'production',
    PATH: environment.PATH ?? process.env.PATH,
  }
  for (const key of PUBLIC_BUILD_KEYS) result[key] = environment[key]
  return Object.freeze(result)
}

function collectBuildArtifacts(directory = DEFAULT_BUILD_DIRECTORY) {
  const artifacts = []
  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = join(currentDirectory, entry.name)
      if (entry.isDirectory()) visit(absolutePath)
      else if (entry.isFile()) {
        artifacts.push({
          path: relative(directory, absolutePath).split('\\').join('/'),
          contents: readFileSync(absolutePath),
        })
      }
    }
  }
  visit(directory)
  return artifacts
}

function captureBuildArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new WebDeploymentError(
      'empty_build',
      'The development web build produced no Hosting artifacts.',
    )
  }
  const seen = new Set()
  const normalized = artifacts.map((artifact) => {
    const artifactPath = artifact?.path
    if (
      typeof artifactPath !== 'string' ||
      artifactPath.length === 0 ||
      isAbsolute(artifactPath) ||
      artifactPath.includes('\\') ||
      artifactPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
      seen.has(artifactPath)
    ) {
      throw new WebDeploymentError(
        'invalid_build_artifact_path',
        'The development web build contains an unsafe or duplicate artifact path.',
      )
    }
    seen.add(artifactPath)
    return Object.freeze({
      path: artifactPath,
      contents: Buffer.from(
        Buffer.isBuffer(artifact.contents)
          ? artifact.contents
          : String(artifact.contents),
      ),
    })
  }).sort((left, right) => left.path.localeCompare(right.path))
  return Object.freeze(normalized)
}

function inspectArtifacts(normalized) {

  for (const artifact of normalized) {
    const filename = basename(artifact.path)
    const text = artifact.contents.toString('utf8')
    if (
      filename === '.env' ||
      filename.startsWith('.env.') ||
      /service[-_.]?account.*\.json$/i.test(filename) ||
      PROHIBITED_BUILD_CONTENT.some((pattern) => pattern.test(text))
    ) {
      throw new WebDeploymentError(
        'prohibited_build_artifact',
        `Hosting artifact ${artifact.path} contains prohibited development build material.`,
      )
    }
  }

  const bundleText = normalized
    .filter((artifact) => /(?:^|\/)assets\/.*\.(?:js|mjs|css)$/.test(artifact.path))
    .map((artifact) => artifact.contents.toString('utf8'))
    .join('\n')
  if (
    !bundleText.includes('development') ||
    !bundleText.includes(APPROVED_TARGET.projectId) ||
    !bundleText.includes(APPROVED_TEST_TOOL_API.origin)
  ) {
    throw new WebDeploymentError(
      'cloud_adapter_not_verified',
      'Hosting bundle must contain the development discriminator, approved project, and verified Test Tool API origin.',
    )
  }
  if (!bundleText.includes(VERIFIED_TEST_TOOL_ROUTE.path)) {
    throw new WebDeploymentError(
      'test_tool_route_absent',
      'Hosting bundle does not register the protected /test-tool route.',
    )
  }

  const hash = createHash('sha256')
  for (const artifact of normalized) {
    hash.update(artifact.path)
    hash.update('\0')
    hash.update(artifact.contents)
    hash.update('\0')
  }
  return Object.freeze({
    buildHash: `sha256:${hash.digest('hex')}`,
    files: Object.freeze(normalized.map((artifact) => artifact.path)),
    testToolRoute: VERIFIED_TEST_TOOL_ROUTE,
  })
}

function createStagedWebBuild({ artifacts, firebaseConfig }) {
  const stagingRoot = mkdtempSync(join(tmpdir(), 'peecare-web-deploy-'))
  const publicDirectory = join(stagingRoot, 'public')
  const configPath = join(stagingRoot, 'firebase.json')
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    rmSync(stagingRoot, { recursive: true, force: true })
    cleaned = true
  }
  try {
    mkdirSync(publicDirectory, { recursive: true, mode: 0o700 })
    for (const artifact of artifacts) {
      const destination = resolve(publicDirectory, artifact.path)
      if (!destination.startsWith(`${publicDirectory}${sep}`)) {
        throw new WebDeploymentError(
          'invalid_build_artifact_path',
          'A staged Hosting artifact escaped the verified snapshot directory.',
        )
      }
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      writeFileSync(destination, artifact.contents, { mode: 0o600 })
    }
    writeFileSync(
      configPath,
      JSON.stringify({
        hosting: {
          site: APPROVED_TARGET.hostingSite,
          public: 'public',
          headers: firebaseConfig.hosting.headers,
          rewrites: firebaseConfig.hosting.rewrites,
        },
      }),
      { mode: 0o600 },
    )
    return Object.freeze({ configPath, cleanup })
  } catch (error) {
    cleanup()
    throw error
  }
}

function cleanupStagedWebBuild(stagedBuild) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      stagedBuild.cleanup()
      return undefined
    } catch {
      // The cleanup handle remains retryable until its exact directory is gone.
    }
  }
  return 'staging_cleanup_failed'
}

function summary(status, dryRun, inspection, testToolApi, cleanupWarning) {
  return Object.freeze({
    status,
    ...(dryRun ? { dryRun: true } : {}),
    ...APPROVED_TARGET,
    buildHash: inspection.buildHash,
    files: inspection.files,
    testToolRoute: inspection.testToolRoute,
    firebaseServices: Object.freeze({
      environment: 'development',
      projectId: APPROVED_TARGET.projectId,
      emulatorEndpoints: Object.freeze([]),
    }),
    testToolApi,
    ...(cleanupWarning === undefined ? {} : { cleanupWarning }),
  })
}

export function runWebDeploy({
  environment,
  args,
  firebaseConfig,
  firebaseRc,
  testToolReleaseRecord,
  now = () => new Date(),
  stageBuildArtifacts = createStagedWebBuild,
  execute,
  readBuildArtifacts,
  write,
}) {
  const mode = args.length === 1 ? args[0] : undefined
  if (mode !== '--dry-run' && mode !== '--apply') {
    throw new WebDeploymentError(
      'explicit_mode_required',
      'Web deployment requires exactly one of --dry-run or --apply.',
    )
  }

  validateTarget(environment, firebaseConfig, firebaseRc)
  validateTestToolRelease(
    environment,
    testToolReleaseRecord,
    now,
  )
  validateBuildEnvironment(environment)
  const commandEnvironment = buildEnvironment(environment)
  const build = execute('npm', ['run', 'build'], { environment: commandEnvironment })
  if (build.status !== 0) {
    throw new WebDeploymentError('web_build_failed', 'The development web build failed.')
  }

  const artifacts = captureBuildArtifacts(readBuildArtifacts())
  const inspection = inspectArtifacts(artifacts)
  if (mode === '--dry-run') {
    const completedTestToolApi = validateTestToolRelease(
      environment,
      testToolReleaseRecord,
      now,
    )
    const plan = summary('ready', true, inspection, completedTestToolApi)
    write(JSON.stringify(plan))
    return plan
  }

  const stagedBuild = stageBuildArtifacts({ artifacts, firebaseConfig })
  let completedTestToolApi
  let primaryError
  let cleanupWarning
  try {
    completedTestToolApi = validateTestToolRelease(
      environment,
      testToolReleaseRecord,
      now,
    )
    const upload = execute(
      'firebase',
      [
        'deploy',
        '--config',
        stagedBuild.configPath,
        '--project',
        APPROVED_TARGET.projectId,
        '--only',
        'hosting',
        '--non-interactive',
      ],
      { environment: commandEnvironment },
    )
    if (upload.status !== 0) {
      throw new WebDeploymentError(
        'hosting_deploy_failed',
        'Firebase CLI failed to upload the inspected development Hosting snapshot.',
      )
    }
  } catch (error) {
    primaryError = error
  } finally {
    cleanupWarning = cleanupStagedWebBuild(stagedBuild)
  }
  if (primaryError !== undefined) throw primaryError

  const result = summary(
    'deployed',
    false,
    inspection,
    completedTestToolApi,
    cleanupWarning,
  )
  write(JSON.stringify(result))
  return result
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function executeCommand(command, args, options) {
  return spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: options.environment,
    stdio: 'inherit',
  })
}

function runCli() {
  try {
    const releaseRecordPath = process.env.PEECARE_TEST_TOOL_RELEASE_RECORD
    if (typeof releaseRecordPath !== 'string' || releaseRecordPath.trim().length === 0) {
      unverifiedTestToolRelease()
    }
    runWebDeploy({
      environment: process.env,
      args: process.argv.slice(2),
      firebaseConfig: readJson(resolve(REPOSITORY_ROOT, 'firebase.json')),
      firebaseRc: readJson(resolve(REPOSITORY_ROOT, '.firebaserc')),
      testToolReleaseRecord: readJson(resolve(releaseRecordPath)),
      execute: executeCommand,
      readBuildArtifacts: () => collectBuildArtifacts(),
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code = error instanceof WebDeploymentError ? error.code : 'web_deploy_failed'
    process.stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
