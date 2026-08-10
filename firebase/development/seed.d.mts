export interface DevelopmentSeedUser {
  readonly uid: string
  readonly email: string
  readonly emailVerified: boolean
  readonly disabled: boolean
  readonly developmentSeedMarker: string
  readonly developmentSeedRole: 'owner' | 'non-owner'
}

export interface DevelopmentSeedAdapter {
  readDocument(path: string): Promise<Record<string, unknown> | null>
  writeDocument(
    path: string,
    data: Record<string, unknown>,
    options: { readonly merge: boolean },
  ): Promise<void>
  deleteDocumentIfMarked(path: string, marker: string): Promise<boolean>
  readUser(uid: string): Promise<DevelopmentSeedUser | null>
  upsertMarkedUser(user: DevelopmentSeedUser): Promise<void>
  deleteUserIfMarked(uid: string, marker: string): Promise<boolean>
}

export class DevelopmentSeedError extends Error {
  readonly code:
    | 'invalid_seed_identity'
    | 'seed_marker_conflict'
    | 'seed_verification_failed'
    | 'explicit_mode_required'
}

export interface DevelopmentSeedIdentity {
  readonly marker: string
  readonly ownerUid: string
  readonly nonOwnerUid: string
  readonly deviceId: string
}

export function developmentSeedIdentity(projectId: string): DevelopmentSeedIdentity
export function mergeDevelopmentOwner(
  existing: Record<string, unknown>,
  identity: { readonly ownerUid: string; readonly marker: string },
): Record<string, unknown>

export function createDevelopmentSeed(options: {
  environment: NodeJS.ProcessEnv
  adapter: DevelopmentSeedAdapter
}): Promise<Record<string, unknown>>

export function verifyDevelopmentSeed(options: {
  environment: NodeJS.ProcessEnv
  adapter: DevelopmentSeedAdapter
}): Promise<Record<string, unknown>>

export function cleanupDevelopmentSeed(options: {
  environment: NodeJS.ProcessEnv
  adapter: DevelopmentSeedAdapter
}): Promise<Record<string, unknown>>
