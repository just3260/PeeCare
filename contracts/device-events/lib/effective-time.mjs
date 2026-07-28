// Mixed event time source derivation.
//
// The device supplies `recordedAtMs` (UTC Unix epoch milliseconds, or null when
// it has no synchronized clock). An ingestion consumer supplies `receivedAtMs`
// (its own trusted receive time) and derives an effective timestamp plus the
// source that was trusted. The device-provided value is always preserved.

// Lower bound: 2026-01-01T00:00:00Z. Rejects the classic 1970 epoch produced by
// unsynchronized clocks without imposing a maximum offline age.
export const PRODUCT_EPOCH_MS = 1767225600000;

// Upper bound offset: 5 minutes. Absorbs small clock skew while rejecting times
// that are implausibly far in the future relative to the receive time.
export const FUTURE_TOLERANCE_MS = 300000;

/**
 * Derive the effective event time and the source that was trusted.
 *
 * The device time is selected only when `recordedAtMs` is an integer no earlier
 * than {@link PRODUCT_EPOCH_MS} and no later than
 * `receivedAtMs + FUTURE_TOLERANCE_MS`; otherwise the server receive time is
 * used. The original `recordedAtMs` is returned unchanged in every case.
 *
 * @param {number | null} recordedAtMs Device-reported time, or null.
 * @param {number} receivedAtMs Server receive time (trusted).
 * @returns {{ effectiveAtMs: number, timeSource: 'device' | 'server', recordedAtMs: number | null }}
 */
export function deriveEffectiveTime(recordedAtMs, receivedAtMs) {
  const deviceTimeIsTrusted =
    Number.isInteger(recordedAtMs) &&
    recordedAtMs >= PRODUCT_EPOCH_MS &&
    recordedAtMs <= receivedAtMs + FUTURE_TOLERANCE_MS;

  if (deviceTimeIsTrusted) {
    return { effectiveAtMs: recordedAtMs, timeSource: 'device', recordedAtMs };
  }

  return { effectiveAtMs: receivedAtMs, timeSource: 'server', recordedAtMs };
}
