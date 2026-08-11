import { describe, expect, it } from 'vitest'

import {
  TestToolApiConfigurationError,
  parseTestToolApiConfig,
} from './test-tool-api-config'

const approvedOrigin =
  'https://peecare-test-tool-development-348528459946.asia-east1.run.app'

function validEnv() {
  return {
    MODE: 'production',
    PROD: true,
    VITE_FIREBASE_ENVIRONMENT: 'development',
    VITE_FIREBASE_PROJECT_ID: 'petcare-c7483',
    VITE_FIREBASE_APPROVED_PROJECT_ID: 'petcare-c7483',
    VITE_TEST_TOOL_API_URL: approvedOrigin,
  }
}

describe('Test Tool API Web configuration', () => {
  it('returns the exact approved HTTPS service origin', () => {
    expect(parseTestToolApiConfig(validEnv()).baseUrl.href).toBe(`${approvedOrigin}/`)
  })

  it.each([undefined, '', '   '])('rejects a missing origin: %j', (value) => {
    expect(() =>
      parseTestToolApiConfig({ ...validEnv(), VITE_TEST_TOOL_API_URL: value }),
    ).toThrowError(expect.objectContaining({ code: 'missing_test_tool_api_url' }))
  })

  it.each([
    'not-a-url',
    'http://peecare-test-tool-development-348528459946.asia-east1.run.app',
    'https://user:password@peecare-test-tool-development-348528459946.asia-east1.run.app',
    `${approvedOrigin}/v1`,
    `${approvedOrigin}?source=release`,
    `${approvedOrigin}#tool`,
    'https://127.0.0.1:8088',
    'https://localhost',
    'https://peecare-test-tool-development-other-project.asia-east1.run.app',
    'https://other-service-348528459946.asia-east1.run.app',
    'https://peecare-test-tool-development-348528459946.us-central1.run.app',
  ])('rejects unsafe or wrong-target origin %s', (value) => {
    expect(() =>
      parseTestToolApiConfig({ ...validEnv(), VITE_TEST_TOOL_API_URL: value }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_test_tool_api_url' }))
  })

  it.each([
    ['local Firebase environment', { VITE_FIREBASE_ENVIRONMENT: 'local' }],
    ['wrong Firebase project', { VITE_FIREBASE_PROJECT_ID: 'other-project' }],
    ['wrong approved project', { VITE_FIREBASE_APPROVED_PROJECT_ID: 'other-project' }],
    ['non-production Vite mode', { MODE: 'development', PROD: false }],
  ])('rejects %s before an adapter is created', (_case, override) => {
    expect(() => parseTestToolApiConfig({ ...validEnv(), ...override })).toThrow(
      TestToolApiConfigurationError,
    )
  })
})
