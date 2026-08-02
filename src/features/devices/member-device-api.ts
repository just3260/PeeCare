import { getFirebaseServices } from '@/platform/firebase/client'

import { isCanonicalCustomName } from './owned-device-model'

export interface MemberDeviceApiUser {
  getIdToken(): Promise<string>
}

export interface MemberDeviceApiAuth {
  readonly currentUser: MemberDeviceApiUser | null
}

export interface RenamedDevice {
  readonly deviceId: string
  readonly customName: string | null
  readonly displayName: string
}

export type RenameDeviceFailureReason =
  | 'unauthorized'
  | 'device_not_found'
  | 'persistence_unavailable'
  | 'unexpected_error'

export type RenameDeviceResult =
  | { readonly ok: true; readonly device: RenamedDevice }
  | { readonly ok: false; readonly reason: RenameDeviceFailureReason }

export interface MemberDeviceApi {
  renameDevice(deviceId: string, customName: string | null): Promise<RenameDeviceResult>
}

export interface CreateMemberDeviceApiOptions {
  readonly baseUrl: URL
  readonly auth?: () => MemberDeviceApiAuth
  readonly fetcher?: typeof fetch
}

function failed(reason: RenameDeviceFailureReason): RenameDeviceResult {
  return { ok: false, reason }
}

function failureForStatus(status: number): RenameDeviceResult {
  if (status === 401) return failed('unauthorized')
  if (status === 404) return failed('device_not_found')
  if (status === 503) return failed('persistence_unavailable')
  return failed('unexpected_error')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCanonicalSuccess(value: unknown, requestedDeviceId: string): RenamedDevice | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (
    keys.length !== 3 ||
    !keys.includes('deviceId') ||
    !keys.includes('customName') ||
    !keys.includes('displayName')
  ) {
    return null
  }

  const { deviceId, customName, displayName } = value
  if (deviceId !== requestedDeviceId || typeof displayName !== 'string') return null
  if (customName !== null && !isCanonicalCustomName(customName)) return null
  if (displayName !== (customName ?? deviceId)) return null

  return { deviceId, customName, displayName }
}

function endpoint(baseUrl: URL, deviceId: string): URL {
  const root = baseUrl.href.endsWith('/') ? baseUrl : new URL(`${baseUrl.href}/`)
  return new URL(`v1/devices/${encodeURIComponent(deviceId)}/display-name`, root)
}

export function createMemberDeviceApi(options: CreateMemberDeviceApiOptions): MemberDeviceApi {
  const auth = options.auth ?? (() => getFirebaseServices().auth)
  const fetcher = options.fetcher ?? fetch

  return {
    async renameDevice(deviceId: string, customName: string | null): Promise<RenameDeviceResult> {
      let user: MemberDeviceApiUser | null
      try {
        user = auth().currentUser
      } catch {
        return failed('unexpected_error')
      }
      if (user === null) return failed('unauthorized')

      let token: string
      try {
        token = await user.getIdToken()
      } catch {
        return failed('unauthorized')
      }

      let response: Response
      try {
        response = await fetcher(endpoint(options.baseUrl, deviceId), {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ customName }),
        })
      } catch {
        return failed('unexpected_error')
      }

      if (!response.ok) return failureForStatus(response.status)

      try {
        const device = parseCanonicalSuccess(await response.json(), deviceId)
        return device ? { ok: true, device } : failed('unexpected_error')
      } catch {
        return failed('unexpected_error')
      }
    },
  }
}
