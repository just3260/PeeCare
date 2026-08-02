import type { OwnedDevice } from './owned-device-model'

/** Resolve the canonical member-facing label for an already validated device. */
export function resolveDeviceDisplayName(device: OwnedDevice): string {
  return device.customName ?? device.deviceId
}
