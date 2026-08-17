# development-tester-event-tool Specification

## Purpose

TBD - created by syncing change 'publish-development-tester-event-tool'. Update Purpose after archive.

## Requirements

### Requirement: Loopback development-cloud bridge

The existing local test tool SHALL support explicit `local` and `development-cloud` profiles while continuing to listen only on `127.0.0.1`. In `development-cloud` profile, the server MUST accept only the approved credential-free HTTPS Hosting, Ingestion, and Member API origins, and it MUST proxy only Ingestion `GET /healthz`, Member API `GET /healthz`, and Ingestion `POST /v1/emqx/events`. The server MUST reject every other remote host, path, method, caller-supplied Authorization header, and live Firestore REST operation before making an upstream request.

#### Scenario: Send a development event from the local tool

- **WHEN** an operator starts the tool in `development-cloud` profile with approved origins and submits an event for a pre-provisioned development device
- **THEN** the loopback server SHALL forward exactly one request to the approved Ingestion event path and SHALL remain unreachable from non-loopback network interfaces

#### Scenario: Reject an arbitrary remote proxy request

- **WHEN** the browser asks the local proxy to call an unapproved host, path, method, live Firestore endpoint, or supplies an Authorization header
- **THEN** the server SHALL reject the request with a sanitized error and SHALL make zero upstream requests

#### Scenario: Preserve the Emulator workflow

- **WHEN** an operator starts the tool in `local` profile
- **THEN** the existing loopback Emulator health, device registry, urination, battery, custom-name, sequence, and preview behaviors SHALL remain available


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
### Requirement: Local server-side development secret boundary

In `development-cloud` profile, the local test-tool server SHALL receive the Ingestion credential from exactly one validated operator credential provider: an authenticated personal gcloud session accessing an exact positive numeric version of the fixed development Ingestion secret in project `petcare-c7483`, or the existing configured operator-only secret file. The gcloud provider MUST invoke gcloud without a shell, MUST reject service-account identity, foreign or unset project, inherited service-account key or Emulator configuration, nonnumeric version, and unexpected output before listening, and MUST keep the resolved credential only in process memory. The file provider MUST preserve the existing owner-only file validation. The server SHALL inject the credential only for the approved Ingestion event operation. The secret MUST NOT appear in the executable, HTML, sanitized configuration response, DOM, browser request, localStorage, curl preview, proxy response, command arguments, environment, filesystem output, standard output, standard error, or structured test-tool log. Missing, invalid, ambiguous, inaccessible, empty, or malformed credential input and invalid cloud origins MUST fail before the server starts listening.

#### Scenario: Inject a gcloud-resolved credential server-side

- **WHEN** an authorized personal operator starts development-cloud mode with one exact numeric secret version and the browser submits an approved development event without an Authorization header
- **THEN** the server SHALL add the in-memory credential to the single approved upstream request, return a response containing no credential material, and clear the credential when the server closes

#### Scenario: Preserve the owner-only file provider

- **WHEN** development-cloud mode starts with one valid owner-only secret file and no gcloud secret-version option
- **THEN** the server SHALL preserve the existing file validation and approved event injection behavior without invoking gcloud

#### Scenario: Reject an unsafe gcloud boundary before listening

- **WHEN** gcloud is unavailable or unauthenticated, the active identity is absent, multiple, or a service account, the project is not `petcare-c7483`, the secret version is not a positive integer, Secret Manager access fails, or the resolved value is invalid
- **THEN** startup SHALL exit non-zero before binding the loopback port, SHALL clear captured credential buffers, and SHALL NOT print raw gcloud output, identity data, invalid values, or secret material

#### Scenario: Reject ambiguous credential providers before listening

- **WHEN** development-cloud mode receives both a secret-version option and a secret-file option or receives neither
- **THEN** startup SHALL fail with `invalid_arguments` before invoking gcloud, reading a secret file, binding the loopback port, or opening the browser

#### Scenario: Preserve local profile isolation

