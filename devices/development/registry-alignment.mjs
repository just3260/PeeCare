import { validateDeviceConfiguration } from './device-configuration.mjs'

export class RegistryAlignmentError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'RegistryAlignmentError'
    this.code = code
  }
}

function fail(code, message) {
  throw new RegistryAlignmentError(code, message)
}

export function validateRegistryAlignment(device, document) {
  if (!document?.exists) fail('registry_device_not_found', 'Registry device does not exist')
  if (document.id !== device.deviceId) {
    fail('registry_document_id_mismatch', 'Registry document ID does not match inventory deviceId')
  }
  if (document.data?.deviceId !== device.deviceId) {
    fail('registry_device_id_mismatch', 'Registry deviceId field does not match inventory')
  }
  if (document.data?.productModel !== device.productModel) {
    fail('registry_product_model_mismatch', 'Registry productModel does not match inventory')
  }
  if (document.data?.ingestionStatus !== 'enabled') {
    fail('registry_device_disabled', 'Registry device ingestionStatus must be enabled')
  }
  return document.data
}

export function createFirestoreRegistryReader({ Firestore, environment = process.env }) {
  if (environment.FIRESTORE_EMULATOR_HOST) {
    fail('registry_emulator_forbidden', 'Development registry preflight cannot use a Firestore emulator')
  }
  const clients = new Map()

  return {
    async readDevice({ projectId, documentPath }) {
      if (projectId !== 'petcare-c7483' || documentPath !== 'devices/PC-000001') {
        fail('unapproved_registry_target', 'Registry reader accepts only the approved development document')
      }
      let firestore = clients.get(projectId)
      if (!firestore) {
        firestore = new Firestore({ projectId })
        clients.set(projectId, firestore)
      }

      let snapshot
      try {
        snapshot = await firestore.doc(documentPath).get()
      } catch {
        fail('registry_read_failed', 'Unable to read the approved Firestore registry document')
      }
      return {
        exists: snapshot.exists === true,
        id: snapshot.id,
        data: snapshot.exists === true ? snapshot.data() : undefined,
      }
    },
  }
}

function validateAuthenticator(authenticator) {
  if (authenticator?.enable !== true) fail('authenticator_disabled', 'EMQX authenticator is disabled')
  if (
    authenticator.mechanism !== 'password_based' ||
    authenticator.backend !== 'built_in_database'
  ) {
    fail('authenticator_backend_mismatch', 'EMQX must use the built-in password authenticator')
  }
  if (authenticator.user_id_type !== 'username') {
    fail('authenticator_identity_mismatch', 'EMQX authenticator identity must be username')
  }
}

function validateAuthorizationSource(source) {
  if (source?.enable !== true) fail('authorizer_disabled', 'EMQX built-in authorizer is disabled')
  if (source.type !== 'built_in_database') {
    fail('authorizer_backend_mismatch', 'EMQX must use the built-in authorization source')
  }
}

export async function runDevicePreflight({ inventory, firmware, registryReader, emqx }) {
  const { device } = validateDeviceConfiguration(inventory, firmware)

  const [document, authenticator, authorizationSource] = await Promise.all([
    registryReader.readDevice({
      projectId: device.firestore.projectId,
      documentPath: device.firestore.documentPath,
    }),
    emqx.readAuthenticator(),
    emqx.readAuthorizationSource(),
  ])

  validateRegistryAlignment(device, document)
  validateAuthenticator(authenticator)
  validateAuthorizationSource(authorizationSource)

  return ['inventory', 'firmware', 'emqx-access-control', 'registry']
}
