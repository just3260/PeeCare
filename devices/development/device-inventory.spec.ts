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
      deviceId: '68E274BD2A58',
      productModel: 'pc-mini',
      mqttPrincipal: 'device-68E274BD2A58',
      firestore: {
        projectId: 'petcare-c7483',
        documentPath: 'devices/68E274BD2A58',
        ingestionStatus: 'enabled',
      },
    },
  ],
}

const validFirmware = {
  schemaVersion: 1,
  deviceId: '68E274BD2A58',
  productModel: 'pc-mini',
  clientId: '68E274BD2A58',
  username: 'device-68E274BD2A58',
  topics: {
    urination: 'products/pc-mini/devices/68E274BD2A58/events/urination',
    battery: 'products/pc-mini/devices/68E274BD2A58/status/battery',
  },
  payloadIdentity: {
    deviceId: '68E274BD2A58',
    productModel: 'pc-mini',
  },
}

describe('development device inventory', () => {
  it('maps the physical label to the canonical device, principal, and registry document', () => {
    expect(validateDeviceInventory(validInventory)).toEqual(validInventory.devices)
  })

  it('returns duplicate_device_id before mutation for duplicate physical device entries', () => {
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

  it('accepts a twelve-digit uppercase ESP32 identifier while preserving leading zeroes', () => {
    const inventory = structuredClone(validInventory)
    inventory.devices[0].deviceId = '00E274BD2A58'
    inventory.devices[0].mqttPrincipal = 'device-00E274BD2A58'
    inventory.devices[0].firestore.documentPath = 'devices/00E274BD2A58'

    expect(validateDeviceInventory(inventory)).toEqual(inventory.devices)
  })

  it.each([
    '68e274bd2a58',
    '8E274BD2A58',
    '068E274BD2A58',
    '68:E2:74:BD:2A:58',
    '68E274-BD2A58',
    '68E274BD2A5 ',
    '68E274BD2A5G',
    '68E274BD2A5',
  ])('rejects malformed physical deviceId %s before handoff', (deviceId) => {
    const inventory = structuredClone(validInventory)
    inventory.devices[0].deviceId = deviceId
    inventory.devices[0].mqttPrincipal = `device-${deviceId}`
    inventory.devices[0].firestore.documentPath = `devices/${deviceId}`

    expect(() => validateDeviceInventory(inventory)).toThrowError(
      expect.objectContaining({ code: 'invalid_device_id' }),
    )
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

  it('keeps the inventory schema aligned with the physical ESP32 identifier boundary', async () => {
    const schema = JSON.parse(
      await readFile(`${developmentDirectory}/device-inventory.schema.json`, 'utf8'),
    )

    expect(schema.properties.devices.items.properties.deviceId.pattern).toBe('^[0-9A-F]{12}$')
    expect(schema.properties.devices.items.properties.mqttPrincipal.pattern).toBe(
      '^device-[0-9A-F]{12}$',
    )
    expect(schema.properties.devices.items.properties.firestore.properties.documentPath.pattern).toBe(
      '^devices/[0-9A-F]{12}$',
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
