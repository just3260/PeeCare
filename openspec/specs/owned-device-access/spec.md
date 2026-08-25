# owned-device-access Specification

## Purpose

TBD - created by archiving change 'authorize-owned-device-access'. Update Purpose after archive.

## Requirements

### Requirement: Single-owner device model

Each readable device SHALL contain exactly one non-empty `ownerUid`. One UID SHALL be permitted to own multiple device documents.

#### Scenario: Represent multiple owned devices
- **WHEN** devices A and B both contain `ownerUid: member-001`
- **THEN** both devices belong to member-001


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Trusted first-owner Claim mutation

Only the trusted Claim backend SHALL set a missing `devices/{deviceId}.ownerUid` during a valid first-owner transaction. The Web client MUST remain unable to create, update, or delete ownership. The Claim transaction MUST treat the same UID as idempotent success and MUST reject a different non-empty ownerUid without changing it.

#### Scenario: Assign the first Owner

- **WHEN** a valid unexpired Claim Session for member-001 completes against an enabled ownerless device
- **THEN** the trusted backend sets ownerUid to member-001
- **AND** the Web client can subsequently discover the device through its constrained Owner query

#### Scenario: Refuse ownership replacement

- **WHEN** a valid Claim Session for member-002 completes against a device already owned by member-001
- **THEN** the Claim becomes conflict
- **AND** ownerUid remains member-001


<!-- @trace
source: add-device-claim-onboarding
updated: 2026-08-26
code:
  - deploy/development/emqx-webhook.template.json
  - src/features/device-claim/device-claim-store.ts
  - deploy/development/verify-member.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - src/features/device-claim/device-claim-api.ts
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/deploy-member.d.mts
  - src/views/HomeView.vue
  - src/views/DeviceConnectView.vue
  - deploy/development/verify-emqx-webhook.mjs
  - services/member-api/src/config.ts
  - services/member-api/src/http/errors.ts
  - devices/development/fixtures/legacy-bind-retry.json
  - devices/development/legacy-bind-policy.mjs
  - deploy/development/verify-member.d.mts
  - deploy/development/member-service.yaml
  - scripts/test-firebase.mjs
  - src/features/device-claim/device-claim-store-key.ts
  - deploy/development/deploy-member.mjs
  - deploy/development/EMQX_RUNBOOK.md
  - services/member-api/src/security/emqx-claim-auth.ts
  - firestore.rules
  - firebase/local/fixtures/device-claims.ts
  - services/member-api/src/app.ts
  - services/member-api/src/claims/claim-service.ts
  - package.json
  - src/components/WifiConnectionGuideDialog.vue
  - src/features/device-claim/device-id-input.ts
  - src/router/index.ts
  - services/member-api/src/claims/emqx-device-claim-route.ts
  - devices/development/legacy-bind-policy.json
  - deploy/development/configure-emqx-webhook.mjs
  - services/member-api/src/server.ts
  - services/member-api/src/firestore/device-claim-repository.ts
  - src/main.ts
  - src/features/device-claim/device-claim-session-storage.ts
  - services/member-api/src/claims/pair-code.ts
  - src/features/device-claim/device-claim-auth-lifecycle.ts
tests:
  - src/router/index.spec.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - src/views/HomeView.spec.ts
  - src/features/device-claim/device-id-input.spec.ts
  - services/member-api/test/member-claim-routes.test.ts
  - services/member-api/test/device-claim-firestore.integration.test.ts
  - src/features/device-claim/device-claim-store.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-firebase.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - services/member-api/test/app.test.ts
  - services/member-api/test/emqx-device-claim-route.test.ts
  - src/components/WifiConnectionGuideDialog.spec.ts
  - src/views/DeviceConnectView.spec.ts
  - services/member-api/test/pair-code.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-member.spec.ts
  - devices/development/legacy-bind-policy.spec.ts
  - src/features/device-claim/device-claim-auth-lifecycle.spec.ts
  - services/member-api/test/config.test.ts
  - deploy/development/deploy-member.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
  - services/member-api/test/emqx-claim-auth.test.ts
  - services/member-api/test/claim-service.test.ts
  - src/features/device-claim/device-claim-api.spec.ts
  - src/features/device-claim/device-claim-session-storage.spec.ts
-->

---
### Requirement: Claim storage remains Admin-only

Firestore Rules SHALL deny every Web client read and write under `deviceClaimSessions` and `activeDeviceClaims`. Claim Session authorization SHALL be enforced only by the authenticated Member API status route.

#### Scenario: Owner attempts direct Claim Session access

- **WHEN** an authenticated device Owner reads or writes either Claim collection through the Web SDK
- **THEN** Firestore returns permission-denied


<!-- @trace
source: add-device-claim-onboarding
updated: 2026-08-26
code:
  - deploy/development/emqx-webhook.template.json
  - src/features/device-claim/device-claim-store.ts
  - deploy/development/verify-member.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - src/features/device-claim/device-claim-api.ts
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/deploy-member.d.mts
  - src/views/HomeView.vue
  - src/views/DeviceConnectView.vue
  - deploy/development/verify-emqx-webhook.mjs
  - services/member-api/src/config.ts
  - services/member-api/src/http/errors.ts
  - devices/development/fixtures/legacy-bind-retry.json
  - devices/development/legacy-bind-policy.mjs
  - deploy/development/verify-member.d.mts
  - deploy/development/member-service.yaml
  - scripts/test-firebase.mjs
  - src/features/device-claim/device-claim-store-key.ts
  - deploy/development/deploy-member.mjs
  - deploy/development/EMQX_RUNBOOK.md
  - services/member-api/src/security/emqx-claim-auth.ts
  - firestore.rules
  - firebase/local/fixtures/device-claims.ts
  - services/member-api/src/app.ts
  - services/member-api/src/claims/claim-service.ts
  - package.json
  - src/components/WifiConnectionGuideDialog.vue
  - src/features/device-claim/device-id-input.ts
  - src/router/index.ts
  - services/member-api/src/claims/emqx-device-claim-route.ts
  - devices/development/legacy-bind-policy.json
  - deploy/development/configure-emqx-webhook.mjs
  - services/member-api/src/server.ts
  - services/member-api/src/firestore/device-claim-repository.ts
  - src/main.ts
  - src/features/device-claim/device-claim-session-storage.ts
  - services/member-api/src/claims/pair-code.ts
  - src/features/device-claim/device-claim-auth-lifecycle.ts
