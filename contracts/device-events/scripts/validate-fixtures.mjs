#!/usr/bin/env node
// Executable contract test entry point (`npm test`).
//
// Loads every fixture group, runs each case through the contract validator, and
// asserts the outcome. Exits 0 with a passing report when every case matches
// its expectation; exits non-zero and writes the offending fixture name, stable
// error code, and validation summary to stderr otherwise.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadValidators } from '../lib/validators.mjs';
import { validateEnvelope } from '../lib/validate-envelope.mjs';
import { compareRetry } from '../lib/retry.mjs';
import { deriveEffectiveTime } from '../lib/effective-time.mjs';
import { ERROR_CODES, ALL_ERROR_CODES } from '../lib/error-codes.mjs';
import { discoverFixtureFiles } from '../lib/fixture-files.mjs';
import {
  distinctRetryExpectationError,
  invalidCaseFormatError,
  isPlainObject,
  missingRequiredInvalidCoverage,
  missingRequiredFixtureCoverage,
  parseFixtureJson,
  retryCaseFormatError,
  timeCaseFormatError,
} from '../lib/fixture-format.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

function readFixture(relativePath) {
  try {
    return parseFixtureJson(readFileSync(join(fixturesDir, relativePath), 'utf8'));
  } catch {
    return { ok: false, summary: 'fixture could not be read' };
  }
}

// Compile all schemas once under AJV 2020 strict mode. A malformed schema
// (unknown keyword or unresolved $ref) throws here and fails the run loudly.
const validators = loadValidators();

const failures = [];
let caseCount = 0;

function fail(name, error, summary) {
  failures.push({ name, error, summary });
}

const fixtureFiles = discoverFixtureFiles(fixturesDir);
const filesIn = (group) => fixtureFiles.filter((file) => file.startsWith(`${group}/`));
const knownFiles = new Set(
  ['valid', 'invalid', 'retry', 'time-source'].flatMap((group) => filesIn(group)),
);
const loadedFixtures = new Map();
const coverage = { urination: 0, battery: 0, retry: 0, invalid: 0 };
const invalidCoverage = new Set();

for (const file of fixtureFiles) {
  if (!knownFiles.has(file)) {
    caseCount += 1;
    fail(
      file,
      ERROR_CODES.FIXTURE_FORMAT,
      'fixture must be placed under valid, invalid, retry, or time-source',
    );
  }
}

for (const file of knownFiles) {
  const loaded = readFixture(file);
  if (!loaded.ok) {
    caseCount += 1;
    fail(file, ERROR_CODES.FIXTURE_FORMAT, loaded.summary);
  } else {
    loadedFixtures.set(file, loaded.value);
  }
}

// --- Valid envelope fixtures: must pass with no error. ---------------------
for (const file of filesIn('valid')) {
  if (!loadedFixtures.has(file)) continue;
  caseCount += 1;
  const fixture = loadedFixtures.get(file);
  const retryLike =
    isPlainObject(fixture) &&
    (Object.prototype.hasOwnProperty.call(fixture, 'original') ||
      Object.prototype.hasOwnProperty.call(fixture, 'retry'));
  if (retryLike && (!fixture.original || !fixture.retry)) {
    fail(file, ERROR_CODES.FIXTURE_FORMAT, 'retry fixture missing "original" or "retry"');
    continue;
  }
  const result = retryLike
    ? compareRetry(fixture.original, fixture.retry, validators)
    : validateEnvelope(fixture, validators);
  if (!result.ok) fail(file, result.error, result.summary);
  else if (retryLike) coverage.retry += 1;
  else if (result.schemaKey === 'urination') coverage.urination += 1;
  else if (result.schemaKey === 'battery') coverage.battery += 1;
}

// --- Named invalid cases: each must fail with its expected error code. ------
for (const file of filesIn('invalid')) {
  if (!loadedFixtures.has(file)) continue;
  const cases = loadedFixtures.get(file);
  if (!Array.isArray(cases)) {
    caseCount += 1;
    fail(file, ERROR_CODES.FIXTURE_FORMAT, 'invalid fixture manifest must be an array');
    continue;
  }
  for (const testCase of cases) {
    caseCount += 1;
    const name = isPlainObject(testCase) ? testCase.name : undefined;
    const label = `${file} :: ${name ?? '(unnamed)'}`;
    const formatError = invalidCaseFormatError(testCase);
    if (formatError) {
      fail(label, ERROR_CODES.FIXTURE_FORMAT, formatError);
      continue;
    }
    if (!ALL_ERROR_CODES.includes(testCase.expectedError)) {
      fail(label, ERROR_CODES.FIXTURE_FORMAT, `unknown expectedError "${testCase.expectedError}"`);
      continue;
    }
    const result = validateEnvelope(testCase.input, validators);
    if (result.ok) {
      fail(
        label,
        ERROR_CODES.FIXTURE_EXPECTATION,
        `expected ${testCase.expectedError} but the case passed`,
      );
    } else if (result.error !== testCase.expectedError) {
      fail(label, result.error, `expected ${testCase.expectedError}, got ${result.error}: ${result.summary}`);
    } else {
      coverage.invalid += 1;
      if (typeof testCase.covers === 'string') invalidCoverage.add(testCase.covers);
    }
  }
}

