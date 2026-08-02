import { describe, expect, it } from 'vitest'
import {
  LocalFirebaseConfigurationError,
  MemberApiConfigurationError,
  parseLocalFirebaseConfig,
  parseMemberApiConfig,
  parseFirebaseClientConfig,
  type RawFirebaseEnv,
} from './config'

// A fully valid local Emulator configuration. Individual tests clone and mutate
// this to isolate one invalid field at a time.
function validEnv(): RawFirebaseEnv {
  return {
    MODE: 'development',
    PROD: false,
    VITE_FIREBASE_USE_EMULATORS: 'true',
    VITE_FIREBASE_PROJECT_ID: 'demo-peecare',
    VITE_FIREBASE_API_KEY: 'demo-api-key',
    VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
    VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8085',
  }
}

describe('parseLocalFirebaseConfig', () => {
  it('returns the fixed demo project and Emulator endpoints for valid config', () => {
    const config = parseLocalFirebaseConfig(validEnv())

    expect(config.projectId).toBe('demo-peecare')
    expect(config.apiKey).toBe('demo-api-key')
    expect(config.authEmulator).toEqual({ host: '127.0.0.1', port: 9099 })
    expect(config.firestoreEmulator).toEqual({ host: '127.0.0.1', port: 8085 })
  })

  it('throws production_mode when PROD is true, before any other check', () => {
    // Every other field is deliberately invalid; production must win.
    const env: RawFirebaseEnv = {
      MODE: 'production',
      PROD: true,
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-peecare',
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
      VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
      VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
      VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8085',
    }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'production_mode' }),
    )
  })

  it('throws production_mode when MODE is production even if PROD flag is missing', () => {
    const env = { ...validEnv(), MODE: 'production', PROD: undefined }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'production_mode' }),
    )
  })

  it('throws emulator_disabled when VITE_FIREBASE_USE_EMULATORS is absent', () => {
    const env = { ...validEnv(), VITE_FIREBASE_USE_EMULATORS: undefined }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'emulator_disabled' }),
    )
  })

  it('throws emulator_disabled when VITE_FIREBASE_USE_EMULATORS is not exactly "true"', () => {
    const env = { ...validEnv(), VITE_FIREBASE_USE_EMULATORS: 'false' }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'emulator_disabled' }),
    )
  })

  it('throws project_mismatch when the project ID is a real project', () => {
    const env = { ...validEnv(), VITE_FIREBASE_PROJECT_ID: 'peecare-production' }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'project_mismatch' }),
    )
  })

  it('throws non_loopback_host when the Auth host is 0.0.0.0', () => {
    const env = { ...validEnv(), VITE_FIREBASE_AUTH_EMULATOR_HOST: '0.0.0.0' }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'non_loopback_host' }),
    )
  })

  it('throws non_loopback_host when the Firestore host is a LAN address', () => {
    const env = { ...validEnv(), VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '192.168.1.20' }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'non_loopback_host' }),
    )
  })

  it.each([
    ['Auth', 'VITE_FIREBASE_AUTH_EMULATOR_HOST', 'localhost'],
    ['Firestore', 'VITE_FIREBASE_FIRESTORE_EMULATOR_HOST', '::1'],
  ] as const)(
    'rejects the %s host when it is loopback but not the fixed 127.0.0.1 endpoint',
    (_service, field, host) => {
      const env = { ...validEnv(), [field]: host }

      expect(() => parseLocalFirebaseConfig(env)).toThrowError(
        expect.objectContaining({ code: 'non_loopback_host' }),
      )
    },
  )

  it('throws missing_config when the project ID is absent', () => {
    const env = { ...validEnv(), VITE_FIREBASE_PROJECT_ID: undefined }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'missing_config' }),
    )
  })

  it('throws missing_config when the API key is absent', () => {
    const env = { ...validEnv(), VITE_FIREBASE_API_KEY: undefined }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'missing_config' }),
    )
  })

  it('throws missing_config when a port is non-numeric', () => {
    const env = { ...validEnv(), VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: 'abc' }

    expect(() => parseLocalFirebaseConfig(env)).toThrowError(
      expect.objectContaining({ code: 'missing_config' }),
    )
  })

  it('produces a LocalFirebaseConfigurationError that is a real Error', () => {
    const env = { ...validEnv(), VITE_FIREBASE_USE_EMULATORS: undefined }

    try {
      parseLocalFirebaseConfig(env)
      expect.unreachable('parseLocalFirebaseConfig should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(LocalFirebaseConfigurationError)
      expect(error).toBeInstanceOf(Error)
      expect((error as LocalFirebaseConfigurationError).code).toBe('emulator_disabled')
    }
  })
})

