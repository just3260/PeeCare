import { pathToFileURL } from 'node:url'

import { DevelopmentInventoryError, parseDevelopmentInventory } from './environment.mjs'

const DEVICE_ID = 'PC-DEV-0001'
const DEVICE_INGESTION_FIXTURE = Object.freeze({
  deviceId: DEVICE_ID,
  productModel: 'pc-mini',
  ingestionStatus: 'enabled',
  latestUrinationAtMs: 1_786_358_400_000,
  latestUrinationReceivedAtMs: 1_786_358_400_100,
  latestUrinationEventId: 'development-urination-1',
  latestUrinationEstimatedUrineMl: 21,
  latestUrinationEstimationStatus: 'estimated',
  latestBatteryAtMs: 1_786_358_500_000,
  latestBatteryReceivedAtMs: 1_786_358_500_100,
  latestBatteryEventId: 'development-battery-1',
  latestBatteryLevelPercent: 87,
  latestBatteryVoltageMv: 4_020,
  lastReportedAtMs: 1_786_358_500_100,
})

export class DevelopmentSeedError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DevelopmentSeedError'
    this.code = code
  }
}

export function developmentSeedIdentity(projectId) {
  return Object.freeze({
    marker: `${projectId}-development-smoke-v1`,
    ownerUid: `${projectId}-development-owner-v1`,
    nonOwnerUid: `${projectId}-development-non-owner-v1`,
    deviceId: DEVICE_ID,
  })
}

export function mergeDevelopmentOwner(existing, { ownerUid, marker }) {
  if (typeof ownerUid !== 'string' || ownerUid.trim().length === 0) {
    throw new DevelopmentSeedError('invalid_seed_identity', 'Seed owner UID is required.')
  }
  if (typeof marker !== 'string' || marker.trim().length === 0) {
    throw new DevelopmentSeedError('invalid_seed_identity', 'Seed marker is required.')
  }
  return { ...existing, ownerUid, developmentSeedMarker: marker }
}

function paths(identity) {
  return {
    device: `devices/${identity.deviceId}`,
    manifest: `developmentSeeds/${identity.marker}`,
  }
}

function markedUser(uid, role, marker, projectId) {
  return Object.freeze({
    uid,
    email: `${role}@${projectId}.invalid`,
    emailVerified: true,
    disabled: false,
    developmentSeedMarker: marker,
    developmentSeedRole: role,
  })
}

function assertMarker(resource, marker, label) {
  if (resource !== null && resource.developmentSeedMarker !== marker) {
    throw new DevelopmentSeedError(
      'seed_marker_conflict',
      `Refusing to modify ${label} because it is not owned by the development seed marker.`,
    )
  }
}

function seedSummary(status, inventory, identity) {
  return Object.freeze({
    status,
    projectId: inventory.projectId,
    marker: identity.marker,
    ownerUid: identity.ownerUid,
    nonOwnerUid: identity.nonOwnerUid,
    deviceId: identity.deviceId,
    authUsers: 2,
    documents: 2,
  })
}

export async function createDevelopmentSeed({ environment, adapter }) {
  const inventory = parseDevelopmentInventory(environment)
  const identity = developmentSeedIdentity(inventory.projectId)
  const seedPaths = paths(identity)
  const [device, manifest, owner, nonOwner] = await Promise.all([
    adapter.readDocument(seedPaths.device),
    adapter.readDocument(seedPaths.manifest),
    adapter.readUser(identity.ownerUid),
    adapter.readUser(identity.nonOwnerUid),
  ])

  assertMarker(device, identity.marker, seedPaths.device)
  assertMarker(manifest, identity.marker, seedPaths.manifest)
  assertMarker(owner, identity.marker, identity.ownerUid)
  assertMarker(nonOwner, identity.marker, identity.nonOwnerUid)

  await adapter.upsertMarkedUser(
    markedUser(identity.ownerUid, 'owner', identity.marker, inventory.projectId),
  )
  await adapter.upsertMarkedUser(
    markedUser(identity.nonOwnerUid, 'non-owner', identity.marker, inventory.projectId),
  )
  if (device === null) {
    await adapter.writeDocument(
      seedPaths.device,
      { ...DEVICE_INGESTION_FIXTURE, developmentSeedMarker: identity.marker },
      { merge: false },
    )
  }
  await adapter.writeDocument(
    seedPaths.device,
    mergeDevelopmentOwner(device ?? DEVICE_INGESTION_FIXTURE, {
      ownerUid: identity.ownerUid,
      marker: identity.marker,
    }),
    { merge: true },
  )
  await adapter.writeDocument(
    seedPaths.manifest,
    {
      developmentSeedMarker: identity.marker,
      deviceId: identity.deviceId,
      ownerUid: identity.ownerUid,
      nonOwnerUid: identity.nonOwnerUid,
    },
    { merge: false },
  )

  return seedSummary('seeded', inventory, identity)
}

