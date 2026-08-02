# member-device-overview

## Purpose

TBD

## Requirements

### Requirement: Owned device selection

The overview SHALL list only owned devices in stable order and SHALL maintain exactly one selected device when the list is non-empty.

#### Scenario: Select from two devices
- **WHEN** the member owns devices A and B and selects B
- **THEN** B becomes the only selected device

#### Scenario: Show no-device state
- **WHEN** the member owns no devices
- **THEN** the overview displays an empty state and starts no device listener


<!-- @trace
source: show-member-device-overview
updated: 2026-07-29
code:
  - vitest.config.ts
  - src/components/DeviceSelector.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/devices/owned-device-model.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/return-route.ts
  - src/features/devices/device-overview-model.ts
  - firestore.rules
  - src/components/DeviceStatusCards.vue
  - src/features/devices/device-overview-store-key.ts
  - src/features/devices/device-overview-store.ts
  - src/router/index.ts
  - src/features/auth/session.ts
  - src/features/auth/auth-provider.ts
  - src/App.vue
  - src/features/auth/auth-store-key.ts
  - src/views/HomeView.vue
  - src/views/SignInView.vue
  - vitest.firebase.config.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
tests:
  - src/components/DeviceSelector.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/App.auth.spec.ts
  - src/views/SignInView.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Single selected-device listener

The overview SHALL maintain at most one live Firestore listener for the selected device and SHALL unsubscribe it before switching devices or signing out.

#### Scenario: Switch devices
- **WHEN** the member switches from A to B
- **THEN** the A listener stops before the B listener starts


<!-- @trace
source: show-member-device-overview
updated: 2026-07-29
code:
  - vitest.config.ts
  - src/components/DeviceSelector.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/devices/owned-device-model.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/return-route.ts
  - src/features/devices/device-overview-model.ts
  - firestore.rules
  - src/components/DeviceStatusCards.vue
  - src/features/devices/device-overview-store-key.ts
  - src/features/devices/device-overview-store.ts
  - src/router/index.ts
  - src/features/auth/session.ts
  - src/features/auth/auth-provider.ts
  - src/App.vue
  - src/features/auth/auth-store-key.ts
  - src/views/HomeView.vue
  - src/views/SignInView.vue
  - vitest.firebase.config.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
tests:
  - src/components/DeviceSelector.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/App.auth.spec.ts
  - src/views/SignInView.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Latest projection display

The overview SHALL display the selected device's latest urination time, latest battery level, and last reported time exactly as stored in the device projection.

#### Scenario: Receive a projection update
- **WHEN** Firestore updates the selected device battery from 50 to 25
- **THEN** the visible battery card changes to 25


<!-- @trace
source: show-member-device-overview
updated: 2026-07-29
code:
  - vitest.config.ts
  - src/components/DeviceSelector.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/devices/owned-device-model.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/return-route.ts
  - src/features/devices/device-overview-model.ts
  - firestore.rules
  - src/components/DeviceStatusCards.vue
  - src/features/devices/device-overview-store-key.ts
  - src/features/devices/device-overview-store.ts
  - src/router/index.ts
  - src/features/auth/session.ts
  - src/features/auth/auth-provider.ts
  - src/App.vue
  - src/features/auth/auth-store-key.ts
  - src/views/HomeView.vue
  - src/views/SignInView.vue
  - vitest.firebase.config.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
tests:
  - src/components/DeviceSelector.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/App.auth.spec.ts
  - src/views/SignInView.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Explicit overview states

The overview SHALL distinguish loading, empty, ready, missing-data, and read-error states. Missing values SHALL NOT be represented as zero or inferred from history.

#### Scenario: Display missing battery data
- **WHEN** the selected device has no latest battery projection
- **THEN** the battery card displays an unknown-data state

#### Scenario: Handle a listener error
- **WHEN** the selected device listener fails
- **THEN** the overview clears stale device data and displays a retryable error state


<!-- @trace
source: show-member-device-overview
updated: 2026-07-29
code:
  - vitest.config.ts
  - src/components/DeviceSelector.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/devices/owned-device-model.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/return-route.ts
  - src/features/devices/device-overview-model.ts
  - firestore.rules
  - src/components/DeviceStatusCards.vue
  - src/features/devices/device-overview-store-key.ts
  - src/features/devices/device-overview-store.ts
  - src/router/index.ts
  - src/features/auth/session.ts
  - src/features/auth/auth-provider.ts
  - src/App.vue
  - src/features/auth/auth-store-key.ts
  - src/views/HomeView.vue
  - src/views/SignInView.vue
  - vitest.firebase.config.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
tests:
  - src/components/DeviceSelector.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/App.auth.spec.ts
  - src/views/SignInView.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Validated latest projection tuples

