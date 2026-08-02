## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Pending calibration daily record shape

**Reason**: The urine volume estimation formula is implemented, so daily documents now carry a real summed volume instead of a `pending_calibration` marker with four null fields. The current shape is defined by "Summed daily urine volume record shape".

**Migration**: Daily documents written under the previous shape are rejected by the integrity guard and are not backfilled; development environments clear the `dailyStats` subcollection and let it be rebuilt from new events.
