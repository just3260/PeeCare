import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  loadMemberManifest,
  resolveMemberClaimConfiguration,
} from './deploy-member.mjs'

const APPROVED_PROJECT = 'petcare-c7483'
const APPROVED_REGION = 'asia-east1'
const APPROVED_SERVICE = 'peecare-member-development'
const APPROVED_PROJECT_ROLES = Object.freeze([
  'roles/datastore.user',
  'roles/firebaseauth.viewer',
])
const APPROVED_SECRET_ACCESS = Object.freeze({
  'peecare-claim-webhook-current': Object.freeze([
    'roles/secretmanager.secretAccessor',
  ]),
  'peecare-pair-code-hmac-key': Object.freeze([
    'roles/secretmanager.secretAccessor',
  ]),
})
const REVISION_PATTERN = /^peecare-member-development-[0-9]{5}-[a-z0-9]{3}$/
const SMOKE_CHECKS = Object.freeze([
  ['publicHealth', 'checkPublicHealth'],
  ['corsPreflight', 'checkCorsPreflight'],
  ['missingToken', 'checkMissingToken'],
  ['wrongToken', 'checkWrongToken'],
  ['revokedToken', 'checkRevokedToken'],
  ['ownerRename', 'checkOwnerRename'],
  ['nonOwnerDenial', 'checkNonOwnerDenial'],
  ['projectIsolation', 'checkProjectIsolation'],
  ['memberClaimRoutes', 'checkMemberClaimRoutes'],
  ['claimCredentialIsolation', 'checkClaimCredentialIsolation'],
  ['claimPersistenceBoundary', 'checkClaimPersistenceBoundary'],
])

const ALLOWED_OPERATOR_KEYS = new Set([
  'PEECARE_DEVELOPMENT_PROJECT_ID',
  'PEECARE_DEVELOPMENT_FIRESTORE_REGION',
  'PEECARE_DEVELOPMENT_WEB_ORIGIN',
  'PEECARE_DEVELOPMENT_WEB_API_KEY',
  'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF',
  'PEECARE_PAIR_CODE_HMAC_KEY_REF',
  'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
  'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
  'PEECARE_MEMBER_SMOKE_DEVICE_ID',
  'PEECARE_MEMBER_CLAIM_SMOKE_DEVICE_ID',
  'PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID',
  'PEECARE_MEMBER_RELEASE_RECORD',
  'PEECARE_MEMBER_PRIOR_RELEASE_RECORD',
])
const ALLOWED_REVISION_KEYS = new Set([
  'PEECARE_WEB_ORIGIN',
  'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
  'PEECARE_CLAIM_WEBHOOK_SECRET',
  'PEECARE_PAIR_CODE_HMAC_KEY',
  'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
])

function isSensitiveConfigurationKey(key) {
  return (
    key === 'GOOGLE_APPLICATION_CREDENTIALS' ||
    key === 'FIRESTORE_EMULATOR_HOST' ||
    key === 'FIREBASE_AUTH_EMULATOR_HOST' ||
    (/^(?:PEECARE|EMQX)_/.test(key) &&
      /(?:SECRET|PASSWORD|TOKEN|HMAC_KEY)/i.test(key))
  )
}

function hasUnsupportedSensitiveOperatorEnvironment(environment) {
  return Object.keys(environment).some((key) =>
    /^(?:PEECARE|EMQX)_/.test(key)
      ? !ALLOWED_OPERATOR_KEYS.has(key)
      : isSensitiveConfigurationKey(key),
  )
}

function inspectRuntimeEnvironment(revisionRecord) {
  const environment = revisionRecord.spec?.containers?.[0]?.env
  const values = {}
  const secretBindings = {}
  let unexpectedSensitiveKey = false
  if (Array.isArray(environment)) {
    for (const entry of environment) {
      if (
        typeof entry?.name === 'string' &&
        ((/^(?:PEECARE|EMQX)_/.test(entry.name) &&
          !ALLOWED_REVISION_KEYS.has(entry.name)) ||
          (isSensitiveConfigurationKey(entry.name) &&
            !ALLOWED_REVISION_KEYS.has(entry.name)))
      ) {
        unexpectedSensitiveKey = true
      }
      if (
        entry?.name === 'PEECARE_PAIR_CODE_HMAC_KEY_VERSION' ||
        entry?.name === 'PEECARE_CLAIM_SHARED_MQTT_USERNAME'
      ) {
        values[entry.name] = entry.value
      }
      if (
        entry?.name === 'PEECARE_CLAIM_WEBHOOK_SECRET' ||
        entry?.name === 'PEECARE_PAIR_CODE_HMAC_KEY'
      ) {
        const reference =
          entry.valueSource?.secretKeyRef ?? entry.valueFrom?.secretKeyRef
        secretBindings[entry.name] = {
          secret: reference?.secret ?? reference?.name,
          version: reference?.version ?? reference?.key,
        }
      }
    }
  }
  return Object.freeze({
    values: Object.freeze(values),
    secretBindings: Object.freeze(secretBindings),
    unexpectedSensitiveKey,
  })
}

function inspectDirectRoles(policyText, member) {
  const policy = JSON.parse(policyText)
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

function inspectProjectSecretNames(listText) {
  let records
  try {
    records = JSON.parse(listText)
  } catch {
    throw new MemberVerificationError(
      'cloud_inspection_failed',
      'Secret Manager inventory is not valid JSON.',
    )
  }
  if (!Array.isArray(records)) {
    throw new MemberVerificationError(
      'cloud_inspection_failed',
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
      throw new MemberVerificationError(
        'cloud_inspection_failed',
        'Secret Manager inventory contains a malformed record.',
      )
    }
    const name = record.name.slice(record.name.lastIndexOf('/') + 1)
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(name)) {
      throw new MemberVerificationError(
        'cloud_inspection_failed',
        'Secret Manager inventory contains an invalid secret name.',
      )
    }
    return name
  })
  if (new Set(names).size !== names.length) {
    throw new MemberVerificationError(
      'cloud_inspection_failed',
      'Secret Manager inventory contains duplicate secret names.',
    )
  }
  return names.sort()
}

