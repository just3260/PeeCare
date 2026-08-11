# development-web-deployment Specification

## Purpose

Define the development-only Firebase Hosting build, release, and smoke-verification requirements for safely deploying the Web MVP against approved cloud services.

## Requirements

### Requirement: Development-only Hosting target

Deployment SHALL require the approved development Firebase project and Hosting site and SHALL reject demo, Emulator, production, or mismatched targets before upload.

#### Scenario: Reject an Emulator build

- **WHEN** the build contains an Emulator host
- **THEN** deployment exits before Hosting upload

---
### Requirement: Secret-free cloud build

The public build SHALL contain only approved Firebase client configuration and SHALL NOT contain MQTT credentials, webhook secrets, Admin credentials, or source environment files.

#### Scenario: Inspect deployment artifacts

- **WHEN** the build artifact is scanned
- **THEN** no prohibited secret or environment file is found

---
### Requirement: SPA and cache behavior

Hosting SHALL rewrite application routes to the index shell, revalidate the shell, and immutable-cache content-hashed assets.

#### Scenario: Reload a protected route

- **WHEN** an authenticated member reloads `/history`
- **THEN** Hosting serves the app shell and the router restores the route

---
### Requirement: Development member smoke journey

Post-deploy verification SHALL cover sign-in, owned-device overview, history, daily stats, non-owner denial, and sign-out on a mobile viewport.

#### Scenario: Complete the smoke journey

- **WHEN** a marked development member signs in
- **THEN** all owned views load, non-owned data remains denied, and sign-out returns to the sign-in view

---
### Requirement: Hosting release record

A healthy release SHALL record the build hash, Hosting version, target, verification timestamp, and explicit rollback availability without credentials. When a prior live version exists, the record SHALL include that exact rollback version. For the first live release without channel history, the record SHALL contain `rollbackAvailable: false` and `rollbackVersion: null` only after exact operator bootstrap confirmation.

#### Scenario: Record a verified release

- **WHEN** all smoke checks pass and a prior live Hosting version exists
- **THEN** the release record SHALL identify the deployed version and exact rollback version

#### Scenario: Record a verified first release

- **WHEN** all smoke checks pass for an explicitly confirmed first live release with no channel history
- **THEN** the release record SHALL identify the deployed version and SHALL explicitly state that rollback is unavailable


<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->

---
### Requirement: One-time bootstrap verification without identity provisioning

Before the protected tester route exists on live Hosting, an explicitly approved one-time operator harness SHALL be permitted to produce the required Test Tool API healthy handoff only by using the assigned device owner and one non-owner Firebase Auth account that already exist. The harness MUST keep custom tokens and ID tokens in process memory, MUST clear token references when execution ends, and MUST NOT create, reset, update, delete, output, or persist an account, credential, token, user identifier, resolved secret, device payload, or event identifier. It MUST bind verification to the exact approved project, service, revision, immutable image digest, and origin, and it MUST execute all required Test Tool API smoke checks before emitting sanitized healthy evidence.

#### Scenario: Produce the bootstrap handoff from existing identities

- **WHEN** the assigned device owner and at least one non-owner Firebase Auth account already exist, the exact deployed Test Tool API target is healthy, and all required smoke checks pass
- **THEN** the harness SHALL emit one sanitized healthy API release record bound to that exact target, clear all in-memory token references, and perform no Firebase Auth account mutation

##### Example: Bind a complete run to one immutable revision

- **GIVEN** the assigned owner and one non-owner user already exist and revision `peecare-test-tool-development-00002-rte` serves the approved immutable image digest
- **WHEN** all eleven named API smoke checks pass against that revision and origin
- **THEN** one healthy record identifies the exact revision and digest without an account identifier, credential, token, resolved secret, device payload, or event identifier

#### Scenario: Fail closed when an existing principal is unavailable

- **WHEN** the assigned owner cannot be confirmed as an existing Firebase Auth account or no existing non-owner account is available
- **THEN** the harness SHALL exit non-zero before marker, event, release-record, or Hosting mutation and SHALL expose no account identifier or credential

##### Example: No foreign account exists

- **GIVEN** the assigned owner exists but every Firebase Auth account resolves to that same owner
- **WHEN** the harness resolves the foreign authorization principal
- **THEN** it exits with a stable sanitized failure before token exchange, marker write, event submission, or release-record write

#### Scenario: Reject incomplete or drifting bootstrap verification