The overview model SHALL require `latestUrinationEventId`, `latestUrinationAtMs`, and `latestUrinationReceivedAtMs` as one complete urination tuple. It SHALL require `latestBatteryEventId`, `latestBatteryLevelPercent`, `latestBatteryAtMs`, and `latestBatteryReceivedAtMs` as one complete battery tuple, with optional `latestBatteryVoltageMv`. A completely absent tuple SHALL mean missing data; a partial or invalid tuple MUST produce a data-integrity error.

#### Scenario: Reject a partial battery tuple
- **WHEN** a device contains `latestBatteryLevelPercent: 25` but no latestBatteryEventId or latestBatteryAtMs
- **THEN** the model returns a data-integrity error and the view does not display a ready battery card


<!-- @trace
source: show-member-device-overview
updated: 2026-07-29
code:
  - vitest.config.ts
  - src/components/DeviceSelector.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/devices/owned-device-model.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/return-route.ts
  - src/features/devices/device-overview-model.ts
  - firestore.rules
  - src/components/DeviceStatusCards.vue
  - src/features/devices/device-overview-store-key.ts
  - src/features/devices/device-overview-store.ts
  - src/router/index.ts
  - src/features/auth/session.ts
  - src/features/auth/auth-provider.ts
  - src/App.vue
  - src/features/auth/auth-store-key.ts
  - src/views/HomeView.vue
  - src/views/SignInView.vue
  - vitest.firebase.config.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
tests:
  - src/components/DeviceSelector.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/App.auth.spec.ts
  - src/views/SignInView.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
### Requirement: Canonical battery projection values

The overview SHALL accept a latest battery level only when it is exactly 0, 25, 50, 75, or 100 and SHALL display latestBatteryVoltageMv only when the same latest event provides a valid integer voltage.

#### Scenario: Display a latest battery snapshot
- **WHEN** a complete projection contains level 75 and voltage 3840
- **THEN** the card displays 75 percent and 3840 mV from that projection


<!-- @trace
source: show-member-device-overview
updated: 2026-07-29
code:
  - vitest.config.ts
  - src/components/DeviceSelector.vue
  - src/components/OverviewPlaceholder.vue
  - src/features/devices/owned-device-model.ts
  - src/features/devices/owned-device-repository.ts
  - src/features/auth/return-route.ts
  - src/features/devices/device-overview-model.ts
  - firestore.rules
  - src/components/DeviceStatusCards.vue
  - src/features/devices/device-overview-store-key.ts
  - src/features/devices/device-overview-store.ts
  - src/router/index.ts
  - src/features/auth/session.ts
  - src/features/auth/auth-provider.ts
  - src/App.vue
  - src/features/auth/auth-store-key.ts
  - src/views/HomeView.vue
  - src/views/SignInView.vue
  - vitest.firebase.config.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
tests:
  - src/components/DeviceSelector.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/App.auth.spec.ts
  - src/views/SignInView.spec.ts
  - src/App.no-service-worker.spec.ts
  - src/components/DeviceStatusCards.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/views/HomeView.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/devices/device-overview-model.spec.ts
-->

---
  - src/features/devices/device-overview-model.spec.ts
-->


---
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
### Requirement: Resolved device display name

Every device label in the member overview, home, history, statistics, and shared device selector SHALL use one common resolver. The resolver SHALL return a valid non-empty `customName` when present and SHALL otherwise return the immutable `deviceId`. A device document with no `customName` SHALL remain readable and SHALL display its `deviceId`.

#### Scenario: Display a custom name across device surfaces

- **WHEN** owned device `PC-000001` contains `customName: 主浴室`
- **THEN** home, history, statistics, and every shared device-selector option label that device as `主浴室`

#### Scenario: Fall back to the serial identifier

- **WHEN** owned device `PC-000001` has no `customName`
- **THEN** every device-label surface displays `PC-000001`

#### Scenario: Keep selection identity independent from the label

- **WHEN** selected device `PC-000001` changes its display name from `浴室` to `主浴室`
- **THEN** `selectedDeviceId` remains `PC-000001` and no device switch occurs


<!-- @trace
source: rename-shared-device-via-member-api
updated: 2026-08-02
code:
  - src/features/devices/device-overview-store.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
  - src/features/devices/member-device-api.ts
  - services/member-api/Dockerfile
  - services/member-api/src/server.ts
  - src/components/DeviceSelector.vue
  - src/views/SettingsView.vue
  - env.d.ts
  - services/member-api/tsconfig.json
  - src/features/devices/owned-device-model.ts
  - services/member-api/src/devices/device-name-service.ts
  - services/member-api/src/shutdown.ts
  - scripts/test-firebase.mjs
  - services/member-api/package.json
  - scripts/test-tool.html
  - services/member-api/src/firestore/device-name-repository.ts
  - services/member-api/src/config.ts
  - services/member-api/src/firestore/firestore-client.ts
  - package.json
  - services/member-api/src/security/firebase-id-token-verifier.ts
  - services/member-api/vitest.config.ts
  - src/features/auth/auth-provider.ts
  - scripts/machine.png
  - firebase/local/fixtures/members-and-devices.ts
  - services/member-api/src/http/errors.ts
  - services/member-api/src/devices/custom-name.ts
  - src/platform/firebase/config.ts
  - services/member-api/src/app.ts
  - vitest.config.ts
  - .env.example
  - src/features/devices/device-display-name.ts
  - services/member-api/tsconfig.test.json
  - src/platform/firebase/client.ts
  - scripts/test-tool.mjs
