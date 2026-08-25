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
const APPROVED_CLAIM_SHARED_MQTT_USERNAME = 'approved-legacy-device'

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
  secretAccess: Object.freeze([
    Object.freeze({
      secret: 'peecare-claim-webhook-current',
      role: 'roles/secretmanager.secretAccessor',
    }),
    Object.freeze({
      secret: 'peecare-pair-code-hmac-key',
      role: 'roles/secretmanager.secretAccessor',
    }),
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
  memberClaimPaths: Object.freeze([
    '/v1/device-claim-sessions',
    '/v1/device-claim-sessions/:sessionId',
  ]),
  emqxClaimPath: '/v1/emqx/device-claims',
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
  requiredValues: Object.freeze([
    'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
    'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
  ]),
  secretBindings: Object.freeze({
    PEECARE_CLAIM_WEBHOOK_SECRET: Object.freeze({
      secret: 'peecare-claim-webhook-current',
      referenceEnvironment: 'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF',
    }),
    PEECARE_PAIR_CODE_HMAC_KEY: Object.freeze({
      secret: 'peecare-pair-code-hmac-key',
      referenceEnvironment: 'PEECARE_PAIR_CODE_HMAC_KEY_REF',
    }),
  }),
})

const APPROVED_PERSISTENCE_ACCESS = Object.freeze({
  enforcement: Object.freeze({
    iam: 'database-wide-datastore-role-with-direct-binding-audit',
    logicalScope: 'application-repository-and-release-probe',
  }),
  deviceRegistry: Object.freeze({
    reads: 'enabled-registry-fields-only',
    ownerUidMutation: 'first-set-only',
  }),
  claimCollections: Object.freeze({
    deviceClaimSessions: Object.freeze(['create', 'read', 'update']),
    activeDeviceClaims: Object.freeze(['create', 'read', 'update']),
  }),
  deniedMutations: Object.freeze([
    'owner-transfer',
    'device-delete',
    'device-child-write',
  ]),
})

const CLAIM_SECRET_REFERENCE_PATTERN =
  /^projects\/(?:petcare-c7483|348528459946)\/secrets\/peecare-claim-webhook-current\/versions\/([1-9][0-9]*)$/
const HMAC_SECRET_REFERENCE_PATTERN =
  /^projects\/(?:petcare-c7483|348528459946)\/secrets\/peecare-pair-code-hmac-key\/versions\/([1-9][0-9]*)$/

const ALLOWED_OPERATOR_KEYS = new Set([
  'PEECARE_DEVELOPMENT_PROJECT_ID',
  'PEECARE_DEVELOPMENT_FIRESTORE_REGION',
  'PEECARE_DEVELOPMENT_BUDGET_RECORD',
  'PEECARE_DEVELOPMENT_WEB_ORIGIN',
  'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF',
  'PEECARE_PAIR_CODE_HMAC_KEY_REF',
  'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
  'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
])

function isUnsupportedSensitiveEnvironmentKey(key) {
  if (/^(?:PEECARE|EMQX)_/.test(key)) return !ALLOWED_OPERATOR_KEYS.has(key)
  return (
    key === 'GOOGLE_APPLICATION_CREDENTIALS' ||
    key === 'FIRESTORE_EMULATOR_HOST' ||
    key === 'FIREBASE_AUTH_EMULATOR_HOST' ||
    false
  )
}

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
      JSON.stringify(APPROVED_RUNTIME_ENVIRONMENT) ||
    JSON.stringify(manifest.persistenceAccess) !==
      JSON.stringify(APPROVED_PERSISTENCE_ACCESS)
  ) {
    throw new MemberDeploymentError(
      'invalid_manifest',
      'Cloud Run target must exactly match the approved development Member API service.',
    )
  }
}

