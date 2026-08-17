// @vitest-environment node

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build as esbuild } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

import {
  assertEmbeddedAssetParity,
  assertFreshStaging,
  assertGeneratedCommonJsBundle,
  createBundleOptions,
  createArchitecturePaths,
  createSeaConfiguration,
  createStagingRecord,
  loadBuildManifest,
  parseBuildArguments,
  parseMachOArchitectures,
  validateBuildManifest,
  validateDownloadResponse,
  validateEmbeddedAssets,
  validatePinnedBuildTooling,
  verifyArtifactArchitecture,
  verifySha256,
} from './test-tool-macos-build.mjs'
import {
  createSeaAssetProvider,
  createSourceAssetProvider,
  createRuntimeAssetProvider,
  loadTestToolAssets,
} from './test-tool.mjs'

const NODE_VERSION = '22.23.2'
const POSTJECT_INTEGRITY =
  'sha512-b9Eb8h2eVqNE8edvKdwqkrY6O7kAwmI8kcnBv1NScolYJbo59XUF0noFq+lxbC1yN20bmC0WBEbDC5H/7ASb0A=='
const ESBUILD_INTEGRITY =
  'sha512-bbPBYYrtZbkt6Os6FiTLCTFxvq4tt3JKall1vRwshA3fdVztsLAatFaZobhkBC8/BrPetoa0oksYoKXoG4ryJg=='

function manifestFixture() {
  return {
    schemaVersion: 1,
    nodeVersion: NODE_VERSION,
    bundler: {
      package: 'esbuild',
      version: '0.25.12',
      integrity: ESBUILD_INTEGRITY,
    },
    injector: {
      package: 'postject',
      version: '1.0.0-alpha.6',
      integrity: POSTJECT_INTEGRITY,
    },
    sea: {
      useSnapshot: false,
      useCodeCache: false,
    },
    assets: [
      {
        key: 'test-tool.html',
        source: 'scripts/test-tool.html',
        contentType: 'text/html; charset=utf-8',
      },
      {
        key: 'machine.png',
        source: 'scripts/machine.png',
        contentType: 'image/png',
      },
      {
        key: 'dog.png',
        source: 'scripts/dog.png',
        contentType: 'image/png',
      },
    ],
    architectures: {
      arm64: {
        minimumMacOS: '14.8.8',
        archiveUrl:
          'https://nodejs.org/download/release/v22.23.2/node-v22.23.2-darwin-arm64.tar.xz',
        archiveSha256:
          '5eff7a9011895aae3f29d06f167b84a62b028a591370c7cafb59103559fd26e1',
        outputName: 'peecare-test-tool-macos-arm64',
      },
      x64: {
        minimumMacOS: '14.6.0',
        archiveUrl:
          'https://nodejs.org/download/release/v22.23.2/node-v22.23.2-darwin-x64.tar.xz',
        archiveSha256:
          '96dff79f4e19a78715da559ec7cac2028f4985a175ea0c3454625a269c21deb7',
        outputName: 'peecare-test-tool-macos-x64',
      },
    },
  }
}

function sourceAssets() {
  return new Map([
    ['test-tool.html', readFileSync(resolve('scripts/test-tool.html'))],
    ['machine.png', readFileSync(resolve('scripts/machine.png'))],
    ['dog.png', readFileSync(resolve('scripts/dog.png'))],
  ])
}