- **WHEN** the project, service, revision, digest, or origin differs from the approved deployed target, any required smoke check fails, or output privacy validation finds protected data
- **THEN** the harness SHALL exit non-zero, SHALL NOT emit healthy evidence, SHALL clear in-memory token references, and SHALL perform zero Hosting mutation

##### Example: Require the complete API smoke set

- **GIVEN** ten API checks pass but `webProjection` fails for the exact deployed revision
- **WHEN** the harness evaluates the bootstrap result
- **THEN** no healthy API release record is written and Web upload remains blocked

---
### Requirement: Exact test-tool route restoration gate

A development Web release that restores the tester event tool SHALL prove before upload that the inspected production bundle registers `/test-tool`, selects the approved development Firebase environment, and binds the exact HTTPS Test Tool API origin from a current healthy immutable release record. The release MUST reject a bundle that omits the route or contains a stale, mismatched, loopback, Emulator, credential-bearing, or secret-bearing configuration.

#### Scenario: Accept an inspected test-tool bundle

- **WHEN** the production bundle contains the protected `/test-tool` route and its Test Tool API origin matches the current healthy release record for the approved project, region, service, revision, and immutable image digest
- **THEN** Web release preflight SHALL permit the operator to review the Hosting upload plan

#### Scenario: Reject a bundle that would fall back to home

- **WHEN** the inspected production bundle does not register `/test-tool` even though the Hosting rewrite can serve the application shell
- **THEN** Web release preflight SHALL exit non-zero before Hosting upload and SHALL report a stable route-absent failure

#### Scenario: Reject an invalid Test Tool API handoff

- **WHEN** the Test Tool API release record is missing, stale, unhealthy, bound to another project or service, or resolves a non-approved origin
- **THEN** Web release preflight SHALL exit non-zero before build artifact upload and SHALL perform zero Hosting mutation

##### Example: Reject a stale foreign-service record

- **GIVEN** a record marked healthy was verified more than 24 hours ago and identifies service `peecare-test-tool-staging`
- **WHEN** the operator starts the approved development Web release preflight
- **THEN** preflight exits non-zero before build or upload and reports zero Hosting mutations

---
### Requirement: Exact live test-tool route verification

A development Hosting release that includes the tester event tool SHALL bind post-deploy verification to the exact uploaded Hosting version and build hash. The release MUST NOT be marked healthy unless signed-out and authenticated direct-load journeys prove that `/test-tool` no longer reaches the unknown-route home fallback, the authenticated tester sees exactly the assigned eligible device, one bounded test event reaches its Web projection, and sign-out/offline verification exposes no prior tester state.

#### Scenario: Preserve the signed-out return path

- **WHEN** a fresh signed-out browser context directly opens `/test-tool` on the exact deployed Hosting version
- **THEN** the router SHALL render sign-in with `returnTo=/test-tool`, SHALL NOT redirect to home, and SHALL NOT render tester devices, forms, or prior results

#### Scenario: Preserve the authenticated tester route

- **WHEN** the assigned authenticated tester directly opens and reloads `/test-tool` on the exact deployed Hosting version
- **THEN** the router SHALL remain on `/test-tool`, the tool SHALL load exactly the assigned eligible device, and one bounded event submission SHALL produce the expected development Web projection

#### Scenario: Reject the home fallback after upload

- **WHEN** either direct-load journey resolves to `/`, loses the exact return path, loads an unexpected device, or fails the event projection
- **THEN** verification SHALL record the exact Hosting version as failed, SHALL NOT emit a healthy release record, and SHALL preserve only sanitized failure and rollback metadata

#### Scenario: Exclude tester state after sign-out

- **WHEN** the authenticated journey submits an event, signs out, clears its isolated context, and reloads `/test-tool` offline
- **THEN** the application SHALL expose no tester device, form value, event identifier, sequence, result, credential, or Test Tool API response from cache

---
### Requirement: Sanitized test-tool restoration evidence

A healthy test-tool restoration release record SHALL identify the approved project and site, exact build hash, exact Hosting version, exact Test Tool API revision identity, verification timestamp, check statuses, and explicit rollback availability. The record MUST NOT contain tester PII, credentials, tokens, device data, custom names, form values, event identifiers, or event payloads.

#### Scenario: Record a healthy restoration

- **WHEN** bundle inspection, signed-out routing, authenticated routing, eligible-device authorization, bounded event projection, cache exclusion, privacy scan, and rollback checks all pass for the same exact Hosting version
- **THEN** the release SHALL emit one sanitized healthy record bound to that Hosting version and Test Tool API revision

##### Example: Bind one healthy record to exact versions

