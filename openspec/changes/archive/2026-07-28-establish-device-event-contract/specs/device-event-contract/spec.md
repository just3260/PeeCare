## ADDED Requirements

### Requirement: Canonical event topics

A version 1 device event publisher SHALL publish urination events to `products/{productModel}/devices/{deviceId}/events/urination` and battery events to `products/{productModel}/devices/{deviceId}/status/battery`. Each `productModel` and `deviceId` topic segment MUST match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. The payload `deviceId` MUST equal the `deviceId` topic segment.

#### Scenario: Route a urination event

- **WHEN** an envelope uses topic `products/pc-mini/devices/PC-000001/events/urination` and its payload has `eventType` `urination` and `deviceId` `PC-000001`
- **THEN** the contract validator SHALL select the version 1 urination event schema

#### Scenario: Route a battery event

- **WHEN** an envelope uses topic `products/pc-mini/devices/PC-000001/status/battery` and its payload has `eventType` `battery` and `deviceId` `PC-000001`
- **THEN** the contract validator SHALL select the version 1 battery event schema

#### Scenario: Reject a device identity mismatch

- **WHEN** the topic identifies device `PC-000001` and the payload identifies device `PC-000002`
- **THEN** the contract validator SHALL reject the envelope with error code `device_mismatch`

#### Scenario: Reject an unsupported topic

- **WHEN** an envelope uses topic `peecare/device/1/status`
- **THEN** the contract validator SHALL reject the envelope with error code `unsupported_topic`

#### Scenario: Reject an invalid topic segment

- **WHEN** a topic contains a product model or device identifier with a space, slash, MQTT wildcard, or more than 64 characters
- **THEN** the contract validator SHALL reject the envelope with error code `topic_format`

### Requirement: Strict common event envelope

Every version 1 event payload SHALL contain `schemaVersion`, `eventId`, `eventType`, `deviceId`, `sequence`, `recordedAtMs`, and `firmwareVersion`. `schemaVersion` MUST equal integer `1`. `eventId` MUST match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. `deviceId` MUST match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. `sequence` MUST be an integer from 0 through 4294967295. `recordedAtMs` MUST be either a non-negative integer representing UTC Unix epoch milliseconds or JSON null. `firmwareVersion` MUST contain a Semantic Versioning core version with optional pre-release or build metadata. The schema SHALL reject undeclared properties and SHALL NOT coerce JSON values between types.

#### Scenario: Accept a common event envelope

- **WHEN** a payload contains `schemaVersion: 1`, `eventId: "PC-000001:42"`, `deviceId: "PC-000001"`, `sequence: 42`, `recordedAtMs: 1785168000000`, and `firmwareVersion: "1.2.0"` together with a supported event type
- **THEN** the common envelope fields SHALL pass schema validation

#### Scenario: Accept an unavailable device time

- **WHEN** a supported event payload contains `recordedAtMs: null`
- **THEN** the common envelope fields SHALL pass schema validation

#### Scenario: Reject an unsupported schema version

- **WHEN** a payload contains `schemaVersion: 2`
- **THEN** the contract validator SHALL reject the payload with error code `schema_validation`

#### Scenario: Reject an undeclared property

- **WHEN** a payload contains a property not declared by its version 1 event schema
- **THEN** the contract validator SHALL reject the payload with error code `schema_validation`

#### Scenario: Reject implicit type conversion

- **WHEN** a payload contains `sequence: "42"` as a JSON string
- **THEN** the contract validator SHALL reject the payload with error code `schema_validation`

### Requirement: Urination event payload

A version 1 urination event SHALL set `eventType` to `urination` and SHALL contain `flushDurationMs` and `pumpDurationMs`. Each duration MUST be an integer from 0 through 4294967295. The payload SHALL contain raw durations only and SHALL NOT contain `estimatedUrineMl`, a daily count, or another derived urine measurement.

#### Scenario: Accept raw urination durations

- **WHEN** a urination payload contains `flushDurationMs: 3000` and `pumpDurationMs: 5000`
- **THEN** the payload SHALL pass the version 1 urination schema

##### Example: Fixture-first pending calibration event

- **GIVEN** device `PC-000001` publishes event `PC-000001:42`
- **WHEN** the event reports a 3000 millisecond flush and a 5000 millisecond pump duration
- **THEN** the contract output SHALL preserve both raw values without adding an estimated urine volume

#### Scenario: Reject a string duration

- **WHEN** a urination payload contains `flushDurationMs: "3000"`
- **THEN** the contract validator SHALL reject the payload with error code `schema_validation`

#### Scenario: Reject a derived urine value

- **WHEN** a urination payload contains `estimatedUrineMl`
- **THEN** the contract validator SHALL reject the undeclared property with error code `schema_validation`

### Requirement: Battery event payload

A version 1 battery event SHALL set `eventType` to `battery` and SHALL contain `batteryLevelPercent` equal to 0, 25, 50, 75, or 100. A payload that includes `batteryVoltageMv` MUST represent it as an integer from 0 through 20000. A publisher without a voltage measurement SHALL omit `batteryVoltageMv`.

#### Scenario: Accept a battery level and voltage

- **WHEN** a battery payload contains `batteryLevelPercent: 75` and `batteryVoltageMv: 3975`
- **THEN** the payload SHALL pass the version 1 battery schema

