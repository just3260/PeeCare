import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'

export interface CachedFirebaseServices {
  readonly app: FirebaseApp
  readonly auth: Auth
  readonly firestore: Firestore
}

let cachedServices: CachedFirebaseServices | null = null

export function readCachedFirebaseServices(): CachedFirebaseServices | null {
  return cachedServices
}

export function cacheFirebaseServices(
  services: CachedFirebaseServices,
): CachedFirebaseServices {
  cachedServices = services
  return services
}

export function clearCachedFirebaseServices(): void {
  cachedServices = null
}
