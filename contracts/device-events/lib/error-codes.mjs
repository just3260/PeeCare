// Stable error codes for the device event contract validator.
// These strings are part of the contract surface: fixtures and downstream
// ingestion depend on them, so they must not change without a schema version
// bump and a coordinated update to consumers.
export const ERROR_CODES = Object.freeze({
  UNSUPPORTED_TOPIC: 'unsupported_topic',
  TOPIC_FORMAT: 'topic_format',
  DEVICE_MISMATCH: 'device_mismatch',
  SCHEMA_VALIDATION: 'schema_validation',
  RETRY_MISMATCH: 'retry_mismatch',
  FIXTURE_FORMAT: 'fixture_format',
  FIXTURE_EXPECTATION: 'fixture_expectation',
});

export const ALL_ERROR_CODES = Object.freeze(Object.values(ERROR_CODES));
