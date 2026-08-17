// @vitest-environment node

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  FIXED_QUALIFICATION_CHECKS,
  validateReleaseRecord,
  verifyArchitectureReleaseEvidence,
  verifyPairedRelease,
} from './test-tool-macos-verify.mjs'
import {
  createBuildManifestHash,
  loadBuildManifest,
} from './test-tool-macos-build.mjs'

const TEAM_IDENTIFIER = 'ABCDE12345'
const MANIFEST_HASH = createBuildManifestHash()

function buildManifestFixture() {
  return loadBuildManifest()
}

function checksFixture() {
  return Object.fromEntries(
    FIXED_QUALIFICATION_CHECKS.map((name: string) => [name, 'passed']),
  )
}

function recordFixture(architecture: 'arm64' | 'x64', executableBytes = Buffer.from(architecture)) {
  return {
    schemaVersion: 1,
    applicationVersion: '0.0.0',
    architecture,
    minimumMacOS: architecture === 'arm64' ? '14.8.8' : '14.6.0',
    nodeVersion: '22.23.2',
    inputManifestHash: MANIFEST_HASH,
    executableSha256: createHash('sha256').update(executableBytes).digest('hex'),
    signatureTeamIdentifier: TEAM_IDENTIFIER,
    notarizationSubmissionIdentifier:
      architecture === 'arm64'
        ? '11111111-1111-4111-8111-111111111111'
        : '22222222-2222-4222-8222-222222222222',
    qualificationHostArchitecture: architecture,
    qualificationHostVersion: architecture === 'arm64' ? '14.8.8' : '14.6.0',
    verificationTime: '2026-08-12T12:00:00.000Z',
    namedCheckStatuses: checksFixture(),
  }
}

function evidenceFixture(architecture: 'arm64' | 'x64', executableBytes = Buffer.from(architecture)) {
  const record = recordFixture(architecture, executableBytes)
  return {
    record,
    executableBytes,
    fileOutput: `Mach-O 64-bit executable ${architecture === 'arm64' ? 'arm64' : 'x86_64'}`,
    codesign: {
      exitCode: 0,
      output: [
        'Authority=Developer ID Application: PeeCare Internal (ABCDE12345)',
        'TeamIdentifier=ABCDE12345',
        'Timestamp=Aug 12, 2026 at 12:00:00',
        'flags=0x10000(runtime)',
      ].join('\n'),
    },
    notarization: {
      exitCode: 0,
      status: 'Accepted',
      submissionIdentifier: record.notarizationSubmissionIdentifier,
    },
    gatekeeper: {
      exitCode: 0,
      output: `/release/peecare-test-tool-macos-${architecture}: accepted\nsource=Notarized Developer ID`,
    },
    privacyFindings: [],
  }
}