- **GIVEN** Test Tool API revision `peecare-test-tool-development-00042-abc`, Hosting version `sites/petcare-c7483/versions/123`, and a distinct prior Hosting version `sites/petcare-c7483/versions/122`
- **WHEN** every required restoration check passes for version `123`
- **THEN** one record has status `healthy`, identifies revision `00042-abc`, identifies Hosting version `123`, and declares version `122` as the exact rollback target without tester data

#### Scenario: Preserve failed evidence without automatic rollback

- **WHEN** Hosting upload succeeds but any required restoration check fails
- **THEN** the release SHALL emit sanitized failed evidence, SHALL NOT label the release healthy, and SHALL produce only an exact prior-version rollback dry-run when a distinct prior healthy version exists

##### Example: Home fallback fails the new Hosting version

- **GIVEN** uploaded Hosting version `sites/petcare-c7483/versions/124` falls back from `/test-tool` to `/` and prior healthy version `sites/petcare-c7483/versions/123` exists
- **WHEN** live route verification evaluates version `124`
- **THEN** evidence has status `failed`, identifies failed version `124`, offers only a rollback dry-run for version `123`, and performs no automatic rollback

---
### Requirement: Verified Test Tool API origin handoff

A development Web build that includes the tester event tool SHALL require a healthy Test Tool API release record and SHALL inject its exact approved HTTPS origin through `VITE_TEST_TOOL_API_URL`. The build MUST reject a missing, loopback, HTTP, credential-bearing, path-bearing, wrong-project, unverified, or stale API origin before Hosting upload.

#### Scenario: Build with a healthy Test Tool API release

- **WHEN** the release record identifies a healthy immutable `peecare-test-tool-development` revision in `petcare-c7483` and provides its exact HTTPS origin
- **THEN** the Web build SHALL bind the protected test-tool adapter to that origin and SHALL contain no Emulator or loopback endpoint

#### Scenario: Reject an unverified API origin

- **WHEN** `VITE_TEST_TOOL_API_URL` is missing or does not match the healthy release record for the approved service and project
- **THEN** the Web deployment SHALL exit before build artifact upload


<!-- @trace
source: publish-development-tester-event-tool
updated: 2026-08-11
code:
  - src/App.vue
  - env.d.ts
  - services/test-tool-api/tsconfig.test.json
  - deploy/development/verify-test-tool.mjs
  - services/test-tool-api/src/events/test-event-service.ts
  - scripts/install-workspaces.mjs
  - scripts/test-tool.mjs
  - scripts/check-release.mjs
  - services/test-tool-api/src/security/firebase-id-token-verifier.ts
  - src/features/test-tool/test-tool-api.ts
  - services/test-tool-api/scripts/scan-privacy.mjs
  - deploy/development/deploy-web.mjs
  - services/test-tool-api/tsconfig.json
  - package.json
  - deploy/development/deploy-test-tool.mjs
  - src/main.ts
  - firebase.json
  - src/views/TestToolView.vue
  - services/test-tool-api/src/devices/test-device-repository.ts
  - deploy/development/TEST_TOOL_RUNBOOK.md
  - src/features/auth/protected-resource-registry.ts
  - scripts/audit-production-dependencies.mjs
  - scripts/test-tool.development.env.example
  - deploy/development/verify-web.mjs
  - firebase/local/README.md
  - services/test-tool-api/src/usage/usage-ledger.ts
  - services/test-tool-api/src/events/test-event-request.ts
  - deploy/development/test-tool-service.json
  - services/test-tool-api/cloudbuild.json
  - services/test-tool-api/src/security/privacy-scan.ts
  - services/test-tool-api/src/server.ts
  - deploy/development/BETA_RELEASE_RUNBOOK.md
  - services/test-tool-api/src/config.ts
  - .env.example
  - src/router/index.ts
  - services/test-tool-api/src/http/response-contract.ts
  - vitest.config.ts
  - services/test-tool-api/package.json
  - services/test-tool-api/Dockerfile
  - services/test-tool-api/vitest.config.ts
  - services/test-tool-api/src/security/mounted-ingestion-secret.ts
  - scripts/test-firebase.mjs
  - deploy/development/beta-tester-inventory.schema.json
  - services/test-tool-api/src/app.ts
  - deploy/development/fixtures/test-tool-rollback-release.json
  - src/features/test-tool/test-tool-api-key.ts
  - deploy/development/release-web-beta.mjs
  - scripts/test-tool.html
  - src/features/test-tool/test-tool-api-config.ts
  - deploy/development/beta-tester-inventory.example.json
  - services/test-tool-api/src/ingestion/ingestion-client.ts