describe('pinned macOS SEA build manifest', () => {
  it('loads the checked-in manifest as the exact validated source of truth', () => {
    expect(loadBuildManifest()).toEqual(manifestFixture())
  })

  it('accepts the exact immutable dual-architecture manifest', () => {
    const manifest = validateBuildManifest(manifestFixture())

    expect(manifest).toEqual(manifestFixture())
    expect(Object.keys(manifest.architectures)).toEqual(['arm64', 'x64'])
    expect(manifest).not.toHaveProperty('minimumMacOS')
    expect(manifest.architectures.arm64.minimumMacOS).toBe('14.8.8')
    expect(manifest.architectures.x64.minimumMacOS).toBe('14.6.0')
    expect(manifest.assets.map(({ key }) => key)).toEqual([
      'test-tool.html',
      'machine.png',
      'dog.png',
    ])
    expect(manifest.injector).toEqual({
      package: 'postject',
      version: '1.0.0-alpha.6',
      integrity: POSTJECT_INTEGRITY,
    })
    expect(manifest.bundler).toEqual({
      package: 'esbuild',
      version: '0.25.12',
      integrity: ESBUILD_INTEGRITY,
    })
  })

  it.each([
    ['unknown root key', (manifest: any) => { manifest.mutableChannel = 'latest' }],
    ['mutable Node version', (manifest: any) => { manifest.nodeVersion = 'latest' }],
    ['root-level fallback minimum macOS', (manifest: any) => { manifest.minimumMacOS = '14.8.8' }],
    ['wrong arm64 minimum macOS', (manifest: any) => { manifest.architectures.arm64.minimumMacOS = '14.8.7' }],
    ['wrong x64 minimum macOS', (manifest: any) => { manifest.architectures.x64.minimumMacOS = '14.8.8' }],
    ['mutable Node URL', (manifest: any) => { manifest.architectures.arm64.archiveUrl = 'https://nodejs.org/download/release/latest-v22.x/node.tar.xz' }],
    ['foreign Node URL', (manifest: any) => { manifest.architectures.arm64.archiveUrl = 'https://example.test/node.tar.xz' }],
    ['non-SHA-256 archive digest', (manifest: any) => { manifest.architectures.arm64.archiveSha256 = 'sha1:bad' }],
    ['unpinned injector version', (manifest: any) => { manifest.injector.version = '^1.0.0-alpha.6' }],
    ['wrong injector integrity', (manifest: any) => { manifest.injector.integrity = 'sha512-tampered' }],
    ['unpinned bundler version', (manifest: any) => { manifest.bundler.version = '^0.25.12' }],
    ['wrong bundler integrity', (manifest: any) => { manifest.bundler.integrity = 'sha512-tampered' }],
    ['snapshot enabled', (manifest: any) => { manifest.sea.useSnapshot = true }],
    ['code cache enabled', (manifest: any) => { manifest.sea.useCodeCache = true }],
    ['missing declared asset', (manifest: any) => { manifest.assets.pop() }],
    ['unexpected asset key', (manifest: any) => { manifest.assets[0].key = 'index.html' }],
    ['wrong arm64 output', (manifest: any) => { manifest.architectures.arm64.outputName = 'peecare-test-tool-macos' }],
  ])('rejects %s', (_label, mutate) => {
    const manifest = manifestFixture()
    mutate(manifest)

    expect(() => validateBuildManifest(manifest)).toThrow()
  })

  it.each(['arm64', 'x64'] as const)(
    'creates a single-architecture %s CommonJS SEA config with snapshots and code cache disabled',
    (architecture) => {
      const configuration = createSeaConfiguration({
        manifest: validateBuildManifest(manifestFixture()),
        architecture,
        entryPath: '/staging/test-tool-operator.bundle.cjs',
        blobPath: `/staging/${architecture}/sea-prep.blob`,
      })

      expect(configuration).toEqual({
        main: 'test-tool-operator.bundle.cjs',
        mainFormat: 'commonjs',
        output: 'sea-prep.blob',
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        execArgvExtension: 'none',
        assets: {
          'test-tool.html': 'assets/test-tool.html',
          'machine.png': 'assets/machine.png',
          'dog.png': 'assets/dog.png',
        },
      })
      expect(JSON.stringify(configuration)).not.toContain('/staging')
    },
  )

  it.each([
    ['arm64', '14.8.8'],
    ['x64', '14.6.0'],
  ] as const)(
    'embeds only the selected %s architecture and its %s runtime floor',
    (architecture, minimumMacOS) => {
      const options = createBundleOptions({
        manifest: validateBuildManifest(manifestFixture()),
        architecture,
        outfile: `/staging/${architecture}/test-tool-operator.bundle.cjs`,
      })

      expect(options.define).toMatchObject({
        __PEECARE_ARCHITECTURE__: JSON.stringify(architecture),
        __PEECARE_MINIMUM_MACOS__: JSON.stringify(minimumMacOS),
      })
      expect(JSON.stringify(options.define)).not.toContain(
        architecture === 'arm64' ? '14.6.0' : '14.8.8',
      )
    },
  )

  it.each([
    [['--arch', 'arm64'], { architectures: ['arm64'] }],
    [['--arch', 'x64'], { architectures: ['x64'] }],
    [['--all'], { architectures: ['arm64', 'x64'] }],
  ] as const)('accepts the exact build selector %j', (args, expected) => {
    expect(parseBuildArguments([...args])).toEqual(expected)
  })

  it.each([
    [],
    ['--arch'],
    ['--arch', 'universal'],
    ['--arch', 'arm64', '--all'],
    ['--all', '--all'],
    ['arm64'],
  ])('rejects ambiguous or unknown build arguments %j', (args) => {
    expect(() => parseBuildArguments(args)).toThrow()
  })

  it('accepts only a non-redirected successful response from the pinned URL', () => {
    const url = manifestFixture().architectures.arm64.archiveUrl

    expect(validateDownloadResponse({ requestedUrl: url, finalUrl: url, status: 200 }))
      .toBe(url)
  })

  it.each([
    ['redirected host', 'https://mirror.example/node.tar.xz', 200],
    ['mutable Node endpoint', 'https://nodejs.org/download/release/latest-v22.x/node.tar.xz', 200],
    ['unexpected status', manifestFixture().architectures.arm64.archiveUrl, 206],
  ])('rejects a %s', (_label, finalUrl, status) => {
    const requestedUrl = manifestFixture().architectures.arm64.archiveUrl
    expect(() => validateDownloadResponse({ requestedUrl, finalUrl, status })).toThrow()
  })

  it('rejects stale staging instead of reusing it', () => {
    expect(assertFreshStaging({ exists: false })).toBe(true)
    expect(() => assertFreshStaging({ exists: true })).toThrow()
  })

  it.each([
    ['Mach-O 64-bit executable arm64', ['arm64']],
    ['Mach-O 64-bit executable x86_64', ['x64']],
    ['Mach-O universal binary with 2 architectures: [x86_64:Mach-O] [arm64:Mach-O]', ['arm64', 'x64']],
  ])('parses Mach-O inspection %j', (inspection, expected) => {
    expect(parseMachOArchitectures(inspection)).toEqual(expected)
  })

  it.each(['arm64', 'x64'] as const)('isolates %s staging paths', (architecture) => {
    const paths = createArchitecturePaths({
      architecture,
      artifactRoot: '/private/tmp/peecare-staging',
      manifest: manifestFixture(),
    })

    expect(paths.root).toBe(`/private/tmp/peecare-staging/${architecture}`)
    expect(paths.executable).toBe(
      `/private/tmp/peecare-staging/${architecture}/peecare-test-tool-macos-${architecture}`,
    )
    expect(paths.bundle).toBe(
      `/private/tmp/peecare-staging/${architecture}/test-tool-operator.bundle.cjs`,
    )
    expect(
      Object.values(paths).every(
        (path) => path === paths.root || path.includes(`/${architecture}/`),
      ),
    ).toBe(true)
  })
})

