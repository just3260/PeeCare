export type DeviceIdQueryResult =
  | { readonly status: 'absent' }
  | { readonly status: 'selected'; readonly deviceId: string }
  | { readonly status: 'rejected'; readonly reason: 'duplicate' | 'invalid' | 'unsupported' }

const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/

/** Normalize only the approved manual ASCII a-f fallback. */
export function normalizeManualDeviceId(input: string): string | null {
  const normalized = input.trim().replace(/[a-f]/g, (character) => character.toUpperCase())
  return DEVICE_ID_PATTERN.test(normalized) ? normalized : null
}

/** QR query values are canonical data, so they are accepted without normalization. */
export function parseDeviceIdQuery(
  value: string | null | readonly (string | null)[] | undefined,
): DeviceIdQueryResult {
  if (value === undefined) return { status: 'absent' }
  if (Array.isArray(value)) {
    if (value.length !== 1) return { status: 'rejected', reason: 'duplicate' }
    return parseDeviceIdQuery(value[0])
  }
  if (typeof value === 'string' && DEVICE_ID_PATTERN.test(value)) {
    return { status: 'selected', deviceId: value }
  }
  return { status: 'rejected', reason: 'invalid' }
}

export function parseDeviceConnectQuery(
  query: Readonly<Record<string, string | null | readonly (string | null)[] | undefined>>,
): DeviceIdQueryResult {
  if (Object.keys(query).some((key) => key !== 'deviceId')) {
    return { status: 'rejected', reason: 'unsupported' }
  }
  return parseDeviceIdQuery(query.deviceId)
}