tests:
  - src/router/test-tool-route.spec.ts
  - deploy/development/release-web-beta.spec.ts
  - scripts/test-tool.spec.ts
  - services/test-tool-api/test/app-ingestion-errors.test.ts
  - services/test-tool-api/test/test-event-service.test.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - services/test-tool-api/test/app-response-privacy.test.ts
  - services/test-tool-api/test/server.test.ts
  - firebase/local/firestore.rules.spec.ts
  - services/test-tool-api/test/test-event-request.test.ts
  - src/features/test-tool/test-tool-api.spec.ts
  - scripts/test-firebase.spec.ts
  - scripts/install-workspaces.spec.ts
  - services/test-tool-api/test/usage-ledger.test.ts
  - scripts/audit-production-dependencies.spec.ts
  - services/test-tool-api/test/app-ledger-errors.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-test-tool.spec.ts
  - src/pwa-build.spec.ts
  - services/test-tool-api/test/app-event-boundary.test.ts
  - scripts/check-release.spec.ts
  - scripts/test-tool-server.spec.ts
  - services/test-tool-api/test/app.test.ts
  - services/test-tool-api/test/ingestion-client.test.ts
  - services/test-tool-api/test/privacy-scan.test.ts
  - services/test-tool-api/test/container.test.ts
  - deploy/development/verify-web.spec.ts
  - src/features/test-tool/test-tool-api-config.spec.ts
  - deploy/development/deploy-web.spec.ts
  - src/App.auth.spec.ts
  - src/views/TestToolView.spec.ts
  - services/test-tool-api/test/app-auth.test.ts
  - services/test-tool-api/test/app-complete-matrix.test.ts
  - services/test-tool-api/test/test-device-repository.test.ts
  - src/App.spec.ts
  - services/ingestion-api/test/test-tool-event-to-projection.integration.test.ts
  - services/test-tool-api/test/firebase-id-token-verifier.test.ts
  - services/test-tool-api/test/test-device-firestore.integration.test.ts
  - src/router/index.spec.ts
  - services/test-tool-api/test/app-device-authorization.test.ts
  - services/test-tool-api/test/config.test.ts
  - deploy/development/deploy-test-tool.spec.ts
-->

---
### Requirement: Protected development test-tool route

The development Web app SHALL expose `/test-tool` only as an authenticated route, SHALL use the existing Firebase authentication lifecycle, and SHALL load tester devices and submit events only through the configured Test Tool API adapter. The route SHALL NOT initialize another Firebase app, display an independent sign-in form, or expose generic proxy settings.

#### Scenario: Reload the tester tool as an authenticated member

- **WHEN** an authenticated development tester directly loads or reloads `/test-tool`
- **THEN** Firebase Hosting SHALL serve the application shell, the router SHALL preserve `/test-tool`, and the tool SHALL use the existing authenticated session

#### Scenario: Open the tester tool while signed out

- **WHEN** a signed-out visitor directly loads `/test-tool`
- **THEN** the route guard SHALL redirect to `/sign-in` without rendering tester devices, event forms, or prior tester results

#### Scenario: Exclude the tester tool from non-development configuration

- **WHEN** a Web build does not explicitly select the approved development environment and verified Test Tool API release
- **THEN** the build SHALL fail closed and SHALL NOT publish a functional tester tool route