describe('package-lock-pinned CommonJS bundling', () => {
  it('accepts only the exact manifest and package-lock esbuild pin', () => {
    const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))

    expect(validatePinnedBuildTooling(manifestFixture(), packageLock)).toEqual({
      package: 'esbuild',
      version: '0.25.12',
      integrity: ESBUILD_INTEGRITY,
    })

    packageLock.packages['node_modules/esbuild'].integrity = 'sha512-tampered'
    expect(() => validatePinnedBuildTooling(manifestFixture(), packageLock)).toThrow()
  })

  it('builds the repository ESM entry as one deterministic Node 22 CommonJS file', () => {
    const options = createBundleOptions({
      manifest: manifestFixture(),
      architecture: 'arm64',
      outfile: '/staging/test-tool-operator.bundle.cjs',
    })

    expect(options).toMatchObject({
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22.23.2',
      outfile: '/staging/test-tool-operator.bundle.cjs',
      sourcemap: false,
      legalComments: 'none',
    })
    expect(options.external).toEqual([])
    expect(options.define).toEqual({
      __PEECARE_ARCHITECTURE__: '"arm64"',
      __PEECARE_MINIMUM_MACOS__: '"14.8.8"',
      'import.meta.url': '"file:///__peecare_sea__/test-tool.mjs"',
    })
  })

  it('bundles the real operator entry without ESM or adjacent runtime modules', async () => {
    const options = createBundleOptions({
      manifest: manifestFixture(),
      architecture: 'arm64',
      outfile: '/private/tmp/test-tool-operator.bundle.cjs',
    })
    const result = await esbuild({ ...options, write: false })

    expect(result.outputFiles).toHaveLength(1)
    expect(assertGeneratedCommonJsBundle(result.outputFiles[0].text)).toBe(true)
  })

  it('accepts a self-contained CommonJS bundle that imports only Node built-ins', () => {
    expect(assertGeneratedCommonJsBundle(`
      var fs = require("node:fs");
      var sea = require("node:sea");
      module.exports = { fs, sea };
    `)).toBe(true)
  })

  it.each([
    ['ES module import', 'import fs from "node:fs";'],
    ['ES module export', 'export { value };'],
    ['dynamic import', 'import("node:sea");'],
    ['relative runtime require', 'require("./test-tool.mjs");'],
    ['package runtime require', 'require("firebase");'],
    ['source map comment', '//# sourceMappingURL=test-tool.js.map'],
  ])('rejects a bundle containing %s', (_label, bundle) => {
    expect(() => assertGeneratedCommonJsBundle(bundle)).toThrow()
  })
})

