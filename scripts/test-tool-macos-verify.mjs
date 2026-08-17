import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createBuildManifestHash,
  loadBuildManifest,
  parseMachOArchitectures,
  validateBuildManifest,
  verifyArtifactArchitecture,
} from './test-tool-macos-build.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..')
const RELEASE_ROOT = resolve(PROJECT_ROOT, 'artifacts/test-tool-macos/release')
const ARCHITECTURES = Object.freeze(['arm64', 'x64'])
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const TEAM_IDENTIFIER_PATTERN = /^[A-Z0-9]{10}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'applicationVersion',
  'architecture',
  'minimumMacOS',
  'nodeVersion',
  'inputManifestHash',
  'executableSha256',
  'signatureTeamIdentifier',
  'notarizationSubmissionIdentifier',
  'qualificationHostArchitecture',
  'qualificationHostVersion',
  'verificationTime',
  'namedCheckStatuses',
])

export const FIXED_QUALIFICATION_CHECKS = Object.freeze([
  'quarantineLaunch',
  'architectureGate',
  'runtimeGate',
  'embeddedAssetInventory',
  'gcloudDenialMatrix',
  'localRegression',
  'developmentHealth',
  'developmentEvent',
  'outputPrivacy',
  'browserFallback',
  'signalCleanup',
  'signature',
  'notarization',
  'gatekeeper',
])

export class MacOSVerificationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'MacOSVerificationError'
    this.code = code
  }
}

function fail(code = 'release_verification_failed') {
  throw new MacOSVerificationError(code)
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

function parseVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) fail()
  return version.split('.').map(Number)
}

function versionAtLeast(actual, minimum) {
  const actualParts = parseVersion(actual)
  const minimumParts = parseVersion(minimum)
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true
    if (actualParts[index] < minimumParts[index]) return false
  }
  return true
}

function validIsoInstant(value) {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

function qualificationHostVersionAllowed(record) {
  if (record.architecture === 'x64') {
    const [major, minor] = parseVersion(record.qualificationHostVersion)
    return major === 14 && minor === 6
  }
  return versionAtLeast(record.qualificationHostVersion, record.minimumMacOS)
}

export function validateReleaseRecord(record, manifest = loadBuildManifest()) {
  const validatedManifest = validateBuildManifest(manifest)
  const expectedMinimumMacOS =
    validatedManifest.architectures?.[record?.architecture]?.minimumMacOS
  if (
    !exactKeys(record, RECORD_KEYS) ||
    record.schemaVersion !== 1 ||
    !VERSION_PATTERN.test(record.applicationVersion) ||
    !ARCHITECTURES.includes(record.architecture) ||
    record.minimumMacOS !== expectedMinimumMacOS ||
    record.nodeVersion !== '22.23.2' ||
    record.inputManifestHash !== createBuildManifestHash() ||
    !SHA256_PATTERN.test(record.executableSha256) ||
    !TEAM_IDENTIFIER_PATTERN.test(record.signatureTeamIdentifier) ||
    !UUID_PATTERN.test(record.notarizationSubmissionIdentifier) ||
    record.qualificationHostArchitecture !== record.architecture ||
    !qualificationHostVersionAllowed(record) ||
    !validIsoInstant(record.verificationTime) ||
    !exactKeys(record.namedCheckStatuses, FIXED_QUALIFICATION_CHECKS) ||
    !FIXED_QUALIFICATION_CHECKS.every(
      (name) => record.namedCheckStatuses[name] === 'passed',
    )
  ) {
    fail()
  }
  return Object.freeze(structuredClone(record))
}

function verifyDeveloperIdSignature(codesign, teamIdentifier) {
  if (
    codesign?.exitCode !== 0 ||
    typeof codesign.output !== 'string' ||
    !codesign.output.includes('Authority=Developer ID Application:') ||
    !codesign.output.includes(`TeamIdentifier=${teamIdentifier}`) ||
    !/^Timestamp=.+$/mu.test(codesign.output) ||
    !/flags=.*\(runtime\)/u.test(codesign.output) ||
    /\badhoc\b/iu.test(codesign.output)
  ) {
    fail()
  }
}

function verifyNotarization(notarization, submissionIdentifier) {
  if (
    notarization?.exitCode !== 0 ||
    notarization.status !== 'Accepted' ||
    notarization.submissionIdentifier !== submissionIdentifier
  ) {
    fail()
  }
}

function verifyGatekeeper(gatekeeper) {
  if (
    gatekeeper?.exitCode !== 0 ||
    typeof gatekeeper.output !== 'string' ||
    !/(?:^|\n)[^\n]*: accepted(?:\n|$)/u.test(gatekeeper.output) ||
    !/(?:^|\n)source=Notarized Developer ID(?:\n|$)/u.test(gatekeeper.output)
  ) {
    fail()
  }
}

export function verifyArchitectureReleaseEvidence({
  record,
  manifest = loadBuildManifest(),
  executableBytes,
  fileOutput,
  codesign,
  notarization,
  gatekeeper,
  privacyFindings,
}) {
  const validated = validateReleaseRecord(record, manifest)
  if (!Buffer.isBuffer(executableBytes)) fail()
  const executableSha256 = createHash('sha256').update(executableBytes).digest('hex')
  if (executableSha256 !== validated.executableSha256) fail()
  verifyArtifactArchitecture({
    declaredArchitecture: validated.architecture,
    detectedArchitectures: parseMachOArchitectures(fileOutput),
  })
  verifyDeveloperIdSignature(codesign, validated.signatureTeamIdentifier)
  verifyNotarization(notarization, validated.notarizationSubmissionIdentifier)
  verifyGatekeeper(gatekeeper)
  if (!Array.isArray(privacyFindings) || privacyFindings.length !== 0) fail()
  return validated
}

export function verifyPairedRelease(records, manifest = loadBuildManifest()) {
  if (!Array.isArray(records) || records.length !== ARCHITECTURES.length) fail()
  const validated = records.map((record) => validateReleaseRecord(record, manifest))
  const byArchitecture = Object.fromEntries(
    validated.map((record) => [record.architecture, record]),
  )
  if (!exactKeys(byArchitecture, ARCHITECTURES)) fail()
  const arm64 = byArchitecture.arm64
  const x64 = byArchitecture.x64
  for (const key of [
    'applicationVersion',
    'nodeVersion',
    'inputManifestHash',
    'signatureTeamIdentifier',
  ]) {
    if (arm64[key] !== x64[key]) fail()
  }
  if (
    arm64.executableSha256 === x64.executableSha256 ||
    arm64.notarizationSubmissionIdentifier === x64.notarizationSubmissionIdentifier
  ) {
    fail()
  }
  return Object.freeze({ arm64, x64 })
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 4 * 1024 * 1024,
  })
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

