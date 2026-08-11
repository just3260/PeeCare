import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MANIFEST_PATH = resolve(MODULE_DIRECTORY, 'test-tool-service.json')
const BUDGET_PATTERN =
  /^billingAccounts\/[0-9A-Fa-f]{6}(?:-[0-9A-Fa-f]{6}){2}\/budgets\/[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/
const REVISION_SUFFIX_PATTERN = /^[0-9]{5}-[a-z0-9]{3}$/
const REVISION_PATTERN = /^peecare-test-tool-development-[0-9]{5}-[a-z0-9]{3}$/
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

const EXACT_MANIFEST = Object.freeze({
  apiVersion: 'peecare.dev/v1',
  kind: 'CloudRunService',
  metadata: Object.freeze({
    projectId: 'petcare-c7483',
    projectNumber: '348528459946',
    region: 'asia-east1',
    service: 'peecare-test-tool-development',
  }),
  image: Object.freeze({
    digestPattern:
      '^asia-east1-docker\\.pkg\\.dev/petcare-c7483/peecare/test-tool-api@sha256:[0-9a-f]{64}$',
  }),
  runtimeIdentity: Object.freeze({
    serviceAccount:
      'peecare-test-tool-runtime@petcare-c7483.iam.gserviceaccount.com',
    accountId: 'peecare-test-tool-runtime',
    displayName: 'PeeCare development Test Tool API runtime',
  }),
  iam: Object.freeze({
    projectRoles: Object.freeze([
      'roles/datastore.user',
      'roles/firebaseauth.viewer',
    ]),
    secretAccessorRole: 'roles/secretmanager.secretAccessor',
    secretAccessorConditionTitlePrefix: 'peecare-test-tool-secret-version-',
  }),
  secretMount: Object.freeze({
    secretName: 'peecare-emqx-webhook-current',
    runtimePath: '/var/run/secrets/peecare/ingestion-secret',
    defaultMode: 256,
  }),
  resources: Object.freeze({
    billing: 'request-based', executionEnvironment: 'gen1',
    cpu: '1', memory: '512Mi', timeoutSeconds: 60,
    concurrency: 20, minInstances: 0, maxInstances: 2,
  }),
  network: Object.freeze({
    ingress: 'all', allowUnauthenticated: true, publicHealthPath: '/health',
    deviceListPath: '/v1/test-devices',
    eventPath: '/v1/test-devices/:deviceId/events',
    applicationAuth: 'firebase-id-token-revoked-aware-owner-marker',
    allowedOrigin: 'https://petcare-c7483.web.app',
  }),
  runtimeEnvironment: Object.freeze({
    values: Object.freeze({
      NODE_ENV: 'production', GOOGLE_CLOUD_PROJECT: 'petcare-c7483',
      PEECARE_WEB_ORIGIN: 'https://petcare-c7483.web.app',
      PEECARE_INGESTION_ORIGIN:
        'https://peecare-ingestion-development-348528459946.asia-east1.run.app',
      PEECARE_INGESTION_SECRET_FILE: '/var/run/secrets/peecare/ingestion-secret',
      PEECARE_TEST_TOOL_ENABLED: 'true',
    }),
    platformProvided: Object.freeze(['PORT']),
  }),
})

export class TestToolDeploymentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TestToolDeploymentError'
    this.code = code
  }
}

export function loadTestToolManifest(path = DEFAULT_MANIFEST_PATH) {
  return Object.freeze(JSON.parse(readFileSync(path, 'utf8')))
}

function fail(code, message) {
  throw new TestToolDeploymentError(code, message)
}

function validateManifest(manifest) {
  if (JSON.stringify(manifest) !== JSON.stringify(EXACT_MANIFEST)) {
    fail('invalid_manifest', 'The Test Tool API manifest is not the approved exact contract.')
  }
}

