import type { InjectionKey } from 'vue'

import type { AuthStore } from './auth-store'

// Kept in its own module so the injection key can be imported without pulling in
// the Firebase-backed store implementation (and to keep router/view imports
// free of import cycles).
export const AUTH_STORE_KEY: InjectionKey<AuthStore> = Symbol('auth-store')
