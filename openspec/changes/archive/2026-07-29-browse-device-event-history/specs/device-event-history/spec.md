## ADDED Requirements

### Requirement: Bounded urination history query

The repository SHALL query only `urination` events for one owned device and SHALL return at most 25 documents per request.

#### Scenario: Load the first page
- **WHEN** an owned device has 30 urination events
- **THEN** the first request returns 25 events

### Requirement: Stable newest-first ordering

History results SHALL order by effectiveAtMs descending and eventId descending.

#### Scenario: Order equal-time events
- **WHEN** events B and A have the same effectiveAtMs
- **THEN** B appears before A

### Requirement: Cursor pagination

The repository SHALL use the last returned document as the next cursor and SHALL NOT use offset pagination.

#### Scenario: Load a second page
- **WHEN** the first page contains 25 of 30 events
- **THEN** load more returns the remaining 5 without duplicates

### Requirement: Device-scoped history state

Changing the selected device SHALL clear existing items, cursor, and errors before the new query begins.

#### Scenario: Switch history device
- **WHEN** the member changes from device A to B
- **THEN** no A event remains in the B history state

### Requirement: Explicit history states

The view SHALL distinguish loading, empty, ready, end-of-list, and retryable error states and SHALL display raw duration and pending-calibration values without deriving volume.

#### Scenario: Show empty history
- **WHEN** the first query returns zero events
- **THEN** the view displays an empty-history state

### Requirement: Validated immutable urination records

Each history item SHALL match its document ID and selected deviceId, SHALL have `eventType: urination`, valid integer sequence, effectiveAtMs, flushDurationMs, and pumpDurationMs, and SHALL have `estimatedUrineMl: null` with `estimationStatus: pending_calibration`. Invalid records MUST produce a data-integrity error and SHALL NOT be rendered as valid history.

#### Scenario: Reject a cross-device record
- **WHEN** a document under the selected device contains a different deviceId
- **THEN** the page enters a data-integrity error state and does not render that document

### Requirement: Stale history response isolation

The store SHALL associate every request with the selected deviceId and a monotonically increasing query generation. A response from an older generation or different device SHALL NOT change items, cursor, loading state, or error state.

#### Scenario: A slower prior-device query completes last
- **WHEN** device A loading starts, the member switches to B, and A returns after B
- **THEN** only B items and cursor remain in history state

### Requirement: Asia Taipei history time display

The view SHALL display effective event time using `Asia/Taipei` while preserving effectiveAtMs for ordering and pagination.

#### Scenario: Display an event after local midnight
- **WHEN** effectiveAtMs represents `2026-07-27T16:00:00.000Z`
- **THEN** the history date is July 28 in Asia/Taipei