export function createCliRevisionInspector(execute) {
  return async ({ projectId, region, service, revision }) => {
    const serviceRecord = JSON.parse(
      execute([
        'run',
        'services',
        'describe',
        service,
        '--project',
        projectId,
        '--region',
        region,
        '--format=json',
      ]),
    )
    const revisionRecord = JSON.parse(
      execute([
        'run',
        'revisions',
        'describe',
        revision,
        '--project',
        projectId,
        '--region',
        region,
        '--format=json',
      ]),
    )
    const annotations = revisionRecord.metadata?.annotations ?? {}
    const runtimeIdentity = revisionRecord.spec?.serviceAccountName
    const member = `serviceAccount:${runtimeIdentity}`
    const projectRoles = inspectDirectRoles(
      execute([
        'projects',
        'get-iam-policy',
        projectId,
        '--format=json',
      ]),
      member,
    )
    const secretAccess = Object.create(null)
    const projectSecrets = inspectProjectSecretNames(
      execute([
        'secrets',
        'list',
        '--project',
        projectId,
        '--format=json(name)',
      ]),
    )
    for (const secret of projectSecrets) {
      const roles = inspectDirectRoles(
        execute([
          'secrets',
          'get-iam-policy',
          secret,
          '--project',
          projectId,
          '--format=json',
        ]),
        member,
      )
      if (roles.length > 0) secretAccess[secret] = roles
    }
    return {
      ready: Boolean(
        revisionRecord.status?.conditions?.some(
          (condition) =>
            condition.type === 'Ready' && condition.status === 'True',
        ),
      ),
      serving:
        serviceRecord.status?.latestReadyRevisionName === revision &&
        serviceRecord.status?.traffic?.some(
          (target) =>
            target.revisionName === revision && target.percent === 100,
        ) === true,
      projectId,
      region,
      service,
      revision: revisionRecord.metadata?.name,
      image: revisionRecord.spec?.containers?.[0]?.image,
      runtimeIdentity,
      serviceUrl: serviceRecord.status?.url,
      resources: Object.freeze({
        billing:
          annotations['run.googleapis.com/cpu-throttling'] === 'false'
            ? 'instance-based'
            : 'request-based',
        minInstances: Number(
          annotations['autoscaling.knative.dev/minScale'] ?? 0,
        ),
      }),
      runtimeEnvironment: inspectRuntimeEnvironment(revisionRecord),
      directIam: Object.freeze({
        projectRoles: Object.freeze(projectRoles),
        secretAccess: Object.freeze({ ...secretAccess }),
      }),
    }
  }
}

export class MemberVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MemberVerificationError'
    this.code = code
  }
}

function parseVerificationArguments(args) {
  if (
    args.length !== 4 ||
    args[0] !== '--revision' ||
    args[2] !== '--image'
  ) {
    throw new MemberVerificationError(
      'explicit_revision_required',
      'Verification requires an exact --revision and immutable --image.',
    )
  }
  return { revision: args[1], image: args[3] }
}

function validateVerificationTarget(environment, manifest, revision, image) {
  if (hasUnsupportedSensitiveOperatorEnvironment(environment)) {
    throw new MemberVerificationError(
      'claim_configuration_invalid',
      'Verification rejects unsupported direct credentials and local runtime overrides.',
    )
  }
  if (
    environment.PEECARE_DEVELOPMENT_PROJECT_ID !== APPROVED_PROJECT ||
    environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION !== APPROVED_REGION ||
    environment.PEECARE_DEVELOPMENT_WEB_ORIGIN !==
      manifest.runtimeEnvironment.values.PEECARE_WEB_ORIGIN ||
    manifest.metadata.projectId !== APPROVED_PROJECT ||
    manifest.metadata.region !== APPROVED_REGION ||
    manifest.metadata.service !== APPROVED_SERVICE
  ) {
    throw new MemberVerificationError(
      'target_mismatch',
      'Verification target must exactly match the approved development service.',
    )
  }
  if (!REVISION_PATTERN.test(revision)) {
    throw new MemberVerificationError(
      'invalid_revision',
      'Verification requires an exact approved Member API revision.',
    )
  }
  if (!new RegExp(manifest.image.digestPattern).test(image)) {
    throw new MemberVerificationError(
      'immutable_image_required',
      'Verification requires an approved immutable image digest.',
    )
  }
  if (
    environment.PEECARE_CLAIM_WEBHOOK_SECRET !== undefined ||
    environment.PEECARE_PAIR_CODE_HMAC_KEY !== undefined
  ) {
    throw new MemberVerificationError(
      'claim_configuration_invalid',
      'Verification loads Claim secrets only from approved numeric Secret Manager versions.',
    )
  }
  try {
    return resolveMemberClaimConfiguration(environment)
  } catch {
    throw new MemberVerificationError(
      'claim_configuration_invalid',
      'Verification requires approved independent numeric Claim secret bindings.',
    )
  }
}

export function preflightMemberVerification({ environment, args, manifest }) {
  const { revision, image } = parseVerificationArguments(args)
  const claimConfiguration = validateVerificationTarget(
    environment,
    manifest,
    revision,
    image,
  )
  return Object.freeze({ revision, image, claimConfiguration })
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '')
  if (normalized === 'localhost') return true
  const segments = normalized.split('.')
  if (
    segments.length === 4 &&
    segments.every(
      (segment) => /^\d{1,3}$/.test(segment) && Number(segment) <= 255,
    ) &&
    Number(segments[0]) === 127
  ) {
    return true
  }
  const ipv6 =
    normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized
  return ipv6 === '::1' || /^::ffff:7f[0-9a-f]{2}:/.test(ipv6)
}

function validateServiceOrigin(value, service) {
  let origin
  try {
    origin = new URL(value)
  } catch {
    throw new MemberVerificationError(
      'invalid_verified_origin',
      'Verified Member API origin must be a valid HTTPS Cloud Run origin.',
    )
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username.length > 0 ||
    origin.password.length > 0 ||
    origin.pathname !== '/' ||
    origin.search.length > 0 ||
    origin.hash.length > 0 ||
    origin.origin !== value ||
    isLoopbackHostname(origin.hostname) ||
    !origin.hostname.startsWith(`${service}-`) ||
    !origin.hostname.endsWith('.run.app')
  ) {
    throw new MemberVerificationError(
      'invalid_verified_origin',
      'Verified Member API origin must be the exact HTTPS origin for the approved Cloud Run service.',
    )
  }
  return origin.origin
}

