# daily-urination-visualization Specification

## Purpose

TBD - created by archiving change 'visualize-daily-urination-stats'. Update Purpose after archive.

## Requirements

### Requirement: Bounded fourteen-day query

The stats repository SHALL query only the selected owned device's 14 Asia/Taipei calendar days ending on today and SHALL order documents by date ascending.

#### Scenario: Query a fourteen-day range
- **WHEN** today is `2026-07-28` in Asia/Taipei
- **THEN** the range starts at `2026-07-15` and ends at `2026-07-28`


<!-- @trace
source: visualize-daily-urination-stats
updated: 2026-07-29
code:
  - src/components/DeviceSelector.vue
  - src/features/auth/return-route.ts
  - src/features/stats/daily-series.ts
  - src/main.ts
  - src/features/auth/auth-provider.ts
  - src/features/history/device-event-history-store.ts
  - vitest.firebase.config.ts
  - src/views/HomeView.vue
  - src/features/devices/device-overview-model.ts
  - src/features/history/urination-history-model.ts
  - src/features/auth/auth-store-key.ts
  - vitest.config.ts
  - src/views/StatsView.vue
  - src/components/DeviceStatusCards.vue
  - src/features/devices/owned-device-model.ts
  - src/features/history/device-event-history-store-key.ts
  - src/components/DailyUrinationChart.vue
  - src/views/SignInView.vue
  - firestore.rules
  - src/features/devices/device-overview-store.ts
  - src/features/devices/device-overview-store-key.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/stats/daily-stats-store.ts
  - src/views/HistoryView.vue
  - src/features/history/device-event-history-repository.ts
  - src/features/auth/protected-resource-registry.ts
  - src/features/stats/daily-stats-store-key.ts
  - src/router/index.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/auth-store.ts
  - src/features/stats/daily-stats-model.ts
  - src/components/BottomNavigation.vue
  - src/features/auth/session.ts
  - src/features/stats/daily-stats-repository.ts
  - src/App.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/stats/daily-stats-source.ts
  - firestore.indexes.json
tests:
  - src/features/devices/owned-device-repository.spec.ts
  - src/components/DailyUrinationChart.spec.ts
  - src/views/StatsView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/devices/device-overview-model.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/history/urination-history-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/App.auth.spec.ts
  - src/features/history/device-event-history.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/views/HistoryView.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/features/stats/daily-stats-store.spec.ts
  - src/views/SignInView.spec.ts
  - src/features/history/device-event-history-store.spec.ts
  - src/features/stats/daily-stats.spec.ts
-->

---
### Requirement: Continuous daily count series

The series builder SHALL return exactly one point for every day in the range and SHALL represent a missing document as `urinationCount: 0` with `synthetic: true`.

#### Scenario: Fill a missing day
- **WHEN** documents exist for July 15 and July 17 but not July 16
- **THEN** the series includes July 16 with count 0 and synthetic true


<!-- @trace
source: visualize-daily-urination-stats
updated: 2026-07-29
code:
  - src/components/DeviceSelector.vue
  - src/features/auth/return-route.ts
  - src/features/stats/daily-series.ts
  - src/main.ts
  - src/features/auth/auth-provider.ts
  - src/features/history/device-event-history-store.ts
  - vitest.firebase.config.ts
  - src/views/HomeView.vue
  - src/features/devices/device-overview-model.ts
  - src/features/history/urination-history-model.ts
  - src/features/auth/auth-store-key.ts
  - vitest.config.ts
  - src/views/StatsView.vue
  - src/components/DeviceStatusCards.vue
  - src/features/devices/owned-device-model.ts
  - src/features/history/device-event-history-store-key.ts
  - src/components/DailyUrinationChart.vue
  - src/views/SignInView.vue
  - firestore.rules
  - src/features/devices/device-overview-store.ts
  - src/features/devices/device-overview-store-key.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/stats/daily-stats-store.ts
  - src/views/HistoryView.vue
  - src/features/history/device-event-history-repository.ts
  - src/features/auth/protected-resource-registry.ts
  - src/features/stats/daily-stats-store-key.ts
  - src/router/index.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/auth-store.ts
  - src/features/stats/daily-stats-model.ts
  - src/components/BottomNavigation.vue
  - src/features/auth/session.ts
  - src/features/stats/daily-stats-repository.ts
  - src/App.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/stats/daily-stats-source.ts
  - firestore.indexes.json
tests:
  - src/features/devices/owned-device-repository.spec.ts
  - src/components/DailyUrinationChart.spec.ts
  - src/views/StatsView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/devices/device-overview-model.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/history/urination-history-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/App.auth.spec.ts
  - src/features/history/device-event-history.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/views/HistoryView.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/features/stats/daily-stats-store.spec.ts
  - src/views/SignInView.spec.ts
  - src/features/history/device-event-history-store.spec.ts
  - src/features/stats/daily-stats.spec.ts
