# battery-event-ingestion Specification

## Purpose

TBD - created by archiving change 'ingest-battery-events'. Update Purpose after archive.

## Requirements

### Requirement: Shared battery persistence invariants

The durable sink SHALL dispatch validated `battery` events through the same registered-device gate, canonical identity, immutable event path, Firestore transaction, and stable outcome rules used for urination events. It MUST classify `eventType` exhaustively and MUST NOT use a second HTTP endpoint or persistence stack.

#### Scenario: Store an eligible battery event

- **WHEN** an enabled registered device sends a valid new battery event through `POST /v1/emqx/events`
- **THEN** the sink stores it under `devices/{deviceId}/events/{eventId}` and returns `stored`

#### Scenario: Reject a battery event at the device gate

- **WHEN** a valid battery event belongs to an unknown, disabled, or product-mismatched device
- **THEN** the sink returns the corresponding device rejection and performs zero writes

#### Scenario: Redeliver an identical battery event

- **WHEN** a battery event document already contains the same canonicalHash as an incoming delivery with the same eventId
- **THEN** the sink returns `duplicate` and performs zero writes


<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->

---
### Requirement: Battery event record shape

A stored battery event SHALL contain the common contract, normalized time, transport audit, canonical identity, and first-write fields, plus `eventType: battery` and the validated `batteryLevelPercent`. It SHALL contain `batteryVoltageMv` only when that field exists in the payload. It SHALL NOT contain urination duration, estimated volume, or calibration fields.

#### Scenario: Store a battery level with voltage

- **WHEN** a new battery payload contains `batteryLevelPercent: 75` and `batteryVoltageMv: 3840`
- **THEN** the event document preserves both exact integer values and contains no urination-specific fields

#### Scenario: Store a battery level without voltage

- **WHEN** a new battery payload contains `batteryLevelPercent: 25` and omits `batteryVoltageMv`
- **THEN** the event document contains `batteryLevelPercent: 25` and omits `batteryVoltageMv`

#### Scenario: Preserve the five-level contract

- **WHEN** the sink receives a validated battery event
- **THEN** its batteryLevelPercent is exactly one of 0, 25, 50, 75, or 100 and the sink does not interpolate another percentage


<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->

---
### Requirement: Device-wide event ID conflict

The eventId namespace SHALL span all event types for one device. When an existing event document has the incoming battery eventId and a different canonicalHash, the sink SHALL return `event_id_conflict`, preserve the original document and projection, and perform zero writes.

#### Scenario: Conflict with an existing urination event

- **WHEN** an urination event already occupies `devices/PC-000001/events/evt-000001` and a battery payload reuses `evt-000001`
- **THEN** the sink returns `event_id_conflict` and does not replace the urination document


<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->

---
### Requirement: Monotonic latest battery projection

For each newly stored battery event, the sink SHALL compare `(effectiveAtMs, receivedAtMs, eventId)` lexicographically with the current latest battery tuple. It SHALL update all latest battery projection fields only when the new tuple is greater. It SHALL update `lastReportedAtMs` to the maximum of its existing value and the new event receivedAtMs even when a late event does not become the latest battery.

#### Scenario: Advance latest battery

- **WHEN** the current tuple is `(1785168000000, 1785168001000, evt-bat-001)` and a new battery tuple is `(1785168060000, 1785168061000, evt-bat-002)`
- **THEN** every latest battery projection field references `evt-bat-002` and its values

#### Scenario: Preserve latest battery for a late event

- **WHEN** a new battery event has a tuple lower than the current latest battery tuple
- **THEN** the event is stored in history, latest battery fields remain unchanged, and lastReportedAtMs advances only if the new receivedAtMs is greater

#### Scenario: Resolve an equal-time tie

- **WHEN** two distinct battery events have equal effectiveAtMs and receivedAtMs
- **THEN** the event with the lexicographically greater eventId becomes latest independent of transaction order


<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->

---
### Requirement: Coherent latest voltage projection

`latestBatteryVoltageMv` SHALL represent the same event as all other latest battery fields. When a battery event becomes latest and contains voltage, the transaction SHALL set that field. When a battery event becomes latest and omits voltage, the transaction SHALL delete that field. A battery event that does not become latest SHALL NOT change the field.

#### Scenario: Set voltage from the latest event

- **WHEN** a newer battery event contains `batteryVoltageMv: 3840`
- **THEN** the device projection sets `latestBatteryVoltageMv` to 3840

#### Scenario: Clear stale voltage

- **WHEN** the current latest projection contains `latestBatteryVoltageMv: 3840` and a newer battery event omits batteryVoltageMv
- **THEN** the device projection removes `latestBatteryVoltageMv` while updating the other latest fields to the newer event

#### Scenario: Late event does not change voltage

- **WHEN** a late battery event contains a different voltage but does not become latest
- **THEN** the current latestBatteryVoltageMv remains unchanged


<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->

---
### Requirement: Battery events do not establish presence

Processing a battery event SHALL NOT create or update `isOnline`, `lastHeartbeatAtMs`, `offlineAtMs`, or any equivalent presence field. The event SHALL affect only immutable history, the latest battery projection, and the shared lastReportedAtMs field.

#### Scenario: Process battery without online state

- **WHEN** a battery event is stored for a device with no presence fields
- **THEN** the transaction creates no presence fields


<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->

---
### Requirement: Stable battery HTTP outcomes

The HTTP route SHALL map a new battery event to 201, an identical duplicate to 200, an eventId conflict to 409, device rejection to the persistence-defined 422 or 403 response, and transient Firestore failure to 503. It MUST preserve the safe error body and logging rules from webhook validation.

#### Scenario: Return a stored response

- **WHEN** the battery sink returns `stored`
- **THEN** the route returns HTTP 201 without exposing Firestore document contents

#### Scenario: Return a duplicate response

- **WHEN** the battery sink returns `duplicate`
- **THEN** the route returns HTTP 200 and the transaction performs zero writes

<!-- @trace
source: ingest-battery-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/src/server.ts
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/http/errors.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
tests:
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
-->