tests:
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/member-api/test/authenticated-member-flow.integration.test.ts
  - src/features/devices/device-display-name.spec.ts
  - src/views/SettingsView.spec.ts
  - scripts/test-tool.spec.ts
  - services/member-api/test/device-name-firestore.integration.test.ts
  - src/features/devices/member-device-api.spec.ts
  - src/features/devices/use-device-selection.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - services/member-api/test/config.test.ts
  - services/member-api/test/firebase-id-token-verifier.test.ts
  - services/member-api/test/app.test.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HistoryView.spec.ts
  - services/member-api/test/custom-name.test.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/views/StatsView.spec.ts
  - services/member-api/test/shutdown.test.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/HomeView.spec.ts
  - src/platform/firebase/config.spec.ts
  - src/platform/firebase/client.spec.ts
-->

---
### Requirement: Canonical shared-name synchronization

The overview store SHALL expose one asynchronous rename operation backed by the Member API adapter. It SHALL update the matching owned-device entry from the canonical success response only after the API succeeds, SHALL preserve stable device ordering and selection, and SHALL expose the updated immutable shared state to every consuming view. A validation, authentication, authorization, or persistence failure SHALL leave committed device state unchanged.

#### Scenario: Synchronize a successful rename

- **WHEN** the Member API returns `{"deviceId":"PC-000001","customName":"主浴室","displayName":"主浴室"}`
- **THEN** the store updates only `PC-000001`, preserves its list position and selection, and every mounted consumer displays `主浴室`

#### Scenario: Synchronize a successful clear

- **WHEN** the Member API returns `{"deviceId":"PC-000001","customName":null,"displayName":"PC-000001"}`
- **THEN** the store clears only that device custom name and every mounted consumer falls back to `PC-000001`

#### Scenario: Preserve committed state after failure

- **WHEN** a rename request fails before a canonical success response
- **THEN** the store retains the prior device list, custom name, stable order, and selected device

<!-- @trace
source: rename-shared-device-via-member-api
updated: 2026-08-02
code:
  - src/features/devices/device-overview-store.ts
  - src/main.ts
  - src/features/auth/auth-store.ts
  - src/features/devices/member-device-api.ts
  - services/member-api/Dockerfile
  - services/member-api/src/server.ts
  - src/components/DeviceSelector.vue
  - src/views/SettingsView.vue
  - env.d.ts
  - services/member-api/tsconfig.json
  - src/features/devices/owned-device-model.ts
  - services/member-api/src/devices/device-name-service.ts
  - services/member-api/src/shutdown.ts
  - scripts/test-firebase.mjs
  - services/member-api/package.json
  - scripts/test-tool.html
  - services/member-api/src/firestore/device-name-repository.ts
  - services/member-api/src/config.ts
  - services/member-api/src/firestore/firestore-client.ts
  - package.json
  - services/member-api/src/security/firebase-id-token-verifier.ts
  - services/member-api/vitest.config.ts
  - src/features/auth/auth-provider.ts
  - scripts/machine.png
  - firebase/local/fixtures/members-and-devices.ts
  - services/member-api/src/http/errors.ts
  - services/member-api/src/devices/custom-name.ts
  - src/platform/firebase/config.ts
  - services/member-api/src/app.ts
  - vitest.config.ts
  - .env.example
  - src/features/devices/device-display-name.ts
  - services/member-api/tsconfig.test.json
  - src/platform/firebase/client.ts
  - scripts/test-tool.mjs
tests:
  - services/ingestion-api/test/firestore-event-sink.integration.test.ts
  - services/member-api/test/authenticated-member-flow.integration.test.ts
  - src/features/devices/device-display-name.spec.ts
  - src/views/SettingsView.spec.ts
  - scripts/test-tool.spec.ts
  - services/member-api/test/device-name-firestore.integration.test.ts
  - src/features/devices/member-device-api.spec.ts
  - src/features/devices/use-device-selection.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - services/member-api/test/config.test.ts
  - services/member-api/test/firebase-id-token-verifier.test.ts
  - services/member-api/test/app.test.ts
  - src/features/devices/device-overview-store.spec.ts
  - src/views/HistoryView.spec.ts
  - services/member-api/test/custom-name.test.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/components/DeviceSelector.spec.ts
  - src/views/StatsView.spec.ts
  - services/member-api/test/shutdown.test.ts
  - firebase/local/firestore.rules.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/HomeView.spec.ts
  - src/platform/firebase/config.spec.ts
  - src/platform/firebase/client.spec.ts
-->