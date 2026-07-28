export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Return null for a well-shaped named invalid case, otherwise a concise
 * fixture_format summary.
 *
 * @param {unknown} testCase
 * @returns {string | null}
 */
export function invalidCaseFormatError(testCase) {
  if (!isPlainObject(testCase)) return 'invalid case must be an object';
  if (typeof testCase.name !== 'string' || testCase.name.length === 0) {
    return 'case missing a non-empty string "name"';
  }
  if (!Object.prototype.hasOwnProperty.call(testCase, 'input')) {
    return 'case missing "input"';
  }
  if (typeof testCase.expectedError !== 'string' || testCase.expectedError.length === 0) {
    return 'case missing a non-empty string "expectedError"';
  }
  return null;
}

/**
 * Parse fixture JSON into a result object so callers can report fixture_format
 * without leaking a raw parser stack trace.
 *
 * @param {string} source
 * @returns {{ ok: true, value: unknown } | { ok: false, summary: string }}
 */
export function parseFixtureJson(source) {
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false, summary: 'fixture contains invalid JSON' };
  }
}

const RETRY_EXPECTATIONS = new Set(['retry_mismatch', 'distinct', 'fixture_format']);

/**
 * @param {unknown} testCase
 * @returns {string | null}
 */
export function retryCaseFormatError(testCase) {
  if (!isPlainObject(testCase)) return 'retry case must be an object';
  if (typeof testCase.name !== 'string' || testCase.name.length === 0) {
    return 'retry case missing a non-empty string "name"';
  }
  if (!RETRY_EXPECTATIONS.has(testCase.expected)) {
    return 'retry case has an unknown "expected" value';
  }

  const hasOriginal = Object.prototype.hasOwnProperty.call(testCase, 'original');
  const hasRetry = Object.prototype.hasOwnProperty.call(testCase, 'retry');
  if (testCase.expected === 'fixture_format') {
    if (!hasOriginal && !hasRetry) {
      return 'malformed retry case must include at least one delivery';
    }
    return null;
  }
  if (!hasOriginal || !hasRetry) return 'retry case missing "original" or "retry"';
  return null;
}

/**
 * @param {unknown} testCase
 * @returns {string | null}
 */
export function timeCaseFormatError(testCase) {
  if (!isPlainObject(testCase)) return 'time-source case must be an object';
  if (typeof testCase.name !== 'string' || testCase.name.length === 0) {
    return 'time-source case missing a non-empty string "name"';
  }
  if (!(testCase.recordedAtMs === null || Number.isInteger(testCase.recordedAtMs))) {
    return 'time-source case "recordedAtMs" must be an integer or null';
  }
  if (!Number.isInteger(testCase.receivedAtMs)) {
    return 'time-source case "receivedAtMs" must be an integer';
  }
  if (!isPlainObject(testCase.expected)) {
    return 'time-source case missing an object "expected"';
  }
  if (!Number.isInteger(testCase.expected.effectiveAtMs)) {
    return 'time-source expected "effectiveAtMs" must be an integer';
  }
  if (!['device', 'server'].includes(testCase.expected.timeSource)) {
    return 'time-source expected "timeSource" must be "device" or "server"';
  }
  if (
    !(
      testCase.expected.recordedAtMs === null ||
      Number.isInteger(testCase.expected.recordedAtMs)
    )
  ) {
    return 'time-source expected "recordedAtMs" must be an integer or null';
  }
  return null;
}

/**
 * @param {{ urination: number, battery: number, retry: number, invalid: number }} coverage
 * @returns {string[]}
 */
export function missingRequiredFixtureCoverage(coverage) {
  const missing = [];
  if (coverage.urination === 0) missing.push('valid urination');
  if (coverage.battery === 0) missing.push('valid battery');
  if (coverage.retry === 0) missing.push('identical retry');
  if (coverage.invalid === 0) missing.push('named invalid');
  return missing;
}

const REQUIRED_INVALID_COVERAGE = [
  'unknown_property',
  'unsupported_schema_version',
  'device_mismatch',
  'string_duration',
  'invalid_battery_tier',
  'invalid_event_id',
  'invalid_recorded_time',
];

/**
 * @param {Set<string>} covered
 * @returns {string[]}
 */
export function missingRequiredInvalidCoverage(covered) {
  return REQUIRED_INVALID_COVERAGE.filter((requirement) => !covered.has(requirement));
}

/**
 * Validate the cross-event premise for a distinct-after-restart fixture.
 * Standalone envelope validation is performed by the caller first.
 *
 * @param {{ payload: { eventId: string, sequence: number } }} original
 * @param {{ payload: { eventId: string, sequence: number } }} retry
 * @returns {string | null}
 */
export function distinctRetryExpectationError(original, retry) {
  if (original.payload.sequence !== retry.payload.sequence) {
    return 'distinct events must reuse the same sequence';
  }
  if (original.payload.eventId === retry.payload.eventId) {
    return 'distinct events must use different eventId values';
  }
  return null;
}
