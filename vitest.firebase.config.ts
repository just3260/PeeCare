import { defineConfig } from 'vitest/config'

// Emulator-backed integration tests. These run in a plain Node environment (no
// Vue plugin, no jsdom) under `firebase emulators:exec`, which injects the
// Emulator host env vars. Kept separate from the fast Vitest gate so
// `npm run check` never needs Java or a running Emulator.
export default defineConfig({
  test: {
    environment: 'node',
    // The local Firebase client adapter tests plus the Emulator-backed
    // Security Rules tests, matching the spec's "client and rules tests".
    include: [
      'src/platform/firebase/*.spec.ts',
      'firebase/local/firestore.rules.spec.ts',
      'firebase/local/reset.integration.spec.ts',
    ],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