describe('parseMemberApiConfig', () => {
  it('accepts a fixed loopback HTTP endpoint in local mode', () => {
    const config = parseMemberApiConfig({
      ...validEnv(),
      VITE_MEMBER_API_URL: 'http://127.0.0.1:8087',
    })

    expect(config.baseUrl.href).toBe('http://127.0.0.1:8087/')
  })

  it('accepts a remote HTTPS endpoint in production', () => {
    const config = parseMemberApiConfig({
      MODE: 'production',
      PROD: true,
      VITE_MEMBER_API_URL: 'https://member.peecare.example',
    })

    expect(config.baseUrl.href).toBe('https://member.peecare.example/')
  })

  it.each([undefined, '', '   '])('fails closed when Member API URL is missing: %j', (value) => {
    expect(() => parseMemberApiConfig({ ...validEnv(), VITE_MEMBER_API_URL: value })).toThrowError(
      expect.objectContaining({ code: 'missing_member_api_url' }),
    )
  })

  it.each([
    'not a url',
    'ftp://member.peecare.example',
    'https://user:pass@member.peecare.example',
    'https://member.peecare.example/path',
    'https://member.peecare.example?query=1',
    'https://member.peecare.example#fragment',
  ])('rejects malformed or non-origin Member API URL %s', (url) => {
    expect(() => parseMemberApiConfig({ ...validEnv(), VITE_MEMBER_API_URL: url })).toThrowError(
      expect.objectContaining({ code: 'invalid_member_api_url' }),
    )
  })

  it('rejects a remote HTTP endpoint even in local mode', () => {
    expect(() =>
      parseMemberApiConfig({
        ...validEnv(),
        VITE_MEMBER_API_URL: 'http://member.peecare.example',
      }),
    ).toThrowError(expect.objectContaining({ code: 'insecure_member_api_url' }))
  })

  it('does not mistake a DNS name starting with 127 for a loopback IPv4 literal', () => {
    expect(() =>
      parseMemberApiConfig({
        ...validEnv(),
        VITE_MEMBER_API_URL: 'http://127.example.com:8080',
      }),
    ).toThrowError(expect.objectContaining({ code: 'insecure_member_api_url' }))

    expect(
      parseMemberApiConfig({
        MODE: 'production',
        PROD: true,
        VITE_MEMBER_API_URL: 'https://127.example.com',
      }).baseUrl.href,
    ).toBe('https://127.example.com/')
  })

  it.each(['http://127.0.0.1:8080', 'https://127.0.0.1:8080']) (
    'rejects local endpoint %s in production',
    (url) => {
      expect(() =>
        parseMemberApiConfig({ MODE: 'production', PROD: true, VITE_MEMBER_API_URL: url }),
      ).toThrowError(expect.objectContaining({ code: 'local_member_api_url' }))
    },
  )

  it.each([
    'https://localhost.',
    'https://127.0.0.2',
    'https://[::ffff:7f00:1]',
  ])('rejects canonical loopback representation %s in production', (url) => {
    expect(() =>
      parseMemberApiConfig({ MODE: 'production', PROD: true, VITE_MEMBER_API_URL: url }),
    ).toThrowError(expect.objectContaining({ code: 'local_member_api_url' }))
  })

  it('requires HTTPS for every production Member API endpoint', () => {
    expect(() =>
      parseMemberApiConfig({
        MODE: 'production',
        PROD: true,
        VITE_MEMBER_API_URL: 'http://member.peecare.example',
      }),
    ).toThrowError(expect.objectContaining({ code: 'insecure_member_api_url' }))
  })

  it('throws a typed configuration error before runtime initialization', () => {
    expect(() => parseMemberApiConfig({ ...validEnv() })).toThrow(MemberApiConfigurationError)
  })
})

describe('parseFirebaseClientConfig', () => {
  it('returns production Firebase config without Emulator endpoints', () => {
    expect(
      parseFirebaseClientConfig({
        MODE: 'production',
        PROD: true,
        VITE_FIREBASE_PROJECT_ID: 'peecare-production',
        VITE_FIREBASE_API_KEY: 'production-api-key',
      }),
    ).toEqual({
      environment: 'production',
      projectId: 'peecare-production',
      apiKey: 'production-api-key',
    })
  })

  it('rejects Emulator configuration in production', () => {
    expect(() =>
      parseFirebaseClientConfig({
        MODE: 'production',
        PROD: true,
        VITE_FIREBASE_PROJECT_ID: 'peecare-production',
        VITE_FIREBASE_API_KEY: 'production-api-key',
        VITE_FIREBASE_USE_EMULATORS: 'true',
      }),
    ).toThrowError(expect.objectContaining({ code: 'emulator_enabled_in_production' }))
  })
})
