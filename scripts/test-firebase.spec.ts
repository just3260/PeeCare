import { describe, expect, it } from 'vitest'

import { FIREBASE_SUITES } from './test-firebase.mjs'

describe('Firebase Emulator workspace orchestration', () => {
  it('runs the Test Tool API integration after the root, Member, and Ingestion suites', () => {
    expect(FIREBASE_SUITES).toHaveLength(4)
    expect(FIREBASE_SUITES[2][1]).toContain(
      'test/test-tool-event-to-projection.integration.test.ts',
    )
    expect(FIREBASE_SUITES[3]).toEqual([
      'npm',
      [
        '--prefix',
        'services/test-tool-api',
        'test',
        '--',
        '--run',
        'test/test-device-firestore.integration.test.ts',
      ],
    ])
  })
})
