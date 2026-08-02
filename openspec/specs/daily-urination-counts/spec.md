# daily-urination-counts Specification

## Purpose

TBD - created by syncing change 'aggregate-daily-urination-counts'. Update Purpose after implementation.

## Requirements

### Requirement: Fixed Asia Taipei day key

The aggregator SHALL derive a strict `yyyy-MM-dd` day key from normalized `effectiveAtMs` using the IANA timezone `Asia/Taipei`, Gregorian calendar, and Latin digits. It SHALL NOT use server host timezone, client locale, broker received time, or HTTP received time to select the day.

#### Scenario: Resolve the midnight boundary

- **WHEN** effectiveAtMs represents an instant immediately before or at Asia/Taipei midnight
- **THEN** the aggregator returns the corresponding local calendar date

##### Example: UTC boundary for July 28

| Effective instant | Expected day key |
| --- | --- |
| `2026-07-27T15:59:59.999Z` | `2026-07-27` |
| `2026-07-27T16:00:00.000Z` | `2026-07-28` |

#### Scenario: Ignore host timezone

- **WHEN** the same effectiveAtMs is processed under hosts configured for UTC, Asia/Taipei, and America/Los_Angeles
- **THEN** every host produces the same Asia/Taipei day key


<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->

---
### Requirement: Atomic event and daily count commit

For each eligible new urination event, the Firestore transaction SHALL read the target daily document before any write and SHALL atomically create the immutable event, update the device projection, and set the daily document. A failed transaction SHALL expose neither an event-only nor a count-only partial result.

#### Scenario: Commit a first event and count

- **WHEN** a device has no event document and no daily document for the event day
- **THEN** one transaction creates the event and a daily document with `urinationCount: 1`

#### Scenario: Abort the combined transaction

- **WHEN** any event, device projection, or dailyStats write fails before commit
- **THEN** none of the transaction changes become visible


<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->

---
### Requirement: Exactly-once eligible urination counting

The aggregator SHALL increment a daily count only for an event whose type is `urination` and whose immutable event document is created by the current transaction. It SHALL NOT read or write dailyStats for a duplicate, eventId conflict, device rejection, or battery event.

#### Scenario: Count two unique urination events

- **WHEN** two eligible events with distinct eventIds are first stored on the same Asia/Taipei day
- **THEN** the daily urinationCount changes from absent to 1 and then to 2

#### Scenario: Do not count a duplicate

- **WHEN** an already stored urination event is delivered again with the same canonicalHash
- **THEN** the route returns the duplicate outcome and the daily document remains byte-for-byte unchanged

#### Scenario: Do not count a conflict or rejection

- **WHEN** an event results in event_id_conflict, unknown_device, device_disabled, or product_model_mismatch
- **THEN** no dailyStats document is created or updated

#### Scenario: Do not count a battery event

- **WHEN** a new battery event is stored successfully
- **THEN** no daily urination document is created or updated


<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->

---
### Requirement: Concurrent unique event counting

The aggregator SHALL read and increment the daily count inside a Firestore transaction so automatic transaction retries serialize concurrent updates. Every distinct committed urination event SHALL contribute exactly one to the final count.

#### Scenario: Count two concurrent events

- **WHEN** two distinct eligible urination events for the same device and day are processed concurrently from an initial count of 0
- **THEN** both event documents exist and the final urinationCount is 2

#### Scenario: Concurrent duplicate delivery

- **WHEN** two concurrent deliveries use the same new eventId and canonicalHash
- **THEN** exactly one event document exists and the final urinationCount is 1


<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->

---
### Requirement: Late event day attribution

A newly stored urination event SHALL increment the daily document selected by its effectiveAtMs even when its receivedAtMs falls on a later Asia/Taipei day. It SHALL NOT increment the received day unless both instants resolve to that day.

#### Scenario: Attribute a late event to the previous day

- **WHEN** effectiveAtMs is `2026-07-27T15:59:00.000Z` and receivedAtMs is `2026-07-27T16:05:00.000Z`
- **THEN** the aggregator increments dailyStats `2026-07-27` and leaves dailyStats `2026-07-28` unchanged


<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->
---
### Requirement: Summed daily urine volume record shape