function assertInspectedRevision(
  inspected,
  manifest,
  revision,
  image,
  requireServing = true,
  claimConfiguration,
) {
  if (
    inspected.ready !== true ||
    (requireServing && inspected.serving !== true) ||
    inspected.projectId !== manifest.metadata.projectId ||
    inspected.region !== manifest.metadata.region ||
    inspected.service !== manifest.metadata.service ||
    inspected.revision !== revision ||
    inspected.image !== image ||
    inspected.runtimeIdentity !== manifest.runtimeIdentity.serviceAccount ||
    (claimConfiguration !== undefined &&
      (inspected.resources?.billing !== manifest.resources.billing ||
        inspected.resources?.minInstances !== manifest.resources.minInstances ||
        inspected.runtimeEnvironment?.values
          ?.PEECARE_PAIR_CODE_HMAC_KEY_VERSION !==
          claimConfiguration.hmacKeyVersion ||
        inspected.runtimeEnvironment?.values
          ?.PEECARE_CLAIM_SHARED_MQTT_USERNAME !==
          claimConfiguration.sharedUsername ||
        inspected.runtimeEnvironment?.secretBindings
          ?.PEECARE_CLAIM_WEBHOOK_SECRET?.secret !==
          manifest.runtimeEnvironment.secretBindings.PEECARE_CLAIM_WEBHOOK_SECRET
            .secret ||
        inspected.runtimeEnvironment?.secretBindings
          ?.PEECARE_CLAIM_WEBHOOK_SECRET?.version !==
          claimConfiguration.claimSecretVersion ||
        inspected.runtimeEnvironment?.secretBindings?.PEECARE_PAIR_CODE_HMAC_KEY
          ?.secret !==
          manifest.runtimeEnvironment.secretBindings.PEECARE_PAIR_CODE_HMAC_KEY
            .secret ||
        inspected.runtimeEnvironment?.secretBindings?.PEECARE_PAIR_CODE_HMAC_KEY
          ?.version !== claimConfiguration.hmacSecretVersion ||
        inspected.runtimeEnvironment?.unexpectedSensitiveKey !== false))
    ||
    (claimConfiguration !== undefined &&
      (JSON.stringify(inspected.directIam?.projectRoles) !==
        JSON.stringify(APPROVED_PROJECT_ROLES) ||
        JSON.stringify(inspected.directIam?.secretAccess) !==
          JSON.stringify(APPROVED_SECRET_ACCESS)))
  ) {
    throw new MemberVerificationError(
      'revision_mismatch',
      'Inspected revision does not match the approved deployment target.',
    )
  }
}

function requireSmokeValue(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MemberVerificationError(
      'smoke_config_missing',
      `Required Member API smoke configuration ${name} is missing.`,
    )
  }
  return value.trim()
}

function sameDeviceSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactObjectKeys(value, expectedKeys) {
  if (!isPlainRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function hasExactTerminalDelta(before, after, status) {
  if (
    before === null ||
    after === null ||
    before.status !== 'pending' ||
    after.status !== status ||
    !Number.isSafeInteger(after.terminalAtMs)
  ) {
    return false
  }
  const beforeBase = { ...before }
  const afterBase = { ...after }
  delete beforeBase.status
  delete afterBase.status
  delete afterBase.terminalAtMs
  return sameDeviceSnapshot(beforeBase, afterBase)
}

export function createMemberSmokeAdapter({
  environment,
  inspectRevision,
  request,
  readDevice,
  claimWebhookSecret,
  readClaimState,
}) {
  const projectId = requireSmokeValue(
    environment,
    'PEECARE_DEVELOPMENT_PROJECT_ID',
  )
  const allowedOrigin = requireSmokeValue(
    environment,
    'PEECARE_DEVELOPMENT_WEB_ORIGIN',
  )
  const deviceId = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_SMOKE_DEVICE_ID',
  )
  const ownerToken = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_OWNER_ID_TOKEN',
  )
  const nonOwnerToken = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_NON_OWNER_ID_TOKEN',
  )
  const revokedToken = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_REVOKED_ID_TOKEN',
  )
  const claimDeviceId = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_CLAIM_SMOKE_DEVICE_ID',
  )
  const claimClientId = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID',
  )
  const claimSharedUsername = requireSmokeValue(
    environment,
    'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
  )
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)) {
    throw new MemberVerificationError(
      'smoke_config_invalid',
      'Member API smoke device ID is invalid.',
    )
  }
  if (
    !/^[0-9A-F]{12}$/.test(claimDeviceId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(claimClientId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(claimSharedUsername) ||
    typeof claimWebhookSecret !== 'string' ||
    claimWebhookSecret.length === 0 ||
    claimWebhookSecret === ownerToken
  ) {
    throw new MemberVerificationError(
      'smoke_config_invalid',
      'Member API Claim smoke configuration is invalid.',
    )
  }

  let claimProbe

  function mutationUrl(inspected) {
    return `${inspected.serviceUrl}/v1/devices/${encodeURIComponent(deviceId)}/display-name`
  }

  async function rejectedMutationHasZeroWrites(inspected, authorization) {
    const before = await readDevice({ projectId, deviceId })
    const response = await request({
      method: 'PATCH',
      url: mutationUrl(inspected),
      headers: {
        origin: allowedOrigin,
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: { customName: 'Rejected smoke mutation' },
    })
    const after = await readDevice({ projectId, deviceId })
    return response.status === 401 && sameDeviceSnapshot(before, after)
  }

  return Object.freeze({
    inspectRevision,
    async checkPublicHealth(inspected) {
      const response = await request({
        method: 'GET',
        url: `${inspected.serviceUrl}/health`,
      })
      return response.status === 200 && response.body?.status === 'ok'
    },
    async checkCorsPreflight(inspected) {
      const url = mutationUrl(inspected)
      const [approved, foreign] = await Promise.all([
        request({
          method: 'OPTIONS',
          url,
          headers: {
            origin: allowedOrigin,
            'access-control-request-method': 'PATCH',
            'access-control-request-headers': 'authorization, content-type',
          },
        }),
        request({
          method: 'OPTIONS',
          url,
          headers: {
            origin: 'https://unapproved.invalid',
            'access-control-request-method': 'PATCH',
          },
        }),
      ])
      return (
        approved.status === 204 &&
        approved.headers['access-control-allow-origin'] === allowedOrigin &&
        approved.headers['access-control-allow-methods'] === 'PATCH' &&
        foreign.headers['access-control-allow-origin'] === undefined
      )
    },
    checkMissingToken(inspected) {
      return rejectedMutationHasZeroWrites(inspected)
    },
    checkWrongToken(inspected) {
      return rejectedMutationHasZeroWrites(inspected, 'Bearer invalid-token')
    },
    checkRevokedToken(inspected) {
      return rejectedMutationHasZeroWrites(inspected, `Bearer ${revokedToken}`)
    },
    async checkOwnerRename(inspected) {
      const before = await readDevice({ projectId, deviceId })
      const setResponse = await request({
        method: 'PATCH',
        url: mutationUrl(inspected),
        headers: {
          authorization: `Bearer ${ownerToken}`,
          origin: allowedOrigin,
          'content-type': 'application/json',
        },
        body: { customName: 'Cloud smoke 主浴室' },
      })
      const renamed = await readDevice({ projectId, deviceId })
      const clearResponse = await request({
        method: 'PATCH',
        url: mutationUrl(inspected),
        headers: {
          authorization: `Bearer ${ownerToken}`,
          origin: allowedOrigin,
          'content-type': 'application/json',
        },
        body: { customName: null },
      })
      const cleared = await readDevice({ projectId, deviceId })
      return (
        before.exists === true &&
        setResponse.status === 200 &&
        setResponse.body?.customName === 'Cloud smoke 主浴室' &&
        renamed.data?.customName === 'Cloud smoke 主浴室' &&
        clearResponse.status === 200 &&
        clearResponse.body?.customName === null &&
        (cleared.data?.customName === undefined ||
          cleared.data?.customName === null) &&
        cleared.data?.ownerUid === before.data?.ownerUid
      )
    },
    async checkNonOwnerDenial(inspected) {
      const before = await readDevice({ projectId, deviceId })
      const response = await request({
        method: 'PATCH',
        url: mutationUrl(inspected),
        headers: {
          authorization: `Bearer ${nonOwnerToken}`,
          origin: allowedOrigin,
          'content-type': 'application/json',
        },
        body: { customName: 'Non-owner smoke mutation' },
      })
      const after = await readDevice({ projectId, deviceId })
      return response.status === 404 && sameDeviceSnapshot(before, after)
    },
    async checkProjectIsolation(_inspected) {
      const snapshot = await readDevice({ projectId, deviceId })
      return (
        snapshot.projectId === APPROVED_PROJECT &&
        snapshot.deviceId === deviceId &&
        snapshot.exists === true &&
        typeof snapshot.data?.ownerUid === 'string' &&
        snapshot.data.ownerUid.length > 0
      )
    },
    async checkMemberClaimRoutes(inspected) {
      const collectionUrl = `${inspected.serviceUrl}/v1/device-claim-sessions`
      const [preflight, rejectedMethod] = await Promise.all([
        request({
          method: 'OPTIONS',
          url: collectionUrl,
          headers: {
            origin: allowedOrigin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization, content-type',
          },
        }),
        request({ method: 'GET', url: collectionUrl }),
      ])
      if (
        preflight.status !== 204 ||
        preflight.headers['access-control-allow-origin'] !== allowedOrigin ||
        preflight.headers['access-control-allow-methods'] !== 'POST' ||
        rejectedMethod.status !== 405
      ) {
        return false
      }
      const initialState = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
      })
      if (
        initialState.device.exists !== true ||
        initialState.device.data === null ||
        Object.prototype.hasOwnProperty.call(initialState.device.data, 'ownerUid') ||
        initialState.activeClaim.exists !== false
      ) {
        return false
      }
      const response = await request({
        method: 'POST',
        url: collectionUrl,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          origin: allowedOrigin,
          'content-type': 'application/json',
        },
        body: { deviceId: claimDeviceId },
      })
      const body = response.body
      if (
        response.status !== 201 ||
        body === null ||
        typeof body !== 'object' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          body.sessionId ?? '',
        ) ||
        body.deviceId !== claimDeviceId ||
        !/^[0-9]{8}$/.test(body.pairCode ?? '') ||
        body.status !== 'pending' ||
        !Number.isSafeInteger(body.expiresAtMs) ||
        Object.keys(body).sort().join(',') !==
          'deviceId,expiresAtMs,pairCode,sessionId,status'
      ) {
        return false
      }
      const statusResponse = await request({
        method: 'GET',
        url: `${collectionUrl}/${encodeURIComponent(body.sessionId)}`,
        headers: { authorization: `Bearer ${ownerToken}`, origin: allowedOrigin },
      })
      if (
        statusResponse.status !== 200 ||
        statusResponse.body?.sessionId !== body.sessionId ||
        statusResponse.body?.deviceId !== claimDeviceId ||
        statusResponse.body?.status !== 'pending' ||
        statusResponse.body?.expiresAtMs !== body.expiresAtMs ||
        Object.keys(statusResponse.body ?? {}).sort().join(',') !==
          'deviceId,expiresAtMs,sessionId,status'
      ) {
        return false
      }
      const createdState = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: body.sessionId,
      })
      if (
        !sameDeviceSnapshot(initialState.device, createdState.device) ||
        createdState.activeClaim.data?.status !== 'pending' ||
        createdState.activeClaim.data?.sessionId !== body.sessionId ||
        createdState.session.data?.status !== 'pending' ||
        createdState.session.data?.expectedDeviceId !== claimDeviceId
      ) {
        return false
      }
      claimProbe = Object.freeze({
        initialState,
        sessionId: body.sessionId,
        pairCode: body.pairCode,
        expiresAtMs: body.expiresAtMs,
      })
      return true
    },
    async checkClaimCredentialIsolation(inspected) {
      if (claimProbe === undefined) return false
      const before = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: claimProbe.sessionId,
      })
      const memberCrossUse = await request({
        method: 'POST',
        url: `${inspected.serviceUrl}/v1/device-claim-sessions`,
        headers: {
          authorization: `Bearer ${claimWebhookSecret}`,
          origin: allowedOrigin,
          'content-type': 'application/json',
        },
        body: { deviceId: claimDeviceId },
      })
      const afterMemberCrossUse = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: claimProbe.sessionId,
      })
      const emqxCrossUse = await request({
        method: 'POST',
        url: `${inspected.serviceUrl}/v1/emqx/device-claims`,
        headers: { 'content-type': 'application/json' },
        body: {
          webhookAuthorization: ownerToken,
          event: {
            brokerReceivedAtMs: Date.now(),
            clientId: claimClientId,
            payload: { device_id: claimDeviceId, pair_code: claimProbe.pairCode },
            qos: 0,
            retained: false,
            topic: 'peecare/device/1/bind',
            username: claimSharedUsername,
          },
        },
      })
      const after = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: claimProbe.sessionId,
      })
      return (
        memberCrossUse.status === 401 &&
        emqxCrossUse.status === 401 &&
        sameDeviceSnapshot(before, afterMemberCrossUse) &&
        sameDeviceSnapshot(afterMemberCrossUse, after)
      )
    },
    async checkClaimPersistenceBoundary(inspected) {
      if (claimProbe === undefined) return false
      const before = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: claimProbe.sessionId,
      })
      if (
        before.device.exists !== true ||
        before.device.data === null ||
        Object.prototype.hasOwnProperty.call(before.device.data, 'ownerUid') ||
        before.activeClaim.data?.status !== 'pending' ||
        before.activeClaim.data?.sessionId !== claimProbe.sessionId ||
        before.session.data?.status !== 'pending' ||
        before.session.data?.expectedDeviceId !== claimDeviceId ||
        typeof before.session.data?.memberUid !== 'string' ||
        before.session.data.memberUid.length === 0
      ) {
        return false
      }
      const event = {
        brokerReceivedAtMs: Date.now(),
        clientId: claimClientId,
        payload: { device_id: claimDeviceId, pair_code: claimProbe.pairCode },
        qos: 0,
        retained: false,
        topic: 'peecare/device/1/bind',
        username: claimSharedUsername,
      }
      const bindUrl = `${inspected.serviceUrl}/v1/emqx/device-claims`
      const first = await request({
        method: 'POST',
        url: bindUrl,
        headers: { 'content-type': 'application/json' },
        body: { webhookAuthorization: claimWebhookSecret, event },
      })
      const afterFirst = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: claimProbe.sessionId,
      })
      const duplicate = await request({
        method: 'POST',
        url: bindUrl,
        headers: { 'content-type': 'application/json' },
        body: { webhookAuthorization: claimWebhookSecret, event },
      })
      const afterDuplicate = await readClaimState({
        projectId,
        deviceId: claimDeviceId,
        requestedSessionId: claimProbe.sessionId,
      })
      const status = await request({
        method: 'GET',
        url: `${inspected.serviceUrl}/v1/device-claim-sessions/${encodeURIComponent(claimProbe.sessionId)}`,
        headers: { authorization: `Bearer ${ownerToken}`, origin: allowedOrigin },
      })
      const preservedDevice = { ...afterFirst.device.data }
      delete preservedDevice.ownerUid
      delete preservedDevice.claimedAtMs
      return (
        first.status === 202 &&
        duplicate.status === 202 &&
        status.status === 200 &&
        status.body?.status === 'claimed' &&
        afterFirst.device.data?.ownerUid === before.session.data.memberUid &&
        Number.isSafeInteger(afterFirst.device.data?.claimedAtMs) &&
        sameDeviceSnapshot(preservedDevice, before.device.data) &&
        hasExactTerminalDelta(
          before.session.data,
          afterFirst.session.data,
          'claimed',
        ) &&
        hasExactTerminalDelta(
          before.activeClaim.data,
          afterFirst.activeClaim.data,
          'claimed',
        ) &&
        sameDeviceSnapshot(afterFirst, afterDuplicate)
      )
    },
  })
}

