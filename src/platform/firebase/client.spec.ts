import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawFirebaseEnv } from './config'

// Mock the three Firebase SDK entry points so no real app, Auth, or Firestore is
// created. vi.hoisted lets the mock factories reference these spies safely.
const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
  getFirestore: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
}))

vi.mock('firebase/app', () => ({ initializeApp: mocks.initializeApp }))
vi.mock('firebase/auth', () => ({
  getAuth: mocks.getAuth,
  connectAuthEmulator: mocks.connectAuthEmulator,
}))
vi.mock('firebase/firestore', () => ({
  getFirestore: mocks.getFirestore,
  connectFirestoreEmulator: mocks.connectFirestoreEmulator,
}))

import { getLocalFirebaseServices, resetLocalFirebaseServices } from './client'

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

const fakeApp = { name: 'demo-peecare-app' }
const fakeAuth = { kind: 'auth' }
const fakeFirestore = { kind: 'firestore' }

beforeEach(() => {
  resetLocalFirebaseServices()
  vi.clearAllMocks()
  mocks.initializeApp.mockReturnValue(fakeApp)
  mocks.getAuth.mockReturnValue(fakeAuth)
  mocks.getFirestore.mockReturnValue(fakeFirestore)
})

describe('getLocalFirebaseServices', () => {
  it('initializes the app once and returns the same instances on repeated calls', () => {
    const first = getLocalFirebaseServices(validEnv())
    const second = getLocalFirebaseServices(validEnv())

    expect(second.app).toBe(first.app)
    expect(second.auth).toBe(first.auth)
    expect(second.firestore).toBe(first.firestore)
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1)
    expect(mocks.getAuth).toHaveBeenCalledTimes(1)
    expect(mocks.getFirestore).toHaveBeenCalledTimes(1)
  })

  it('connects Auth and Firestore to the fixed loopback Emulators', () => {
    const services = getLocalFirebaseServices(validEnv())

    expect(services.app).toBe(fakeApp)
    expect(services.auth).toBe(fakeAuth)
    expect(services.firestore).toBe(fakeFirestore)
    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(
      fakeAuth,
      'http://127.0.0.1:9099',
      expect.anything(),
    )
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledWith(fakeFirestore, '127.0.0.1', 8085)
  })

  it('initializes the app after the config is validated', () => {
    getLocalFirebaseServices(validEnv())

    expect(mocks.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'demo-peecare', apiKey: 'demo-api-key' }),
    )
  })

  const invalidCases: ReadonlyArray<{ name: string; env: RawFirebaseEnv; code: string }> = [
    {
      name: 'emulator disabled',
      env: { ...validEnv(), VITE_FIREBASE_USE_EMULATORS: undefined },
      code: 'emulator_disabled',
    },
    {
      name: 'project mismatch',
      env: { ...validEnv(), VITE_FIREBASE_PROJECT_ID: 'peecare-production' },
      code: 'project_mismatch',
    },
    {
      name: 'non-loopback host',
      env: { ...validEnv(), VITE_FIREBASE_AUTH_EMULATOR_HOST: '0.0.0.0' },
      code: 'non_loopback_host',
    },
    {
      name: 'production mode',
      env: { ...validEnv(), PROD: true },
      code: 'production_mode',
    },
    {
      name: 'missing config',
      env: { ...validEnv(), VITE_FIREBASE_API_KEY: undefined },
      code: 'missing_config',
    },
  ]

  it.each(invalidCases)(
    'throws $code and never calls initializeApp for $name',
    ({ env, code }) => {
      expect(() => getLocalFirebaseServices(env)).toThrowError(
        expect.objectContaining({ code }),
      )
      expect(mocks.initializeApp).not.toHaveBeenCalled()
      expect(mocks.getAuth).not.toHaveBeenCalled()
      expect(mocks.getFirestore).not.toHaveBeenCalled()
      expect(mocks.connectAuthEmulator).not.toHaveBeenCalled()
      expect(mocks.connectFirestoreEmulator).not.toHaveBeenCalled()
    },
  )
})