Each daily document SHALL contain `date`, `timeZone: Asia/Taipei`, a non-negative safe-integer `urinationCount`, a non-negative finite `estimatedUrineTotalMl`, and `lastEventAtMs` and `updatedAtMs`. The `estimatedUrineTotalMl` field SHALL hold the sum of the calibrated urine volume of every counted event for that day, derived from the same estimation used for the stored event. The document SHALL NOT contain `volumeStatus`, `estimatedUrineAverageMl`, `estimatedUrineMinMl`, or `estimatedUrineMaxMl`. A single event contribution that is not a non-negative finite number, and a running total that is not finite, SHALL each abort the transaction with `aggregation_integrity_error`.

#### Scenario: Create the daily document

- **WHEN** the first urination event for `2026-07-28` is committed with an estimated volume of 200 ml
- **THEN** `devices/{deviceId}/dailyStats/2026-07-28` has date `2026-07-28`, timezone `Asia/Taipei`, count 1, and `estimatedUrineTotalMl` 200

#### Scenario: Accumulate volume during increments

- **WHEN** another unique urination event with an estimated volume of 50 ml increments an existing valid daily document holding count 1 and total 200
- **THEN** the document holds count 2 and `estimatedUrineTotalMl` 250

##### Example: successive increments

| Existing count | Existing total (ml) | Event volume (ml) | Resulting count | Resulting total (ml) |
| -------------- | ------------------- | ----------------- | --------------- | -------------------- |
| (no document)  | (no document)       | 200               | 1               | 200                  |
| 1              | 200                 | 50                | 2               | 250                  |
| 2              | 250                 | 0                 | 3               | 250                  |



<!-- @trace
source: project-today-urination-totals
updated: 2026-08-02
code:
  - services/ingestion-api/src/aggregation/today-urination-projection.ts
  - src/features/devices/device-overview-model.ts
  - docs/mqtt-interfaces-and-firestore-models.md
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - src/features/stats/daily-stats-model.ts
  - src/views/HistoryView.vue
  - src/components/HomeInstantCards.vue
  - src/views/StatsView.vue
  - src/components/HomeOverviewHero.vue
  - scripts/test-tool.html
tests:
  - src/features/stats/daily-stats.spec.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - src/views/HomeView.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/StatsView.spec.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/today-urination-projection.test.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Registry today totals projection

On every stored urination event, the transaction SHALL mirror the resulting daily aggregate onto the parent `devices/{deviceId}` document as `todayDate`, `todayUrinationCount`, and `todayEstimatedUrineTotalMl`, taken verbatim from the `date`, `urinationCount`, and `estimatedUrineTotalMl` of the daily record written in that same transaction. The three fields SHALL be written together or not at all. The projection SHALL be overwritten only when the event's day key is not earlier than the existing `todayDate`, or when no `todayDate` exists. Battery events SHALL NOT write these fields, and outcomes that store nothing — duplicate, unknown device, disabled device, product model mismatch — SHALL leave the projection unchanged.

#### Scenario: Mirror the daily aggregate

- **WHEN** a urination event increments `devices/{deviceId}/dailyStats/2026-07-28` to count 3 and total 550
- **THEN** `devices/{deviceId}` holds `todayDate: 2026-07-28`, `todayUrinationCount: 3`, and `todayEstimatedUrineTotalMl: 550`

#### Scenario: Reject a backward projection from a late event

- **WHEN** a late urination event whose day key is `2026-07-27` is stored while the device projection holds `todayDate: 2026-07-28`
- **THEN** the `2026-07-27` daily document is incremented and the three today fields on the device document keep their `2026-07-28` values

##### Example: projection overwrite decision

| Existing todayDate | Event day key | Projection written |
| ------------------ | ------------- | ------------------ |
| (absent)           | `2026-07-28`  | yes                |
| `2026-07-28`       | `2026-07-28`  | yes                |
| `2026-07-28`       | `2026-07-29`  | yes                |
| `2026-07-28`       | `2026-07-27`  | no                 |

#### Scenario: Leave the projection untouched on a battery event

- **WHEN** a battery event is stored for a device whose projection holds `todayDate: 2026-07-28`
- **THEN** the device document keeps the same three today field values and no today field is added or removed



<!-- @trace
source: project-today-urination-totals
updated: 2026-08-02
code:
  - services/ingestion-api/src/aggregation/today-urination-projection.ts
  - src/features/devices/device-overview-model.ts
  - docs/mqtt-interfaces-and-firestore-models.md
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - src/features/stats/daily-stats-model.ts
  - src/views/HistoryView.vue
  - src/components/HomeInstantCards.vue
  - src/views/StatsView.vue
  - src/components/HomeOverviewHero.vue
  - scripts/test-tool.html