function parseDeployArguments(args) {
  if (
    args.length !== 5 ||
    !['--dry-run', '--apply'].includes(args[0]) ||
    args[1] !== '--image' ||
    args[3] !== '--revision-suffix'
  ) fail('explicit_mode_required', 'An explicit mode, immutable image, and revision are required.')
  return { mode: args[0], image: args[2], revisionSuffix: args[4] }
}

function validateOperatorEnvironment(environment) {
  const allowedReference = 'PEECARE_TEST_TOOL_INGESTION_SECRET_REF'
  if (
    environment.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
    environment.FIRESTORE_EMULATOR_HOST !== undefined ||
    environment.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
    Object.keys(environment).some((key) =>
      key !== allowedReference &&
      /(?:SECRET|TOKEN|PASSWORD|PASSPHRASE|PRIVATE[_-]?KEY|CREDENTIAL)/i.test(key),
    )
  ) fail('forbidden_runtime_configuration', 'Deployment rejects keys, Emulators, and resolved secrets.')
}

function validateGates(environment, manifest) {
  if (
    environment.PEECARE_DEVELOPMENT_PROJECT_ID !== manifest.metadata.projectId ||
    environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== manifest.metadata.region
  ) fail('target_mismatch', 'The development project and region must match exactly.')
  if (!BUDGET_PATTERN.test(environment.PEECARE_DEVELOPMENT_BUDGET_RECORD ?? '')) {
    fail('missing_budget_record', 'An approved budget resource is required.')
  }
}

function validateImage(image, manifest) {
  if (typeof image !== 'string' || !new RegExp(manifest.image.digestPattern).test(image)) {
    fail('immutable_image_required', 'The image must use the approved digest-only repository.')
  }
}

function validateRevisionSuffix(suffix, service) {
  if (!REVISION_SUFFIX_PATTERN.test(suffix ?? '') || `${service}-${suffix}`.length > 63) {
    fail('invalid_revision_suffix', 'The revision suffix is invalid.')
  }
}

function validateSecretReference(reference, manifest) {
  const pattern = new RegExp(
    `^projects/(?:${manifest.metadata.projectId}|${manifest.metadata.projectNumber})/secrets/${manifest.secretMount.secretName}/versions/([1-9][0-9]*)$`,
  )
  const match = typeof reference === 'string' ? reference.match(pattern) : null
  if (!match) fail('invalid_secret_reference', 'One approved numeric ingestion secret version is required.')
  return Object.freeze({
    reference:
      `projects/${manifest.metadata.projectId}/secrets/${manifest.secretMount.secretName}/versions/${match[1]}`,
    version: match[1],
  })
}

function normalizeSecretResourceName(name, manifest) {
  if (typeof name !== 'string') return null
  const prefix = `projects/${manifest.metadata.projectNumber}/`
  return name.startsWith(prefix)
    ? `projects/${manifest.metadata.projectId}/${name.slice(prefix.length)}`
    : name
}

function summary(manifest, image, revisionSuffix, secretRef, budgetRecord, status, dryRun) {
  return Object.freeze({
    status, ...(dryRun ? { dryRun: true } : {}),
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision: `${manifest.metadata.service}-${revisionSuffix}`,
    image,
    imageDigest: image.slice(image.lastIndexOf('@') + 1),
    runtimeIdentity: manifest.runtimeIdentity.serviceAccount,
    iam: Object.freeze({
      projectRoles: Object.freeze([...manifest.iam.projectRoles]),
      secretAccessorRole: manifest.iam.secretAccessorRole,
    }),
    secretRef: secretRef.reference,
    secretMountPath: manifest.secretMount.runtimePath,
    resources: Object.freeze({ ...manifest.resources }),
    network: Object.freeze({ ...manifest.network }),
    runtimeEnvironment: Object.freeze({
      values: Object.freeze({ ...manifest.runtimeEnvironment.values }),
      platformProvided: Object.freeze([...manifest.runtimeEnvironment.platformProvided]),
    }),
    budgetRecord,
  })
}

