import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MANIFEST_PATH = resolve(MODULE_DIRECTORY, 'ingestion-service.yaml')

export class IngestionDeploymentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IngestionDeploymentError'
    this.code = code
  }
}

export function loadIngestionManifest(path = DEFAULT_MANIFEST_PATH) {
  return Object.freeze(JSON.parse(readFileSync(path, 'utf8')))
}

function parseArguments(args) {
  if (
    args.length !== 3 ||
    (args[0] !== '--dry-run' && args[0] !== '--apply') ||
    args[1] !== '--image'
  ) {
    throw new IngestionDeploymentError(
      'explicit_mode_required',
      'Deployment requires --dry-run or --apply followed by --image and an immutable digest reference.',
    )
  }
  return { mode: args[0], image: args[2] }
}

function validateImage(manifest, image) {
  if (typeof image !== 'string' || !new RegExp(manifest.image.digestPattern).test(image)) {
    throw new IngestionDeploymentError(
      'immutable_image_required',
      'Image must be an approved Artifact Registry reference pinned by sha256 digest.',
    )
  }
}

const APPROVED_TARGET = Object.freeze({
  projectId: 'petcare-c7483',
  projectNumber: '348528459946',
  region: 'asia-east1',
  service: 'peecare-ingestion-development',
})

const APPROVED_RESOURCES = Object.freeze({
  billing: 'request-based',
  cpu: '1',
  memory: '512Mi',
  timeoutSeconds: 60,
  concurrency: 20,
  minInstances: 0,
  maxInstances: 2,
})

const APPROVED_NETWORK = Object.freeze({
  ingress: 'all',
  allowUnauthenticated: true,
  publicHealthPath: '/health',
  protectedWebhookPath: '/v1/emqx/events',
  applicationAuth: 'bearer-current-or-previous',
})

const APPROVED_RUNTIME_ENVIRONMENT = Object.freeze({
  values: Object.freeze({
    NODE_ENV: 'production',
    GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
  }),
  secretNames: Object.freeze([
    'EMQX_WEBHOOK_SECRET_CURRENT',
    'EMQX_WEBHOOK_SECRET_PREVIOUS',
  ]),
  platformProvided: Object.freeze(['PORT']),
})

function validateRuntimeEnvironment(environment, manifest) {
  if (environment.FIRESTORE_EMULATOR_HOST !== undefined) {
    throw new IngestionDeploymentError(
      'emulator_environment_forbidden',
      'FIRESTORE_EMULATOR_HOST is forbidden for development Cloud Run deployment.',
    )
  }
  if (
    JSON.stringify(manifest.runtimeEnvironment) !==
    JSON.stringify(APPROVED_RUNTIME_ENVIRONMENT)
  ) {
    throw new IngestionDeploymentError(
      'invalid_runtime_environment',
      'Runtime values, secret names, and platform-provided names must exactly match the production contract.',
    )
  }
}