async function validatePriorHealthyRelease(
  priorRelease,
  activeRevision,
  manifest,
  adapter,
) {
  if (priorRelease === undefined) return undefined
  if (
    priorRelease?.status !== 'healthy' ||
    priorRelease.projectId !== manifest.metadata.projectId ||
    priorRelease.region !== manifest.metadata.region ||
    priorRelease.service !== manifest.metadata.service ||
    !REVISION_PATTERN.test(priorRelease.revision ?? '') ||
    priorRelease.revision === activeRevision ||
    typeof priorRelease.image !== 'string' ||
    !new RegExp(manifest.image.digestPattern).test(priorRelease.image) ||
    !/^sha256:[0-9a-f]{64}$/.test(priorRelease.imageDigest ?? '') ||
    priorRelease.image.slice(priorRelease.image.lastIndexOf('@') + 1) !==
      priorRelease.imageDigest
  ) {
    throw new MemberVerificationError(
      'rollback_target_invalid',
      'Prior release must be a healthy immutable revision of the same approved service.',
    )
  }
  const inspected = await adapter.inspectRevision({
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision: priorRelease.revision,
  })
  assertInspectedRevision(
    inspected,
    manifest,
    priorRelease.revision,
    priorRelease.image,
    false,
  )
  return Object.freeze({
    revision: priorRelease.revision,
    imageDigest: priorRelease.imageDigest,
  })
}

export async function runMemberVerification({
  environment,
  args,
  manifest,
  adapter,
  priorRelease,
  write,
}) {
  const { revision, image, claimConfiguration } = preflightMemberVerification({
    environment,
    args,
    manifest,
  })
  const inspected = await adapter.inspectRevision({
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision,
  })
  assertInspectedRevision(
    inspected,
    manifest,
    revision,
    image,
    true,
    claimConfiguration,
  )
  const verifiedOrigin = validateServiceOrigin(
    inspected.serviceUrl,
    manifest.metadata.service,
  )
  const priorHealthyRevision = await validatePriorHealthyRelease(
    priorRelease,
    revision,
    manifest,
    adapter,
  )

  const smoke = {}
  for (const [resultName, methodName] of SMOKE_CHECKS) {
    const passed = await adapter[methodName](inspected)
    if (passed !== true) {
      throw new MemberVerificationError(
        'smoke_failed',
        `Member API verification failed at ${resultName}.`,
      )
    }
    smoke[resultName] = 'passed'
  }

  const release = Object.freeze({
    status: 'healthy',
    projectId: inspected.projectId,
    region: inspected.region,
    service: inspected.service,
    revision: inspected.revision,
    image: inspected.image,
    imageDigest: inspected.image.slice(inspected.image.lastIndexOf('@') + 1),
    runtimeIdentity: inspected.runtimeIdentity,
    claimRuntime: Object.freeze({
      billing: inspected.resources.billing,
      minInstances: inspected.resources.minInstances,
      directIamBindings: 'verified',
      secretBindings: Object.freeze({
        PEECARE_CLAIM_WEBHOOK_SECRET: Object.freeze({
          secret:
            inspected.runtimeEnvironment.secretBindings
              .PEECARE_CLAIM_WEBHOOK_SECRET.secret,
          version:
            inspected.runtimeEnvironment.secretBindings
              .PEECARE_CLAIM_WEBHOOK_SECRET.version,
        }),
        PEECARE_PAIR_CODE_HMAC_KEY: Object.freeze({
          secret:
            inspected.runtimeEnvironment.secretBindings.PEECARE_PAIR_CODE_HMAC_KEY
              .secret,
          version:
            inspected.runtimeEnvironment.secretBindings.PEECARE_PAIR_CODE_HMAC_KEY
              .version,
        }),
      }),
    }),
    verifiedOrigin,
    smoke: Object.freeze(smoke),
    ...(priorHealthyRevision ? { priorHealthyRevision } : {}),
  })
  write(JSON.stringify(release))
  return release
}

