import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distinctRetryExpectationError,
  invalidCaseFormatError,
  missingRequiredInvalidCoverage,
  missingRequiredFixtureCoverage,
  parseFixtureJson,
  retryCaseFormatError,
  timeCaseFormatError,
} from '../lib/fixture-format.mjs';

test('accepts a complete named invalid case', () => {
  assert.equal(
    invalidCaseFormatError({
      name: 'bad schema version',
      input: {},
      expectedError: 'schema_validation',
    }),
    null,
  );
});

test('reports fixture_format details for every required invalid-case member', () => {
  assert.match(invalidCaseFormatError({ input: {}, expectedError: 'schema_validation' }), /name/);
  assert.match(invalidCaseFormatError({ name: 'missing input', expectedError: 'schema_validation' }), /input/);
  assert.match(invalidCaseFormatError({ name: 'missing error', input: {} }), /expectedError/);
  assert.match(invalidCaseFormatError(null), /object/);
});

test('parses JSON without exposing parser exceptions to the runner', () => {
  assert.deepEqual(parseFixtureJson('{"ok":true}'), { ok: true, value: { ok: true } });
  assert.deepEqual(parseFixtureJson('{'), {
    ok: false,
    summary: 'fixture contains invalid JSON',
  });
});

test('validates retry manifest members and expectation enum', () => {
  assert.equal(
    retryCaseFormatError({
      name: 'changed retry',
      expected: 'retry_mismatch',
      original: {},
      retry: {},
    }),
    null,
  );
  assert.match(retryCaseFormatError({ expected: 'fixture_format', original: {} }), /name/);
  assert.match(retryCaseFormatError({ name: 'empty malformed pair', expected: 'fixture_format' }), /delivery/);
  assert.match(
    retryCaseFormatError({ name: 'unknown', expected: 'anything', original: {}, retry: {} }),
    /expected/,
  );
});

test('validates complete integer time-source cases', () => {
  assert.equal(
    timeCaseFormatError({
      name: 'valid time',
      recordedAtMs: null,
      receivedAtMs: 1785168060000,
      expected: {
        effectiveAtMs: 1785168060000,
        timeSource: 'server',
        recordedAtMs: null,
      },
    }),
    null,
  );
  assert.match(
    timeCaseFormatError({
      name: 'string time',
      recordedAtMs: '1785168000000',
      receivedAtMs: 1785168060000,
      expected: {
        effectiveAtMs: 1785168000000,
        timeSource: 'device',
        recordedAtMs: '1785168000000',
      },
    }),
    /recordedAtMs/,
  );
});

test('requires every mandated fixture category', () => {
  assert.deepEqual(
    missingRequiredFixtureCoverage({ urination: 0, battery: 0, retry: 0, invalid: 0 }),
    ['valid urination', 'valid battery', 'identical retry', 'named invalid'],
  );
  assert.deepEqual(
    missingRequiredFixtureCoverage({ urination: 1, battery: 1, retry: 1, invalid: 1 }),
    [],
  );
});

test('requires every invalid scenario named by the contract', () => {
  assert.deepEqual(missingRequiredInvalidCoverage(new Set()), [
    'unknown_property',
    'unsupported_schema_version',
    'device_mismatch',
    'string_duration',
    'invalid_battery_tier',
    'invalid_event_id',
    'invalid_recorded_time',
  ]);
  assert.deepEqual(
    missingRequiredInvalidCoverage(
      new Set([
        'unknown_property',
        'unsupported_schema_version',
        'device_mismatch',
        'string_duration',
        'invalid_battery_tier',
        'invalid_event_id',
        'invalid_recorded_time',
      ]),
    ),
    [],
  );
});

test('distinct retry expectation requires sequence reuse and different event IDs', () => {
  assert.equal(
    distinctRetryExpectationError(
      { payload: { eventId: 'before', sequence: 7 } },
      { payload: { eventId: 'after', sequence: 7 } },
    ),
    null,
  );
  assert.match(
    distinctRetryExpectationError(
      { payload: { eventId: 'before', sequence: 7 } },
      { payload: { eventId: 'after', sequence: 8 } },
    ),
    /sequence/,
  );
  assert.match(
    distinctRetryExpectationError(
      { payload: { eventId: 'same', sequence: 7 } },
      { payload: { eventId: 'same', sequence: 7 } },
    ),
    /eventId/,
  );
});
