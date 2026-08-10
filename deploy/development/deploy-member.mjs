import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MANIFEST_PATH = resolve(MODULE_DIRECTORY, 'member-service.yaml')

const APPROVED_TARGET = Object.freeze({
  projectId: 'petcare-c7483',
  region: 'asia-east1',
  service: 'peecare-member-development',
})

const APPROVED_RUNTIME_IDENTITY = Object.freeze({
  serviceAccount: 'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com',
  accountId: 'peecare-member-runtime',
  displayName: 'PeeCare development Member API runtime',
})

const APPROVED_IAM = Object.freeze({
  projectRoles: Object.freeze([
    'roles/datastore.user',
    'roles/firebaseauth.viewer',
  ]),
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
  protectedMutationPath: '/v1/devices/:deviceId/display-name',
  applicationAuth: 'firebase-id-token-revoked-aware-owner',
  allowedOrigin: 'https://petcare-c7483.web.app',
})

const APPROVED_RUNTIME_ENVIRONMENT = Object.freeze({
  values: Object.freeze({
    NODE_ENV: 'production',
    GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
    PEECARE_WEB_ORIGIN: 'https://petcare-c7483.web.app',
  }),
  platformProvided: Object.freeze(['PORT']),
})

export class MemberDeploymentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MemberDeploymentError'
    this.code = code
  }
}

export function loadMemberManifest(path = DEFAULT_MANIFEST_PATH) {
  return Object.freeze(JSON.parse(readFileSync(path, 'utf8')))
}

function parseArguments(args) {
  if (
    args.length !== 5 ||
    (args[0] !== '--dry-run' && args[0] !== '--apply') ||
    args[1] !== '--image' ||
    args[3] !== '--revision-suffix'
  ) {
    throw new MemberDeploymentError(
      'explicit_mode_required',
      'Deployment requires --dry-run or --apply, an immutable --image, and an explicit --revision-suffix.',
    )
  }
  return { mode: args[0], image: args[2], revisionSuffix: args[4] }
}

function validateManifest(manifest) {
  if (
    manifest.apiVersion !== 'peecare.dev/v1' ||
    manifest.kind !== 'CloudRunService' ||
    manifest.metadata.projectId !== APPROVED_TARGET.projectId ||
    manifest.metadata.region !== APPROVED_TARGET.region ||
    manifest.metadata.service !== APPROVED_TARGET.service ||
    JSON.stringify(manifest.runtimeIdentity) !==
      JSON.stringify(APPROVED_RUNTIME_IDENTITY) ||
    JSON.stringify(manifest.iam) !== JSON.stringify(APPROVED_IAM) ||
    JSON.stringify(manifest.resources) !== JSON.stringify(APPROVED_RESOURCES) ||
    JSON.stringify(manifest.network) !== JSON.stringify(APPROVED_NETWORK) ||
    JSON.stringify(manifest.runtimeEnvironment) !==
      JSON.stringify(APPROVED_RUNTIME_ENVIRONMENT)
  ) {
    throw new MemberDeploymentError(
      'invalid_manifest',
      'Cloud Run target must exactly match the approved development Member API service.',
    )
  }
}

