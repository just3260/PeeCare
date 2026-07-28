## ADDED Requirements

### Requirement: Bounded fourteen-day query

The stats repository SHALL query only the selected owned device's 14 Asia/Taipei calendar days ending on today and SHALL order documents by date ascending.

#### Scenario: Query a fourteen-day range
- **WHEN** today is `2026-07-28` in Asia/Taipei
- **THEN** the range starts at `2026-07-15` and ends at `2026-07-28`

### Requirement: Continuous daily count series

The series builder SHALL return exactly one point for every day in the range and SHALL represent a missing document as `urinationCount: 0` with `synthetic: true`.

#### Scenario: Fill a missing day
- **WHEN** documents exist for July 15 and July 17 but not July 16
- **THEN** the series includes July 16 with count 0 and synthetic true

### Requirement: Pending volume exclusion

The view SHALL NOT display a numeric urine volume when daily volumeStatus is `pending_calibration` or estimated volume fields are null.

#### Scenario: Hide unavailable volume
- **WHEN** a daily document has pending_calibration and null volume fields
- **THEN** the visualization displays count only

### Requirement: Accessible count visualization

The chart and semantic data table SHALL use the same normalized series and SHALL expose each date and count to assistive technology.

#### Scenario: Compare chart and table
- **WHEN** the series contains counts 1, 0, and 2
- **THEN** both chart and table expose the same three dates and values

### Requirement: Device-scoped stats state

Changing the selected device SHALL clear the prior series before querying the new device and SHALL distinguish loading, ready, and error states.

#### Scenario: Switch stats device
- **WHEN** the member changes from device A to B
- **THEN** no A series remains visible while B loads

### Requirement: Validated daily aggregate documents

Before gap filling, each existing document MUST have a document ID equal to `date`, `timeZone: Asia/Taipei`, a non-negative safe-integer urinationCount, `volumeStatus: pending_calibration`, four null estimated volume fields, and finite integer lastEventAtMs and updatedAtMs. A corrupt document SHALL produce a data-integrity error and SHALL NOT be replaced by a synthetic zero.

#### Scenario: Reject a wrong-timezone document
- **WHEN** dailyStats `2026-07-20` contains `timeZone: UTC`
- **THEN** series construction fails with a data-integrity error

### Requirement: All-zero fourteen-day series

When the selected device has no daily documents in the requested range, the view SHALL display 14 synthetic zero points rather than an empty-data state.

#### Scenario: Query a device with no daily documents
- **WHEN** the repository returns no documents for the 14-day range
- **THEN** the chart and table each expose 14 dates with count 0 and synthetic true

### Requirement: Stale stats response isolation

The stats store SHALL associate each query with the selected deviceId and a monotonically increasing generation. Responses from older generations or other devices SHALL NOT mutate the current series or error state.

#### Scenario: Prior-device stats return after a switch
- **WHEN** device A query starts, selection changes to B, and A returns last
- **THEN** only the B series remains visible
