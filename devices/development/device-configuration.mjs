const SECRET_KEY_PATTERN = /(?:password|passphrase|api[_-]?key|api[_-]?secret|token|credential(?:value)?|private[_-]?key)/i
const SECRET_VALUE_PATTERN = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:password|passphrase|secret|token|api[_-]?key)\s*[:=])/i
const PHYSICAL_DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/

export class DeviceConfigurationError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'DeviceConfigurationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new DeviceConfigurationError(code, message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertNoSecrets(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`))
    return
  }

  if (!isRecord(value)) {
    if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
      fail('secret_like_inventory_value', `Secret-like value at ${path}`)
    }
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail('secret_like_inventory_value', `Secret-like key at ${path}.${key}`)
    }
    assertNoSecrets(child, `${path}.${key}`)
  }
}

function assertNonEmptyString(value, code, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(code, `${label} must be a non-empty string`)
  }
}

export function validateDeviceInventory(inventory) {
  assertNoSecrets(inventory)
  if (!isRecord(inventory) || inventory.schemaVersion !== 1 || !Array.isArray(inventory.devices)) {
    fail('invalid_device_inventory', 'Inventory must use schemaVersion 1 and contain devices')
  }
  if (inventory.devices.length === 0) {
    fail('empty_device_inventory', 'Inventory must contain at least one device')
  }

  const deviceIds = new Set()
  const hardwareLabels = new Set()
  for (const device of inventory.devices) {
    if (!isRecord(device)) fail('invalid_device_inventory', 'Every device must be an object')
    assertNonEmptyString(device.hardwareLabel, 'invalid_hardware_label', 'hardwareLabel')
    assertNonEmptyString(device.deviceId, 'invalid_device_id', 'deviceId')
    assertNonEmptyString(device.productModel, 'invalid_product_model', 'productModel')
    if (!PHYSICAL_DEVICE_ID_PATTERN.test(device.deviceId)) {
      fail('invalid_device_id', 'deviceId must be exactly 12 uppercase hexadecimal characters')
    }

    if (deviceIds.has(device.deviceId)) fail('duplicate_device_id', `Duplicate deviceId: ${device.deviceId}`)
    if (hardwareLabels.has(device.hardwareLabel)) {
      fail('duplicate_hardware_label', `Duplicate hardwareLabel: ${device.hardwareLabel}`)
    }
    deviceIds.add(device.deviceId)
    hardwareLabels.add(device.hardwareLabel)

    if (device.mqttPrincipal !== `device-${device.deviceId}`) {
      fail('principal_identity_mismatch', 'mqttPrincipal must equal device-{deviceId}')
    }
    if (
      !isRecord(device.firestore) ||
      device.firestore.projectId !== 'petcare-c7483' ||
      device.firestore.documentPath !== `devices/${device.deviceId}` ||
      device.firestore.ingestionStatus !== 'enabled'
    ) {
      fail('inventory_registry_mismatch', 'Firestore inventory reference is not canonical and enabled')
    }
  }
  return inventory.devices
}

export function validateDeviceConfiguration(inventory, firmware) {
  const devices = validateDeviceInventory(inventory)
  if (devices.length !== 1 || !isRecord(firmware)) {
    fail('device_identity_mismatch', 'Exactly one inventory device and one firmware configuration are required')
  }

  const [device] = devices
  const canonicalTopics = {
    urination: `products/${device.productModel}/devices/${device.deviceId}/events/urination`,
    battery: `products/${device.productModel}/devices/${device.deviceId}/status/battery`,
  }
  if (
    firmware.deviceId !== device.deviceId ||
    firmware.productModel !== device.productModel ||
    firmware.clientId !== device.deviceId ||
    firmware.username !== device.mqttPrincipal ||
    firmware.topics?.urination !== canonicalTopics.urination ||
    firmware.topics?.battery !== canonicalTopics.battery ||
    firmware.payloadIdentity?.deviceId !== device.deviceId
  ) {
    fail('device_identity_mismatch', 'Inventory, client, principal, topics, and payload identity must match')
  }

  return { device, firmware, canonicalTopics }
}