function validateResourceGates(environment) {
  if (
    environment.PEECARE_DEVELOPMENT_PROJECT_ID !== APPROVED_TARGET.projectId ||
    environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== APPROVED_TARGET.region
  ) {
    throw new MemberDeploymentError(
      'target_mismatch',
      'Development inventory must match the approved Cloud Run project and region.',
    )
  }
  const budgetRecord = environment.PEECARE_DEVELOPMENT_BUDGET_RECORD
  if (
    typeof budgetRecord !== 'string' ||
    !/^billingAccounts\/[0-9A-Fa-f]{6}(?:-[0-9A-Fa-f]{6}){2}\/budgets\/[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(
      budgetRecord,
    )
  ) {
    throw new MemberDeploymentError(
      'missing_budget_record',
      'An approved Cloud Billing budget resource name is required.',
    )
  }
  return budgetRecord
}

function validateOperatorRuntimeEnvironment(environment) {
  if (
    environment.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
    environment.FIRESTORE_EMULATOR_HOST !== undefined ||
    environment.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
    Object.keys(environment).some((key) => key.startsWith('EMQX_WEBHOOK_SECRET'))
  ) {
    throw new MemberDeploymentError(
      'forbidden_runtime_configuration',
      'Member API deployment uses ADC and rejects key files, Emulator hosts, and Ingestion secrets.',
    )
  }
}

function validateImage(manifest, image) {
  if (typeof image !== 'string' || !new RegExp(manifest.image.digestPattern).test(image)) {
    throw new MemberDeploymentError(
      'immutable_image_required',
      'Image must be an approved Artifact Registry reference pinned by sha256 digest.',
    )
  }
}

function validateRevisionSuffix(service, revisionSuffix) {
  if (
    typeof revisionSuffix !== 'string' ||
    !/^[0-9]{5}-[a-z0-9]{3}$/.test(revisionSuffix) ||
    `${service}-${revisionSuffix}`.length > 63
  ) {
    throw new MemberDeploymentError(
      'invalid_revision_suffix',
      'Revision suffix must use the approved 00000-abc format and fit the Cloud Run revision limit.',
    )
  }
}

function deploymentSummary(
  manifest,
  image,
  revisionSuffix,
  budgetRecord,
  status,
  dryRun,
) {
  return Object.freeze({
    status,
    ...(dryRun ? { dryRun: true } : {}),
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision: `${manifest.metadata.service}-${revisionSuffix}`,
    image,
    imageDigest: image.slice(image.lastIndexOf('@') + 1),
    runtimeIdentity: manifest.runtimeIdentity.serviceAccount,
    iam: Object.freeze({
      projectRoles: Object.freeze([...manifest.iam.projectRoles]),
    }),
    runtimeEnvironment: Object.freeze({
      values: Object.freeze({ ...manifest.runtimeEnvironment.values }),
      platformProvided: Object.freeze([
        ...manifest.runtimeEnvironment.platformProvided,
      ]),
    }),
    resources: Object.freeze({ ...manifest.resources }),
    network: Object.freeze({ ...manifest.network }),
    budgetRecord,
  })
}

function requireSuccessfulExecution(result, code, message) {
  if (result.status !== 0) throw new MemberDeploymentError(code, message)
}

function configureRuntimeIdentity(manifest, execute) {
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
    'Unable to inspect the dedicated Member API runtime identity.',
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
      'Unable to create the dedicated Member API runtime identity.',
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
      'Unable to grant the approved Firestore role to the Member API runtime identity.',
    )
  }
}

export function runMemberDeploy({ environment, args, manifest, execute, write }) {
  const { mode, image, revisionSuffix } = parseArguments(args)
  validateOperatorRuntimeEnvironment(environment)
  validateManifest(manifest)
  const budgetRecord = validateResourceGates(environment)
  validateImage(manifest, image)
  validateRevisionSuffix(manifest.metadata.service, revisionSuffix)

  if (mode === '--dry-run') {
    const plan = deploymentSummary(
      manifest,
      image,
      revisionSuffix,
      budgetRecord,
      'ready',
      true,
    )
    write(JSON.stringify(plan))
    return plan
  }

  configureRuntimeIdentity(manifest, execute)
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
    '--revision-suffix',
    revisionSuffix,
    '--service-account',
    manifest.runtimeIdentity.serviceAccount,
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
    throw new MemberDeploymentError(
      'cloud_run_deploy_failed',
      'gcloud failed to deploy the development Member API revision.',
    )
  }

  const summary = deploymentSummary(
    manifest,
    image,
    revisionSuffix,
    budgetRecord,
    'deployed',
    false,
  )
  write(JSON.stringify(summary))
  return summary
}

function runCli() {
  try {
    runMemberDeploy({
      environment: process.env,
      args: process.argv.slice(2),
      manifest: loadMemberManifest(),
      execute: (command, args) => spawnSync(command, args, { encoding: 'utf8' }),
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof MemberDeploymentError
        ? error.code
        : 'member_deployment_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
