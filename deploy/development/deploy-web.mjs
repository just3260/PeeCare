import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
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
  requireExact(
    firebaseConfig?.hosting?.target,
    APPROVED_TARGET.hostingTarget,
    'firebase.json Hosting target',
  )
  requireExact(
    firebaseConfig?.hosting?.public,
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

function inspectArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new WebDeploymentError(
      'empty_build',
      'The development web build produced no Hosting artifacts.',
    )
  }

  const normalized = artifacts
    .map((artifact) => ({
      path: artifact.path,
      contents: Buffer.isBuffer(artifact.contents)
        ? artifact.contents
        : Buffer.from(String(artifact.contents)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

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
    !bundleText.includes(APPROVED_TARGET.projectId)
  ) {
    throw new WebDeploymentError(
      'cloud_adapter_not_verified',
      'Hosting bundle must contain the development discriminator and approved Firebase project.',
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
  })
}

function summary(status, dryRun, inspection) {
  return Object.freeze({
    status,
    ...(dryRun ? { dryRun: true } : {}),
    ...APPROVED_TARGET,
    buildHash: inspection.buildHash,
    files: inspection.files,
    firebaseServices: Object.freeze({
      environment: 'development',
      projectId: APPROVED_TARGET.projectId,
      emulatorEndpoints: Object.freeze([]),
    }),
  })
}

export function runWebDeploy({
  environment,
  args,
  firebaseConfig,
  firebaseRc,
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
  validateBuildEnvironment(environment)
  const commandEnvironment = buildEnvironment(environment)
  const build = execute('npm', ['run', 'build'], { environment: commandEnvironment })
  if (build.status !== 0) {
    throw new WebDeploymentError('web_build_failed', 'The development web build failed.')
  }

  const inspection = inspectArtifacts(readBuildArtifacts())
  if (mode === '--dry-run') {
    const plan = summary('ready', true, inspection)
    write(JSON.stringify(plan))
    return plan
  }

  const upload = execute(
    'firebase',
    [
      'deploy',
      '--project',
      APPROVED_TARGET.projectId,
      '--only',
      `hosting:${APPROVED_TARGET.hostingTarget}`,
      '--non-interactive',
    ],
    { environment: commandEnvironment },
  )
  if (upload.status !== 0) {
    throw new WebDeploymentError(
      'hosting_deploy_failed',
      'Firebase CLI failed to upload the inspected development Hosting build.',
    )
  }

  const result = summary('deployed', false, inspection)
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
    runWebDeploy({
      environment: process.env,
      args: process.argv.slice(2),
      firebaseConfig: readJson(resolve(REPOSITORY_ROOT, 'firebase.json')),
      firebaseRc: readJson(resolve(REPOSITORY_ROOT, '.firebaserc')),
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
