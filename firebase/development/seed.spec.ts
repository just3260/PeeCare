import { describe, expect, it } from 'vitest'

import {
  cleanupDevelopmentSeed,
  createDevelopmentSeed,
  developmentSeedIdentity,
  mergeDevelopmentOwner,
  verifyDevelopmentSeed,
  type DevelopmentSeedAdapter,
  type DevelopmentSeedUser,
} from './seed.mjs'

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PEECARE_DEVELOPMENT_PROJECT_ID: 'petcare-c7483',
    PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST: 'petcare-c7483',
    PEECARE_DEVELOPMENT_FIRESTORE_REGION: 'asia-east1',
    PEECARE_DEVELOPMENT_BILLING_OWNER: 'development-owner@example.com',
    PEECARE_DEVELOPMENT_AUTH_PROVIDER: 'password',
    PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION: 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION',
  }
}

class MemorySeedAdapter implements DevelopmentSeedAdapter {
  readonly documents = new Map<string, Record<string, unknown>>()
  readonly users = new Map<string, DevelopmentSeedUser>()

  async readDocument(path: string): Promise<Record<string, unknown> | null> {
    return structuredClone(this.documents.get(path) ?? null)
  }

  async writeDocument(
    path: string,
    data: Record<string, unknown>,
    options: { merge: boolean },
  ): Promise<void> {
    const existing = this.documents.get(path) ?? {}
    this.documents.set(path, structuredClone(options.merge ? { ...existing, ...data } : data))
  }

  async deleteDocumentIfMarked(path: string, marker: string): Promise<boolean> {
    if (this.documents.get(path)?.developmentSeedMarker !== marker) return false
    return this.documents.delete(path)
  }

  async readUser(uid: string): Promise<DevelopmentSeedUser | null> {
    return structuredClone(this.users.get(uid) ?? null)
  }

  async upsertMarkedUser(user: DevelopmentSeedUser): Promise<void> {
    this.users.set(user.uid, structuredClone(user))
  }

  async deleteUserIfMarked(uid: string, marker: string): Promise<boolean> {
    if (this.users.get(uid)?.developmentSeedMarker !== marker) return false
    return this.users.delete(uid)
  }
}

describe('disposable development seed', () => {
  it('creates, verifies, and cleans only deterministic marker-scoped data', async () => {
    const adapter = new MemorySeedAdapter()
    const identity = developmentSeedIdentity('petcare-c7483')
    const unmarked = { deviceId: 'PC-UNMARKED', ingestionStatus: 'enabled' }
    adapter.documents.set('devices/PC-UNMARKED', structuredClone(unmarked))

    const created = await createDevelopmentSeed({ environment: validEnvironment(), adapter })
    const verified = await verifyDevelopmentSeed({ environment: validEnvironment(), adapter })

    expect(created).toEqual({
      status: 'seeded',
      projectId: 'petcare-c7483',
      marker: identity.marker,
      ownerUid: identity.ownerUid,
      nonOwnerUid: identity.nonOwnerUid,
      deviceId: identity.deviceId,
      authUsers: 2,
      documents: 2,
    })
    expect(verified).toEqual({ ...created, status: 'verified' })
    expect(adapter.documents.get('devices/PC-UNMARKED')).toEqual(unmarked)

    const cleaned = await cleanupDevelopmentSeed({ environment: validEnvironment(), adapter })

    expect(cleaned).toEqual({
      status: 'cleaned',
      projectId: 'petcare-c7483',
      marker: identity.marker,
      authUsersDeleted: 2,
      documentsDeleted: 2,
    })
    expect(adapter.documents.get('devices/PC-UNMARKED')).toEqual(unmarked)
    expect(adapter.documents.has(`devices/${identity.deviceId}`)).toBe(false)
    expect(adapter.users.size).toBe(0)
  })

  it('preserves every ingestion and latest projection field when merging ownership', () => {
    const existing = {
      deviceId: 'PC-DEV-0001',
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
    }

    const merged = mergeDevelopmentOwner(existing, {
      ownerUid: 'peecare-development-owner-v1',
      marker: 'peecare-development-smoke-v1',
    })

    expect(merged).toEqual({
      ...existing,
      ownerUid: 'peecare-development-owner-v1',
      developmentSeedMarker: 'peecare-development-smoke-v1',
    })
    for (const [field, value] of Object.entries(existing)) {
      expect(merged[field]).toEqual(value)
    }
  })

  it('refuses to overwrite a deterministic seed path owned by another marker', async () => {
    const adapter = new MemorySeedAdapter()
    const identity = developmentSeedIdentity('petcare-c7483')
    const conflicting = {
      deviceId: identity.deviceId,
      developmentSeedMarker: 'someone-else',
      ingestionStatus: 'enabled',
    }
    adapter.documents.set(`devices/${identity.deviceId}`, structuredClone(conflicting))

    await expect(
      createDevelopmentSeed({ environment: validEnvironment(), adapter }),
    ).rejects.toMatchObject({ code: 'seed_marker_conflict' })
    expect(adapter.documents.get(`devices/${identity.deviceId}`)).toEqual(conflicting)
  })
})