export async function verifyDevelopmentSeed({ environment, adapter }) {
  const inventory = parseDevelopmentInventory(environment)
  const identity = developmentSeedIdentity(inventory.projectId)
  const seedPaths = paths(identity)
  const [device, manifest, owner, nonOwner] = await Promise.all([
    adapter.readDocument(seedPaths.device),
    adapter.readDocument(seedPaths.manifest),
    adapter.readUser(identity.ownerUid),
    adapter.readUser(identity.nonOwnerUid),
  ])

  for (const [resource, label] of [
    [device, seedPaths.device],
    [manifest, seedPaths.manifest],
    [owner, identity.ownerUid],
    [nonOwner, identity.nonOwnerUid],
  ]) {
    if (resource === null || resource.developmentSeedMarker !== identity.marker) {
      throw new DevelopmentSeedError('seed_verification_failed', `Missing marked seed ${label}.`)
    }
  }
  if (device.ownerUid !== identity.ownerUid || device.deviceId !== identity.deviceId) {
    throw new DevelopmentSeedError(
      'seed_verification_failed',
      'Seeded device ownership or identity does not match the approved fixture.',
    )
  }

  return seedSummary('verified', inventory, identity)
}

export async function cleanupDevelopmentSeed({ environment, adapter }) {
  const inventory = parseDevelopmentInventory(environment)
  const identity = developmentSeedIdentity(inventory.projectId)
  const seedPaths = paths(identity)
  const [deviceDeleted, manifestDeleted, ownerDeleted, nonOwnerDeleted] = await Promise.all([
    adapter.deleteDocumentIfMarked(seedPaths.device, identity.marker),
    adapter.deleteDocumentIfMarked(seedPaths.manifest, identity.marker),
    adapter.deleteUserIfMarked(identity.ownerUid, identity.marker),
    adapter.deleteUserIfMarked(identity.nonOwnerUid, identity.marker),
  ])

  return Object.freeze({
    status: 'cleaned',
    projectId: inventory.projectId,
    marker: identity.marker,
    authUsersDeleted: Number(ownerDeleted) + Number(nonOwnerDeleted),
    documentsDeleted: Number(deviceDeleted) + Number(manifestDeleted),
  })
}

async function runCli() {
  try {
    const mode = process.argv.slice(2)
    if (mode.length !== 1 || !['--apply', '--verify', '--cleanup'].includes(mode[0])) {
      throw new DevelopmentSeedError(
        'explicit_mode_required',
        'Development seed requires exactly one of --apply, --verify, or --cleanup.',
      )
    }
    const inventory = parseDevelopmentInventory(process.env)
    const { createFirebaseAdminSeedAdapter } = await import('./seed-admin-adapter.mjs')
    const adapter = await createFirebaseAdminSeedAdapter(inventory.projectId)
    const operation =
      mode[0] === '--apply'
        ? createDevelopmentSeed
        : mode[0] === '--verify'
          ? verifyDevelopmentSeed
          : cleanupDevelopmentSeed
    const summary = await operation({ environment: process.env, adapter })
    process.stdout.write(`${JSON.stringify(summary)}\n`)
  } catch (error) {
    const code =
      error instanceof DevelopmentSeedError || error instanceof DevelopmentInventoryError
        ? error.code
        : 'development_seed_failed'
    process.stderr.write(JSON.stringify({ status: 'error', code }) + '\n')
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