- **WHEN** local profile starts without credential options
- **THEN** it SHALL preserve the existing loopback Emulator workflow and SHALL perform no gcloud or Secret Manager operation


<!-- @trace
source: package-macos-operator-test-tool
updated: 2026-08-18
code:
  - package.json
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - scripts/test-tool-operator.mjs
  - scripts/test-tool.mjs
tests:
  - scripts/test-tool-operator.spec.ts
  - scripts/test-tool-server.spec.ts
-->

---
### Requirement: Hosted Web observation handoff

The `development-cloud` profile SHALL display a clear environment banner and a fixed control that opens `https://petcare-c7483.web.app` without credentials, tokens, device settings, or query parameters. It SHALL disable live device create/update and direct custom-name reads, and it SHALL explain that the selected development device MUST be provisioned through the approved operator workflow before event submission.

#### Scenario: Open the hosted application after an event

- **WHEN** an operator sends an event and activates the Hosting control
- **THEN** the browser SHALL open the approved Firebase Hosting origin in a separate browsing context so the operator can authenticate normally and inspect the device projection

#### Scenario: Prevent Emulator-only registry access in cloud profile

- **WHEN** the tool is using `development-cloud` profile
- **THEN** device create/update, Firestore REST, and direct custom-name refresh controls SHALL be unavailable and SHALL make zero live Firestore requests


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
### Requirement: Authenticated tester event tool access

The development tester event tool SHALL require an existing Firebase member session and SHALL list only devices that the Test Tool API confirms are owned, enabled, and marked for the approved development beta tool. The tool MUST NOT provide a separate credential store or expose tester identity data in persisted UI state.

#### Scenario: Open the tool as an eligible tester

- **WHEN** an authenticated tester opens `/test-tool` and owns one marked enabled beta device
- **THEN** the tool SHALL display that device and SHALL permit the tester to open urination and battery event forms

#### Scenario: Block a signed-out visitor

- **WHEN** a signed-out visitor opens `/test-tool`
- **THEN** the existing route guard SHALL redirect to `/sign-in` and SHALL render no tester device or event form

#### Scenario: Show no ineligible devices

- **WHEN** an authenticated member owns devices but none have the approved test-tool marker and enabled ingestion status
- **THEN** the API SHALL return an empty device list and the tool SHALL provide no event submission control


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
### Requirement: Typed event API without generic proxy capability

The Test Tool API SHALL expose only a device-list operation and a typed event submission operation. It MUST reject caller-controlled upstream URLs, methods, headers, topics, project identifiers, product models, event identities, sequences, timestamps, transport metadata, and extra request properties.

#### Scenario: Accept a urination measurement request

- **WHEN** an authorized tester submits exact JSON containing `eventType: "urination"`, `flushDurationMs`, and `pumpDurationMs`
- **THEN** the API SHALL validate the measurements and SHALL construct the remaining event and transport fields server-side

#### Scenario: Accept a battery measurement request

- **WHEN** an authorized tester submits exact JSON containing `eventType: "battery"`, an allowed `batteryLevelPercent`, and an optional valid `batteryVoltageMv`
- **THEN** the API SHALL validate the measurements and SHALL construct the remaining event and transport fields server-side

#### Scenario: Reject proxy control fields

- **WHEN** a request contains `url`, `method`, `headers`, `authorization`, `topic`, `projectId`, `productModel`, `eventId`, `sequence`, `recordedAtMs`, or any other undeclared property
- **THEN** the API SHALL return `400 invalid_request` and SHALL make zero ingestion calls

#### Scenario: Enforce transport boundaries

- **WHEN** a request has a non-JSON content type or a body larger than 8 KiB
- **THEN** the API SHALL return `415 unsupported_media_type` or `413 payload_too_large` respectively and SHALL make zero repository and ingestion calls


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
### Requirement: Server-side tester and device authorization