describe('SEA input and output verification', () => {
  it('accepts bytes only when their SHA-256 matches exactly', () => {
    const bytes = Buffer.from('verified-node-archive')
    const expected = createHash('sha256').update(bytes).digest('hex')

    expect(verifySha256(bytes, expected)).toBe(expected)
    expect(() => verifySha256(bytes, '0'.repeat(64))).toThrow()
  })

  it.each([
    ['arm64', ['arm64']],
    ['x64', ['x64']],
  ] as const)('accepts only a single matching %s Mach-O slice', (declared, detected) => {
    expect(
      verifyArtifactArchitecture({
        declaredArchitecture: declared,
        detectedArchitectures: detected,
      }),
    ).toBe(declared)
  })

  it.each([
    ['universal artifact', 'arm64', ['arm64', 'x64']],
    ['wrong architecture', 'arm64', ['x64']],
    ['missing architecture', 'x64', []],
  ] as const)('rejects a %s', (_label, declaredArchitecture, detectedArchitectures) => {
    expect(() =>
      verifyArtifactArchitecture({
        declaredArchitecture,
        detectedArchitectures,
      }),
    ).toThrow()
  })

  it('does not let an arm64 artifact satisfy x64 inspection', () => {
    expect(() =>
      verifyArtifactArchitecture({
        declaredArchitecture: 'x64',
        detectedArchitectures: ['arm64'],
      }),
    ).toThrowError('architecture_mismatch')
  })

  it.each(['arm64', 'x64'] as const)(
    'keeps the %s staging record qualification-pending',
    (architecture) => {
      const record = createStagingRecord({
        architecture,
        manifest: manifestFixture(),
        manifestHash: 'a'.repeat(64),
        executableSha256: 'b'.repeat(64),
      })

      expect(record).toEqual({
        schemaVersion: 1,
        architecture,
        nodeVersion: '22.23.2',
        minimumMacOS: architecture === 'arm64' ? '14.8.8' : '14.6.0',
        manifestHash: 'a'.repeat(64),
        executableSha256: 'b'.repeat(64),
        signingStatus: 'ad-hoc-staging-only',
        qualificationStatus: 'qualification-pending',
      })
      expect(JSON.stringify(record)).not.toContain('releasable')
    },
  )

  it('accepts exactly the three immutable source assets', () => {
    expect(validateEmbeddedAssets(sourceAssets())).toEqual(sourceAssets())
  })

  it.each([
    [
      'credential-like asset name',
      new Map([...sourceAssets(), ['service-account.json', Buffer.from('{}')]]),
    ],
    [
      'unexpected source map',
      new Map([...sourceAssets(), ['test-tool.js.map', Buffer.from('{}')]]),
    ],
    [
      'secret-like asset bytes',
      new Map([
        ...sourceAssets(),
        ['dog.png', Buffer.from('Authorization: Bearer embedded-secret')],
      ]),
    ],
  ])('rejects %s', (_label, assets) => {
    expect(() => validateEmbeddedAssets(assets)).toThrow()
  })

  it('requires source and SEA assets to be byte-identical', () => {
    const source = sourceAssets()
    const embedded = new Map(
      [...source].map(([key, value]) => [key, Buffer.from(value)]),
    )

    expect(assertEmbeddedAssetParity(source, embedded)).toBe(true)
    embedded.set('machine.png', Buffer.from('different'))
    expect(() => assertEmbeddedAssetParity(source, embedded)).toThrow()
  })
})