export function resolveMemberClaimConfiguration(environment) {
  const claimReference = environment.PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF
  const hmacReference = environment.PEECARE_PAIR_CODE_HMAC_KEY_REF
  if (
    typeof claimReference === 'string' &&
    typeof hmacReference === 'string' &&
    claimReference === hmacReference
  ) {
    throw new MemberDeploymentError(
      'claim_credentials_not_independent',
      'Claim webhook and Pair Code HMAC credentials must be independent.',
    )
  }
  const claimMatch =
    typeof claimReference === 'string'
      ? CLAIM_SECRET_REFERENCE_PATTERN.exec(claimReference)
      : null
  if (claimMatch === null) {
    throw new MemberDeploymentError(
      'invalid_claim_secret_reference',
      'Claim webhook secret must use an approved numeric version.',
    )
  }
  const hmacMatch =
    typeof hmacReference === 'string'
      ? HMAC_SECRET_REFERENCE_PATTERN.exec(hmacReference)
      : null
  if (hmacMatch === null) {
    throw new MemberDeploymentError(
      'invalid_hmac_secret_reference',
      'Pair Code HMAC key must use an approved numeric version.',
    )
  }
  const hmacKeyVersion = environment.PEECARE_PAIR_CODE_HMAC_KEY_VERSION
  if (hmacKeyVersion !== hmacMatch[1]) {
    throw new MemberDeploymentError(
      'invalid_hmac_key_version',
      'Pair Code HMAC key version must match its numeric secret binding.',
    )
  }
  const sharedUsername = environment.PEECARE_CLAIM_SHARED_MQTT_USERNAME
  if (sharedUsername !== APPROVED_CLAIM_SHARED_MQTT_USERNAME) {
    throw new MemberDeploymentError(
      'invalid_shared_publisher',
      'Claim deployment requires the bounded approved shared MQTT username.',
    )
  }
  return Object.freeze({
    claimSecretVersion: claimMatch[1],
    hmacSecretVersion: hmacMatch[1],
    hmacKeyVersion,
    sharedUsername,
  })
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
  if (Object.keys(environment).some(isUnsupportedSensitiveEnvironmentKey)) {
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
  claimConfiguration,
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
      secretAccess: Object.freeze(
        manifest.iam.secretAccess.map((binding) => Object.freeze({ ...binding })),
      ),
    }),
    runtimeEnvironment: Object.freeze({
      values: Object.freeze({ ...manifest.runtimeEnvironment.values }),
      platformProvided: Object.freeze([
        ...manifest.runtimeEnvironment.platformProvided,
      ]),
      requiredValues: Object.freeze([
        ...manifest.runtimeEnvironment.requiredValues,
      ]),
      secretBindings: Object.freeze({
        PEECARE_CLAIM_WEBHOOK_SECRET: Object.freeze({
          secret:
            manifest.runtimeEnvironment.secretBindings
              .PEECARE_CLAIM_WEBHOOK_SECRET.secret,
          version: claimConfiguration.claimSecretVersion,
        }),
        PEECARE_PAIR_CODE_HMAC_KEY: Object.freeze({
          secret:
            manifest.runtimeEnvironment.secretBindings.PEECARE_PAIR_CODE_HMAC_KEY
              .secret,
          version: claimConfiguration.hmacSecretVersion,
        }),
      }),
    }),
    persistenceAccess: Object.freeze({
      enforcement: Object.freeze({ ...manifest.persistenceAccess.enforcement }),
      deviceRegistry: Object.freeze({ ...manifest.persistenceAccess.deviceRegistry }),
      claimCollections: Object.freeze({
        deviceClaimSessions: Object.freeze([
          ...manifest.persistenceAccess.claimCollections.deviceClaimSessions,
        ]),
        activeDeviceClaims: Object.freeze([
          ...manifest.persistenceAccess.claimCollections.activeDeviceClaims,
        ]),
      }),
      deniedMutations: Object.freeze([
        ...manifest.persistenceAccess.deniedMutations,
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

function directRolesForMember(policyText, member) {
  let policy
  try {
    policy = JSON.parse(policyText)
  } catch {
    throw new MemberDeploymentError(
      'iam_binding_failed',
      'Unable to parse IAM policy during Member API preflight.',
    )
  }
  if (!Array.isArray(policy.bindings)) return []
  return policy.bindings
    .filter(
      (binding) =>
        typeof binding?.role === 'string' &&
        Array.isArray(binding.members) &&
        binding.members.includes(member),
    )
    .map((binding) => binding.role)
    .sort()
}

function projectSecretNames(listText) {
  let records
  try {
    records = JSON.parse(listText)
  } catch {
    throw new MemberDeploymentError(
      'iam_binding_failed',
      'Unable to parse Secret Manager inventory during IAM preflight.',
    )
  }
  if (!Array.isArray(records)) {
    throw new MemberDeploymentError(
      'iam_binding_failed',
      'Secret Manager inventory must be an exact JSON array.',
    )
  }
  const names = records.map((record) => {
    if (
      typeof record !== 'object' ||
      record === null ||
      Array.isArray(record) ||
      Object.keys(record).length !== 1 ||
      typeof record.name !== 'string'
    ) {
      throw new MemberDeploymentError(
        'iam_binding_failed',
        'Secret Manager inventory contains a malformed record.',
      )
    }
    const name = record.name.slice(record.name.lastIndexOf('/') + 1)
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(name)) {
      throw new MemberDeploymentError(
        'iam_binding_failed',
        'Secret Manager inventory contains an invalid secret name.',
      )
    }
    return name
  })
  if (new Set(names).size !== names.length) {
    throw new MemberDeploymentError(
      'iam_binding_failed',
      'Secret Manager inventory contains duplicate secret names.',
    )
  }
  return names.sort()
}

function inspectExistingDirectIam(manifest, execute) {
  const member = `serviceAccount:${manifest.runtimeIdentity.serviceAccount}`
  const projectPolicy = execute('gcloud', [
    'projects',
    'get-iam-policy',
    manifest.metadata.projectId,
    '--format=json',
  ])
  requireSuccessfulExecution(
    projectPolicy,
    'iam_binding_failed',
    'Unable to inspect direct project IAM bindings.',
  )
  const allowedProjectRoles = new Set(manifest.iam.projectRoles)
  if (
    directRolesForMember(projectPolicy.stdout, member).some(
      (role) => !allowedProjectRoles.has(role),
    )
  ) {
    throw new MemberDeploymentError(
      'iam_drift_detected',
      'Member API runtime identity has an unapproved direct project role.',
    )
  }
  const secretList = execute('gcloud', [
    'secrets',
    'list',
    '--project',
    manifest.metadata.projectId,
    '--format=json(name)',
  ])
  requireSuccessfulExecution(
    secretList,
    'iam_binding_failed',
    'Unable to enumerate project secrets for IAM preflight.',
  )
  for (const secret of projectSecretNames(secretList.stdout)) {
    const approvedBinding = manifest.iam.secretAccess.find(
      (binding) => binding.secret === secret,
    )
    const secretPolicy = execute('gcloud', [
      'secrets',
      'get-iam-policy',
      secret,
      '--project',
      manifest.metadata.projectId,
      '--format=json',
    ])
    requireSuccessfulExecution(
      secretPolicy,
      'iam_binding_failed',
      'Unable to inspect direct Claim secret IAM bindings.',
    )
    const directRoles = directRolesForMember(secretPolicy.stdout, member)
    if (
      directRoles.length > 0 &&
      (approvedBinding === undefined ||
        directRoles.some((role) => role !== approvedBinding.role))
    ) {
      throw new MemberDeploymentError(
        'iam_drift_detected',
        'Member API runtime identity has unapproved direct Claim secret access.',
      )
    }
  }
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
  const identityExists = (listResult.stdout ?? '').trim() === serviceAccount
  if (!identityExists) {
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
  inspectExistingDirectIam(manifest, execute)

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
  for (const binding of manifest.iam.secretAccess) {
    requireSuccessfulExecution(
      execute('gcloud', [
        'secrets',
        'add-iam-policy-binding',
        binding.secret,
        '--project',
        manifest.metadata.projectId,
        '--member',
        `serviceAccount:${serviceAccount}`,
        '--role',
        binding.role,
        '--condition=None',
        '--quiet',
      ]),
      'iam_binding_failed',
      'Unable to grant the approved Claim secret access.',
    )
  }
}

export function runMemberDeploy({ environment, args, manifest, execute, write }) {
  const { mode, image, revisionSuffix } = parseArguments(args)
  validateOperatorRuntimeEnvironment(environment)
  validateManifest(manifest)
  const budgetRecord = validateResourceGates(environment)
  const claimConfiguration = resolveMemberClaimConfiguration(environment)
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
      claimConfiguration,
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
    Object.entries({
      ...manifest.runtimeEnvironment.values,
      PEECARE_PAIR_CODE_HMAC_KEY_VERSION:
        claimConfiguration.hmacKeyVersion,
      PEECARE_CLAIM_SHARED_MQTT_USERNAME:
        claimConfiguration.sharedUsername,
    })
      .map(([name, value]) => `${name}=${value}`)
      .join(','),
    '--set-secrets',
    [
      `PEECARE_CLAIM_WEBHOOK_SECRET=${manifest.runtimeEnvironment.secretBindings.PEECARE_CLAIM_WEBHOOK_SECRET.secret}:${claimConfiguration.claimSecretVersion}`,
      `PEECARE_PAIR_CODE_HMAC_KEY=${manifest.runtimeEnvironment.secretBindings.PEECARE_PAIR_CODE_HMAC_KEY.secret}:${claimConfiguration.hmacSecretVersion}`,
    ].join(','),
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
    claimConfiguration,
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
