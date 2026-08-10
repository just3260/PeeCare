import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

// https://vitest.dev/config/
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // The Vue web app plus the fetch-mocked local reset unit tests. The
      // contracts/ directory ships its own node:test fixtures and must not be
      // collected here, and firebase/local/firestore.rules.spec.ts is Emulator-
      // backed so it runs only under vitest.firebase.config.ts.
      include: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'scripts/audit-production-dependencies.spec.ts',
        'scripts/check-release.spec.ts',
        'scripts/install-workspaces.spec.ts',
        'scripts/test-tool.spec.ts',
        'firebase/local/reset.spec.ts',
        'firebase/local/fixtures/members-and-devices.spec.ts',
        'firebase/development/**/*.spec.ts',
      ],
      // *.integration.spec.ts are Emulator-backed and run only under
      // vitest.firebase.config.ts, never in this fast, mock-only gate.
      exclude: [
        ...configDefaults.exclude,
        'e2e/**',
        'contracts/**',
        'src/**/*.integration.spec.ts',
      ],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
