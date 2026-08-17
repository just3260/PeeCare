import { createHash, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..')
const DEFAULT_MANIFEST_PATH = resolve(SCRIPT_DIRECTORY, 'test-tool-macos-build.json')
const ROOT_KEYS = ['schemaVersion', 'nodeVersion', 'bundler', 'injector', 'sea', 'assets', 'architectures']
const ASSET_FIXTURES = Object.freeze([
  Object.freeze({ key: 'test-tool.html', source: 'scripts/test-tool.html', contentType: 'text/html; charset=utf-8' }),
  Object.freeze({ key: 'machine.png', source: 'scripts/machine.png', contentType: 'image/png' }),
  Object.freeze({ key: 'dog.png', source: 'scripts/dog.png', contentType: 'image/png' }),
])
const ARCHITECTURES = Object.freeze(['arm64', 'x64'])
const MINIMUM_MACOS_BY_ARCHITECTURE = Object.freeze({
  arm64: '14.8.8',
  x64: '14.6.0',
})
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const NODE_VERSION_PATTERN = /^22\.[0-9]+\.[0-9]+$/u
const POSTJECT_INTEGRITY = 'sha512-b9Eb8h2eVqNE8edvKdwqkrY6O7kAwmI8kcnBv1NScolYJbo59XUF0noFq+lxbC1yN20bmC0WBEbDC5H/7ASb0A=='
const ESBUILD_INTEGRITY = 'sha512-bbPBYYrtZbkt6Os6FiTLCTFxvq4tt3JKall1vRwshA3fdVztsLAatFaZobhkBC8/BrPetoa0oksYoKXoG4ryJg=='
const ESBUILD_VERSION = '0.25.12'
const execFileAsync = promisify(execFile)
const DEFAULT_ARTIFACT_ROOT = resolve(PROJECT_ROOT, 'artifacts/test-tool-macos/staging')
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

export class MacOSBuildError extends Error {
  constructor(code) {
    super(code)
    this.name = 'MacOSBuildError'
    this.code = code
  }
}

function fail(code) {
  throw new MacOSBuildError(code)
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  )
}

function validateAssetManifest(assets) {
  if (!Array.isArray(assets) || assets.length !== ASSET_FIXTURES.length) {
    fail('manifest_invalid')
  }
  for (let index = 0; index < ASSET_FIXTURES.length; index += 1) {
    const asset = assets[index]
    const expected = ASSET_FIXTURES[index]
    if (
      !exactKeys(asset, ['key', 'source', 'contentType']) ||
      asset.key !== expected.key ||
      asset.source !== expected.source ||
      asset.contentType !== expected.contentType
    ) {
      fail('manifest_invalid')
    }
  }
}

function validateArchitectureManifest(nodeVersion, architectures) {
  if (!exactKeys(architectures, ARCHITECTURES)) fail('manifest_invalid')
  for (const architecture of ARCHITECTURES) {
    const value = architectures[architecture]
    const expectedUrl = `https://nodejs.org/download/release/v${nodeVersion}/node-v${nodeVersion}-darwin-${architecture}.tar.xz`
    if (
      !exactKeys(value, ['minimumMacOS', 'archiveUrl', 'archiveSha256', 'outputName']) ||
      value.minimumMacOS !== MINIMUM_MACOS_BY_ARCHITECTURE[architecture] ||
      value.archiveUrl !== expectedUrl ||
      !SHA256_PATTERN.test(value.archiveSha256) ||
      value.outputName !== `peecare-test-tool-macos-${architecture}`
    ) {
      fail('manifest_invalid')
    }
  }
}

export function validateBuildManifest(manifest) {
  if (
    !exactKeys(manifest, ROOT_KEYS) ||
    manifest.schemaVersion !== 1 ||
    !NODE_VERSION_PATTERN.test(manifest.nodeVersion) ||
    !exactKeys(manifest.bundler, ['package', 'version', 'integrity']) ||
    manifest.bundler.package !== 'esbuild' ||
    manifest.bundler.version !== ESBUILD_VERSION ||
    manifest.bundler.integrity !== ESBUILD_INTEGRITY ||
    !exactKeys(manifest.injector, ['package', 'version', 'integrity']) ||
    manifest.injector.package !== 'postject' ||
    manifest.injector.version !== '1.0.0-alpha.6' ||
    manifest.injector.integrity !== POSTJECT_INTEGRITY ||
    !exactKeys(manifest.sea, ['useSnapshot', 'useCodeCache']) ||
    manifest.sea.useSnapshot !== false ||
    manifest.sea.useCodeCache !== false
  ) {
    fail('manifest_invalid')
  }
  validateAssetManifest(manifest.assets)
  validateArchitectureManifest(manifest.nodeVersion, manifest.architectures)
  return structuredClone(manifest)
}