function validateResourceGates(environment, manifest) {
  if (
    environment.PEECARE_DEVELOPMENT_PROJECT_ID !== APPROVED_TARGET.projectId ||
    environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== APPROVED_TARGET.region
  ) {
    throw new IngestionDeploymentError(
      'target_mismatch',
      'Development inventory must match the approved Cloud Run project and region.',
    )
  }
  if (
    manifest.metadata.projectId !== APPROVED_TARGET.projectId ||
    manifest.metadata.region !== APPROVED_TARGET.region ||
    manifest.metadata.service !== APPROVED_TARGET.service ||
    JSON.stringify(manifest.resources) !== JSON.stringify(APPROVED_RESOURCES) ||
    JSON.stringify(manifest.network) !== JSON.stringify(APPROVED_NETWORK)
  ) {
    throw new IngestionDeploymentError(
      'invalid_manifest',
      'Cloud Run target and resource limits must exactly match the approved development manifest.',
    )
  }
  const budgetRecord = environment.PEECARE_DEVELOPMENT_BUDGET_RECORD
  if (
    typeof budgetRecord !== 'string' ||
    !/^billingAccounts\/[0-9A-Fa-f]{6}(?:-[0-9A-Fa-f]{6}){2}\/budgets\/[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(
      budgetRecord,
    )
  ) {
    throw new IngestionDeploymentError(
      'missing_budget_record',
      'An approved Cloud Billing budget resource name is required.',
    )
  }
  return budgetRecord
}

function validateSecretReferences(environment, projectId) {
  const pattern = new RegExp(
    `^projects/(?:${projectId}|${APPROVED_TARGET.projectNumber})/secrets/([a-zA-Z0-9_-]+)/versions/([1-9][0-9]*)$`,
  )
  const current = environment.PEECARE_INGESTION_SECRET_CURRENT_REF
  const previous = environment.PEECARE_INGESTION_SECRET_PREVIOUS_REF
  if (typeof current !== 'string' || !pattern.test(current)) {
    throw new IngestionDeploymentError(
      'invalid_secret_reference',
      'A numeric current Secret Manager version reference in the approved project is required.',
    )
  }
  if (previous !== undefined && (typeof previous !== 'string' || !pattern.test(previous))) {
    throw new IngestionDeploymentError(
      'invalid_secret_reference',
      'The previous Secret Manager reference must use a numeric version in the approved project.',
    )
  }
  if (previous === current) {
    throw new IngestionDeploymentError(
      'invalid_secret_reference',
      'Current and previous Secret Manager version references must differ.',
    )
  }
  return Object.freeze({
    EMQX_WEBHOOK_SECRET_CURRENT: current,
    ...(previous ? { EMQX_WEBHOOK_SECRET_PREVIOUS: previous } : {}),
  })
}

function parseSecretReference(reference) {
  const segments = reference.split('/')
  return Object.freeze({
    secretName: segments[3],
    gcloudReference: `${segments[3]}:${segments[5]}`,
  })
}

function deploymentSummary(manifest, image, secretRefs, budgetRecord, status, dryRun) {
  return Object.freeze({
    status,
    ...(dryRun ? { dryRun: true } : {}),
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    image,
    imageDigest: image.slice(image.lastIndexOf('@') + 1),
    runtimeIdentity: manifest.runtimeIdentity.serviceAccount,
    iam: Object.freeze({
      projectRoles: Object.freeze([...manifest.iam.projectRoles]),
      secretAccessorRole: manifest.iam.secretAccessorRole,
    }),
    secretRefs,
    resources: Object.freeze({ ...manifest.resources }),
    network: Object.freeze({ ...manifest.network }),
    runtimeEnvironment: Object.freeze({
      values: Object.freeze({ ...manifest.runtimeEnvironment.values }),
      secretNames: Object.freeze([...manifest.runtimeEnvironment.secretNames]),
      platformProvided: Object.freeze([
        ...manifest.runtimeEnvironment.platformProvided,
      ]),
    }),
    budgetRecord,
  })
}

function requireSuccessfulExecution(result, code, message) {
  if (result.status !== 0) throw new IngestionDeploymentError(code, message)
}

function configureRuntimeIdentity(manifest, secretRefs, execute) {
  const serviceAccount = manifest.runtimeIdentity.serviceAccount
  const listResult = execute('gcloud', [
    'iam',
    'service-accounts',
    'list',
    '--project',
    manifest.metadata.projectId,
    '--filter',
    `email=${serviceAccount}`,
    '--format=value(email)',
  ])
  requireSuccessfulExecution(
    listResult,
    'runtime_identity_failed',
    'Unable to inspect the dedicated ingestion runtime identity.',
  )
  if ((listResult.stdout ?? '').trim() !== serviceAccount) {
    requireSuccessfulExecution(
      execute('gcloud', [
        'iam',
        'service-accounts',
        'create',
        manifest.runtimeIdentity.accountId,
        '--project',
        manifest.metadata.projectId,
        '--display-name',
        manifest.runtimeIdentity.displayName,
        '--quiet',
      ]),
      'runtime_identity_failed',
      'Unable to create the dedicated ingestion runtime identity.',
    )
  }

  for (const role of manifest.iam.projectRoles) {
    requireSuccessfulExecution(
      execute('gcloud', [
        'projects',
        'add-iam-policy-binding',
        manifest.metadata.projectId,
        '--member',
        `serviceAccount:${serviceAccount}`,
        '--role',
        role,
        '--condition=None',
        '--quiet',
      ]),
      'iam_binding_failed',
      'Unable to grant the approved Firestore role to the ingestion runtime identity.',
    )
  }

  for (const reference of Object.values(secretRefs)) {
    const { secretName } = parseSecretReference(reference)
    requireSuccessfulExecution(
      execute('gcloud', [
        'secrets',
        'add-iam-policy-binding',
        secretName,
        '--project',
        manifest.metadata.projectId,
        '--member',
        `serviceAccount:${serviceAccount}`,
        '--role',
        manifest.iam.secretAccessorRole,
        '--condition=None',
        '--quiet',
      ]),
      'iam_binding_failed',
      'Unable to grant access to an approved ingestion secret.',
    )
  }
}

function secretMountArgument(secretRefs) {
  return Object.entries(secretRefs)
    .map(([environmentName, reference]) => {
      const { gcloudReference } = parseSecretReference(reference)
      return `${environmentName}=${gcloudReference}`
    })
    .join(',')
}

export function runIngestionDeploy({ environment, args, manifest, execute, write }) {
  const { mode, image } = parseArguments(args)
  validateRuntimeEnvironment(environment, manifest)
  const budgetRecord = validateResourceGates(environment, manifest)
  validateImage(manifest, image)
  const secretRefs = validateSecretReferences(environment, manifest.metadata.projectId)

  if (mode === '--dry-run') {
    const plan = deploymentSummary(
      manifest,
      image,
      secretRefs,
      budgetRecord,
      'ready',
      true,
    )
    write(JSON.stringify(plan))
    return plan
  }

  configureRuntimeIdentity(manifest, secretRefs, execute)
  const result = execute('gcloud', [
    'run',
    'deploy',
    manifest.metadata.service,
    '--project',
    manifest.metadata.projectId,
    '--region',
    manifest.metadata.region,
    '--image',
    image,
    '--service-account',
    manifest.runtimeIdentity.serviceAccount,
    '--set-secrets',
    secretMountArgument(secretRefs),
    '--set-env-vars',
    Object.entries(manifest.runtimeEnvironment.values)
      .map(([name, value]) => `${name}=${value}`)
      .join(','),
    '--cpu',
    manifest.resources.cpu,
    '--memory',
    manifest.resources.memory,
    '--timeout',
    `${manifest.resources.timeoutSeconds}s`,
    '--concurrency',
    String(manifest.resources.concurrency),
    '--min-instances',
    String(manifest.resources.minInstances),
    '--max-instances',
    String(manifest.resources.maxInstances),
    '--cpu-throttling',
    '--ingress',
    manifest.network.ingress,
    '--allow-unauthenticated',
    '--quiet',
  ])
  if (result.status !== 0) {
    throw new IngestionDeploymentError(
      'cloud_run_deploy_failed',
      'gcloud failed to deploy the development ingestion revision.',
    )
  }

  const summary = deploymentSummary(
    manifest,
    image,
    secretRefs,
    budgetRecord,
    'deployed',
    false,
  )
  write(JSON.stringify(summary))
  return summary
}

function executeGcloud(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' })
}

function runCli() {
  try {
    runIngestionDeploy({
      environment: process.env,
      args: process.argv.slice(2),
      manifest: loadIngestionManifest(),
      execute: executeGcloud,
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof IngestionDeploymentError
        ? error.code
        : 'ingestion_deployment_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
