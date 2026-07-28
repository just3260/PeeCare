import { describe, expect, it } from 'vitest'
import {
  LocalFirebaseConfigurationError,
  parseLocalFirebaseConfig,
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