function requireSuccess(result, code) {
  if (result?.status !== 0) fail(code, 'The approved cloud operation failed.')
}

function parseJsonResult(result, code) {
  requireSuccess(result, code)
  try {
    return JSON.parse(result.stdout)
  } catch {
    fail(code, 'The approved cloud inspection returned invalid data.')
  }
}

function isEnabledRuntimeIdentity(identity, expectedEmail) {
  return identity?.email === expectedEmail &&
    (identity.disabled === undefined || identity.disabled === false)
}

function parseBudgetReference(reference) {
  const match = reference.match(
    /^billingAccounts\/([^/]+)\/budgets\/([^/]+)$/,
  )
  if (!match) fail('missing_budget_record', 'An approved budget resource is required.')
  return { billingAccount: match[1], budgetId: match[2] }
}

function secretAccessCondition(manifest, version) {
  return Object.freeze({
    title: `${manifest.iam.secretAccessorConditionTitlePrefix}${version}`,
    expression:
      `resource.name == "projects/${manifest.metadata.projectNumber}/secrets/${manifest.secretMount.secretName}/versions/${version}"`,
  })
}

function bindingsForMember(policy, member) {
  if (!Array.isArray(policy?.bindings)) return []
  return policy.bindings.filter(
    (binding) => Array.isArray(binding?.members) && binding.members.includes(member),
  )
}

function exactCondition(actual, expected) {
  return actual?.title === expected.title &&
    actual?.expression === expected.expression
}

function assertExistingIamIsBounded(
  manifest, member, projectPolicy, secretPolicy, secretRef, requireGrants = false,
) {
  const projectBindings = bindingsForMember(projectPolicy, member)
  if (projectBindings.some((binding) =>
    !manifest.iam.projectRoles.includes(binding.role) || binding.condition !== undefined,
  )) fail('runtime_identity_overprivileged', 'The runtime identity has unapproved project access.')
  const expectedCondition = secretAccessCondition(manifest, secretRef.version)
  const secretBindings = bindingsForMember(secretPolicy, member)
  if (secretBindings.some((binding) =>
    binding.role !== manifest.iam.secretAccessorRole ||
    !exactCondition(binding.condition, expectedCondition),
  )) fail('runtime_identity_overprivileged', 'The runtime identity has unapproved secret access.')
  if (
    requireGrants &&
    (
      manifest.iam.projectRoles.some((role) =>
        projectBindings.filter((binding) => binding.role === role).length !== 1,
      ) ||
      secretBindings.length !== 1
    )
  ) fail('runtime_identity_overprivileged', 'The runtime identity is missing an exact approved grant.')
  return expectedCondition
}