export async function runMemberRollback({
  args,
  manifest,
  releaseRecord,
  inspectRevision,
  executeTrafficMutation: _executeTrafficMutation,
  write,
}) {
  const target = releaseRecord?.priorHealthyRevision
  if (
    args.length !== 1 ||
    args[0] !== '--rollback-dry-run' ||
    releaseRecord?.status !== 'healthy' ||
    releaseRecord.projectId !== manifest.metadata.projectId ||
    releaseRecord.region !== manifest.metadata.region ||
    releaseRecord.service !== manifest.metadata.service ||
    !REVISION_PATTERN.test(releaseRecord.revision ?? '') ||
    target === undefined ||
    target === null ||
    typeof target !== 'object' ||
    !REVISION_PATTERN.test(target.revision ?? '') ||
    target.revision === releaseRecord.revision ||
    !/^sha256:[0-9a-f]{64}$/.test(target.imageDigest ?? '')
  ) {
    throw new MemberVerificationError(
      'rollback_target_invalid',
      'Rollback requires a same-service healthy release record with an exact prior immutable revision.',
    )
  }

  const inspected = await inspectRevision({
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    revision: target.revision,
  })
  if (
    inspected.projectId !== manifest.metadata.projectId ||
    inspected.region !== manifest.metadata.region ||
    inspected.service !== manifest.metadata.service ||
    inspected.revision !== target.revision ||
    inspected.runtimeIdentity !== manifest.runtimeIdentity.serviceAccount ||
    inspected.image.slice(inspected.image.lastIndexOf('@') + 1) !==
      target.imageDigest
  ) {
    throw new MemberVerificationError(
      'rollback_target_invalid',
      'Rollback target does not match the inspected immutable revision.',
    )
  }

  const command = Object.freeze({
    executable: 'gcloud',
    args: Object.freeze([
      'run',
      'services',
      'update-traffic',
      manifest.metadata.service,
      '--project',
      manifest.metadata.projectId,
      '--region',
      manifest.metadata.region,
      '--to-revisions',
      `${target.revision}=100`,
      '--quiet',
    ]),
  })
  const plan = Object.freeze({
    status: 'ready',
    dryRun: true,
    projectId: manifest.metadata.projectId,
    region: manifest.metadata.region,
    service: manifest.metadata.service,
    currentRevision: releaseRecord.revision,
    targetRevision: target.revision,
    imageDigest: target.imageDigest,
    command,
  })
  write(JSON.stringify(plan))
  return plan
}

function validateHealthyRelease(environment, releaseRecord) {
  let claimConfiguration
  try {
    claimConfiguration = resolveMemberClaimConfiguration(environment)
  } catch {
    claimConfiguration = undefined
  }
  const expectedTopLevelKeys = [
    'status',
    'projectId',
    'region',
    'service',
    'revision',
    'image',
    'imageDigest',
    'runtimeIdentity',
    'claimRuntime',
    'verifiedOrigin',
    'smoke',
    ...(releaseRecord?.priorHealthyRevision === undefined
      ? []
      : ['priorHealthyRevision']),
  ]
  const exactReleaseSchema =
    hasExactObjectKeys(releaseRecord, expectedTopLevelKeys) &&
    hasExactObjectKeys(releaseRecord.claimRuntime, [
      'billing',
      'minInstances',
      'directIamBindings',
      'secretBindings',
    ]) &&
    hasExactObjectKeys(releaseRecord.claimRuntime.secretBindings, [
      'PEECARE_CLAIM_WEBHOOK_SECRET',
      'PEECARE_PAIR_CODE_HMAC_KEY',
    ]) &&
    hasExactObjectKeys(
      releaseRecord.claimRuntime.secretBindings.PEECARE_CLAIM_WEBHOOK_SECRET,
      ['secret', 'version'],
    ) &&
    hasExactObjectKeys(
      releaseRecord.claimRuntime.secretBindings.PEECARE_PAIR_CODE_HMAC_KEY,
      ['secret', 'version'],
    ) &&
    hasExactObjectKeys(
      releaseRecord.smoke,
      SMOKE_CHECKS.map(([name]) => name),
    ) &&
    (releaseRecord.priorHealthyRevision === undefined ||
      hasExactObjectKeys(releaseRecord.priorHealthyRevision, [
        'revision',
        'imageDigest',
      ]))
  if (
    !exactReleaseSchema ||
    releaseRecord === undefined ||
    releaseRecord === null ||
    releaseRecord.status !== 'healthy' ||
    releaseRecord.projectId !== APPROVED_PROJECT ||
    releaseRecord.projectId !== environment.PEECARE_DEVELOPMENT_PROJECT_ID ||
    releaseRecord.region !== APPROVED_REGION ||
    releaseRecord.region !== environment.PEECARE_DEVELOPMENT_FIRESTORE_REGION ||
    releaseRecord.service !== APPROVED_SERVICE ||
    !REVISION_PATTERN.test(releaseRecord.revision ?? '') ||
    typeof releaseRecord.image !== 'string' ||
    releaseRecord.imageDigest !==
      releaseRecord.image.slice(releaseRecord.image.lastIndexOf('@') + 1) ||
    releaseRecord.runtimeIdentity !==
      'peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com' ||
    claimConfiguration === undefined ||
    releaseRecord.claimRuntime?.billing !== 'request-based' ||
    releaseRecord.claimRuntime?.minInstances !== 0 ||
    releaseRecord.claimRuntime?.directIamBindings !== 'verified' ||
    releaseRecord.claimRuntime?.secretBindings?.PEECARE_CLAIM_WEBHOOK_SECRET
      ?.secret !== 'peecare-claim-webhook-current' ||
    releaseRecord.claimRuntime?.secretBindings?.PEECARE_CLAIM_WEBHOOK_SECRET
      ?.version !== claimConfiguration.claimSecretVersion ||
    releaseRecord.claimRuntime?.secretBindings?.PEECARE_PAIR_CODE_HMAC_KEY
      ?.secret !== 'peecare-pair-code-hmac-key' ||
    releaseRecord.claimRuntime?.secretBindings?.PEECARE_PAIR_CODE_HMAC_KEY
      ?.version !== claimConfiguration.hmacSecretVersion ||
    typeof releaseRecord.smoke !== 'object' ||
    releaseRecord.smoke === null ||
    SMOKE_CHECKS.some(([name]) => releaseRecord.smoke[name] !== 'passed')
  ) {
    throw new MemberVerificationError(
      'unverified_release',
      'Web build requires a matching healthy Member API release record.',
    )
  }
  return validateServiceOrigin(releaseRecord.verifiedOrigin, releaseRecord.service)
}

