import { ERROR_CODES } from './error-codes.mjs';
import { parseTopic } from './topic.mjs';
import { summarizeAjvErrors } from './validators.mjs';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate one `{ topic, payload }` envelope through the full contract pipeline:
 * structural check → topic routing → schema validation → device cross-check.
 *
 * The pipeline never mutates, coerces, or fills in the payload. It returns the
 * first failure encountered as a stable error code.
 *
 * @param {unknown} envelope
 * @param {{ urination: import('ajv').ValidateFunction, battery: import('ajv').ValidateFunction }} validators
 * @returns {{ ok: true, schemaKey: string } | { ok: false, error: string, summary: string }}
 */
export function validateEnvelope(envelope, validators) {
  if (!isPlainObject(envelope)) {
    return { ok: false, error: ERROR_CODES.FIXTURE_FORMAT, summary: 'envelope is not an object' };
  }

  if (typeof envelope.topic !== 'string') {
    return {
      ok: false,
      error: ERROR_CODES.FIXTURE_FORMAT,
      summary: 'envelope is missing a string "topic" member',
    };
  }

  if (!isPlainObject(envelope.payload)) {
    return {
      ok: false,
      error: ERROR_CODES.FIXTURE_FORMAT,
      summary: 'envelope is missing an object "payload" member',
    };
  }

  const routed = parseTopic(envelope.topic);
  if ('error' in routed) {
    return { ok: false, error: routed.error, summary: `topic "${envelope.topic}" rejected` };
  }

  const validate = validators[routed.schemaKey];
  if (!validate(envelope.payload)) {
    return {
      ok: false,
      error: ERROR_CODES.SCHEMA_VALIDATION,
      summary: summarizeAjvErrors(validate.errors),
    };
  }

  if (envelope.payload.deviceId !== routed.deviceId) {
    return {
      ok: false,
      error: ERROR_CODES.DEVICE_MISMATCH,
      summary: `topic deviceId "${routed.deviceId}" != payload deviceId "${envelope.payload.deviceId}"`,
    };
  }

  return { ok: true, schemaKey: routed.schemaKey };
}