tests:
  - src/router/index.spec.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - src/views/HomeView.spec.ts
  - src/features/device-claim/device-id-input.spec.ts
  - services/member-api/test/member-claim-routes.test.ts
  - services/member-api/test/device-claim-firestore.integration.test.ts
  - src/features/device-claim/device-claim-store.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-firebase.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - services/member-api/test/app.test.ts
  - services/member-api/test/emqx-device-claim-route.test.ts
  - src/components/WifiConnectionGuideDialog.spec.ts
  - src/views/DeviceConnectView.spec.ts
  - services/member-api/test/pair-code.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-member.spec.ts
  - devices/development/legacy-bind-policy.spec.ts
  - src/features/device-claim/device-claim-auth-lifecycle.spec.ts
  - services/member-api/test/config.test.ts
  - deploy/development/deploy-member.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
  - services/member-api/test/emqx-claim-auth.test.ts
  - services/member-api/test/claim-service.test.ts
  - src/features/device-claim/device-claim-api.spec.ts
  - src/features/device-claim/device-claim-session-storage.spec.ts
-->

---
### Requirement: Owner-only device reads

Firestore Rules SHALL allow an authenticated member to read a device only when its ownerUid equals `request.auth.uid`.

#### Scenario: Owner reads a device
- **WHEN** member-001 reads a device owned by member-001
- **THEN** the read succeeds

#### Scenario: Another member reads a device
- **WHEN** member-002 reads a device owned by member-001
- **THEN** the read is denied


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Owner-only child data reads

Firestore Rules SHALL allow event and dailyStats reads only when the authenticated member owns the parent device.

#### Scenario: Owner reads event history
- **WHEN** a device owner reads an event under that device
- **THEN** the read succeeds

#### Scenario: Anonymous user reads daily data
- **WHEN** an unauthenticated client reads dailyStats
- **THEN** the read is denied


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Constrained owned-device query

The Web repository SHALL query devices with `ownerUid == authenticatedUid` and SHALL NOT issue an unconstrained device collection query.

#### Scenario: List a member's devices
- **WHEN** member-001 owns devices A and B and member-002 owns device C
- **THEN** the repository returns A and B only


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Client write denial

Firestore Rules SHALL deny all Web client creates, updates, and deletes for devices, events, dailyStats, and ownership fields.

#### Scenario: Owner attempts a write
- **WHEN** an owner attempts to update a device display field through the Web SDK
- **THEN** the write is denied


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Ingestion registry preservation

The Admin-only ownership fixture SHALL merge a non-empty `ownerUid` into an existing device registry document and SHALL preserve `deviceId`, `productModel`, `ingestionStatus`, latest projection fields, and `lastReportedAtMs`.

#### Scenario: Add an owner to an ingested device
- **WHEN** `devices/PC-000001` already contains ingestion and latest projection fields and the fixture assigns `member-001`
- **THEN** only `ownerUid` and fixture marker fields change


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Malformed ownership denial

Firestore Rules and the Web repository MUST treat a missing, empty, non-string, or mismatched ownerUid as unauthorized. The repository SHALL reject a document whose `deviceId` differs from its document ID.

#### Scenario: Read a device with an empty owner
- **WHEN** an authenticated member reads a device with `ownerUid: ""`
- **THEN** the read is denied and the repository returns no device model


<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->

---
### Requirement: Owned device runtime model

The repository SHALL validate `deviceId`, `ownerUid`, `productModel`, and `ingestionStatus` before exposing an owned device and SHALL surface a typed data-integrity error instead of silently omitting required fields.

#### Scenario: Parse a mismatched device identifier
- **WHEN** document `devices/PC-000001` contains `deviceId: PC-000002`
- **THEN** model parsing fails with a data-integrity error

<!-- @trace
source: authorize-owned-device-access
updated: 2026-07-29
code:
  - src/features/auth/auth-store.ts
  - src/features/auth/session.ts
  - src/views/SignInView.vue
  - src/router/index.ts
  - firebase/local/fixtures/members-and-devices.ts
  - src/features/auth/auth-provider.ts
  - src/features/devices/owned-device-model.ts
  - src/features/auth/return-route.ts
  - src/features/devices/owned-device-repository.ts
  - vitest.firebase.config.ts
  - src/features/auth/auth-store-key.ts
  - firestore.rules
  - vitest.config.ts
  - src/main.ts
  - src/features/auth/protected-resource-registry.ts
  - src/App.vue
tests:
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - firebase/local/fixtures/members-and-devices.spec.ts
  - src/features/devices/owned-device-repository.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/features/devices/owned-device-model.spec.ts
  - src/views/SignInView.spec.ts
  - src/router/auth-guard.spec.ts
  - firebase/local/firestore.rules.spec.ts
-->