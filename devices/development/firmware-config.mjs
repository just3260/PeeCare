import { compareRetry } from '../../contracts/device-events/lib/retry.mjs'
import { loadValidators } from '../../contracts/device-events/lib/validators.mjs'
import { validateDeviceConfiguration } from './device-configuration.mjs'

const validators = loadValidators()

export class FirmwareConfigurationError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'FirmwareConfigurationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new FirmwareConfigurationError(code, message)
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

export function validateFirmwareConfiguration(inventory, firmware) {
  const { device } = validateDeviceConfiguration(inventory, firmware)

  if (
    Object.keys(firmware).some((key) =>
      /(?:password|passphrase|api[_-]?key|api[_-]?secret|token|credential|private[_-]?key)/i.test(
        key,
      ),
    )
  ) {
    fail('secret_like_firmware_value', 'Firmware configuration cannot contain credential fields')
  }
  if (
    !hasExactKeys(firmware, [
      'schemaVersion',
      'deviceId',
      'productModel',
      'clientId',
      'username',
      'broker',
      'topics',
      'publishPolicy',
      'payloadIdentity',
      'retry',
    ])
  ) {
    fail('unexpected_firmware_configuration', 'Firmware configuration contains unknown fields')
  }

  if (
    !hasExactKeys(firmware.broker, ['urlFromEnvironment', 'protocol', 'port', 'tls']) ||
    firmware.broker.urlFromEnvironment !== 'PEECARE_DEVICE_MQTT_URL' ||
    firmware.broker.protocol !== 'mqtts' ||
    firmware.broker.port !== 8883 ||
    !hasExactKeys(firmware.broker.tls, ['rejectUnauthorized']) ||
    firmware.broker.tls.rejectUnauthorized !== true
  ) {
    fail('unsafe_firmware_tls', 'Firmware requires strict mqtts:// TLS on port 8883')
  }

  if (
    !hasExactKeys(firmware.publishPolicy, ['qos', 'retained']) ||
    firmware.publishPolicy.qos !== 1 ||
    firmware.publishPolicy.retained !== false
  ) {
    fail('invalid_publish_policy', 'Firmware telemetry requires QoS 1 and retained false')
  }

  if (!hasExactKeys(firmware.payloadIdentity, ['deviceId'])) {
    fail('device_identity_mismatch', 'Canonical payload identity contains only deviceId')
  }
  if (
    !hasExactKeys(firmware.retry, [
      'strategy',
      'preserveTopic',
      'preserveAllPayloadFields',
      'newEventIdOnlyForDistinctPhysicalEventOrBatteryTransition',
    ]) ||
    firmware.retry.strategy !== 'reuse-unacknowledged-envelope' ||
    firmware.retry.preserveTopic !== true ||
    firmware.retry.preserveAllPayloadFields !== true ||
    firmware.retry.newEventIdOnlyForDistinctPhysicalEventOrBatteryTransition !== true
  ) {
    fail('invalid_retry_policy', 'Firmware retry must preserve the complete canonical envelope')
  }

  return firmware
}

export function validateRetryAfterDisconnect(fixture) {
  if (
    fixture === null ||
    typeof fixture !== 'object' ||
    !fixture.original ||
    !fixture.retry
  ) {
    fail('retry_fixture_invalid', 'Retry fixture requires original and retry deliveries')
  }
  const result = compareRetry(fixture.original, fixture.retry, validators)
  if (!result.ok) fail(result.error, result.summary)
  return result
}