function inspectCloudResources(manifest, image, secretRef, budgetRecord, execute) {
  const email = manifest.runtimeIdentity.serviceAccount
  const listed = execute('gcloud', [
    'iam', 'service-accounts', 'list', '--project', manifest.metadata.projectId,
    '--filter', `email=${email}`, '--format=value(email)',
  ])
  requireSuccess(listed, 'runtime_identity_failed')
  const identity = (listed.stdout ?? '').trim()
  if (identity !== '' && identity !== email) {
    fail('runtime_identity_failed', 'The dedicated runtime identity inspection was ambiguous.')
  }
  const member = `serviceAccount:${email}`
  let identityExists = false
  if (identity === email) {
    const describedIdentity = parseJsonResult(execute('gcloud', [
      'iam', 'service-accounts', 'describe', email,
      '--project', manifest.metadata.projectId, '--format=json',
    ]), 'runtime_identity_failed')
    if (!isEnabledRuntimeIdentity(describedIdentity, email)) {
      fail('runtime_identity_failed', 'The dedicated runtime identity is disabled or changed.')
    }
    const userManagedKeys = parseJsonResult(execute('gcloud', [
      'iam', 'service-accounts', 'keys', 'list',
      '--iam-account', email, '--project', manifest.metadata.projectId,
      '--managed-by=user', '--format=json',
    ]), 'runtime_identity_failed')
    if (!Array.isArray(userManagedKeys) || userManagedKeys.length !== 0) {
      fail('runtime_identity_failed', 'The dedicated runtime identity has a user-managed key.')
    }
    identityExists = true
  }
  const inspectedImage = parseJsonResult(execute('gcloud', [
    'artifacts', 'docker', 'images', 'describe', image,
    '--project', manifest.metadata.projectId, '--format=json',
  ]), 'image_preflight_failed')
  if (
    inspectedImage?.image_summary?.fully_qualified_digest !== image ||
    inspectedImage?.image_summary?.digest !== image.slice(image.lastIndexOf('@') + 1)
  ) fail('image_preflight_failed', 'The immutable image inspection did not match.')

  const inspectedSecret = parseJsonResult(execute('gcloud', [
    'secrets', 'versions', 'describe', secretRef.version,
    '--secret', manifest.secretMount.secretName,
    '--project', manifest.metadata.projectId, '--format=json',
  ]), 'secret_preflight_failed')
  if (
    normalizeSecretResourceName(inspectedSecret?.name, manifest) !== secretRef.reference ||
    inspectedSecret?.state !== 'ENABLED'
  ) fail('secret_preflight_failed', 'The numeric secret version is unavailable.')

  const budget = parseBudgetReference(budgetRecord)
  const inspectedBudget = parseJsonResult(execute('gcloud', [
    'billing', 'budgets', 'describe', budget.budgetId,
    '--billing-account', budget.billingAccount, '--format=json',
  ]), 'budget_preflight_failed')
  if (inspectedBudget?.name !== budgetRecord) {
    fail('budget_preflight_failed', 'The approved budget could not be confirmed.')
  }
  const [projectPolicy, secretPolicy] = [
    parseJsonResult(execute('gcloud', [
      'projects', 'get-iam-policy', manifest.metadata.projectId, '--format=json',
    ]), 'runtime_identity_failed'),
    parseJsonResult(execute('gcloud', [
      'secrets', 'get-iam-policy', manifest.secretMount.secretName,
      '--project', manifest.metadata.projectId, '--format=json',
    ]), 'runtime_identity_failed'),
  ]
  const condition = assertExistingIamIsBounded(
    manifest, member, projectPolicy, secretPolicy, secretRef,
  )
  return Object.freeze({ identityExists, condition })
}

function configureIdentity(manifest, identityExists, secretRef, condition, execute) {
  const email = manifest.runtimeIdentity.serviceAccount
  if (!identityExists) {
    requireSuccess(execute('gcloud', [
      'iam', 'service-accounts', 'create', manifest.runtimeIdentity.accountId,
      '--project', manifest.metadata.projectId,
      '--display-name', manifest.runtimeIdentity.displayName, '--quiet',
    ]), 'runtime_identity_failed')
  }
  for (const role of manifest.iam.projectRoles) {
    requireSuccess(execute('gcloud', [
      'projects', 'add-iam-policy-binding', manifest.metadata.projectId,
      '--member', `serviceAccount:${email}`, '--role', role,
      '--condition=None', '--quiet',
    ]), 'iam_binding_failed')
  }
  requireSuccess(execute('gcloud', [
    'secrets', 'add-iam-policy-binding', manifest.secretMount.secretName,
    '--project', manifest.metadata.projectId,
    '--member', `serviceAccount:${email}`,
    '--role', manifest.iam.secretAccessorRole,
    '--condition', `expression=${condition.expression},title=${condition.title}`,
    '--quiet',
  ]), 'iam_binding_failed')
}