-->
---
### Requirement: Accessible count visualization
The chart and semantic data table SHALL use the same normalized series and SHALL expose each date and count to assistive technology.

#### Scenario: Compare chart and table
- **WHEN** the series contains counts 1, 0, and 2
- **THEN** both chart and table expose the same three dates and values


<!-- @trace
source: visualize-daily-urination-stats
updated: 2026-07-29
code:
  - src/components/DeviceSelector.vue
  - src/features/auth/return-route.ts
  - src/features/stats/daily-series.ts
  - src/main.ts
  - src/features/auth/auth-provider.ts
  - src/features/history/device-event-history-store.ts
  - vitest.firebase.config.ts
  - src/views/HomeView.vue
  - src/features/devices/device-overview-model.ts
  - src/features/history/urination-history-model.ts
  - src/features/auth/auth-store-key.ts
  - vitest.config.ts
  - src/views/StatsView.vue
  - src/components/DeviceStatusCards.vue
  - src/features/devices/owned-device-model.ts
  - src/features/history/device-event-history-store-key.ts
  - src/components/DailyUrinationChart.vue
  - src/views/SignInView.vue
  - firestore.rules
  - src/features/devices/device-overview-store.ts
  - src/features/devices/device-overview-store-key.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/stats/daily-stats-store.ts
  - src/views/HistoryView.vue
  - src/features/history/device-event-history-repository.ts
  - src/features/auth/protected-resource-registry.ts
  - src/features/stats/daily-stats-store-key.ts
  - src/router/index.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/auth-store.ts
  - src/features/stats/daily-stats-model.ts
  - src/components/BottomNavigation.vue
  - src/features/auth/session.ts
  - src/features/stats/daily-stats-repository.ts
  - src/App.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/stats/daily-stats-source.ts
  - firestore.indexes.json
tests:
  - src/features/devices/owned-device-repository.spec.ts
  - src/components/DailyUrinationChart.spec.ts
  - src/views/StatsView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/devices/device-overview-model.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/history/urination-history-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/App.auth.spec.ts
  - src/features/history/device-event-history.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/views/HistoryView.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/features/stats/daily-stats-store.spec.ts
  - src/views/SignInView.spec.ts
  - src/features/history/device-event-history-store.spec.ts
  - src/features/stats/daily-stats.spec.ts
-->

---
### Requirement: Device-scoped stats state

Changing the selected device SHALL clear the prior series before querying the new device and SHALL distinguish loading, ready, and error states.

#### Scenario: Switch stats device
- **WHEN** the member changes from device A to B
- **THEN** no A series remains visible while B loads


<!-- @trace
source: visualize-daily-urination-stats
updated: 2026-07-29
code:
  - src/components/DeviceSelector.vue
  - src/features/auth/return-route.ts
  - src/features/stats/daily-series.ts
  - src/main.ts
  - src/features/auth/auth-provider.ts
  - src/features/history/device-event-history-store.ts
  - vitest.firebase.config.ts
  - src/views/HomeView.vue
  - src/features/devices/device-overview-model.ts
  - src/features/history/urination-history-model.ts
  - src/features/auth/auth-store-key.ts
  - vitest.config.ts
  - src/views/StatsView.vue
  - src/components/DeviceStatusCards.vue
  - src/features/devices/owned-device-model.ts
  - src/features/history/device-event-history-store-key.ts
  - src/components/DailyUrinationChart.vue
  - src/views/SignInView.vue
  - firestore.rules
  - src/features/devices/device-overview-store.ts
  - src/features/devices/device-overview-store-key.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/stats/daily-stats-store.ts
  - src/views/HistoryView.vue
  - src/features/history/device-event-history-repository.ts
  - src/features/auth/protected-resource-registry.ts
  - src/features/stats/daily-stats-store-key.ts
  - src/router/index.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/auth-store.ts
  - src/features/stats/daily-stats-model.ts
  - src/components/BottomNavigation.vue
  - src/features/auth/session.ts
  - src/features/stats/daily-stats-repository.ts
  - src/App.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/stats/daily-stats-source.ts
  - firestore.indexes.json
tests:
  - src/features/devices/owned-device-repository.spec.ts
  - src/components/DailyUrinationChart.spec.ts
  - src/views/StatsView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/devices/device-overview-model.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/history/urination-history-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/App.auth.spec.ts
  - src/features/history/device-event-history.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/views/HistoryView.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/features/stats/daily-stats-store.spec.ts
  - src/views/SignInView.spec.ts
  - src/features/history/device-event-history-store.spec.ts
  - src/features/stats/daily-stats.spec.ts