Every protected API operation SHALL verify a non-revoked Firebase ID token and SHALL authorize the decoded UID against the current Firestore device document. Event submission SHALL require document ID and `deviceId` consistency, matching `ownerUid`, `ingestionStatus: "enabled"`, a valid product model, and exact `developmentTestTool.enabled: true` and `developmentTestTool.marker: "petcare-c7483-beta-v1"`.

#### Scenario: Authorize an owned marked device

- **WHEN** a valid tester token identifies the owner of an enabled correctly marked development device
- **THEN** the API SHALL permit validated event submission for that device

#### Scenario: Reject a missing or invalid token

- **WHEN** the ID token is missing, malformed, expired, revoked, invalid, or belongs to the wrong Firebase project
- **THEN** the API SHALL return `401 unauthorized` and SHALL make zero Firestore usage writes and zero ingestion calls

#### Scenario: Hide device eligibility failures

- **WHEN** the device is missing, foreign-owned, disabled, malformed, or lacks the exact development marker
- **THEN** the API SHALL return `404 test_device_not_found` with the same response shape and SHALL make zero usage writes and zero ingestion calls


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
### Requirement: Server-generated canonical event envelope

For every accepted typed request, the server SHALL derive the product model from the authorized registry document, reserve the next sequence, generate a cryptographically random event identifier prefixed with `tt:<deviceId>:`, set server timestamps and fixed test-tool firmware and transport metadata, derive the canonical topic, and submit the resulting envelope to the approved development Ingestion API.

#### Scenario: Generate a canonical urination event

- **WHEN** device `PC-BETA-0001` registered as `pc-mini` reserves sequence 17 for a valid urination request
- **THEN** the server SHALL submit topic `products/pc-mini/devices/PC-BETA-0001/events/urination`, sequence 17, matching client and payload device identity, QoS 1, `retained: false`, and a unique `tt:PC-BETA-0001:` event identifier

#### Scenario: Generate a canonical battery event

- **WHEN** device `PC-BETA-0001` registered as `pc-mini` reserves sequence 18 for a valid battery request
- **THEN** the server SHALL submit topic `products/pc-mini/devices/PC-BETA-0001/status/battery` with the validated battery fields and the fixed server-owned transport metadata

#### Scenario: Return a sanitized stored outcome

- **WHEN** the development Ingestion API returns its accepted stored outcome
- **THEN** the Test Tool API SHALL return only `status`, `eventId`, `eventType`, `deviceId`, and `sequence` and SHALL NOT return the webhook secret, Authorization header, canonical envelope, or upstream response body


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
### Requirement: Transactional tester rate and sequence ledger

The server SHALL atomically authorize the device and reserve usage in a Firestore ledger keyed by a SHA-256 digest of the approved project ID and Firebase UID. Each tester SHALL be limited to 500 accepted attempts per UTC day, each tester-device pair SHALL have at least 1000 milliseconds between accepted reservations, and each device sequence SHALL increase without reuse up to the unsigned 32-bit maximum.

#### Scenario: Reserve the next permitted event

- **WHEN** the caller is below the daily quota, at least 1000 milliseconds have elapsed for the device, and the next sequence is within range
- **THEN** one transaction SHALL increment the daily count, record the acceptance time, reserve the next sequence, and permit exactly one ingestion call

#### Scenario: Reject a burst request

- **WHEN** the same tester submits another event for the same device 999 milliseconds after the prior reservation
- **THEN** the API SHALL return `429 rate_limited` with a bounded `retryAfterSeconds` and SHALL make zero ingestion calls

##### Example: Rate and quota boundaries

| State before request | Expected result |
| --- | --- |
| 999 ms since prior device reservation | `429 rate_limited` |
| 1000 ms since prior device reservation | accepted |
| 499 accepted attempts in the UTC day | accepted as attempt 500 |
| 500 accepted attempts in the UTC day | `429 rate_limited` |
| UTC day changed | daily count resets before reservation |
| next sequence is 4294967295 | sequence 4294967295 is accepted |
| next sequence exceeds 4294967295 | `409 sequence_exhausted` |

