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
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'firebase/local/reset.spec.ts'],
      exclude: [...configDefaults.exclude, 'e2e/**', 'contracts/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