export function createCloudRunServiceSpec(manifest, image, revisionSuffix, secretRef) {
  const revision = `${manifest.metadata.service}-${revisionSuffix}`
  const mountDirectory = dirname(manifest.secretMount.runtimePath)
  return Object.freeze({
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: Object.freeze({
      name: manifest.metadata.service,
      namespace: manifest.metadata.projectNumber,
      annotations: Object.freeze({
        'run.googleapis.com/ingress': manifest.network.ingress,
        'run.googleapis.com/invoker-iam-disabled': 'true',
      }),
    }),
    spec: Object.freeze({
      template: Object.freeze({
        metadata: Object.freeze({
          name: revision,
          annotations: Object.freeze({
            'run.googleapis.com/execution-environment': manifest.resources.executionEnvironment,
            'autoscaling.knative.dev/minScale': String(manifest.resources.minInstances),
            'autoscaling.knative.dev/maxScale': String(manifest.resources.maxInstances),
            'run.googleapis.com/cpu-throttling': 'true',
          }),
        }),
        spec: Object.freeze({
          containerConcurrency: manifest.resources.concurrency,
          timeoutSeconds: manifest.resources.timeoutSeconds,
          serviceAccountName: manifest.runtimeIdentity.serviceAccount,
          containers: Object.freeze([Object.freeze({
            image,
            env: Object.freeze(Object.entries(manifest.runtimeEnvironment.values)
              .map(([name, value]) => Object.freeze({ name, value }))),
            resources: Object.freeze({ limits: Object.freeze({
              cpu: manifest.resources.cpu,
              memory: manifest.resources.memory,
            }) }),
            volumeMounts: Object.freeze([Object.freeze({
              name: 'ingestion-secret',
              mountPath: mountDirectory,
            })]),
          })]),
          volumes: Object.freeze([Object.freeze({
            name: 'ingestion-secret',
            secret: Object.freeze({
              secretName: manifest.secretMount.secretName,
              items: Object.freeze([Object.freeze({
                key: secretRef.version,
                path: basename(manifest.secretMount.runtimePath),
                mode: manifest.secretMount.defaultMode,
              })]),
            }),
          })]),
        }),
      }),
      traffic: Object.freeze([Object.freeze({ latestRevision: true, percent: 100 })]),
    }),
  })
}

function stageServiceSpec(spec) {
  const directory = mkdtempSync(resolve(tmpdir(), 'peecare-test-tool-service-'))
  const path = resolve(directory, 'service.json')
  writeFileSync(path, JSON.stringify(spec), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  let cleaned = false
  return Object.freeze({
    path,
    cleanup() {
      if (cleaned) return
      rmSync(directory, { recursive: true })
      cleaned = true
    },
  })
}

function cleanupStagedService(handle) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle.cleanup()
      return true
    } catch {
      // A bounded retry handles transient filesystem cleanup failures without
      // disguising the already-known cloud operation outcome.
    }
  }
  return false
}

export function runTestToolDeploy({
  environment, args, manifest, execute, write, stage = stageServiceSpec,
}) {
  const parsed = parseDeployArguments(args)
  validateOperatorEnvironment(environment)
  validateManifest(manifest)
  validateGates(environment, manifest)
  validateImage(parsed.image, manifest)
  validateRevisionSuffix(parsed.revisionSuffix, manifest.metadata.service)
  const secretRef = validateSecretReference(
    environment.PEECARE_TEST_TOOL_INGESTION_SECRET_REF,
    manifest,
  )
  const plan = summary(
    manifest, parsed.image, parsed.revisionSuffix, secretRef,
    environment.PEECARE_DEVELOPMENT_BUDGET_RECORD,
    parsed.mode === '--dry-run' ? 'ready' : 'deployed',
    parsed.mode === '--dry-run',
  )
  if (parsed.mode === '--dry-run') {
    write(JSON.stringify(plan))
    return plan
  }

  const preflight = inspectCloudResources(
    manifest, parsed.image, secretRef,
    environment.PEECARE_DEVELOPMENT_BUDGET_RECORD, execute,
  )
  const staged = stage(createCloudRunServiceSpec(
    manifest, parsed.image, parsed.revisionSuffix, secretRef,
  ))
  let deploymentError
  try {
    configureIdentity(
      manifest, preflight.identityExists, secretRef, preflight.condition, execute,
    )
    requireSuccess(execute('gcloud', [
      'run', 'services', 'replace', staged.path,
      '--project', manifest.metadata.projectId, '--region', manifest.metadata.region,
      '--quiet',
    ]), 'cloud_run_deploy_failed')
  } catch (error) {
    deploymentError = error
  }
  const cleaned = cleanupStagedService(staged)
  if (deploymentError) throw deploymentError
  const completed = cleaned
    ? plan
    : Object.freeze({ ...plan, warning: 'staging_cleanup_failed' })
  write(JSON.stringify(completed))
  return completed
}