<!-- @trace
source: publish-development-tester-event-tool
updated: 2026-08-11
code:
  - src/App.vue
  - env.d.ts
  - services/test-tool-api/tsconfig.test.json
  - deploy/development/verify-test-tool.mjs
  - services/test-tool-api/src/events/test-event-service.ts
  - scripts/install-workspaces.mjs
  - scripts/test-tool.mjs
  - scripts/check-release.mjs
  - services/test-tool-api/src/security/firebase-id-token-verifier.ts
  - src/features/test-tool/test-tool-api.ts
  - services/test-tool-api/scripts/scan-privacy.mjs
  - deploy/development/deploy-web.mjs
  - services/test-tool-api/tsconfig.json
  - package.json
  - deploy/development/deploy-test-tool.mjs
  - src/main.ts
  - firebase.json
  - src/views/TestToolView.vue
  - services/test-tool-api/src/devices/test-device-repository.ts
  - deploy/development/TEST_TOOL_RUNBOOK.md
  - src/features/auth/protected-resource-registry.ts
  - scripts/audit-production-dependencies.mjs
  - scripts/test-tool.development.env.example
  - deploy/development/verify-web.mjs
  - firebase/local/README.md
  - services/test-tool-api/src/usage/usage-ledger.ts
  - services/test-tool-api/src/events/test-event-request.ts
  - deploy/development/test-tool-service.json
  - services/test-tool-api/cloudbuild.json
  - services/test-tool-api/src/security/privacy-scan.ts
  - services/test-tool-api/src/server.ts
  - deploy/development/BETA_RELEASE_RUNBOOK.md
  - services/test-tool-api/src/config.ts
  - .env.example
  - src/router/index.ts
  - services/test-tool-api/src/http/response-contract.ts
  - vitest.config.ts
  - services/test-tool-api/package.json
  - services/test-tool-api/Dockerfile
  - services/test-tool-api/vitest.config.ts
  - services/test-tool-api/src/security/mounted-ingestion-secret.ts
  - scripts/test-firebase.mjs
  - deploy/development/beta-tester-inventory.schema.json
  - services/test-tool-api/src/app.ts
  - deploy/development/fixtures/test-tool-rollback-release.json
  - src/features/test-tool/test-tool-api-key.ts
  - deploy/development/release-web-beta.mjs
  - scripts/test-tool.html
  - src/features/test-tool/test-tool-api-config.ts
  - deploy/development/beta-tester-inventory.example.json
  - services/test-tool-api/src/ingestion/ingestion-client.ts
tests:
  - src/router/test-tool-route.spec.ts
  - deploy/development/release-web-beta.spec.ts
  - scripts/test-tool.spec.ts
  - services/test-tool-api/test/app-ingestion-errors.test.ts
  - services/test-tool-api/test/test-event-service.test.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - services/test-tool-api/test/app-response-privacy.test.ts
  - services/test-tool-api/test/server.test.ts
  - firebase/local/firestore.rules.spec.ts
  - services/test-tool-api/test/test-event-request.test.ts
  - src/features/test-tool/test-tool-api.spec.ts
  - scripts/test-firebase.spec.ts
  - scripts/install-workspaces.spec.ts
  - services/test-tool-api/test/usage-ledger.test.ts
  - scripts/audit-production-dependencies.spec.ts
  - services/test-tool-api/test/app-ledger-errors.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-test-tool.spec.ts
  - src/pwa-build.spec.ts
  - services/test-tool-api/test/app-event-boundary.test.ts
  - scripts/check-release.spec.ts
  - scripts/test-tool-server.spec.ts
  - services/test-tool-api/test/app.test.ts
  - services/test-tool-api/test/ingestion-client.test.ts
  - services/test-tool-api/test/privacy-scan.test.ts
  - services/test-tool-api/test/container.test.ts
  - deploy/development/verify-web.spec.ts
  - src/features/test-tool/test-tool-api-config.spec.ts
  - deploy/development/deploy-web.spec.ts
  - src/App.auth.spec.ts
  - src/views/TestToolView.spec.ts
  - services/test-tool-api/test/app-auth.test.ts
  - services/test-tool-api/test/app-complete-matrix.test.ts
  - services/test-tool-api/test/test-device-repository.test.ts
  - src/App.spec.ts
  - services/ingestion-api/test/test-tool-event-to-projection.integration.test.ts
  - services/test-tool-api/test/firebase-id-token-verifier.test.ts
  - services/test-tool-api/test/test-device-firestore.integration.test.ts
  - src/router/index.spec.ts
  - services/test-tool-api/test/app-device-authorization.test.ts
  - services/test-tool-api/test/config.test.ts
  - deploy/development/deploy-test-tool.spec.ts
-->

---
### Requirement: Test-tool member data cache exclusion

The service worker SHALL NOT cache Test Tool API requests, responses, eligible-device data, event results, Firebase ID tokens, or tester form state. Signing out and reopening the app offline MUST NOT display any prior tester device, measurements, event identifier, or outcome.

#### Scenario: Sign out after submitting a test event

- **WHEN** a tester submits an event, signs out, goes offline, and reloads `/test-tool`
- **THEN** the shell SHALL route to sign-in and SHALL display no cached tester device, form values, event identifier, sequence, or result

#### Scenario: Inspect Cache Storage after tester use

- **WHEN** verification inspects all service-worker cache entries after device listing and event submission
- **THEN** no entry SHALL target the Test Tool API origin or contain tester device or event-result markers


