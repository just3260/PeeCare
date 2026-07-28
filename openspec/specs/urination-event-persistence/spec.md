# urination-event-persistence Specification

## Purpose

TBD - created by archiving change 'persist-urination-events-idempotently'. Update Purpose after archive.

## Requirements

### Requirement: Registered device ingestion gate

The persistence sink SHALL accept an event only when `devices/{deviceId}` exists, its `deviceId` equals the document path identifier, its `ingestionStatus` equals `enabled`, and its `productModel` equals the validated payload `productModel`.

#### Scenario: Accept an enabled registered device

- **WHEN** device `PC-000001` is registered with `deviceId: PC-000001`, `productModel: pc-mini`, and `ingestionStatus: enabled`, and a validated `pc-mini` event arrives for that device
- **THEN** the sink proceeds to event identity classification

#### Scenario: Reject an unknown device

- **WHEN** no `devices/PC-000404` document exists and a validated event arrives for `PC-000404`
- **THEN** the sink returns `unknown_device` and creates no event document

#### Scenario: Reject a disabled device

- **WHEN** `devices/PC-000001` has `ingestionStatus: disabled`
- **THEN** the sink returns `device_disabled` and creates no event document

#### Scenario: Reject a product mismatch

- **WHEN** `devices/PC-000001` is registered as `pc-mini` and the validated payload has `productModel: pc-pro`
- **THEN** the sink returns `product_model_mismatch` and creates no event document


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Canonical event identity

The sink SHALL compute `canonicalHash` as the lowercase SHA-256 hexadecimal digest of UTF-8 stable JSON for exactly `{ topic, clientId, payload }`. The stable JSON serializer MUST recursively order object keys by Unicode code point and MUST preserve array order. The identity input SHALL NOT include `username`, `qos`, `retained`, `brokerReceivedAtMs`, server `receivedAtMs`, `effectiveAtMs`, or `timeSource`.

#### Scenario: Transport audit differences preserve identity

- **WHEN** two deliveries have the same topic, clientId, and payload but different qos, username, brokerReceivedAtMs, and receivedAtMs values
- **THEN** both deliveries produce the same canonicalHash

#### Scenario: Publisher identity changes canonical identity

- **WHEN** two deliveries contain the same payload but use different topic or clientId values
- **THEN** the deliveries produce different canonicalHash values

#### Scenario: Payload key order does not change identity

- **WHEN** two semantically identical payload objects present their keys in different JSON orders
- **THEN** both payloads produce the same canonicalHash


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Transactional immutable urination persistence

For a new urination event, the sink SHALL create `devices/{deviceId}/events/{eventId}` and update the applicable device projection in one Firestore transaction. The transaction MUST complete all reads before any write and MUST NOT leave a partial event or projection update after failure. An existing event document SHALL NOT be overwritten or updated.

#### Scenario: Store a new urination event atomically

- **WHEN** an eligible device receives urination event `evt-000001` and its event document does not exist
- **THEN** the transaction creates exactly one event document, applies the projection rules, and the sink returns `stored`

#### Scenario: Abort without partial writes

- **WHEN** the transaction fails before commit
- **THEN** neither the event document nor any device projection change becomes visible

#### Scenario: Concurrent first deliveries

- **WHEN** two concurrent transactions deliver the same new eventId and canonicalHash
- **THEN** exactly one transaction creates the event and the observable outcomes consist of one `stored` and one `duplicate`


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Idempotent duplicate handling

When an event document with the same eventId and canonicalHash already exists, the sink SHALL return `duplicate` and SHALL perform zero Firestore writes.

#### Scenario: Redeliver an identical event

- **WHEN** `evt-000001` already exists with the same canonicalHash as the incoming validated event
- **THEN** the sink returns `duplicate`, preserves every existing event and device field, and does not advance `lastReportedAtMs`


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Event ID conflict detection

When an event document with the same eventId and a different canonicalHash already exists, the sink SHALL return `event_id_conflict`, SHALL preserve the existing document, and SHALL perform zero Firestore writes.

#### Scenario: Reuse an event ID with changed payload

- **WHEN** `evt-000001` already exists and an incoming event uses `evt-000001` with a different `flushDurationMs`
- **THEN** the sink returns `event_id_conflict` and preserves the original event and device projection


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Urination event record shape

A stored urination event SHALL preserve the validated contract, normalized time, raw duration, transport audit, canonical identity, and first-write time fields. The document SHALL set `eventType` to `urination`, `estimatedUrineMl` to null, and `estimationStatus` to `pending_calibration`. The sink SHALL NOT derive a urine volume.

#### Scenario: Persist raw measurements without a volume formula

- **WHEN** a new event contains `flushDurationMs: 3000` and `pumpDurationMs: 5000`
- **THEN** the stored document contains those exact integer values, `estimatedUrineMl: null`, and `estimationStatus: pending_calibration`

#### Scenario: Persist normalized and audit times

- **WHEN** a validated event contains brokerReceivedAtMs, receivedAtMs, effectiveAtMs, timeSource, and an optional recordedAtMs
- **THEN** the stored document preserves every present time field and sets createdAtMs to the first delivery receivedAtMs

#### Scenario: Persist transport audit fields

- **WHEN** a new validated event is stored
- **THEN** its `transport` object contains exactly topic, clientId, username, and qos from the validated envelope


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Monotonic latest urination projection

For every newly stored urination event, the sink SHALL compare `(effectiveAtMs, receivedAtMs, eventId)` lexicographically with the current latest urination tuple. It SHALL replace the latest urination projection only when the new tuple is greater. It SHALL set `lastReportedAtMs` to the maximum of its existing value and the new event `receivedAtMs`.

#### Scenario: Advance the latest projection

- **WHEN** the current projection tuple is `(1785168000000, 1785168001000, evt-000001)` and a new event tuple is `(1785168060000, 1785168061000, evt-000002)`
- **THEN** the device projection references `evt-000002` and its effective, received, and firmware fields

#### Scenario: Preserve projection for a late event

- **WHEN** a newly stored event has a tuple lower than the current latest urination tuple
- **THEN** the event document is created but all latest urination projection fields remain unchanged

#### Scenario: Break equal-time ties deterministically

- **WHEN** two distinct events share effectiveAtMs and receivedAtMs
- **THEN** the lexicographically greater eventId becomes the latest projection independent of processing order


<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->

---
### Requirement: Stable persistence outcomes

The HTTP integration SHALL map `stored` to 201, `duplicate` to 200, `event_id_conflict` to 409, `unknown_device` and `product_model_mismatch` to 422, `device_disabled` to 403, and transient Firestore unavailability to 503. Failure responses MUST use the safe error shape established by the webhook validation capability and MUST NOT expose raw SDK errors or document contents.

#### Scenario: Report transient Firestore failure

- **WHEN** Firestore returns unavailable, deadline exceeded, or exhausted aborted-transaction retries
- **THEN** the route returns HTTP 503 with error code `persistence_unavailable` and creates no partial record

#### Scenario: Report an event ID conflict

- **WHEN** the sink returns `event_id_conflict`
- **THEN** the route returns HTTP 409 with error code `event_id_conflict`

<!-- @trace
source: persist-urination-events-idempotently
updated: 2026-07-28
code:
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - services/ingestion-api/package.json
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - package.json
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
tests:
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
-->