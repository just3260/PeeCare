## ADDED Requirements

### Requirement: Validated today totals projection tuple

The overview model SHALL require `todayDate`, `todayUrinationCount`, and `todayEstimatedUrineTotalMl` as one complete today tuple, where `todayDate` is a `yyyy-MM-dd` string, `todayUrinationCount` is a non-negative safe integer, and `todayEstimatedUrineTotalMl` is a non-negative finite number. A completely absent tuple SHALL mean missing data; a partial tuple or an invalid field value MUST produce a data-integrity error, and the view MUST NOT render a ready today card from it.

#### Scenario: Accept a complete today tuple
- **WHEN** a device contains `todayDate: 2026-07-28`, `todayUrinationCount: 3`, and `todayEstimatedUrineTotalMl: 550`
- **THEN** the model exposes those three values as the device's today totals

#### Scenario: Treat an absent tuple as missing data
- **WHEN** a device contains none of the three today fields
- **THEN** the model exposes today totals as missing and the home view displays an unknown-data placeholder

#### Scenario: Reject a partial today tuple
- **WHEN** a device contains `todayUrinationCount: 3` but no `todayDate` and no `todayEstimatedUrineTotalMl`
- **THEN** the model returns a data-integrity error and the view does not display a ready today card

##### Example: today tuple validation

| `todayDate` | `todayUrinationCount` | `todayEstimatedUrineTotalMl` | Result |
| ----------- | --------------------- | ---------------------------- | ------ |
| absent | absent | absent | missing data |
| `2026-07-28` | `3` | `550` | complete tuple |
| `2026-07-28` | `3` | absent | data-integrity error |
| `2026-07-28` | `-1` | `550` | data-integrity error |
| `2026-7-28` | `3` | `550` | data-integrity error |

### Requirement: Today totals staleness resolution

The overview SHALL resolve today totals against the current instant expressed in the fixed `Asia/Taipei` timezone. When the projected `todayDate` equals that current local date, the overview SHALL display the projected count and total. When the projected `todayDate` is an earlier date, the overview SHALL display zero urinations and zero millilitres, because every stored urination event updates the projection and an earlier date therefore means no event has been recorded today. When the tuple is missing, the overview SHALL display an unknown-data placeholder and SHALL NOT display zero.

#### Scenario: Display today totals for the current day
- **WHEN** the projection holds `todayDate: 2026-07-28` with count 3 and total 550, and the current Asia/Taipei date is `2026-07-28`
- **THEN** the home view displays 3 urinations and 550 mL for today

#### Scenario: Reset a stale projection after midnight
- **WHEN** the projection holds `todayDate: 2026-07-28` with count 3 and total 550, and the current Asia/Taipei date is `2026-07-29`
- **THEN** the home view displays 0 urinations and 0 mL for today

#### Scenario: Keep unknown totals unknown
- **WHEN** the device has no today tuple
- **THEN** the home view displays an unknown-data placeholder for today count and today volume instead of zero

##### Example: staleness resolution at the Asia/Taipei day boundary

| Projected `todayDate` | Current instant | Displayed count | Displayed volume |
| --------------------- | --------------- | --------------- | ---------------- |
| `2026-07-28` | `2026-07-28T15:59:59.999Z` | 3 | 550 mL |
| `2026-07-28` | `2026-07-28T16:00:00.000Z` | 0 | 0 mL |
| absent | any instant | unknown | unknown |