// --- Retry cases: retry_mismatch, distinct events, or malformed pairs. ------
for (const file of filesIn('retry')) {
  if (!loadedFixtures.has(file)) continue;
  const cases = loadedFixtures.get(file);
  if (!Array.isArray(cases)) {
    caseCount += 1;
    fail(file, ERROR_CODES.FIXTURE_FORMAT, 'retry fixture manifest must be an array');
    continue;
  }
  for (const testCase of cases) {
    caseCount += 1;
    const name = isPlainObject(testCase) ? testCase.name : undefined;
    const label = `${file} :: ${name ?? '(unnamed)'}`;
    const formatError = retryCaseFormatError(testCase);
    if (formatError) {
      fail(label, ERROR_CODES.FIXTURE_FORMAT, formatError);
      continue;
    }

    if (testCase.expected === 'fixture_format') {
      const hasOriginal = Object.prototype.hasOwnProperty.call(testCase, 'original');
      const hasRetry = Object.prototype.hasOwnProperty.call(testCase, 'retry');
      const originalResult = hasOriginal
        ? validateEnvelope(testCase.original, validators)
        : { ok: false, error: ERROR_CODES.FIXTURE_FORMAT };
      const retryResult = hasRetry
        ? validateEnvelope(testCase.retry, validators)
        : { ok: false, error: ERROR_CODES.FIXTURE_FORMAT };
      if (
        originalResult.error !== ERROR_CODES.FIXTURE_FORMAT &&
        retryResult.error !== ERROR_CODES.FIXTURE_FORMAT
      ) {
        fail(
          label,
          ERROR_CODES.FIXTURE_EXPECTATION,
          'expected fixture_format but neither delivery produced fixture_format',
        );
      }
      continue;
    }

    if (testCase.expected === 'distinct') {
      // Same sequence, different eventId: the contract treats these as two
      // separate events, so both must validate and their eventIds must differ.
      const a = validateEnvelope(testCase.original, validators);
      const b = validateEnvelope(testCase.retry, validators);
      if (!a.ok) fail(label, a.error, `original delivery invalid: ${a.summary}`);
      else if (!b.ok) fail(label, b.error, `second delivery invalid: ${b.summary}`);
      else {
        const expectationError = distinctRetryExpectationError(
          testCase.original,
          testCase.retry,
        );
        if (expectationError) {
          fail(label, ERROR_CODES.FIXTURE_EXPECTATION, expectationError);
        }
      }
      continue;
    }

    const result = compareRetry(testCase.original, testCase.retry, validators);
    if (result.ok) {
      fail(
        label,
        ERROR_CODES.FIXTURE_EXPECTATION,
        `expected ${testCase.expected} but the retry matched`,
      );
    } else if (result.error !== testCase.expected) {
      fail(label, result.error, `expected ${testCase.expected}, got ${result.error}: ${result.summary}`);
    }
  }
}

// --- Time source derivation cases: exact effectiveAtMs / timeSource. --------
for (const file of filesIn('time-source')) {
  if (!loadedFixtures.has(file)) continue;
  const cases = loadedFixtures.get(file);
  if (!Array.isArray(cases)) {
    caseCount += 1;
    fail(file, ERROR_CODES.FIXTURE_FORMAT, 'time-source fixture manifest must be an array');
    continue;
  }
  for (const testCase of cases) {
    caseCount += 1;
    const name = isPlainObject(testCase) ? testCase.name : undefined;
    const label = `${file} :: ${name ?? '(unnamed)'}`;
    const formatError = timeCaseFormatError(testCase);
    if (formatError) {
      fail(label, ERROR_CODES.FIXTURE_FORMAT, formatError);
      continue;
    }
    const derived = deriveEffectiveTime(testCase.recordedAtMs, testCase.receivedAtMs);
    const { expected } = testCase;
    const mismatch =
      derived.effectiveAtMs !== expected.effectiveAtMs ||
      derived.timeSource !== expected.timeSource ||
      derived.recordedAtMs !== expected.recordedAtMs;
    if (mismatch) {
      fail(
        label,
        ERROR_CODES.FIXTURE_EXPECTATION,
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(derived)}`,
      );
    }
  }
}

for (const missing of missingRequiredFixtureCoverage(coverage)) {
  caseCount += 1;
  fail('fixture suite', ERROR_CODES.FIXTURE_FORMAT, `missing required ${missing} fixture`);
}
for (const missing of missingRequiredInvalidCoverage(invalidCoverage)) {
  caseCount += 1;
  fail(
    'fixture suite',
    ERROR_CODES.FIXTURE_FORMAT,
    `missing required invalid coverage "${missing}"`,
  );
}

// --- Report ----------------------------------------------------------------
if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`FAIL  ${failure.name}\n      code=${failure.error}\n      ${failure.summary}\n`);
  }
  process.stderr.write(`\n${failures.length} of ${caseCount} contract fixtures failed.\n`);
  process.exit(1);
}

process.stdout.write(`PASS  all ${caseCount} device event contract fixtures validated.\n`);
process.exit(0);
