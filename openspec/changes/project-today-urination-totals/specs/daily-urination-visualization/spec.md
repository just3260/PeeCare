## MODIFIED Requirements

### Requirement: Validated daily aggregate documents

Before gap filling, each existing document MUST have a document ID equal to `date`, `timeZone: Asia/Taipei`, a non-negative safe-integer urinationCount, a non-negative finite `estimatedUrineTotalMl`, and finite integer lastEventAtMs and updatedAtMs. A document carrying the superseded pending-calibration shape — a `volumeStatus` field, or a null `estimatedUrineTotalMl` — SHALL be treated as corrupt. A corrupt document SHALL produce a data-integrity error and SHALL NOT be replaced by a synthetic zero.

#### Scenario: Reject a wrong-timezone document
- **WHEN** dailyStats `2026-07-20` contains `timeZone: UTC`
- **THEN** series construction fails with a data-integrity error

#### Scenario: Accept a summed volume document
- **WHEN** dailyStats `2026-07-20` contains count 4 and `estimatedUrineTotalMl: 720`
- **THEN** series construction succeeds and the day contributes a non-synthetic point with count 4

#### Scenario: Reject a superseded pending-calibration document
- **WHEN** dailyStats `2026-07-20` contains `volumeStatus: pending_calibration` and `estimatedUrineTotalMl: null`
- **THEN** series construction fails with a data-integrity error

##### Example: volume field validation

| `estimatedUrineTotalMl` | Other volume fields | Result |
| ----------------------- | ------------------- | ------ |
| `720` | absent | accepted |
| `0` | absent | accepted |
| `null` | four null fields, `volumeStatus: pending_calibration` | data-integrity error |
| `-5` | absent | data-integrity error |

## REMOVED Requirements

### Requirement: Pending volume exclusion

**Reason**: Daily documents no longer carry a `pending_calibration` status or null volume fields, so a rule that forbids displaying a numeric volume under those conditions describes a state that can no longer exist. Volume validity is now covered by "Validated daily aggregate documents".

**Migration**: The fourteen-day visualization continues to display counts only; no volume rendering is introduced by removing this requirement.
