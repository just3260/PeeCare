export const APPROVED_TEST_TOOL_API_ORIGIN =
  'https://peecare-test-tool-development-5hvpf2z3tq-de.a.run.app'
export const APPROVED_TEST_TOOL_PROJECT_ID = 'petcare-c7483'

export type TestToolApiConfigErrorCode =
  | 'missing_test_tool_api_url'
  | 'invalid_test_tool_api_url'
  | 'invalid_test_tool_environment'

export class TestToolApiConfigurationError extends Error {
  readonly code: TestToolApiConfigErrorCode

  constructor(code: TestToolApiConfigErrorCode, message: string) {
    super(message)
    this.name = 'TestToolApiConfigurationError'
    this.code = code
    Object.setPrototypeOf(this, TestToolApiConfigurationError.prototype)
  }
}

export interface RawTestToolApiEnv {
  readonly MODE?: string
  readonly PROD?: boolean
  readonly VITE_FIREBASE_ENVIRONMENT?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APPROVED_PROJECT_ID?: string
  readonly VITE_TEST_TOOL_API_URL?: string
}

export interface TestToolApiConfig {
  readonly baseUrl: URL
}

/** Validate the deployment-injected origin before constructing the browser adapter. */
export function parseTestToolApiConfig(env: RawTestToolApiEnv): TestToolApiConfig {
  if (
    env.MODE !== 'production' ||
    env.PROD !== true ||
    env.VITE_FIREBASE_ENVIRONMENT !== 'development' ||
    env.VITE_FIREBASE_PROJECT_ID !== APPROVED_TEST_TOOL_PROJECT_ID ||
    env.VITE_FIREBASE_APPROVED_PROJECT_ID !== APPROVED_TEST_TOOL_PROJECT_ID
  ) {
    throw new TestToolApiConfigurationError(
      'invalid_test_tool_environment',
      'The Test Tool API is available only in the approved development Web build.',
    )
  }

  const raw = env.VITE_TEST_TOOL_API_URL
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new TestToolApiConfigurationError(
      'missing_test_tool_api_url',
      'VITE_TEST_TOOL_API_URL is required for the development tester tool.',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new TestToolApiConfigurationError(
      'invalid_test_tool_api_url',
      'VITE_TEST_TOOL_API_URL must be the approved exact HTTPS origin.',
    )
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (raw !== parsed.origin && raw !== `${parsed.origin}/`) ||
    parsed.origin !== APPROVED_TEST_TOOL_API_ORIGIN
  ) {
    throw new TestToolApiConfigurationError(
      'invalid_test_tool_api_url',
      'VITE_TEST_TOOL_API_URL must be the approved exact HTTPS origin.',
    )
  }

  return Object.freeze({ baseUrl: new URL(`${parsed.origin}/`) })
}
