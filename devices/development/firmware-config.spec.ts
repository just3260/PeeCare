import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  FirmwareConfigurationError,
  validateFirmwareConfiguration,
  validateRetryAfterDisconnect,
} from './firmware-config.mjs'

const directory = resolve(process.cwd(), 'devices/development')

async function loadJson(relativePath: string) {
  return JSON.parse(await readFile(resolve(directory, relativePath), 'utf8'))
}

describe('firmware publish configuration', () => {
  it('accepts the checked-in canonical strict-TLS QoS 1 non-retained template', async () => {
    const inventory = await loadJson('device-inventory.json')
    const firmware = await loadJson('firmware-config.template.json')

    expect(validateFirmwareConfiguration(inventory, firmware)).toEqual(
      expect.objectContaining({
        deviceId: 'PC-000001',
        productModel: 'pc-mini',
        clientId: 'PC-000001',
        username: 'device-PC-000001',
      }),
    )
    expect(firmware.payloadIdentity).toEqual({ deviceId: 'PC-000001' })
    expect(firmware).not.toHaveProperty('password')
  })

  it.each([
    [1, false, 'valid'],
    [0, false, 'invalid_publish_policy'],
    [2, false, 'invalid_publish_policy'],
    [1, true, 'invalid_publish_policy'],
  ] as const)('enforces the agreed QoS %s retained %s policy table', async (qos, retained, expected) => {
    const inventory = await loadJson('device-inventory.json')
    const firmware = await loadJson('firmware-config.template.json')
    firmware.publishPolicy = { qos, retained }

    if (expected === 'valid') {
      expect(() => validateFirmwareConfiguration(inventory, firmware)).not.toThrow()
    } else {
      expect(() => validateFirmwareConfiguration(inventory, firmware)).toThrowError(
        expect.objectContaining({ code: expected }),
      )
    }
  })

  it.each([
    ['unsafe_firmware_tls', { protocol: 'mqtt', port: 8883, tls: { rejectUnauthorized: true } }],
    ['unsafe_firmware_tls', { protocol: 'mqtts', port: 1883, tls: { rejectUnauthorized: true } }],
    ['unsafe_firmware_tls', { protocol: 'mqtts', port: 8883, tls: { rejectUnauthorized: false } }],
  ])('rejects TLS bypass configuration with %s', async (code, brokerPatch) => {
    const inventory = await loadJson('device-inventory.json')
    const firmware = await loadJson('firmware-config.template.json')
    firmware.broker = { ...firmware.broker, ...brokerPatch }

    expect(() => validateFirmwareConfiguration(inventory, firmware)).toThrowError(
      expect.objectContaining({ code }),
    )
  })

  it('rejects security switches even if strict TLS fields also remain present', async () => {
    const inventory = await loadJson('device-inventory.json')
    const firmware = await loadJson('firmware-config.template.json')
    firmware.broker.allowInsecureTls = false

    expect(() => validateFirmwareConfiguration(inventory, firmware)).toThrowError(
      expect.objectContaining({ code: 'unsafe_firmware_tls' }),
    )
  })

  it.each([
    ['password', 'sentinel-device-password', 'secret_like_firmware_value'],
    ['allowTlsBypass', false, 'unexpected_firmware_configuration'],
  ])('rejects extra security-sensitive root field %s', async (key, value, code) => {
    const inventory = await loadJson('device-inventory.json')
    const firmware = await loadJson('firmware-config.template.json')
    firmware[key] = value

    expect(() => validateFirmwareConfiguration(inventory, firmware)).toThrowError(
      expect.objectContaining({ code }),
    )
  })

  it('uses typed firmware configuration failures', async () => {
    const inventory = await loadJson('device-inventory.json')
    const firmware = await loadJson('firmware-config.template.json')
    firmware.publishPolicy.qos = 0

    expect(() => validateFirmwareConfiguration(inventory, firmware)).toThrow(
      FirmwareConfigurationError,
    )
  })
})

describe('retry after disconnect fixture', () => {
  it('preserves the canonical Topic and every canonical payload field for evt-000001', async () => {
    const fixture = await loadJson('fixtures/retry-after-disconnect.json')

    expect(validateRetryAfterDisconnect(fixture)).toEqual({ ok: true })
    expect(fixture.original.topic).toBe(
      'products/pc-mini/devices/PC-000001/events/urination',
    )
    expect(fixture.retry.topic).toBe(fixture.original.topic)
    expect(fixture.retry.payload).toEqual(fixture.original.payload)
    expect(fixture.retry.payload).toEqual({
      schemaVersion: 1,
      eventId: 'evt-000001',
      eventType: 'urination',
      deviceId: 'PC-000001',
      sequence: 42,
      recordedAtMs: 1785168000000,
      firmwareVersion: '1.2.0',
      flushDurationMs: 3000,
      pumpDurationMs: 5000,
    })
    expect(fixture.retry.payload).not.toHaveProperty('productModel')
  })

  it.each(['eventId', 'sequence', 'recordedAtMs', 'firmwareVersion', 'pumpDurationMs'])(
    'rejects a retry that mutates %s',
    async (field) => {
      const fixture = await loadJson('fixtures/retry-after-disconnect.json')
      fixture.retry.payload[field] =
        typeof fixture.retry.payload[field] === 'number'
          ? fixture.retry.payload[field] + 1
          : `${fixture.retry.payload[field]}-changed`

      expect(() => validateRetryAfterDisconnect(fixture)).toThrowError(
        expect.objectContaining({ code: 'retry_mismatch' }),
      )
    },
  )

  it('keeps MQTT packages out of the Web dependency graph', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]

    expect(dependencyNames).not.toContain('mqtt')
    expect(dependencyNames).not.toContain('mqtt.js')
  })
})
