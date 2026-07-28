import { ERROR_CODES } from './error-codes.mjs';
import { validateEnvelope } from './validate-envelope.mjs';
import { deepEqual } from './deep-equal.mjs';

/**
 * Compare an original and retry delivery of one logical event. A valid retry
 * reuses the original topic and every payload field unchanged. `eventId` is the
 * idempotency identity; `sequence` is never used as the identity here.
 *
 * Each delivery is first validated as a standalone envelope so a "retry" can
 * never smuggle in a structurally invalid payload.
 *
 * @param {unknown} original
 * @param {unknown} retry
 * @param {object} validators
 * @returns {{ ok: true } | { ok: false, error: string, summary: string }}
 */
export function compareRetry(original, retry, validators) {
  const originalResult = validateEnvelope(original, validators);
  if (!originalResult.ok) return originalResult;

  const retryResult = validateEnvelope(retry, validators);
  if (!retryResult.ok) return retryResult;

  if (original.topic !== retry.topic) {
    return {
      ok: false,
      error: ERROR_CODES.RETRY_MISMATCH,
      summary: `retry topic "${retry.topic}" != original topic "${original.topic}"`,
    };
  }

  if (!deepEqual(original.payload, retry.payload)) {
    return {
      ok: false,
      error: ERROR_CODES.RETRY_MISMATCH,
      summary: `retry payload differs from original for eventId "${original.payload.eventId}"`,
    };
  }

  return { ok: true };
}