#### Scenario: Preserve a reservation after upstream failure

- **WHEN** usage reservation commits and the Ingestion API subsequently returns a transient failure
- **THEN** the API SHALL return `503 ingestion_unavailable` and SHALL NOT decrement the quota or reuse the reserved sequence

#### Scenario: Handle concurrent submissions

- **WHEN** two valid requests for the same tester and device race for one available time window
- **THEN** Firestore transaction retries SHALL allow at most one reservation and at most one ingestion call


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
### Requirement: Server-side ingestion secret and privacy boundary

The browser bundle, event-submission response, logs, Firestore usage ledger, deployment summary, and release record MUST NOT contain the ingestion secret, secret value, Authorization header, tester email, raw Firebase UID, raw custom-name field, measurement body, canonical payload, or full upstream response. The authorized device-list response SHALL expose only `deviceId` and resolved `displayName`. The Test Tool API SHALL read the secret only from the approved read-only mounted file and SHALL call only the approved HTTPS Ingestion origin and fixed event path.

#### Scenario: Inspect a successful request path

- **WHEN** a tester event is stored successfully
- **THEN** all structured logs and persisted records SHALL contain only allowlisted request ID, event type, sanitized device identifier digest, status, latency, and resource identity fields

#### Scenario: Reject unsafe runtime configuration

- **WHEN** the runtime has an Emulator host, mutable secret reference, non-HTTPS or unapproved ingestion origin, missing mounted secret file, service-account key, or unexpected environment variable coupling
- **THEN** startup SHALL fail before listening or initializing Firebase and SHALL NOT print the invalid value


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
### Requirement: Exact-origin browser and disable boundaries

The API SHALL return CORS permission only for the exact approved development Web origin, SHALL require authentication for all non-health operations, and SHALL fail event submission closed when the development disable switch is not exactly enabled. Health and preflight SHALL NOT disclose runtime configuration.

#### Scenario: Permit the approved origin with authentication

- **WHEN** the exact approved Web origin performs preflight and then sends a valid authenticated request
- **THEN** the API SHALL return the exact allow-origin header and SHALL process the request through the normal authorization path

#### Scenario: Reject a foreign browser origin

- **WHEN** a foreign origin performs preflight or an event request
- **THEN** the response SHALL contain no allow-origin permission and the event request SHALL make zero ingestion calls

#### Scenario: Disable tester event submission

- **WHEN** `PEECARE_TEST_TOOL_ENABLED` is absent or not exactly `true`
- **THEN** protected event submission SHALL return `503 ingestion_unavailable` and SHALL make zero usage writes and zero ingestion calls


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
### Requirement: Immutable development Test Tool API deployment

The Test Tool API SHALL deploy as a dedicated non-root Cloud Run service in the approved project and region using an immutable image digest, a dedicated runtime identity, request-based billing, zero minimum instances, bounded maximum instances and concurrency, numeric secret-version access, live verification, a sanitized release record, and exact rollback dry-run.

#### Scenario: Deploy a verified immutable revision

- **WHEN** the approved digest, service identity, budget record, secret version, origins, and resource limits pass preflight
- **THEN** deployment SHALL create an exact revision and verification SHALL cover health, CORS, unauthorized zero-write, foreign and unmarked denial, valid urination and battery events, rate limiting, Firestore and Web projection, and log privacy

#### Scenario: Reject an unsafe deployment input

- **WHEN** the image uses a mutable tag, the target differs from `petcare-c7483` or `asia-east1`, the identity is shared, the secret reference is not numeric, or any required budget or origin input is missing
- **THEN** deployment SHALL exit before IAM, Secret Manager, Artifact Registry, or Cloud Run mutation

#### Scenario: Refuse an ambiguous rollback

- **WHEN** no distinct prior healthy immutable revision exists for the same approved Test Tool API service
- **THEN** rollback dry-run SHALL return `rollback_unavailable` and SHALL NOT generate or execute a guessed traffic command

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