function scanPrivacy(recordBytes, executableBytes) {
  const findings = []
  for (const [name, bytes] of [
    ['record', recordBytes],
    ['executable', executableBytes],
  ]) {
    const text = bytes.toString('utf8')
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text) ||
      /"private_key"\s*:/u.test(text) ||
      /ya29\.[A-Za-z0-9_-]{16,}/u.test(text)
    ) {
      findings.push(`${name}_secret_material`)
    }
  }
  return findings
}

function readArchitectureEvidence(architecture) {
  const root = resolve(RELEASE_ROOT, architecture)
  const executablePath = resolve(root, `peecare-test-tool-macos-${architecture}`)
  const recordPath = resolve(root, 'release-record.json')
  const recordBytes = readFileSync(recordPath)
  const executableBytes = readFileSync(executablePath)
  const record = JSON.parse(recordBytes.toString('utf8'))
  const signatureVerification = run('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--verbose=4',
    executablePath,
  ])
  const signatureDetails = run('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    executablePath,
  ])
  const stapler = run('/usr/bin/xcrun', ['stapler', 'validate', executablePath])
  return {
    record,
    executableBytes,
    fileOutput: run('/usr/bin/file', ['-b', executablePath]).output,
    codesign: {
      exitCode:
        signatureVerification.exitCode === 0 && signatureDetails.exitCode === 0
          ? 0
          : 1,
      output: `${signatureVerification.output}\n${signatureDetails.output}`,
    },
    notarization: {
      exitCode: stapler.exitCode,
      status: stapler.exitCode === 0 ? 'Accepted' : 'Invalid',
      submissionIdentifier: record.notarizationSubmissionIdentifier,
    },
    gatekeeper: run('/usr/sbin/spctl', [
      '--assess',
      '--type',
      'execute',
      '--verbose=4',
      executablePath,
    ]),
    privacyFindings: scanPrivacy(recordBytes, executableBytes),
  }
}

export function runVerificationCli(args = process.argv.slice(2)) {
  if (!Array.isArray(args) || args.length !== 0) fail('invalid_arguments')
  const records = ARCHITECTURES.map((architecture) =>
    verifyArchitectureReleaseEvidence(readArchitectureEvidence(architecture)),
  )
  return verifyPairedRelease(records)
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null
if (import.meta.url === invokedUrl) {
  try {
    const records = runVerificationCli()
    console.log(JSON.stringify({
      status: 'verified',
      inputManifestHash: records.arm64.inputManifestHash,
      executableSha256: {
        arm64: records.arm64.executableSha256,
        x64: records.x64.executableSha256,
      },
    }))
  } catch (error) {
    console.error(JSON.stringify({
      status: 'error',
      code: error instanceof MacOSVerificationError
        ? error.code
        : 'release_verification_failed',
    }))
    process.exitCode = 1
  }
}