export function runVerifiedMemberWebBuildPreflight({
  environment,
  args,
  releaseRecord,
  execute,
  write,
}) {
  if (hasUnsupportedSensitiveOperatorEnvironment(environment)) {
    throw new MemberVerificationError(
      'unverified_release',
      'Web build rejects unsupported PeeCare or EMQX runtime configuration.',
    )
  }
  const mode = args.length === 1 ? args[0] : undefined
  if (mode !== '--dry-run' && mode !== '--apply') {
    throw new MemberVerificationError(
      'explicit_mode_required',
      'Web build preflight requires exactly one of --dry-run or --apply.',
    )
  }
  const verifiedOrigin = validateHealthyRelease(environment, releaseRecord)
  const plan = Object.freeze({
    status: mode === '--dry-run' ? 'ready' : 'built',
    ...(mode === '--dry-run' ? { dryRun: true } : {}),
    projectId: releaseRecord.projectId,
    service: releaseRecord.service,
    revision: releaseRecord.revision,
    buildEnvironment: Object.freeze({ VITE_MEMBER_API_URL: verifiedOrigin }),
  })

  if (mode === '--apply') {
    const result = execute(
      'npm',
      ['run', 'build'],
      Object.freeze({ VITE_MEMBER_API_URL: verifiedOrigin }),
    )
    if (result.status !== 0) {
      throw new MemberVerificationError(
        'web_build_failed',
        'Web build failed after verified Member API origin preflight.',
      )
    }
  }
  write(JSON.stringify(plan))
  return plan
}

export function executeVerifiedWebBuild(command, args, environment) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
}

function executeGcloud(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new MemberVerificationError(
      'cloud_inspection_failed',
      'gcloud could not inspect the development Member API deployment.',
    )
  }
  return result.stdout.trim()
}

async function signInWithPassword(projectId, webApiKey, email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )
  if (!response.ok) {
    throw new MemberVerificationError(
      'smoke_auth_failed',
      `Firebase Auth smoke sign-in failed for ${projectId}.`,
    )
  }
  const body = await response.json()
  if (typeof body.idToken !== 'string' || body.idToken.length === 0) {
    throw new MemberVerificationError(
      'smoke_auth_failed',
      'Firebase Auth smoke sign-in returned no ID token.',
    )
  }
  return body.idToken
}

function tokenAuthTime(idToken) {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'),
    )
    return typeof payload.auth_time === 'number' ? payload.auth_time : undefined
  } catch {
    return undefined
  }
}

async function createCliSmokeTokens(projectId, webApiKey) {
  const { applicationDefault, getApps, initializeApp } = await import(
    'firebase-admin/app'
  )
  const { getAuth } = await import('firebase-admin/auth')
  const appName = `peecare-member-smoke-${projectId}`
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp(
      { credential: applicationDefault(), projectId },
      appName,
    )
  const auth = getAuth(app)
  const ownerUid = `${projectId}-development-owner-v1`
  const nonOwnerUid = `${projectId}-development-non-owner-v1`
  const ownerPassword = `${randomBytes(32).toString('base64url')}Aa1!`
  const nonOwnerPassword = `${randomBytes(32).toString('base64url')}Aa1!`
  const [owner, nonOwner] = await Promise.all([
    auth.updateUser(ownerUid, { password: ownerPassword }),
    auth.updateUser(nonOwnerUid, { password: nonOwnerPassword }),
  ])
  const [ownerToken, revokedToken] = await Promise.all([
    signInWithPassword(projectId, webApiKey, owner.email, ownerPassword),
    signInWithPassword(projectId, webApiKey, nonOwner.email, nonOwnerPassword),
  ])
  const authTime = tokenAuthTime(revokedToken)
  if (authTime === undefined) {
    throw new MemberVerificationError(
      'smoke_auth_failed',
      'Firebase Auth smoke token has no auth_time.',
    )
  }
  const waitMs = Math.max(0, (authTime + 1) * 1000 - Date.now() + 100)
  if (waitMs > 0) {
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs))
  }
  await auth.revokeRefreshTokens(nonOwnerUid)
  const nonOwnerToken = await signInWithPassword(
    projectId,
    webApiKey,
    nonOwner.email,
    nonOwnerPassword,
  )
  return Object.freeze({ ownerToken, nonOwnerToken, revokedToken })
}

