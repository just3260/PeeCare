import { describe, expect, it, vi } from 'vitest'

import { provisionDevice } from './provision-device.mjs'
import {
  RegistryAlignmentError,
  createFirestoreRegistryReader,
  runDevicePreflight,
  validateRegistryAlignment,
} from './registry-alignment.mjs'

const inventory = {
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

const firmware = {
  schemaVersion: 1,
  deviceId: '68E274BD2A58',
  productModel: 'pc-mini',
  clientId: '68E274BD2A58',
  username: 'device-68E274BD2A58',
  topics: {
    urination: 'products/pc-mini/devices/68E274BD2A58/events/urination',
    battery: 'products/pc-mini/devices/68E274BD2A58/status/battery',
  },
  payloadIdentity: { deviceId: '68E274BD2A58', productModel: 'pc-mini' },
}

const enabledRegistryDocument = {
  exists: true,
  id: '68E274BD2A58',
  data: {
    deviceId: '68E274BD2A58',
    productModel: 'pc-mini',
    ingestionStatus: 'enabled',
  },
}

function emqxAdapter() {
  return {
    readAuthenticator: vi.fn().mockResolvedValue({
      mechanism: 'password_based',
      backend: 'built_in_database',
      enable: true,
      user_id_type: 'username',
    }),
    readAuthorizationSource: vi.fn().mockResolvedValue({
      type: 'built_in_database',
      enable: true,
    }),
    createCredential: vi.fn().mockResolvedValue(undefined),
    replaceCredential: vi.fn().mockResolvedValue(undefined),
    putAcl: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
  }
}

describe('registry alignment', () => {
  it('accepts the approved enabled petcare-c7483/devices/68E274BD2A58 document', () => {
    expect(validateRegistryAlignment(inventory.devices[0], enabledRegistryDocument)).toEqual(
      enabledRegistryDocument.data,
    )
  })

  it.each([
    ['registry_device_not_found', { ...enabledRegistryDocument, exists: false }],
    ['registry_document_id_mismatch', { ...enabledRegistryDocument, id: 'PC-000002' }],
    [
      'registry_device_id_mismatch',
      { ...enabledRegistryDocument, data: { ...enabledRegistryDocument.data, deviceId: 'PC-000002' } },
    ],
    [
      'registry_product_model_mismatch',
      { ...enabledRegistryDocument, data: { ...enabledRegistryDocument.data, productModel: 'pc-max' } },
    ],
    [
      'registry_device_disabled',
      { ...enabledRegistryDocument, data: { ...enabledRegistryDocument.data, ingestionStatus: 'disabled' } },
    ],
  ])('returns typed failure %s', (code, document) => {
    expect(() => validateRegistryAlignment(inventory.devices[0], document)).toThrowError(
      expect.objectContaining({ code }),
    )
  })

  it('uses Application Default Credentials for one exact read-only document lookup', async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      id: '68E274BD2A58',
      data: () => enabledRegistryDocument.data,
    })
    const doc = vi.fn(() => ({ get }))
    const Firestore = vi.fn(function Firestore() {
      return { doc }
    })
    const reader = createFirestoreRegistryReader({ Firestore })

    await expect(
      reader.readDevice({ projectId: 'petcare-c7483', documentPath: 'devices/68E274BD2A58' }),
    ).resolves.toEqual(enabledRegistryDocument)
    expect(Firestore).toHaveBeenCalledWith({ projectId: 'petcare-c7483' })
    expect(doc).toHaveBeenCalledWith('devices/68E274BD2A58')
    expect(get).toHaveBeenCalledOnce()
  })

  it('performs zero EMQX writes for the specified disabled 68E274BD2A58 example', async () => {
    const emqx = emqxAdapter()
    const registryReader = {
      readDevice: vi.fn().mockResolvedValue({
        ...enabledRegistryDocument,
        data: { ...enabledRegistryDocument.data, ingestionStatus: 'disabled' },
      }),
    }
    const preflight = () => runDevicePreflight({ inventory, firmware, registryReader, emqx })

    await expect(
      provisionDevice({
        mode: 'apply',
        secretOutputTty: true,
        device: inventory.devices[0],
        runtime: {
          managementUrl: 'https://emqx.development.example',
          mqttUrl: 'mqtts://mqtt.development.example:8883',
        },
        dependencies: {
          emqx,
          preflight,
          openSecretTty: vi.fn(),
          randomBytes: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({ code: 'registry_device_disabled' })
    expect(emqx.createCredential).not.toHaveBeenCalled()
    expect(emqx.replaceCredential).not.toHaveBeenCalled()
    expect(emqx.putAcl).not.toHaveBeenCalled()
    expect(emqx.deleteCredential).not.toHaveBeenCalled()
  })

  it('fails before EMQX writes when firmware and inventory identity differ', async () => {
    const emqx = emqxAdapter()
    const mismatchedFirmware = structuredClone(firmware)
    mismatchedFirmware.username = 'device-PC-000002'

    await expect(
      runDevicePreflight({
        inventory,
        firmware: mismatchedFirmware,
        registryReader: { readDevice: vi.fn() },
        emqx,
      }),
    ).rejects.toMatchObject({ code: 'device_identity_mismatch' })
    expect(emqx.createCredential).not.toHaveBeenCalled()
    expect(emqx.putAcl).not.toHaveBeenCalled()
  })

  it.each([
    ['authenticator_disabled', { enable: false }, undefined],
    ['authenticator_identity_mismatch', { user_id_type: 'clientid' }, undefined],
    ['authorizer_disabled', undefined, { enable: false }],
  ])('fails closed with %s and does not mutate', async (code, authenticatorPatch, authorizerPatch) => {
    const emqx = emqxAdapter()
    if (authenticatorPatch) {
      emqx.readAuthenticator.mockResolvedValue({
        mechanism: 'password_based',
        backend: 'built_in_database',
        enable: true,
        user_id_type: 'username',
        ...authenticatorPatch,
      })
    }
    if (authorizerPatch) {
      emqx.readAuthorizationSource.mockResolvedValue({
        type: 'built_in_database',
        enable: true,
        ...authorizerPatch,
      })
    }

    await expect(
      runDevicePreflight({
        inventory,
        firmware,
        registryReader: { readDevice: vi.fn().mockResolvedValue(enabledRegistryDocument) },
        emqx,
      }),
    ).rejects.toMatchObject({ code })
    expect(emqx.createCredential).not.toHaveBeenCalled()
    expect(emqx.putAcl).not.toHaveBeenCalled()
  })

  it('uses typed registry failures', () => {
    expect(() => validateRegistryAlignment(inventory.devices[0], null)).toThrow(
      RegistryAlignmentError,
    )
  })
})