<!-- @trace
source: publish-development-tester-event-tool
updated: 2026-08-11
code:
  - src/App.vue
  - env.d.ts
  - services/test-tool-api/tsconfig.test.json
  - deploy/development/verify-test-tool.mjs
  - services/test-tool-api/src/events/test-event-service.ts
  - scripts/install-workspaces.mjs
  - scripts/test-tool.mjs
  - scripts/check-release.mjs
  - services/test-tool-api/src/security/firebase-id-token-verifier.ts
  - src/features/test-tool/test-tool-api.ts
  - services/test-tool-api/scripts/scan-privacy.mjs
  - deploy/development/deploy-web.mjs
  - services/test-tool-api/tsconfig.json
  - package.json
  - deploy/development/deploy-test-tool.mjs
  - src/main.ts
  - firebase.json
  - src/views/TestToolView.vue
  - services/test-tool-api/src/devices/test-device-repository.ts
  - deploy/development/TEST_TOOL_RUNBOOK.md
  - src/features/auth/protected-resource-registry.ts
  - scripts/audit-production-dependencies.mjs
  - scripts/test-tool.development.env.example
  - deploy/development/verify-web.mjs
  - firebase/local/README.md
  - services/test-tool-api/src/usage/usage-ledger.ts
  - services/test-tool-api/src/events/test-event-request.ts
  - deploy/development/test-tool-service.json
  - services/test-tool-api/cloudbuild.json
  - services/test-tool-api/src/security/privacy-scan.ts
  - services/test-tool-api/src/server.ts
  - deploy/development/BETA_RELEASE_RUNBOOK.md
  - services/test-tool-api/src/config.ts
  - .env.example
  - src/router/index.ts
  - services/test-tool-api/src/http/response-contract.ts
  - vitest.config.ts
  - services/test-tool-api/package.json
  - services/test-tool-api/Dockerfile
  - services/test-tool-api/vitest.config.ts
  - services/test-tool-api/src/security/mounted-ingestion-secret.ts
  - scripts/test-firebase.mjs
  - deploy/development/beta-tester-inventory.schema.json
  - services/test-tool-api/src/app.ts
  - deploy/development/fixtures/test-tool-rollback-release.json
  - src/features/test-tool/test-tool-api-key.ts
  - deploy/development/release-web-beta.mjs
  - scripts/test-tool.html
  - src/features/test-tool/test-tool-api-config.ts
  - deploy/development/beta-tester-inventory.example.json
  - services/test-tool-api/src/ingestion/ingestion-client.ts
tests:
  - src/router/test-tool-route.spec.ts
  - deploy/development/release-web-beta.spec.ts
  - scripts/test-tool.spec.ts
  - services/test-tool-api/test/app-ingestion-errors.test.ts
  - services/test-tool-api/test/test-event-service.test.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - services/test-tool-api/test/app-response-privacy.test.ts
  - services/test-tool-api/test/server.test.ts
  - firebase/local/firestore.rules.spec.ts
  - services/test-tool-api/test/test-event-request.test.ts
  - src/features/test-tool/test-tool-api.spec.ts
  - scripts/test-firebase.spec.ts
  - scripts/install-workspaces.spec.ts
  - services/test-tool-api/test/usage-ledger.test.ts
  - scripts/audit-production-dependencies.spec.ts
  - services/test-tool-api/test/app-ledger-errors.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-test-tool.spec.ts
  - src/pwa-build.spec.ts
  - services/test-tool-api/test/app-event-boundary.test.ts
  - scripts/check-release.spec.ts
  - scripts/test-tool-server.spec.ts
  - services/test-tool-api/test/app.test.ts
  - services/test-tool-api/test/ingestion-client.test.ts
  - services/test-tool-api/test/privacy-scan.test.ts
  - services/test-tool-api/test/container.test.ts
  - deploy/development/verify-web.spec.ts
  - src/features/test-tool/test-tool-api-config.spec.ts
  - deploy/development/deploy-web.spec.ts
  - src/App.auth.spec.ts
  - src/views/TestToolView.spec.ts
  - services/test-tool-api/test/app-auth.test.ts
  - services/test-tool-api/test/app-complete-matrix.test.ts
  - services/test-tool-api/test/test-device-repository.test.ts
  - src/App.spec.ts
  - services/ingestion-api/test/test-tool-event-to-projection.integration.test.ts
  - services/test-tool-api/test/firebase-id-token-verifier.test.ts
  - services/test-tool-api/test/test-device-firestore.integration.test.ts
  - src/router/index.spec.ts
  - services/test-tool-api/test/app-device-authorization.test.ts
  - services/test-tool-api/test/config.test.ts
  - deploy/development/deploy-test-tool.spec.ts
