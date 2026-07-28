import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALL_ERROR_CODES, ERROR_CODES } from '../lib/error-codes.mjs';

test('fixture expectation failures use a documented stable error code', () => {
  assert.equal(ERROR_CODES.FIXTURE_EXPECTATION, 'fixture_expectation');
  assert.ok(ALL_ERROR_CODES.includes(ERROR_CODES.FIXTURE_EXPECTATION));
});