describe('source and SEA asset provider parity', () => {
  it('loads the existing adjacent source files byte-for-byte', () => {
    const assets = loadTestToolAssets(createSourceAssetProvider())

    expect(Buffer.from(assets.html, 'utf8')).toEqual(
      readFileSync(resolve('scripts/test-tool.html')),
    )
    expect(assets.machinePng).toEqual(readFileSync(resolve('scripts/machine.png')))
    expect(assets.dogPng).toEqual(readFileSync(resolve('scripts/dog.png')))
    expect(Object.isFrozen(assets)).toBe(true)
  })

  it('loads byte-identical SEA assets without reading adjacent files', () => {
    const source = sourceAssets()
    const readSourceAsset = vi.fn(() => {
      throw new Error('adjacent assets are absent')
    })
    const getAsset = (key: string) => {
      const bytes = source.get(key)
      if (bytes === undefined) throw new Error('missing embedded asset')
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }

    const assets = loadTestToolAssets(createRuntimeAssetProvider({
      sea: true,
      getAsset,
      readAsset: readSourceAsset,
    }))

    expect(readSourceAsset).not.toHaveBeenCalled()
    expect(Buffer.from(assets.html, 'utf8')).toEqual(source.get('test-tool.html'))
    expect(assets.machinePng).toEqual(source.get('machine.png'))
    expect(assets.dogPng).toEqual(source.get('dog.png'))
  })

  it.each([
    ['empty HTML', 'test-tool.html', Buffer.alloc(0)],
    ['invalid UTF-8 HTML', 'test-tool.html', Buffer.from([0xff, 0xfe])],
    ['empty machine image', 'machine.png', Buffer.alloc(0)],
    ['empty dog image', 'dog.png', Buffer.alloc(0)],
  ])('rejects %s', (_label, invalidKey, invalidBytes) => {
    const source = sourceAssets()
    source.set(invalidKey, invalidBytes)
    const provider = createSeaAssetProvider({
      getAsset: (key: string) => {
        const bytes = source.get(key)
        if (bytes === undefined) throw new Error('missing embedded asset')
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      },
    })

    expect(() => loadTestToolAssets(provider)).toThrow()
  })
})