tests:
  - src/features/stats/daily-stats.spec.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - src/views/HomeView.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/StatsView.spec.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/today-urination-projection.test.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Monotonic daily metadata
For each counted event, `lastEventAtMs` SHALL become the maximum of the existing value and event effectiveAtMs, and `updatedAtMs` SHALL become the maximum of the existing value and event receivedAtMs. Processing order SHALL NOT decrease either field.

#### Scenario: Count an out-of-order event

- **WHEN** a late event belongs to an existing day and has an earlier effectiveAtMs and a later receivedAtMs than the current metadata
- **THEN** urinationCount increments, lastEventAtMs remains unchanged, and updatedAtMs advances to the later receivedAtMs


<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->

---
### Requirement: Daily document integrity guard

Before incrementing an existing daily document, the transaction MUST verify that its date equals the path day key, timezone equals `Asia/Taipei`, urinationCount is a non-negative safe integer below the maximum safe integer, and `estimatedUrineTotalMl` is a non-negative finite number. An invalid document SHALL cause `aggregation_integrity_error`, SHALL abort the transaction, and SHALL preserve the event, projection, and aggregate state from before the request.

#### Scenario: Reject a corrupt count

- **WHEN** an existing daily document contains `urinationCount: -1`
- **THEN** the transaction returns aggregation_integrity_error and performs zero writes

#### Scenario: Reject mismatched timezone

- **WHEN** an existing daily document has `timeZone: UTC`
- **THEN** the transaction returns aggregation_integrity_error and performs zero writes

#### Scenario: Reject a non-numeric volume total

- **WHEN** an existing daily document contains `estimatedUrineTotalMl: null`
- **THEN** the transaction returns aggregation_integrity_error and performs zero writes


<!-- @trace
source: project-today-urination-totals
updated: 2026-08-02
code:
  - services/ingestion-api/src/aggregation/today-urination-projection.ts
  - src/features/devices/device-overview-model.ts
  - docs/mqtt-interfaces-and-firestore-models.md
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - src/features/stats/daily-stats-model.ts
  - src/views/HistoryView.vue
  - src/components/HomeInstantCards.vue
  - src/views/StatsView.vue
  - src/components/HomeOverviewHero.vue
  - scripts/test-tool.html
tests:
  - src/features/stats/daily-stats.spec.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - src/views/HomeView.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/StatsView.spec.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/ingestion-api/test/today-urination-projection.test.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Stable aggregation failure outcomes

A daily integrity or day-key invariant failure SHALL map to HTTP 500 with safe error code `aggregation_integrity_error`. A transient Firestore failure SHALL map to HTTP 503 with `persistence_unavailable`. Neither response SHALL expose document contents, raw SDK errors, or partial writes.

#### Scenario: Report an integrity failure safely

- **WHEN** the transaction detects an invalid daily document
- **THEN** the route returns HTTP 500 with code aggregation_integrity_error and sanitized metadata

<!-- @trace
source: aggregate-daily-urination-counts
updated: 2026-07-28
code:
  - services/ingestion-api/src/persistence/battery-event-record.ts
  - firebase/local/fixtures/devices.ts
  - services/ingestion-api/src/app.ts
  - services/ingestion-api/src/aggregation/daily-urination-record.ts
  - services/ingestion-api/package.json
  - services/ingestion-api/src/persistence/canonical-event-hash.ts
  - services/ingestion-api/src/aggregation/asia-taipei-day-key.ts
  - services/ingestion-api/src/persistence/urination-event-record.ts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/aggregation/aggregation-error.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/firestore/firestore-event-sink.ts
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/firestore/firestore-client.ts
  - package.json
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/Dockerfile
  - services/ingestion-api/src/server.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/package.json
tests:
  - services/ingestion-api/test/battery-event-ingestion.test.ts
  - services/ingestion-api/test/helpers/device-fixtures.ts
  - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
  - services/ingestion-api/test/firestore-emulator.integration.test.ts
  - services/ingestion-api/test/daily-urination-counts.test.ts
  - services/ingestion-api/test/device-fixtures.integration.test.ts
  - services/ingestion-api/test/config.test.ts
  - services/ingestion-api/test/urination-event-persistence.test.ts
  - services/ingestion-api/test/app.test.ts
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
-->