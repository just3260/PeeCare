import { describe, expect, it } from 'vitest'

import { resolveDeviceDisplayName } from './device-display-name'
import type { OwnedDevice } from './owned-device-model'

function ownedDevice(customName: string | null): OwnedDevice {
  return {
    deviceId: 'PC-000001',
    ownerUid: 'member-001',
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
    customName,
  }
}

describe('resolveDeviceDisplayName', () => {
  it('returns the shared custom name when present', () => {
    expect(resolveDeviceDisplayName(ownedDevice('主浴室'))).toBe('主浴室')
  })

  it('falls back to the immutable device id when customName is absent', () => {
    expect(resolveDeviceDisplayName(ownedDevice(null))).toBe('PC-000001')
  })
})