function exactPriorRelease(record, manifest) {
  const target = record?.priorHealthyRevision
  return record?.status === 'healthy' &&
    record.projectId === manifest.metadata.projectId &&
    record.region === manifest.metadata.region &&
    record.service === manifest.metadata.service &&
    REVISION_PATTERN.test(record.revision ?? '') &&
    DIGEST_PATTERN.test(record.imageDigest ?? '') &&
    typeof record.secretRef === 'string' &&
    target &&
    Object.keys(target).sort().join(',') === 'imageDigest,revision,secretRef' &&
    REVISION_PATTERN.test(target.revision ?? '') &&
    target.revision !== record.revision &&
    DIGEST_PATTERN.test(target.imageDigest ?? '') &&
    typeof target.secretRef === 'string'
      ? target
      : null
}

export async function runTestToolRollback({
  args, manifest, releaseRecord, inspectRevision, inspectSecretAccess,
  inspectRuntimeAccess,
  executeTrafficMutation, write,
}) {
  validateManifest(manifest)
  const target = args.length === 1 && args[0] === '--rollback-dry-run'
    ? exactPriorRelease(releaseRecord, manifest)
    : null
  if (!target) fail('rollback_unavailable', 'Rollback requires one exact prior healthy revision.')
  const expectedSecret = validateSecretReference(target.secretRef, manifest)
  let inspected
  try {
    inspected = await inspectRevision({
      projectId: manifest.metadata.projectId,
      region: manifest.metadata.region,
      revision: target.revision,
    })
  } catch {
    fail('rollback_unavailable', 'The rollback revision could not be inspected.')
  }
  if (
    inspected?.revision !== target.revision ||
    inspected?.image !==
      `asia-east1-docker.pkg.dev/${manifest.metadata.projectId}/peecare/test-tool-api@${target.imageDigest}` ||
    inspected?.runtimeIdentity !== manifest.runtimeIdentity.serviceAccount ||
    inspected?.secretRef !== expectedSecret.reference ||
    inspected?.secretMountContract !== true ||
    inspected?.ready !== true
  ) fail('rollback_unavailable', 'The inspected rollback target is ambiguous or changed.')
  if (typeof inspectSecretAccess !== 'function') {
    fail('rollback_unavailable', 'Rollback secret inspection is unavailable.')
  }
  let access
  try {
    access = await inspectSecretAccess({
      projectId: manifest.metadata.projectId,
      secretName: manifest.secretMount.secretName,
      version: expectedSecret.version,
      runtimeIdentity: manifest.runtimeIdentity.serviceAccount,
    })
  } catch {
    fail('rollback_unavailable', 'The rollback secret could not be inspected.')
  }
  const expectedCondition = secretAccessCondition(manifest, expectedSecret.version)
  if (
    access?.name !== expectedSecret.reference ||
    access?.state !== 'ENABLED' ||
    !exactCondition(access?.condition, expectedCondition)
  ) fail('rollback_unavailable', 'The rollback secret is unavailable or overbroad.')
  if (typeof inspectRuntimeAccess !== 'function') {
    fail('rollback_unavailable', 'Rollback runtime identity inspection is unavailable.')
  }
  let runtime
  try {
    runtime = await inspectRuntimeAccess({
      projectId: manifest.metadata.projectId,
      secretName: manifest.secretMount.secretName,
      runtimeIdentity: manifest.runtimeIdentity.serviceAccount,
    })
    if (
      !isEnabledRuntimeIdentity(
        runtime?.identity,
        manifest.runtimeIdentity.serviceAccount,
      ) ||
      !Array.isArray(runtime?.userManagedKeys) ||
      runtime.userManagedKeys.length !== 0
    ) fail('rollback_unavailable', 'The rollback runtime identity is unavailable or unsafe.')
    assertExistingIamIsBounded(
      manifest,
      `serviceAccount:${manifest.runtimeIdentity.serviceAccount}`,
      runtime.projectPolicy,
      runtime.secretPolicy,
      expectedSecret,
      true,
    )
  } catch {
    fail('rollback_unavailable', 'The rollback runtime identity is unavailable or unsafe.')
  }

  const command = Object.freeze([
    'run', 'services', 'update-traffic', manifest.metadata.service,
    '--project', manifest.metadata.projectId, '--region', manifest.metadata.region,
    '--to-revisions', `${target.revision}=100`, '--quiet',
  ])
  const result = Object.freeze({
    status: 'ready', dryRun: true, projectId: manifest.metadata.projectId,
    region: manifest.metadata.region, service: manifest.metadata.service,
    currentRevision: releaseRecord.revision,
    targetRevision: target.revision,
    targetImageDigest: target.imageDigest,
    secretRef: target.secretRef,
    reviewedCommand: command,
  })
  if (executeTrafficMutation === undefined) fail('rollback_unavailable', 'Rollback mutation port is required.')
  write(JSON.stringify(result))
  return result
}

