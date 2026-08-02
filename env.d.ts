/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Typed local Firebase Emulator configuration. Populated from .env.local; see
// .env.example for the non-secret demo defaults. All entries are optional so the
// Vue app shell type-checks and builds without a local Firebase environment.
interface ImportMetaEnv {
  readonly VITE_FIREBASE_USE_EMULATORS?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_HOST?: string
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string
  readonly VITE_MEMBER_API_URL?: string
}
