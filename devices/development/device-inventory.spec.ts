import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DeviceConfigurationError,
  validateDeviceConfiguration,
  validateDeviceInventory,
} from './device-configuration.mjs'

const developmentDirectory = resolve(process.cwd(), 'devices/development')

const validInventory = {
  schemaVersion: 1,
  devices: [
    {
      hardwareLabel: 'PeeCare development unit 1',
      deviceId: 'PC-000001',
      productModel: 'pc-mini',
      mqttPrincipal: 'device-PC-000001',
      firestore: {
        projectId: 'petcare-c7483',
        documentPath: 'devices/PC-000001',
        ingestionStatus: 'enabled',
      },
    },
  ],
}

const validFirmware = {
  schemaVersion: 1,
  deviceId: 'PC-000001',
  productModel: 'pc-mini',
  clientId: 'PC-000001',
  username: 'device-PC-000001',
  topics: {
    urination: 'products/pc-mini/devices/PC-000001/events/urination',
    battery: 'products/pc-mini/devices/PC-000001/status/battery',
  },
  payloadIdentity: {
    deviceId: 'PC-000001',
    productModel: 'pc-mini',
  },
}

describe('development device inventory', () => {
  it('maps the physical label to the canonical device, principal, and registry document', () => {
    expect(validateDeviceInventory(validInventory)).toEqual(validInventory.devices)
  })

  it('returns duplicate_device_id before mutation for duplicate PC-000001 entries', () => {
    const duplicateInventory = {
      ...validInventory,
      devices: [validInventory.devices[0], { ...validInventory.devices[0], hardwareLabel: 'second unit' }],
    }
    let mutations = 0

    expect(() => {
      validateDeviceInventory(duplicateInventory)
      mutations += 1
    }).toThrowError(expect.objectContaining({ code: 'duplicate_device_id' }))
    expect(mutations).toBe(0)
  })

  it.each([
    ['password', 'correct-horse-battery-staple'],
    ['apiToken', 'token-value'],
    ['notes', '-----BEGIN PRIVATE KEY-----'],
  ])('rejects secret-like inventory data in %s', (key, value) => {
    const inventory = structuredClone(validInventory)
    Object.assign(inventory.devices[0], { [key]: value })

    expect(() => validateDeviceInventory(inventory)).toThrowError(
      expect.objectContaining({ code: 'secret_like_inventory_value' }),
    )
  })

  it('rejects a principal that is not device-{deviceId}', () => {
    const inventory = structuredClone(validInventory)
    inventory.devices[0].mqttPrincipal = 'device-PC-000002'

    expect(() => validateDeviceInventory(inventory)).toThrowError(
      expect.objectContaining({ code: 'principal_identity_mismatch' }),
    )
  })

  it('returns device_identity_mismatch before handoff for the specified client/topic mismatch', () => {
    const firmware = structuredClone(validFirmware)
    firmware.topics.urination = 'products/pc-mini/devices/PC-000002/events/urination'

    expect(() => validateDeviceConfiguration(validInventory, firmware)).toThrowError(
      expect.objectContaining({ code: 'device_identity_mismatch' }),
    )
  })

  it('keeps the checked-in inventory free of credential-shaped keys and values', async () => {
    const inventory = JSON.parse(await readFile(`${developmentDirectory}/device-inventory.json`, 'utf8'))

    expect(() => validateDeviceInventory(inventory)).not.toThrow()
    expect(JSON.stringify(inventory)).not.toMatch(
      /(?:password|api[_-]?key|api[_-]?secret|token|credential|BEGIN (?:RSA )?PRIVATE KEY)/i,
    )
  })

  it('uses typed configuration failures', () => {
    try {
      validateDeviceInventory({ schemaVersion: 1, devices: [] })
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceConfigurationError)
      expect(error).toMatchObject({ code: 'empty_device_inventory' })
    }
  })
})