export function normalizeRevisionInspection(record, projectId, revision) {
  const containers = record?.spec?.containers
  const volumes = record?.spec?.volumes
  const container = Array.isArray(containers) && containers.length === 1
    ? containers[0]
    : null
  const matchingVolumes = Array.isArray(volumes)
    ? volumes.filter((volume) => volume?.name === 'ingestion-secret')
    : []
  const volume = matchingVolumes.length === 1 ? matchingVolumes[0] : null
  const secretVolume = volume?.secret
  const items = secretVolume?.items
  const secretItem = Array.isArray(items) && items.length === 1 ? items[0] : null
  const matchingMounts = Array.isArray(container?.volumeMounts)
    ? container.volumeMounts.filter((mount) => mount?.name === 'ingestion-secret')
    : []
  const mount = matchingMounts.length === 1 ? matchingMounts[0] : null
  const mountContract =
    record?.spec?.containers?.length === 1 &&
    record?.spec?.volumes?.length === 1 &&
    record?.spec?.template?.metadata === undefined &&
    record?.metadata?.annotations?.['run.googleapis.com/execution-environment'] === 'gen1' &&
    secretVolume?.secretName === 'peecare-emqx-webhook-current' &&
    typeof secretItem?.key === 'string' && /^[1-9][0-9]*$/.test(secretItem.key) &&
    secretItem?.path === 'ingestion-secret' &&
    secretItem?.mode === 256 &&
    mount?.mountPath === '/var/run/secrets/peecare'
  return Object.freeze({
    revision: record?.metadata?.name ?? revision,
    image: container?.image,
    runtimeIdentity: record?.spec?.serviceAccountName,
    secretRef: mountContract
      ? `projects/${projectId}/secrets/${secretVolume.secretName}/versions/${secretItem.key}`
      : null,
    secretMountContract: mountContract,
    ready: record?.status?.conditions?.some((condition) =>
      condition.type === 'Ready' && condition.status === 'True'),
  })
}

