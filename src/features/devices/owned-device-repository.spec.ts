import { beforeEach, describe, expect, it, vi } from 'vitest'

// The repository is exercised without the Emulator by mocking the Firestore
// modular API. The assertions pin the *shape* of the query (always constrained
// by ownerUid) and the fail-closed handling of an empty caller UID.
const collection = vi.fn()
const query = vi.fn()
const where = vi.fn()
const getDocs = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collection(...args),
  query: (...args: unknown[]) => query(...args),
  where: (...args: unknown[]) => where(...args),
  getDocs: (...args: unknown[]) => getDocs(...args),
}))

import {
  listOwnedDevices,
  ownedDeviceDailyStatsRef,
  ownedDeviceEventsRef,
} from './owned-device-repository'

const firestore = { __firestore: true } as never

function deviceDoc(id: string, ownerUid: string) {
  return {
    id,
    data: () => ({
      deviceId: id,
      ownerUid,
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
    }),
  }
}

beforeEach(() => {
  collection.mockReset()
  query.mockReset()
  where.mockReset()
  getDocs.mockReset()
  collection.mockImplementation((_db, ...path: string[]) => ({ __collection: path.join('/') }))
  where.mockImplementation((field, op, value) => ({ __where: [field, op, value] }))
  query.mockImplementation((coll, ...constraints) => ({ __query: coll, constraints }))
})

describe('listOwnedDevices', () => {
  it('constrains the device query to ownerUid == authenticatedUid', async () => {
    getDocs.mockResolvedValue({ docs: [] })

    await listOwnedDevices(firestore, 'member-001')

    expect(collection).toHaveBeenCalledWith(firestore, 'devices')
    expect(where).toHaveBeenCalledWith('ownerUid', '==', 'member-001')
    // The query must be built from that single equality constraint, never an
    // unconstrained collection scan.
    expect(query).toHaveBeenCalledTimes(1)
    const [, ...constraints] = query.mock.calls[0]
    expect(constraints).toEqual([{ __where: ['ownerUid', '==', 'member-001'] }])
  })

  // Spec example: member-001 owns devices A and B, member-002 owns device C. The
  // constrained query returns only A and B; the repository parses them.
  it("returns only the member's own devices", async () => {
    getDocs.mockResolvedValue({
      docs: [deviceDoc('PC-000001', 'member-001'), deviceDoc('PC-000002', 'member-001')],
    })

    const devices = await listOwnedDevices(firestore, 'member-001')

    expect(devices).toEqual([
      { deviceId: 'PC-000001', ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' },
      { deviceId: 'PC-000002', ownerUid: 'member-001', productModel: 'pc-mini', ingestionStatus: 'enabled' },
    ])
  })

  it('drops any document whose ownership does not match the caller', async () => {
    // Defense in depth: even if a foreign or empty-owner doc leaks past the
    // query, the parser withholds it.
    getDocs.mockResolvedValue({
      docs: [deviceDoc('PC-000001', 'member-001'), deviceDoc('PC-000003', 'member-002')],
    })

    const devices = await listOwnedDevices(firestore, 'member-001')

    expect(devices.map((device) => device.deviceId)).toEqual(['PC-000001'])
  })

  it('refuses an empty caller UID without ever touching Firestore', async () => {
    await expect(listOwnedDevices(firestore, '')).rejects.toThrow()
    expect(getDocs).not.toHaveBeenCalled()
    expect(where).not.toHaveBeenCalled()
  })
})

describe('owned device child collection references', () => {
  it('builds the events subcollection path under the device', () => {
    ownedDeviceEventsRef(firestore, 'PC-000001')
    expect(collection).toHaveBeenCalledWith(firestore, 'devices', 'PC-000001', 'events')
  })

  it('builds the dailyStats subcollection path under the device', () => {
    ownedDeviceDailyStatsRef(firestore, 'PC-000001')
    expect(collection).toHaveBeenCalledWith(firestore, 'devices', 'PC-000001', 'dailyStats')
  })
})