export async function createCliVerificationAdapter(environment = process.env) {
  const projectId = requireSmokeValue(
    environment,
    'PEECARE_DEVELOPMENT_PROJECT_ID',
  )
  const webApiKey = requireSmokeValue(
    environment,
    'PEECARE_DEVELOPMENT_WEB_API_KEY',
  )
  let claimConfiguration
  try {
    claimConfiguration = resolveMemberClaimConfiguration(environment)
  } catch {
    throw new MemberVerificationError(
      'claim_configuration_invalid',
      'Verification requires approved independent numeric Claim secret bindings.',
    )
  }
  const manifest = loadMemberManifest()
  const claimWebhookSecret = executeGcloud([
    'secrets',
    'versions',
    'access',
    claimConfiguration.claimSecretVersion,
    '--secret',
    manifest.runtimeEnvironment.secretBindings.PEECARE_CLAIM_WEBHOOK_SECRET
      .secret,
    '--project',
    projectId,
  ])
  if (claimWebhookSecret.length === 0) {
    throw new MemberVerificationError(
      'smoke_config_invalid',
      'Claim webhook secret version could not be loaded for smoke verification.',
    )
  }
  const tokens = await createCliSmokeTokens(projectId, webApiKey)
  const { Firestore } = await import('@google-cloud/firestore')
  const firestore = new Firestore({ projectId })
  const inspectRevision = createCliRevisionInspector(executeGcloud)

  return createMemberSmokeAdapter({
    environment: {
      ...environment,
      PEECARE_MEMBER_SMOKE_DEVICE_ID:
        environment.PEECARE_MEMBER_SMOKE_DEVICE_ID ?? 'PC-DEV-0001',
      PEECARE_MEMBER_OWNER_ID_TOKEN: tokens.ownerToken,
      PEECARE_MEMBER_NON_OWNER_ID_TOKEN: tokens.nonOwnerToken,
      PEECARE_MEMBER_REVOKED_ID_TOKEN: tokens.revokedToken,
    },
    inspectRevision,
    claimWebhookSecret,
    async request({ url, method, headers, body }) {
      const response = await fetch(url, {
        method,
        ...(headers ? { headers } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return {
        status: response.status,
        body: await response.json().catch(() => null),
        headers: Object.fromEntries(response.headers.entries()),
      }
    },
    async readDevice({ projectId: requestedProject, deviceId }) {
      if (requestedProject !== projectId) {
        throw new MemberVerificationError(
          'target_mismatch',
          'Firestore smoke read attempted a different project.',
        )
      }
      const snapshot = await firestore.doc(`devices/${deviceId}`).get()
      return {
        projectId: requestedProject,
        deviceId,
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null,
        updateTime: snapshot.updateTime?.toDate().toISOString() ?? null,
      }
    },
    async readClaimState({
      projectId: requestedProject,
      deviceId,
      requestedSessionId,
    }) {
      if (requestedProject !== projectId) {
        throw new MemberVerificationError(
          'target_mismatch',
          'Firestore Claim smoke read attempted a different project.',
        )
      }
      const deviceReference = firestore.doc(`devices/${deviceId}`)
      const activeReference = firestore.doc(`activeDeviceClaims/${deviceId}`)
      const references = [deviceReference, activeReference]
      if (requestedSessionId !== undefined) {
        references.push(
          firestore.doc(`deviceClaimSessions/${requestedSessionId}`),
        )
      }
      const snapshots = await firestore.getAll(...references)
      const snapshotRecord = (snapshot) => ({
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null,
        updateTime: snapshot.updateTime?.toDate().toISOString() ?? null,
      })
      return {
        projectId: requestedProject,
        deviceId,
        device: snapshotRecord(snapshots[0]),
        activeClaim: snapshotRecord(snapshots[1]),
        session:
          requestedSessionId === undefined
            ? { exists: false, data: null, updateTime: null }
            : snapshotRecord(snapshots[2]),
      }
    },
  })
}

function validateCliSmokeConfiguration(environment) {
  requireSmokeValue(environment, 'PEECARE_DEVELOPMENT_PROJECT_ID')
  requireSmokeValue(environment, 'PEECARE_DEVELOPMENT_WEB_ORIGIN')
  requireSmokeValue(environment, 'PEECARE_DEVELOPMENT_WEB_API_KEY')
  const memberDeviceId =
    environment.PEECARE_MEMBER_SMOKE_DEVICE_ID ?? 'PC-DEV-0001'
  const claimDeviceId = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_CLAIM_SMOKE_DEVICE_ID',
  )
  const claimClientId = requireSmokeValue(
    environment,
    'PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID',
  )
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(memberDeviceId) ||
    !/^[0-9A-F]{12}$/.test(claimDeviceId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(claimClientId)
  ) {
    throw new MemberVerificationError(
      'smoke_config_invalid',
      'Member API smoke fixture configuration is invalid.',
    )
  }
}

export async function runMemberVerificationWithAdapterFactory({
  environment,
  args,
  manifest,
  adapterFactory,
  priorRelease,
  write,
}) {
  preflightMemberVerification({ environment, args, manifest })
  validateCliSmokeConfiguration(environment)
  const adapter = await adapterFactory()
  return runMemberVerification({
    environment,
    args,
    manifest,
    adapter,
    priorRelease,
    write,
  })
}

async function runCli() {
  try {
    const manifest = loadMemberManifest()
    if (hasUnsupportedSensitiveOperatorEnvironment(process.env)) {
      throw new MemberVerificationError(
        'claim_configuration_invalid',
        'Member CLI rejects unsupported PeeCare or EMQX runtime configuration.',
      )
    }
    const inspectRevision = createCliRevisionInspector(executeGcloud)
    if (
      process.argv[2] === '--web-build-dry-run' ||
      process.argv[2] === '--web-build-apply'
    ) {
      const recordPath = process.env.PEECARE_MEMBER_RELEASE_RECORD
      if (typeof recordPath !== 'string' || recordPath.trim().length === 0) {
        throw new MemberVerificationError(
          'unverified_release',
          'PEECARE_MEMBER_RELEASE_RECORD is required for a verified Web build.',
        )
      }
      runVerifiedMemberWebBuildPreflight({
        environment: process.env,
        args: [
          process.argv[2] === '--web-build-dry-run' ? '--dry-run' : '--apply',
        ],
        releaseRecord: JSON.parse(
          readFileSync(resolve(recordPath), 'utf8'),
        ),
        execute: executeVerifiedWebBuild,
        write: (line) => process.stdout.write(`${line}\n`),
      })
      return
    }
    if (process.argv[2] === '--rollback-dry-run') {
      const recordPath = process.env.PEECARE_MEMBER_RELEASE_RECORD
      if (typeof recordPath !== 'string' || recordPath.trim().length === 0) {
        throw new MemberVerificationError(
          'rollback_target_invalid',
          'PEECARE_MEMBER_RELEASE_RECORD is required for rollback dry-run.',
        )
      }
      await runMemberRollback({
        args: ['--rollback-dry-run'],
        manifest,
        releaseRecord: JSON.parse(readFileSync(resolve(recordPath), 'utf8')),
        inspectRevision,
        executeTrafficMutation: () => {
          throw new MemberVerificationError(
            'rollback_target_invalid',
            'Rollback dry-run must not execute a traffic mutation.',
          )
        },
        write: (line) => process.stdout.write(`${line}\n`),
      })
      return
    }

    const priorRecordPath = process.env.PEECARE_MEMBER_PRIOR_RELEASE_RECORD
    const priorRelease =
      typeof priorRecordPath === 'string' && priorRecordPath.trim().length > 0
        ? JSON.parse(readFileSync(resolve(priorRecordPath), 'utf8'))
        : undefined
    await runMemberVerificationWithAdapterFactory({
      environment: process.env,
      args: process.argv.slice(2),
      manifest,
      adapterFactory: () => createCliVerificationAdapter(process.env),
      priorRelease,
      write: (line) => process.stdout.write(`${line}\n`),
    })
  } catch (error) {
    const code =
      error instanceof MemberVerificationError
        ? error.code
        : 'member_verification_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