export function loadBuildManifest(path = DEFAULT_MANIFEST_PATH) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail('manifest_invalid')
  }
  return validateBuildManifest(parsed)
}

export function createBuildManifestHash(path = DEFAULT_MANIFEST_PATH) {
  loadBuildManifest(path)
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function parseBuildArguments(args) {
  if (!Array.isArray(args)) fail('invalid_arguments')
  if (args.length === 1 && args[0] === '--all') {
    return Object.freeze({ architectures: ['arm64', 'x64'] })
  }
  if (
    args.length === 2 &&
    args[0] === '--arch' &&
    ARCHITECTURES.includes(args[1])
  ) {
    return Object.freeze({ architectures: [args[1]] })
  }
  fail('invalid_arguments')
}

export function createSeaConfiguration({ manifest, architecture, entryPath, blobPath }) {
  const validated = validateBuildManifest(manifest)
  if (!ARCHITECTURES.includes(architecture)) fail('architecture_invalid')
  if (typeof entryPath !== 'string' || typeof blobPath !== 'string') {
    fail('build_path_invalid')
  }
  return Object.freeze({
    main: basename(entryPath),
    mainFormat: 'commonjs',
    output: basename(blobPath),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgvExtension: 'none',
    assets: Object.fromEntries(
      validated.assets.map((asset) => [asset.key, `assets/${asset.key}`]),
    ),
  })
}

export function validatePinnedBuildTooling(manifest, packageLock) {
  const validated = validateBuildManifest(manifest)
  const rootPackage = packageLock?.packages?.['']
  const esbuildPackage = packageLock?.packages?.['node_modules/esbuild']
  if (
    rootPackage?.devDependencies?.esbuild !== validated.bundler.version ||
    esbuildPackage?.version !== validated.bundler.version ||
    esbuildPackage?.integrity !== validated.bundler.integrity ||
    esbuildPackage?.resolved !==
      `https://registry.npmjs.org/esbuild/-/esbuild-${validated.bundler.version}.tgz`
  ) {
    fail('bundler_pin_invalid')
  }
  return Object.freeze(structuredClone(validated.bundler))
}

export function createBundleOptions({ manifest, architecture, outfile }) {
  const validated = validateBuildManifest(manifest)
  if (!ARCHITECTURES.includes(architecture)) fail('architecture_invalid')
  if (typeof outfile !== 'string' || !outfile.endsWith('.cjs')) {
    fail('build_path_invalid')
  }
  return Object.freeze({
    entryPoints: [resolve(SCRIPT_DIRECTORY, 'test-tool-operator-entry.mjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: `node${validated.nodeVersion}`,
    outfile,
    external: [],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
    define: Object.freeze({
      __PEECARE_ARCHITECTURE__: JSON.stringify(architecture),
      __PEECARE_MINIMUM_MACOS__: JSON.stringify(
        validated.architectures[architecture].minimumMacOS,
      ),
      'import.meta.url': JSON.stringify('file:///__peecare_sea__/test-tool.mjs'),
    }),
  })
}

export function assertGeneratedCommonJsBundle(bundle) {
  if (
    typeof bundle !== 'string' ||
    bundle.length === 0 ||
    /(?:^|\n)\s*import\s+(?:["'{*]|[A-Za-z_$])/u.test(bundle) ||
    /\bimport\s*\(/u.test(bundle) ||
    /(?:^|\n)\s*export\s/u.test(bundle) ||
    /[#@]\s*sourceMappingURL=/u.test(bundle)
  ) {
    fail('bundle_invalid')
  }
  for (const match of bundle.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/gu)) {
    if (!match[1].startsWith('node:')) fail('bundle_invalid')
  }
  return true
}

export function verifySha256(bytes, expectedDigest) {
  if (!SHA256_PATTERN.test(expectedDigest ?? '')) fail('checksum_mismatch')
  const actual = createHash('sha256').update(bytes).digest()
  const expected = Buffer.from(expectedDigest, 'hex')
  if (!timingSafeEqual(actual, expected)) fail('checksum_mismatch')
  return actual.toString('hex')
}

export function verifyArtifactArchitecture({ declaredArchitecture, detectedArchitectures }) {
  if (
    !ARCHITECTURES.includes(declaredArchitecture) ||
    !Array.isArray(detectedArchitectures) ||
    detectedArchitectures.length !== 1 ||
    detectedArchitectures[0] !== declaredArchitecture
  ) {
    fail('architecture_mismatch')
  }
  return declaredArchitecture
}

export function createStagingRecord({
  architecture,
  manifest,
  manifestHash,
  executableSha256,
}) {
  const validated = validateBuildManifest(manifest)
  if (
    !ARCHITECTURES.includes(architecture) ||
    !SHA256_PATTERN.test(manifestHash ?? '') ||
    !SHA256_PATTERN.test(executableSha256 ?? '')
  ) {
    fail('staging_record_invalid')
  }
  return Object.freeze({
    schemaVersion: 1,
    architecture,
    nodeVersion: validated.nodeVersion,
    minimumMacOS: validated.architectures[architecture].minimumMacOS,
    manifestHash,
    executableSha256,
    signingStatus: 'ad-hoc-staging-only',
    qualificationStatus: 'qualification-pending',
  })
}

function secretLikeBytes(bytes) {
  const text = bytes.toString('utf8')
  return (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text) ||
    /"private_key"\s*:/u.test(text) ||
    /ya29\.[A-Za-z0-9_-]{16,}/u.test(text) ||
    /Authorization:\s*Bearer\s+[A-Za-z0-9_-]{8,}/u.test(text)
  )
}

export function validateEmbeddedAssets(assets) {
  if (!(assets instanceof Map) || assets.size !== ASSET_FIXTURES.length) {
    fail('asset_invalid')
  }
  for (const { key } of ASSET_FIXTURES) {
    const bytes = assets.get(key)
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || secretLikeBytes(bytes)) {
      fail('asset_invalid')
    }
  }
  return assets
}

export function assertEmbeddedAssetParity(sourceAssets, embeddedAssets) {
  validateEmbeddedAssets(sourceAssets)
  validateEmbeddedAssets(embeddedAssets)
  for (const { key } of ASSET_FIXTURES) {
    if (!sourceAssets.get(key).equals(embeddedAssets.get(key))) {
      fail('asset_parity_mismatch')
    }
  }
  return true
}

export function validateDownloadResponse({ requestedUrl, finalUrl, status }) {
  let requested
  let final
  try {
    requested = new URL(requestedUrl)
    final = new URL(finalUrl)
  } catch {
    fail('download_invalid')
  }
  if (
    status !== 200 ||
    requested.href !== final.href ||
    final.protocol !== 'https:' ||
    final.hostname !== 'nodejs.org' ||
    !/^\/download\/release\/v22\.[0-9]+\.[0-9]+\/node-v22\.[0-9]+\.[0-9]+-darwin-(?:arm64|x64)\.tar\.xz$/u.test(final.pathname)
  ) {
    fail('download_invalid')
  }
  return final.href
}

export function assertFreshStaging({ exists }) {
  if (exists !== false) fail('stale_staging')
  return true
}

export function parseMachOArchitectures(fileOutput) {
  if (typeof fileOutput !== 'string' || !fileOutput.includes('Mach-O')) {
    fail('architecture_mismatch')
  }
  const detected = []
  if (/\barm64\b/u.test(fileOutput)) detected.push('arm64')
  if (/\bx86_64\b/u.test(fileOutput)) detected.push('x64')
  return detected
}

export function createArchitecturePaths({
  architecture,
  artifactRoot = DEFAULT_ARTIFACT_ROOT,
  manifest = loadBuildManifest(),
}) {
  if (!ARCHITECTURES.includes(architecture)) fail('architecture_invalid')
  const root = resolve(artifactRoot, architecture)
  return Object.freeze({
    root,
    archive: resolve(root, `node-v${manifest.nodeVersion}-darwin-${architecture}.tar.xz`),
    extracted: resolve(root, 'node'),
    assetRoot: resolve(root, 'assets'),
    bundle: resolve(root, 'test-tool-operator.bundle.cjs'),
    seaConfig: resolve(root, 'sea-config.json'),
    blob: resolve(root, 'sea-prep.blob'),
    executable: resolve(root, manifest.architectures[architecture].outputName),
    record: resolve(root, 'staging-record.json'),
  })
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    })
  } catch {
    fail('build_command_failed')
  }
}

async function downloadPinnedArchive(url) {
  let response
  try {
    response = await fetch(url, { redirect: 'manual' })
  } catch {
    fail('download_invalid')
  }
  validateDownloadResponse({
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
  })
  return Buffer.from(await response.arrayBuffer())
}

function scanStagingPrivacy(paths) {
  const files = [paths.bundle, paths.blob, paths.executable]
  for (const path of files) {
    const bytes = readFileSync(path)
    if (
      bytes.includes(Buffer.from(PROJECT_ROOT)) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(bytes.toString('utf8')) ||
      /"private_key"\s*:/u.test(bytes.toString('utf8')) ||
      /ya29\.[A-Za-z0-9_-]{16,}/u.test(bytes.toString('utf8'))
    ) {
      fail('privacy_scan_failed')
    }
  }
}

export async function buildArchitecture({
  architecture,
  artifactRoot = DEFAULT_ARTIFACT_ROOT,
  manifest = loadBuildManifest(),
} = {}) {
  const validated = validateBuildManifest(manifest)
  if (!ARCHITECTURES.includes(architecture)) fail('architecture_invalid')
  const paths = createArchitecturePaths({ architecture, artifactRoot, manifest: validated })
  assertFreshStaging({ exists: existsSync(paths.root) })
  mkdirSync(paths.root, { recursive: true })
  mkdirSync(paths.extracted, { recursive: true })
  mkdirSync(paths.assetRoot, { recursive: true })

  const packageLock = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package-lock.json'), 'utf8'))
  validatePinnedBuildTooling(validated, packageLock)
  const sourceAssets = new Map(
    validated.assets.map((asset) => [asset.key, readFileSync(resolve(PROJECT_ROOT, asset.source))]),
  )
  validateEmbeddedAssets(sourceAssets)
  for (const [key, bytes] of sourceAssets) {
    writeFileSync(resolve(paths.assetRoot, key), bytes, { mode: 0o600 })
  }

  const architectureManifest = validated.architectures[architecture]
  const archiveBytes = await downloadPinnedArchive(architectureManifest.archiveUrl)
  verifySha256(archiveBytes, architectureManifest.archiveSha256)
  writeFileSync(paths.archive, archiveBytes, { mode: 0o600 })
  await run('/usr/bin/tar', ['-xJf', paths.archive, '-C', paths.extracted, '--strip-components=1'])

  const bundler = await import('esbuild')
  if (bundler.version !== validated.bundler.version) fail('bundler_pin_invalid')
  await bundler.build(createBundleOptions({
    manifest: validated,
    architecture,
    outfile: paths.bundle,
  }))
  assertGeneratedCommonJsBundle(readFileSync(paths.bundle, 'utf8'))

  const seaConfiguration = createSeaConfiguration({
    manifest: validated,
    architecture,
    entryPath: paths.bundle,
    blobPath: paths.blob,
  })
  writeFileSync(paths.seaConfig, `${JSON.stringify(seaConfiguration, null, 2)}\n`, { mode: 0o600 })

  const nodeExecutable = resolve(paths.extracted, 'bin/node')
  await run(
    nodeExecutable,
    ['--experimental-sea-config', basename(paths.seaConfig)],
    { cwd: paths.root },
  )
  copyFileSync(nodeExecutable, paths.executable)
  chmodSync(paths.executable, 0o755)
  await run('/usr/bin/codesign', ['--remove-signature', paths.executable])
  await run(process.execPath, [
    resolve(PROJECT_ROOT, 'node_modules/postject/dist/cli.js'),
    paths.executable,
    'NODE_SEA_BLOB',
    paths.blob,
    '--sentinel-fuse',
    SEA_FUSE,
    '--macho-segment-name',
    'NODE_SEA',
  ])

  const fileInspection = await run('/usr/bin/file', ['-b', paths.executable])
  verifyArtifactArchitecture({
    declaredArchitecture: architecture,
    detectedArchitectures: parseMachOArchitectures(fileInspection.stdout),
  })
  scanStagingPrivacy(paths)
  await run('/usr/bin/codesign', ['--force', '--sign', '-', paths.executable])

  const manifestHash = createBuildManifestHash()
  const executableSha256 = createHash('sha256')
    .update(readFileSync(paths.executable))
    .digest('hex')
  const record = createStagingRecord({
    architecture,
    manifest: validated,
    manifestHash,
    executableSha256,
  })
  writeFileSync(paths.record, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return Object.freeze({ paths, record })
}

export async function runBuildCli(args = process.argv.slice(2)) {
  const selection = parseBuildArguments(args)
  const results = []
  for (const architecture of selection.architectures) {
    results.push(await buildArchitecture({ architecture }))
  }
  return results
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null
if (import.meta.url === invokedUrl) {
  runBuildCli().then((results) => {
    console.log(JSON.stringify({
      status: 'staged',
      architectures: results.map(({ record }) => record.architecture),
    }))
  }).catch((error) => {
    console.error(JSON.stringify({
      status: 'error',
      code: error instanceof MacOSBuildError ? error.code : 'build_failed',
    }))
    process.exitCode = 1
  })
}
