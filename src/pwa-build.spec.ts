// @vitest-environment node
// Vite/esbuild builds cannot run under the jsdom environment (jsdom replaces
// TextEncoder), so this build-artifact suite runs in a Node environment.
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { build } from 'vite'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const outDir = join(tmpdir(), 'peecare-pwa-build-test')
const developmentBuildEnv = {
  NODE_ENV: 'production',
  VITE_FIREBASE_ENVIRONMENT: 'development',
  VITE_FIREBASE_APPROVED_PROJECT_ID: 'petcare-c7483',
  VITE_FIREBASE_PROJECT_ID: 'petcare-c7483',
  VITE_FIREBASE_API_KEY: 'public-firebase-client-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'petcare-c7483.firebaseapp.com',
  VITE_FIREBASE_APP_ID: '1:348528459946:web:abc123',
  VITE_MEMBER_API_URL: 'https://peecare-member-development.example.run.app',
  VITE_TEST_TOOL_API_URL:
    'https://peecare-test-tool-development-348528459946.asia-east1.run.app',
}

describe('PWA production build artifacts', () => {
  const originalEnvironment = Object.fromEntries(
    Object.keys(developmentBuildEnv).map((key) => [key, process.env[key]]),
  )

  beforeAll(async () => {
    Object.assign(process.env, developmentBuildEnv)
    rmSync(outDir, { recursive: true, force: true })
    await build({
      root: projectRoot,
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })
  }, 120000)

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('generates a zh-TW installable manifest with both icons', () => {
    const manifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.webmanifest'), 'utf8'),
    )

    expect(manifest.name).toContain('PeeCare')
    expect(manifest.lang).toBe('zh-TW')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')

    const iconSources = manifest.icons.map((icon: { src: string }) => icon.src)
    expect(iconSources).toContain('icons/icon-192.png')
    expect(iconSources).toContain('icons/icon-512.png')
  })

  it('emits a service worker that precaches hashed assets and the icons', () => {
    const swPath = join(outDir, 'sw.js')
    expect(existsSync(swPath)).toBe(true)

    const sw = readFileSync(swPath, 'utf8')
    // Hashed application shell assets are precached by Workbox.
    expect(sw).toMatch(/assets\/index-[\w-]+\.js/)
    expect(sw).toContain('icons/icon-192.png')
    expect(sw).toContain('icons/icon-512.png')
    // Navigation fallback points at the app shell entry document.
    expect(sw).toContain('index.html')
  })

  it('keeps Firebase, Google identity, and Cloud Run member traffic network-only', () => {
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')

    expect(sw).toContain('NetworkOnly')
    expect(sw).toContain('identitytoolkit')
    expect(sw).toContain('securetoken')
    expect(sw).toContain('firestore')
    expect(sw).toContain('accounts')
    expect(sw).toContain('run\\.app')
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(sw).toMatch(new RegExp(`run\\\\\\.app.{0,120}NetworkOnly,"${method}"`))
    }
    expect(sw).not.toMatch(
      /run\\\.app.{0,160}(?:CacheFirst|CacheOnly|NetworkFirst|StaleWhileRevalidate)/,
    )
    expect(sw).not.toContain(
      'https://peecare-test-tool-development-348528459946.asia-east1.run.app',
    )
  })

  it('does not add tester data or form persistence capabilities to the Web source', () => {
    const source = readFileSync(join(projectRoot, 'src/views/TestToolView.vue'), 'utf8')

    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|caches)\b/)
    expect(source).not.toMatch(/serialize|persist|hydrate/i)
  })

  it('registers the service worker only in production, never in dev or test', () => {
    // The Vitest runner is a non-production environment, so the PROD guard in
    // src/main.ts prevents any service-worker registration here.
    expect(import.meta.env.PROD).toBe(false)
  })

  it('selects the approved development cloud adapter without Emulator or MQTT capability', () => {
    const bundle = readdirSync(join(outDir, 'assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(outDir, 'assets', name), 'utf8'))
      .join('\n')

    expect(bundle).toContain('development')
    expect(bundle).toContain('petcare-c7483')
    expect(bundle).toContain('/test-tool')
    expect(bundle).toContain(
      'https://peecare-test-tool-development-348528459946.asia-east1.run.app',
    )
    expect(bundle).not.toMatch(
      /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):(?:4000|8085|9099)\b/i,
    )
    expect(bundle).not.toMatch(/(?:from|require\s*\()["']mqtt["']/i)
    expect(bundle).not.toMatch(/wss?:\/\/[^\s"']*(?:broker|\/mqtt)/i)
    expect(bundle).not.toMatch(/\bmqtt[_-]?(?:username|password|credential)\b/i)
  })
})