-->

---
### Requirement: Development cloud service selection

The hosted build SHALL select the development Firebase adapter through the explicit environment discriminator, SHALL target the approved project, and SHALL contain no loopback host or Emulator connector activation.

#### Scenario: Inspect the hosted Firebase target

- **WHEN** deployment verification loads the built configuration
- **THEN** it resolves the approved development project and no Emulator endpoint

---
### Requirement: Member data cache exclusion

The service worker SHALL NOT cache Firebase Auth, Firestore, Google identity, or Cloud Run API requests or responses. After sign-out, cached assets SHALL NOT reveal the prior member's device, event, or stats data.

#### Scenario: Sign out and open offline

- **WHEN** a member signs out and the app is reopened without network access
- **THEN** the shell can load but no prior member domain data is visible

---
### Requirement: No browser MQTT capability

The hosted build SHALL contain no MQTT client dependency, Broker URL, MQTT credential, or direct subscription path.

#### Scenario: Scan the production bundle

- **WHEN** the Hosting artifact is inspected
- **THEN** no MQTT package import, websocket Broker endpoint, username, or password is present

---
### Requirement: Protected route reload matrix

Verification SHALL directly reload `/`, `/history`, and `/stats` as an authenticated Owner and as a signed-out visitor, and SHALL directly load `/sign-in`. Owner sessions SHALL restore the requested protected route; signed-out sessions SHALL render no protected content and SHALL reach sign-in.

#### Scenario: Reload stats while signed out

- **WHEN** a signed-out browser directly opens `/stats`
- **THEN** Hosting serves the shell and the router shows sign-in without rendering stats

---
### Requirement: Live beta Hosting availability

A beta release SHALL publish the inspected development cloud build to the approved Firebase Hosting live channel and SHALL verify that the root shell and every protected-route entry point return the application shell instead of a 404 response.

#### Scenario: Publish the first live beta shell

- **WHEN** the approved build is uploaded and the live channel selects the resulting Hosting version
- **THEN** `/`, `/history`, `/stats`, and `/sign-in` SHALL return the application shell from `petcare-c7483.web.app`

#### Scenario: Reject an unavailable live origin

- **WHEN** the live origin or any required route returns 404, a non-shell response, or an unapproved redirect
- **THEN** the beta release SHALL be marked failed and SHALL NOT produce a healthy release record


<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->

---
### Requirement: Non-PII beta tester inventory

Beta release verification SHALL require exactly one opaque tester alias mapped to one marked development test device identifier matching `^PC-DEV-[0-9]{6}$`. The committed schema and example SHALL NOT contain or permit email addresses, Firebase UIDs, passwords, tokens, secrets, or production device identifiers, and the populated local inventory MUST remain untracked.

#### Scenario: Accept one tester assignment

- **WHEN** the local inventory contains alias `tester-1` mapped to marked development device `PC-DEV-000001`
- **THEN** beta release preflight SHALL accept the tester structure before requesting credentials

##### Example: Tester count boundaries

| Tester entries | Expected result |
| --- | --- |
| 0 | `inventory_invalid` |
| 1 | accepted |
| 2 | `inventory_invalid` |

#### Scenario: Reject identity or credential data in inventory

- **WHEN** an inventory key or value contains an email, Firebase UID, password, ID token, refresh token, webhook secret, or service-account material
- **THEN** preflight SHALL return `inventory_invalid` before build, browser, Firebase, or Hosting mutation


<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->

---
### Requirement: Ephemeral tester credential handling

The verifier SHALL obtain the single tester email and password only through a hidden interactive session, SHALL keep them only for the current tester authentication operation, and MUST NOT place them in command arguments, environment files, standard output, standard error, browser artifacts, or release records.

#### Scenario: Verify credentials in an interactive session

- **WHEN** an operator supplies a tester email and password through the hidden prompt
- **THEN** the verifier SHALL authenticate the tester, SHALL use the resulting session only for that tester journey, and SHALL omit the identity and credentials from all persisted output

#### Scenario: Reject non-interactive credential input

- **WHEN** no secure TTY is available or credentials are supplied through a command argument or inventory field
- **THEN** verification SHALL return `credential_input_unavailable` before tester authentication or Member API mutation


<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->

---
### Requirement: Isolated beta tester journeys

