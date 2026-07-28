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
### Requirement: Asia Taipei overview time display

The overview SHALL format latest urination time, latest battery time, and last reported time using the fixed `Asia/Taipei` timezone and SHALL retain the original epoch milliseconds in its model.

#### Scenario: Format a UTC boundary instant
- **WHEN** latestUrinationAtMs represents `2026-07-27T16:00:00.000Z`
- **THEN** the visible local date is July 28 in Asia/Taipei

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