#### Scenario: Accept a battery level without voltage

- **WHEN** a battery payload contains `batteryLevelPercent: 50` and omits `batteryVoltageMv`
- **THEN** the payload SHALL pass the version 1 battery schema

#### Scenario: Reject a non-tier battery level

- **WHEN** a battery payload contains `batteryLevelPercent: 30`
- **THEN** the contract validator SHALL reject the payload with error code `schema_validation`

#### Scenario: Reject an unknown voltage represented as null

- **WHEN** a battery payload contains `batteryVoltageMv: null`
- **THEN** the contract validator SHALL reject the payload with error code `schema_validation`

### Requirement: Stable retry identity

A publisher retrying an event SHALL reuse the original Topic, `eventId`, and complete payload without changing any field. The `eventId` SHALL be the idempotency identity. The `sequence` SHALL support ordering and gap diagnosis and SHALL NOT replace `eventId` as the idempotency identity.

#### Scenario: Accept an identical retry fixture

- **WHEN** a retry fixture contains original and retry deliveries with identical Topics and byte-equivalent JSON values
- **THEN** the contract validator SHALL accept the retry fixture as one logical event delivered twice

##### Example: Retry one unchanged urination event

- **GIVEN** the original delivery uses event ID `PC-000001:42`, `flushDurationMs: 3000`, and `pumpDurationMs: 5000`
- **WHEN** the retry repeats the same Topic and every Payload field without modification
- **THEN** the fixture SHALL pass as one logical event delivered twice

#### Scenario: Reject a mutated retry

- **WHEN** a retry reuses the original `eventId` but changes `pumpDurationMs` from 5000 to 5100
- **THEN** the contract validator SHALL reject the retry fixture with error code `retry_mismatch`

#### Scenario: Preserve identity across sequence reuse

- **WHEN** two different events use the same `sequence` after a device restart and use different `eventId` values
- **THEN** the contract SHALL treat them as distinct events

### Requirement: Mixed event time source

A publisher with a synchronized UTC clock SHALL send `recordedAtMs` as Unix epoch milliseconds. A publisher without a synchronized UTC clock MUST send `recordedAtMs: null`. An ingestion consumer SHALL preserve the original `recordedAtMs` and derive `effectiveAtMs` and `timeSource` from `receivedAtMs`. It SHALL select the device time only when `recordedAtMs` is no earlier than `1767225600000` and no later than `receivedAtMs + 300000`; otherwise it SHALL select `receivedAtMs`.

#### Scenario: Select a valid device time

- **WHEN** `receivedAtMs` is `1785168060000` and `recordedAtMs` is `1785168000000`
- **THEN** `effectiveAtMs` SHALL equal `1785168000000` and `timeSource` SHALL equal `device`

#### Scenario: Fall back for an unavailable device time

- **WHEN** `receivedAtMs` is `1785168060000` and `recordedAtMs` is null
- **THEN** `effectiveAtMs` SHALL equal `1785168060000` and `timeSource` SHALL equal `server`

#### Scenario: Fall back for a pre-product epoch

- **WHEN** `receivedAtMs` is `1785168060000` and `recordedAtMs` is `0`
- **THEN** `effectiveAtMs` SHALL equal `1785168060000`, `timeSource` SHALL equal `server`, and the original `recordedAtMs` SHALL remain `0`

#### Scenario: Fall back for an excessive future time

- **WHEN** `receivedAtMs` is `1785168060000` and `recordedAtMs` is `1785168360001`
- **THEN** `effectiveAtMs` SHALL equal `1785168060000` and `timeSource` SHALL equal `server`

### Requirement: Executable contract fixtures

The contract package SHALL include valid urination, valid battery, identical retry, and named invalid fixtures. The invalid fixture manifest SHALL cover unknown properties, unsupported schema versions, Topic and payload device mismatch, string durations, invalid battery tiers, invalid event identifiers, and invalid recorded times, with a stable `covers` identifier for each required scenario. The package SHALL expose an `npm test` command that discovers and validates every JSON fixture with AJV 2020 strict mode. The command SHALL fail when any required fixture category or required invalid-scenario coverage identifier is absent.

#### Scenario: Validate the complete fixture suite

- **WHEN** an operator runs `npm test` in the contract package without modifying fixtures
- **THEN** the command SHALL exit with status 0 and report the number of passing fixtures

#### Scenario: Surface a fixture failure

- **WHEN** a valid fixture violates its schema, an invalid fixture passes, an invalid fixture produces a different error code, or a retry changes content
- **THEN** the command SHALL exit with a non-zero status and write the fixture name, stable error code, and validation summary to standard error

##### Example: Report an incorrect manifest expectation

- **GIVEN** a named invalid fixture contains `batteryLevelPercent: 30` but declares `expectedError: "device_mismatch"`
- **WHEN** an operator runs `npm test`
- **THEN** the command SHALL exit non-zero and report the fixture name, actual `schema_validation` code, and mismatch summary

#### Scenario: Reject a malformed fixture or manifest

- **WHEN** a fixture contains invalid JSON, is placed in an unknown fixture group, omits a required member, uses an unknown retry expectation, or supplies a time field with the wrong type
- **THEN** the command SHALL reject it with error code `fixture_format`