Verification SHALL run the single tester in a fresh browser context and SHALL cover sign-in, the assigned owned-device overview, history, daily statistics, Member API display-name rename and clear, protected-route reload, and sign-out. The signed-in Firebase UID SHALL own the inventory-assigned device, and the context MUST be torn down after the journey.

#### Scenario: Complete the single tester journey

- **WHEN** the single operator-provisioned tester authenticates and owns `PC-DEV-000001`
- **THEN** every required view and mutation SHALL succeed, the marker display name SHALL be cleared, and the tester stage SHALL be recorded as passed without identity or payload data

#### Scenario: Detect an incorrect device assignment

- **WHEN** an authenticated tester does not own the device assigned to that tester alias
- **THEN** verification SHALL return `tester_device_mismatch`, SHALL perform no display-name mutation, and SHALL mark the release failed

#### Scenario: Tear down a tester context

- **WHEN** a tester journey succeeds or fails
- **THEN** the verifier SHALL close that browser context and clear its Auth persistence, IndexedDB, Cache Storage, and service-worker-controlled member state before the verifier exits


<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->

---
### Requirement: Single-tester exact ownership boundary

Live verification SHALL require the authenticated tester's owned-device query and rendered protected content to contain exactly the inventory-assigned device and no additional device. The existing Emulator non-owner denial suite MUST pass before Hosting upload. This change SHALL NOT create a second live tester or claim cross-tester matrix coverage.

#### Scenario: Show only the assigned device

- **WHEN** `tester-1` signs in with assigned device `PC-DEV-000001`
- **THEN** the owned-device result and protected views SHALL contain exactly `PC-DEV-000001` and no additional device, event, or daily statistics data

#### Scenario: Fail on unexpected owned content

- **WHEN** the owned-device result or protected views contain any device other than `PC-DEV-000001`
- **THEN** verification SHALL return `unexpected_owned_device`, SHALL stop dependent smoke stages, and SHALL mark the release failed

#### Scenario: Preserve the non-owner release gate

- **WHEN** the beta release reaches the upload boundary
- **THEN** the existing Emulator non-owner denial suite MUST have passed and the release SHALL NOT report multi-tester live coverage


<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->

---
### Requirement: Healthy beta release and exact rollback evidence

A healthy beta release record SHALL identify the exact build hash, live Hosting version, rollback availability, verification timestamp, tester aliases, and required check statuses. A first live release without channel history MUST record `rollbackAvailable: false` and `rollbackVersion: null` and SHALL require exact operator bootstrap confirmation before upload. Every later healthy release MUST record `rollbackAvailable: true` and the exact prior Hosting version. The record MUST NOT contain tester PII, credentials, tokens, custom names, or event payloads. A failed release SHALL retain sanitized failure evidence and SHALL provide only an exact prior-version rollback dry-run when that version exists.

#### Scenario: Record a healthy beta release

- **WHEN** live availability, SPA/cache behavior, the single tester journey, exact ownership boundary, protected-route reload, and member-data cache exclusion all pass
- **THEN** the verifier SHALL emit a sanitized `status: healthy` record bound to the exact live version and explicit rollback availability

#### Scenario: Confirm the first live release without rollback

- **WHEN** the approved Hosting live channel has no release history and the operator supplies exact `APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK` confirmation
- **THEN** preflight SHALL permit one bootstrap upload and a passing release SHALL record `rollbackAvailable: false` and `rollbackVersion: null`

#### Scenario: Reject an unconfirmed first live release

- **WHEN** the approved Hosting live channel has no release history and exact bootstrap confirmation is absent or incorrect
- **THEN** preflight SHALL return `first_release_confirmation_required` before Hosting upload

#### Scenario: Preserve a failed release without false health

- **WHEN** Hosting upload succeeds but any required smoke check fails
- **THEN** the verifier SHALL emit sanitized `status: failed` evidence, SHALL NOT emit a healthy record, and SHALL retain the exact failed version plus the prior version when one exists

#### Scenario: Refuse an ambiguous rollback

- **WHEN** no distinct prior healthy Hosting version can be resolved for the same approved site
- **THEN** rollback dry-run SHALL return `rollback_unavailable` and SHALL NOT generate or execute a guessed rollback command

<!-- @trace
source: release-development-web-beta
updated: 2026-08-11
code:
  - deploy/development/beta-tester-inventory.schema.json
  - package.json
  - deploy/development/release-web-beta.mjs
  - deploy/development/beta-tester-inventory.example.json
  - deploy/development/BETA_RELEASE_RUNBOOK.md
tests:
  - deploy/development/release-web-beta.spec.ts
-->