describe('sanitized architecture release records', () => {
  it('fixes every named build and native qualification check', () => {
    expect(FIXED_QUALIFICATION_CHECKS).toEqual([
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
  })

  it.each(['arm64', 'x64'] as const)(
    'accepts the exact fixed %s record schema',
    (architecture) => {
      const record = recordFixture(architecture)

      expect(validateReleaseRecord(record, buildManifestFixture())).toEqual(record)
      expect(Object.keys(record).sort()).toEqual([
        'applicationVersion',
        'architecture',
        'executableSha256',
        'inputManifestHash',
        'minimumMacOS',
        'namedCheckStatuses',
        'nodeVersion',
        'notarizationSubmissionIdentifier',
        'qualificationHostArchitecture',
        'qualificationHostVersion',
        'schemaVersion',
        'signatureTeamIdentifier',
        'verificationTime',
      ])
    },
  )

  it.each([
    ['local path', { localPath: '/Users/operator/release' }],
    ['account identity', { account: 'operator@example.test' }],
    ['secret version', { secretVersion: '7' }],
  ])('rejects a record containing %s', (_label, extra) => {
    expect(() => validateReleaseRecord({ ...recordFixture('arm64'), ...extra })).toThrow()
  })

  it('rejects a failed named qualification check', () => {
    const record = recordFixture('x64')
    record.namedCheckStatuses.gatekeeper = 'failed'

    expect(() => validateReleaseRecord(record, buildManifestFixture())).toThrow()
  })

  it.each(['14.7.0', '15.0.0'])(
    'rejects x64 qualification on newer-only Intel macOS %s',
    (qualificationHostVersion) => {
      const record = recordFixture('x64')
      record.qualificationHostVersion = qualificationHostVersion

      expect(() =>
        validateReleaseRecord(record, buildManifestFixture()),
      ).toThrow()
    },
  )

  it.each([
    ['arm64', '14.6.0'],
    ['x64', '14.8.8'],
  ] as const)(
    'rejects a %s record whose floor is paired with the other architecture',
    (architecture, minimumMacOS) => {
      const record = recordFixture(architecture)
      record.minimumMacOS = minimumMacOS

      expect(() =>
        validateReleaseRecord(record, buildManifestFixture()),
      ).toThrow()
    },
  )
})

describe('signed, notarized, Gatekeeper and privacy evidence', () => {
  it.each(['arm64', 'x64'] as const)('accepts complete %s evidence', (architecture) => {
    const evidence = evidenceFixture(architecture)

    expect(verifyArchitectureReleaseEvidence(evidence)).toEqual(evidence.record)
  })

  it('rejects unsigned evidence', () => {
    const evidence = evidenceFixture('arm64')
    evidence.codesign = { exitCode: 1, output: 'code object is not signed at all' }

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })

  it('rejects ad-hoc evidence', () => {
    const evidence = evidenceFixture('arm64')
    evidence.codesign.output = 'Signature=adhoc\nTeamIdentifier=not set\nflags=0x2(adhoc)'

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })

  it('rejects a signature without Hardened Runtime or secure timestamp', () => {
    const evidence = evidenceFixture('arm64')
    evidence.codesign.output = [
      'Authority=Developer ID Application: PeeCare Internal (ABCDE12345)',
      'TeamIdentifier=ABCDE12345',
    ].join('\n')

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })

  it('rejects unnotarized evidence', () => {
    const evidence = evidenceFixture('x64')
    evidence.notarization = {
      exitCode: 1,
      status: 'Invalid',
      submissionIdentifier: evidence.record.notarizationSubmissionIdentifier,
    }

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })

  it('rejects failed Gatekeeper evidence', () => {
    const evidence = evidenceFixture('x64')
    evidence.gatekeeper = { exitCode: 1, output: 'rejected' }

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })

  it('rejects privacy-positive evidence', () => {
    const evidence = evidenceFixture('arm64')
    evidence.privacyFindings = ['embedded_private_key']

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })

  it('rejects executable checksum drift', () => {
    const evidence = evidenceFixture('arm64')
    evidence.executableBytes = Buffer.from('tampered')

    expect(() => verifyArchitectureReleaseEvidence(evidence)).toThrow()
  })
})

describe('paired release gate', () => {
  it('rejects a single architecture record', () => {
    expect(() => verifyPairedRelease([recordFixture('arm64')])).toThrow()
  })

  it('rejects records from different source/build manifests', () => {
    const x64 = recordFixture('x64')
    x64.inputManifestHash = 'c'.repeat(64)

    expect(() => verifyPairedRelease([recordFixture('arm64'), x64])).toThrow()
  })

  it('rejects paired records that repeat the same stale manifest hash', () => {
    const arm64 = recordFixture('arm64')
    const x64 = recordFixture('x64')
    arm64.inputManifestHash = 'c'.repeat(64)
    x64.inputManifestHash = 'c'.repeat(64)

    expect(() =>
      verifyPairedRelease([arm64, x64], buildManifestFixture()),
    ).toThrow()
  })

  it('accepts exactly one healthy arm64 and one healthy x64 record', () => {
    const arm64 = recordFixture('arm64')
    const x64 = recordFixture('x64')

    expect(verifyPairedRelease([arm64, x64], buildManifestFixture())).toEqual({ arm64, x64 })
  })
})