function sanitizedCloudEnvironment(environment) {
  const result = {}
  for (const name of [
    'PATH', 'HOME', 'LANG', 'LC_ALL', 'CLOUDSDK_CONFIG',
    'CLOUDSDK_ACTIVE_CONFIG_NAME', 'XDG_CONFIG_HOME',
  ]) {
    if (typeof environment[name] === 'string') result[name] = environment[name]
  }
  return result
}

export async function runTestToolDeployCli({
  argv = process.argv.slice(2),
  environment = process.env,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  execute = (command, args) => spawnSync(command, args, {
    encoding: 'utf8',
    env: sanitizedCloudEnvironment(environment),
  }),
} = {}) {
  try {
    if (argv[0] === '--rollback-dry-run') {
      const recordPath = environment.PEECARE_TEST_TOOL_RELEASE_RECORD
      if (!recordPath) fail('rollback_unavailable', 'A release record is required.')
      return await runTestToolRollback({
        args: ['--rollback-dry-run'], manifest: loadTestToolManifest(),
        releaseRecord: JSON.parse(readFileSync(resolve(recordPath), 'utf8')),
        inspectRevision: async ({ projectId, region, revision }) => {
          const output = execute('gcloud', [
            'run', 'revisions', 'describe', revision, '--project', projectId,
            '--region', region, '--format=json',
          ])
          requireSuccess(output, 'rollback_target_invalid')
          return normalizeRevisionInspection(JSON.parse(output.stdout), projectId, revision)
        },
        inspectSecretAccess: async ({ projectId, secretName, version, runtimeIdentity }) => {
          const described = parseJsonResult(execute('gcloud', [
            'secrets', 'versions', 'describe', version,
            '--secret', secretName, '--project', projectId, '--format=json',
          ]), 'rollback_target_invalid')
          const policy = parseJsonResult(execute('gcloud', [
            'secrets', 'get-iam-policy', secretName,
            '--project', projectId, '--format=json',
          ]), 'rollback_target_invalid')
          const matching = bindingsForMember(
            policy, `serviceAccount:${runtimeIdentity}`,
          ).filter((binding) => binding.role === 'roles/secretmanager.secretAccessor')
          return {
            name: normalizeSecretResourceName(described?.name, loadTestToolManifest()),
            state: described?.state,
            condition: matching.length === 1 ? matching[0].condition : null,
          }
        },
        inspectRuntimeAccess: async ({ projectId, secretName, runtimeIdentity }) => ({
          identity: parseJsonResult(execute('gcloud', [
            'iam', 'service-accounts', 'describe', runtimeIdentity,
            '--project', projectId, '--format=json',
          ]), 'rollback_target_invalid'),
          userManagedKeys: parseJsonResult(execute('gcloud', [
            'iam', 'service-accounts', 'keys', 'list',
            '--iam-account', runtimeIdentity, '--project', projectId,
            '--managed-by=user', '--format=json',
          ]), 'rollback_target_invalid'),
          projectPolicy: parseJsonResult(execute('gcloud', [
            'projects', 'get-iam-policy', projectId, '--format=json',
          ]), 'rollback_target_invalid'),
          secretPolicy: parseJsonResult(execute('gcloud', [
            'secrets', 'get-iam-policy', secretName,
            '--project', projectId, '--format=json',
          ]), 'rollback_target_invalid'),
        }),
        executeTrafficMutation: () => {},
        write: stdout,
      })
    }
    return runTestToolDeploy({
      environment, args: argv,
      manifest: loadTestToolManifest(),
      execute,
      write: stdout,
    })
  } catch (error) {
    const code = error instanceof TestToolDeploymentError
      ? error.code
      : 'test_tool_deployment_failed'
    stderr(JSON.stringify({ status: 'error', code }))
    return Object.freeze({ status: 'error', code })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runTestToolDeployCli()
  if (result?.status === 'error') process.exitCode = 1
}