-->

---
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
### Requirement: All-zero fourteen-day series

When the selected device has no daily documents in the requested range, the view SHALL display 14 synthetic zero points rather than an empty-data state.

#### Scenario: Query a device with no daily documents
- **WHEN** the repository returns no documents for the 14-day range
- **THEN** the chart and table each expose 14 dates with count 0 and synthetic true


<!-- @trace
source: visualize-daily-urination-stats
updated: 2026-07-29
code:
  - src/components/DeviceSelector.vue
  - src/features/auth/return-route.ts
  - src/features/stats/daily-series.ts
  - src/main.ts
  - src/features/auth/auth-provider.ts
  - src/features/history/device-event-history-store.ts
  - vitest.firebase.config.ts
  - src/views/HomeView.vue
  - src/features/devices/device-overview-model.ts
  - src/features/history/urination-history-model.ts
  - src/features/auth/auth-store-key.ts
  - vitest.config.ts
  - src/views/StatsView.vue
  - src/components/DeviceStatusCards.vue
  - src/features/devices/owned-device-model.ts
  - src/features/history/device-event-history-store-key.ts
  - src/components/DailyUrinationChart.vue
  - src/views/SignInView.vue
  - firestore.rules
  - src/features/devices/device-overview-store.ts
  - src/features/devices/device-overview-store-key.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/stats/daily-stats-store.ts
  - src/views/HistoryView.vue
  - src/features/history/device-event-history-repository.ts
  - src/features/auth/protected-resource-registry.ts
  - src/features/stats/daily-stats-store-key.ts
  - src/router/index.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/auth-store.ts
  - src/features/stats/daily-stats-model.ts
  - src/components/BottomNavigation.vue
  - src/features/auth/session.ts
  - src/features/stats/daily-stats-repository.ts
  - src/App.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/stats/daily-stats-source.ts
  - firestore.indexes.json
tests:
  - src/features/devices/owned-device-repository.spec.ts
  - src/components/DailyUrinationChart.spec.ts
  - src/views/StatsView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/devices/device-overview-model.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/history/urination-history-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/App.auth.spec.ts
  - src/features/history/device-event-history.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/views/HistoryView.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/features/stats/daily-stats-store.spec.ts
  - src/views/SignInView.spec.ts
  - src/features/history/device-event-history-store.spec.ts
  - src/features/stats/daily-stats.spec.ts
-->

---
### Requirement: Stale stats response isolation

The stats store SHALL associate each query with the selected deviceId and a monotonically increasing generation. Responses from older generations or other devices SHALL NOT mutate the current series or error state.

#### Scenario: Prior-device stats return after a switch
- **WHEN** device A query starts, selection changes to B, and A returns last
- **THEN** only the B series remains visible

<!-- @trace
source: visualize-daily-urination-stats
updated: 2026-07-29
code:
  - src/components/DeviceSelector.vue
  - src/features/auth/return-route.ts
  - src/features/stats/daily-series.ts
  - src/main.ts
  - src/features/auth/auth-provider.ts
  - src/features/history/device-event-history-store.ts
  - vitest.firebase.config.ts
  - src/views/HomeView.vue
  - src/features/devices/device-overview-model.ts
  - src/features/history/urination-history-model.ts
  - src/features/auth/auth-store-key.ts
  - vitest.config.ts
  - src/views/StatsView.vue
  - src/components/DeviceStatusCards.vue
  - src/features/devices/owned-device-model.ts
  - src/features/history/device-event-history-store-key.ts
  - src/components/DailyUrinationChart.vue
  - src/views/SignInView.vue
  - firestore.rules
  - src/features/devices/device-overview-store.ts
  - src/features/devices/device-overview-store-key.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/stats/daily-stats-store.ts
  - src/views/HistoryView.vue
  - src/features/history/device-event-history-repository.ts
  - src/features/auth/protected-resource-registry.ts
  - src/features/stats/daily-stats-store-key.ts
  - src/router/index.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/auth-store.ts
  - src/features/stats/daily-stats-model.ts
  - src/components/BottomNavigation.vue
  - src/features/auth/session.ts
  - src/features/stats/daily-stats-repository.ts
  - src/App.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/stats/daily-stats-source.ts
  - firestore.indexes.json
tests:
  - src/features/devices/owned-device-repository.spec.ts
  - src/components/DailyUrinationChart.spec.ts
  - src/views/StatsView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/devices/device-overview-model.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/history/urination-history-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/App.auth.spec.ts
  - src/features/history/device-event-history.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/views/HistoryView.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/features/stats/daily-stats-store.spec.ts
  - src/views/SignInView.spec.ts
  - src/features/history/device-event-history-store.spec.ts
  - src/features/stats/daily-stats.spec.ts
-->