/**
 * Signals that a day-key, daily-document, or counter invariant was violated.
 * The sink maps this to the `aggregation_integrity_error` outcome, which the
 * route surfaces as a sanitized HTTP 500 without exposing document contents.
 */
export class AggregationIntegrityError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AggregationIntegrityError';
  }
}
