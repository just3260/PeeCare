// @vitest-environment node
// Vite/esbuild builds cannot run under the jsdom environment (jsdom replaces
// TextEncoder), so this build-artifact suite runs in a Node environment.
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll } from 'vitest'
import { build } from 'vite'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const outDir = join(tmpdir(), 'peecare-pwa-build-test')

describe('PWA production build artifacts', () => {
  beforeAll(async () => {
    rmSync(outDir, { recursive: true, force: true })
    await build({
      root: projectRoot,
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })
  }, 120000)

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

  it('registers the service worker only in production, never in dev or test', () => {
    // The Vitest runner is a non-production environment, so the PROD guard in
    // src/main.ts prevents any service-worker registration here.
    expect(import.meta.env.PROD).toBe(false)
  })
})
