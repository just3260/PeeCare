## ADDED Requirements

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

### Requirement: Atomic event and daily count commit

For each eligible new urination event, the Firestore transaction SHALL read the target daily document before any write and SHALL atomically create the immutable event, update the device projection, and set the daily document. A failed transaction SHALL expose neither an event-only nor a count-only partial result.

#### Scenario: Commit a first event and count

- **WHEN** a device has no event document and no daily document for the event day
- **THEN** one transaction creates the event and a daily document with `urinationCount: 1`

#### Scenario: Abort the combined transaction

- **WHEN** any event, device projection, or dailyStats write fails before commit
- **THEN** none of the transaction changes become visible

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

### Requirement: Concurrent unique event counting

The aggregator SHALL read and increment the daily count inside a Firestore transaction so automatic transaction retries serialize concurrent updates. Every distinct committed urination event SHALL contribute exactly one to the final count.

#### Scenario: Count two concurrent events

- **WHEN** two distinct eligible urination events for the same device and day are processed concurrently from an initial count of 0
- **THEN** both event documents exist and the final urinationCount is 2

#### Scenario: Concurrent duplicate delivery

- **WHEN** two concurrent deliveries use the same new eventId and canonicalHash
- **THEN** exactly one event document exists and the final urinationCount is 1

### Requirement: Late event day attribution

A newly stored urination event SHALL increment the daily document selected by its effectiveAtMs even when its receivedAtMs falls on a later Asia/Taipei day. It SHALL NOT increment the received day unless both instants resolve to that day.

#### Scenario: Attribute a late event to the previous day

- **WHEN** effectiveAtMs is `2026-07-27T15:59:00.000Z` and receivedAtMs is `2026-07-27T16:05:00.000Z`
- **THEN** the aggregator increments dailyStats `2026-07-27` and leaves dailyStats `2026-07-28` unchanged

### Requirement: Pending calibration daily record shape

Each daily document SHALL contain `date`, `timeZone: Asia/Taipei`, a non-negative safe-integer `urinationCount`, `volumeStatus: pending_calibration`, and `lastEventAtMs` and `updatedAtMs`. It SHALL set `estimatedUrineTotalMl`, `estimatedUrineAverageMl`, `estimatedUrineMinMl`, and `estimatedUrineMaxMl` to null. It SHALL NOT derive any volume from flushDurationMs or pumpDurationMs.

#### Scenario: Create the daily document

- **WHEN** the first urination event for `2026-07-28` is committed
- **THEN** `devices/{deviceId}/dailyStats/2026-07-28` has date `2026-07-28`, timezone `Asia/Taipei`, count 1, pending_calibration status, and four null volume fields

#### Scenario: Preserve pending volume fields during increments

- **WHEN** another unique urination event increments an existing valid daily document
- **THEN** all four volume fields remain null and volumeStatus remains pending_calibration

### Requirement: Monotonic daily metadata

For each counted event, `lastEventAtMs` SHALL become the maximum of the existing value and event effectiveAtMs, and `updatedAtMs` SHALL become the maximum of the existing value and event receivedAtMs. Processing order SHALL NOT decrease either field.

#### Scenario: Count an out-of-order event

- **WHEN** a late event belongs to an existing day and has an earlier effectiveAtMs and a later receivedAtMs than the current metadata
- **THEN** urinationCount increments, lastEventAtMs remains unchanged, and updatedAtMs advances to the later receivedAtMs

### Requirement: Daily document integrity guard

Before incrementing an existing daily document, the transaction MUST verify that its date equals the path day key, timezone equals `Asia/Taipei`, urinationCount is a non-negative safe integer below the maximum safe integer, volumeStatus equals `pending_calibration`, and all four volume fields are null. An invalid document SHALL cause `aggregation_integrity_error`, SHALL abort the transaction, and SHALL preserve the event, projection, and aggregate state from before the request.

#### Scenario: Reject a corrupt count

- **WHEN** an existing daily document contains `urinationCount: -1`
- **THEN** the transaction returns aggregation_integrity_error and performs zero writes

#### Scenario: Reject mismatched timezone

- **WHEN** an existing daily document has `timeZone: UTC`
- **THEN** the transaction returns aggregation_integrity_error and performs zero writes

### Requirement: Stable aggregation failure outcomes

A daily integrity or day-key invariant failure SHALL map to HTTP 500 with safe error code `aggregation_integrity_error`. A transient Firestore failure SHALL map to HTTP 503 with `persistence_unavailable`. Neither response SHALL expose document contents, raw SDK errors, or partial writes.

#### Scenario: Report an integrity failure safely

- **WHEN** the transaction detects an invalid daily document
- **THEN** the route returns HTTP 500 with code aggregation_integrity_error and sanitized metadata
