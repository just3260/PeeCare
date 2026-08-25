# development-member-api-deployment Specification

## Purpose

Define the immutable, least-privilege, authenticated, and verifiable deployment workflow required to operate the Member API safely on the approved development Cloud Run environment and hand its verified origin to the Web application.

## Requirements

### Requirement: Immutable development Member API revision

The Member API SHALL be deployed to an approved development Cloud Run service from an immutable image digest. The deployment record MUST bind the exact project, region, service, revision, and digest.

#### Scenario: Deploy an approved immutable image

- **WHEN** an approved operator deploys a verified Member API image digest
- **THEN** Cloud Run creates a development revision and the release record contains the same digest

#### Scenario: Reject a mutable image reference

- **WHEN** a deployment plan uses a mutable image tag
- **THEN** preflight exits non-zero before a Cloud Run revision is created


<!-- @trace
source: deploy-development-member-api
updated: 2026-08-10
code:
  - deploy/development/deploy-member.d.mts
  - services/member-api/src/server.ts
  - deploy/development/verify-ingestion.mjs
  - scripts/audit-production-dependencies.mjs
  - deploy/development/deploy-ingestion.mjs
  - env.d.ts
  - firebase/development/seed-admin-adapter.mjs
  - deploy/development/verify-ingestion.d.mts
  - firebase/development/readiness.d.mts
  - firebase/development/readiness.mjs
  - services/member-api/cloudbuild.json
  - firebase/development/verify.mjs
  - firebase/development/environment.mjs
  - firebase/development/deploy.mjs
  - deploy/development/ingestion-service.yaml
  - .firebaserc
  - src/platform/firebase/config.ts
  - firebase/development/preflight.mjs
  - deploy/development/deploy-member.mjs
  - firebase/development/environment.d.mts
  - .env.example
  - firebase/development/README.md
  - firebase/development/environment.ts
  - firebase/development/deploy.d.mts
  - services/ingestion-api/cloudbuild.json
  - services/ingestion-api/package.json
  - firebase/development/seed.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - deploy/development/verify-member.d.mts
  - package.json
  - services/member-api/src/app.ts
  - services/member-api/src/config.ts
  - firebase/development/seed.d.mts
  - deploy/development/member-service.yaml
  - deploy/development/deploy-ingestion.d.mts
  - deploy/development/verify-member.mjs
  - scripts/install-workspaces.mjs
  - services/ingestion-api/src/app.ts
  - src/platform/firebase/client.ts
  - vitest.config.ts
  - firebase/development/readiness-admin-adapter.mjs
  - services/ingestion-api/tsconfig.json
  - scripts/check-release.mjs
  - firebase/development/preflight.d.mts
tests:
  - services/member-api/test/app.test.ts
  - deploy/development/verify-member.spec.ts
  - firebase/development/deploy.spec.ts
  - scripts/install-workspaces.spec.ts
  - src/platform/firebase/config.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/deploy-ingestion.spec.ts
  - firebase/development/seed.spec.ts
  - firebase/development/readiness.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-tool.spec.ts
  - scripts/audit-production-dependencies.spec.ts
  - src/platform/firebase/client.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - firebase/development/preflight.spec.ts
  - deploy/development/deploy-member.spec.ts
  - services/member-api/test/config.test.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Co-deployed isolated Claim domain

The development Member API Cloud Run revision SHALL deploy the device Claim domain in the existing service without creating a third Cloud Run service. It SHALL expose Firebase-authenticated create and status routes and an independently authenticated EMQX route. Route-scoped authentication MUST reject credential cross-use and SHALL keep the existing device-name route behavior unchanged.

#### Scenario: Verify all Member API route classes

- **WHEN** deployment verification probes device naming, member Claim creation and status, and EMQX Claim ingress
- **THEN** each route accepts only its documented authentication adapter
- **AND** every cross-use probe is rejected before Firestore mutation


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
### Requirement: Claim-specific runtime secrets and persistence access

The Member API revision SHALL receive an independent Claim webhook secret and Pair Code HMAC key from approved Secret Manager numeric versions. Its dedicated runtime identity SHALL use the approved database-wide `roles/datastore.user` and `roles/firebaseauth.viewer` project roles and SHALL have direct `roles/secretmanager.secretAccessor` bindings only on the two approved Claim secrets. Because Firestore IAM cannot constrain Admin SDK access by collection, document field, or first-set-only mutation, the application repository, route boundaries, and release probes SHALL enforce the logical scope for enabled device registry reads, `deviceClaimSessions`, `activeDeviceClaims`, and first-set `ownerUid`. Artifacts and release evidence MUST describe this as application-enforced logical scope and direct-IAM-binding verification, MUST disclose the residual database-wide runtime compromise blast radius, and MUST NOT describe it as collection-level or field-level IAM isolation. Release records and verification summaries MUST NOT contain either secret, Pair Code, code MAC, Firebase token, UID, or complete bind payload.

#### Scenario: Verify an immutable Claim-capable revision

- **WHEN** the Member API deployment preflight and release verification inspect a Claim-capable revision
- **THEN** they confirm immutable image digest, exact secret version bindings, request-based `minInstances: 0`, approved Member API origin, exact approved direct project roles, no direct runtime binding on any unapproved project secret, and Claim persistence probes
- **AND** produce only sanitized evidence

#### Scenario: Enforce logical persistence scope in the application

- **WHEN** a release probe creates a Claim Session, rejects credential cross-use, completes first-owner Claim, and repeats the terminal bind
- **THEN** the application mutates only the expected Claim Session, active lock, and first-set `ownerUid` fields
- **AND** preserves all other device fields and duplicate terminal state
- **AND** reports the datastore role as database-wide application-enforced logical scope rather than IAM isolation

#### Scenario: Reject direct IAM drift or malformed inventory

- **WHEN** the runtime identity has an extra direct project role, a direct binding on any unapproved project secret returned by Secret Manager list, or the project IAM or Secret Manager inventory output is empty, malformed, or duplicated
- **THEN** deployment preflight and release verification exit non-zero before IAM grants, Cloud Run revision mutation, or healthy release evidence
- **AND** direct-IAM evidence does not claim to prove external inventory completeness, group-derived, inherited, collection-level, or field-level isolation

#### Scenario: Reject a missing Claim secret

- **WHEN** either Claim webhook secret or Pair Code HMAC key is absent, non-numeric, or bound from an unapproved secret
- **THEN** deployment preflight exits non-zero before a Cloud Run revision is created


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
### Requirement: Dedicated Member API runtime identity

The Member API revision SHALL run as a dedicated service account with only the approved development Firestore access and read-only Firebase Authentication Viewer access required for revoked-token lookup. It MUST use Application Default Credentials and MUST NOT use a service-account private key.

#### Scenario: Verify the runtime identity

- **WHEN** deployment verification inspects the active Member API revision
- **THEN** the revision uses the approved dedicated service account and contains no service-account key material


<!-- @trace
source: deploy-development-member-api
updated: 2026-08-10
code:
  - deploy/development/deploy-member.d.mts
  - services/member-api/src/server.ts
  - deploy/development/verify-ingestion.mjs
  - scripts/audit-production-dependencies.mjs
  - deploy/development/deploy-ingestion.mjs
  - env.d.ts
  - firebase/development/seed-admin-adapter.mjs
  - deploy/development/verify-ingestion.d.mts
  - firebase/development/readiness.d.mts
  - firebase/development/readiness.mjs
  - services/member-api/cloudbuild.json
  - firebase/development/verify.mjs
  - firebase/development/environment.mjs
  - firebase/development/deploy.mjs
  - deploy/development/ingestion-service.yaml
  - .firebaserc
  - src/platform/firebase/config.ts
  - firebase/development/preflight.mjs
  - deploy/development/deploy-member.mjs
  - firebase/development/environment.d.mts
  - .env.example
  - firebase/development/README.md
  - firebase/development/environment.ts
  - firebase/development/deploy.d.mts
  - services/ingestion-api/cloudbuild.json
  - services/ingestion-api/package.json
  - firebase/development/seed.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - deploy/development/verify-member.d.mts
  - package.json
  - services/member-api/src/app.ts
  - services/member-api/src/config.ts
  - firebase/development/seed.d.mts
  - deploy/development/member-service.yaml
  - deploy/development/deploy-ingestion.d.mts
  - deploy/development/verify-member.mjs
  - scripts/install-workspaces.mjs
  - services/ingestion-api/src/app.ts
  - src/platform/firebase/client.ts
  - vitest.config.ts
  - firebase/development/readiness-admin-adapter.mjs
  - services/ingestion-api/tsconfig.json
  - scripts/check-release.mjs
  - firebase/development/preflight.d.mts
tests:
  - services/member-api/test/app.test.ts
  - deploy/development/verify-member.spec.ts
  - firebase/development/deploy.spec.ts
  - scripts/install-workspaces.spec.ts
  - src/platform/firebase/config.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/deploy-ingestion.spec.ts
  - firebase/development/seed.spec.ts
  - firebase/development/readiness.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-tool.spec.ts
  - scripts/audit-production-dependencies.spec.ts
  - src/platform/firebase/client.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - firebase/development/preflight.spec.ts
  - deploy/development/deploy-member.spec.ts
  - services/member-api/test/config.test.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Public transport with member authorization

The Member API SHALL accept public HTTPS network invocation. Every device-name mutation MUST verify a non-revoked Firebase ID token and the caller's ownership before invoking Firestore. CORS responses SHALL allow only the exact approved development Web origin.

#### Scenario: Rename an owned device

- **WHEN** an authenticated owner sends a valid rename request from the approved Web origin
- **THEN** the service returns HTTP 200 and persists the canonical custom name

#### Scenario: Reject a missing token without persistence

- **WHEN** a rename request omits its Firebase ID token
- **THEN** the service returns the canonical HTTP 401 error and performs zero Firestore operations

#### Scenario: Deny a non-owner

- **WHEN** an authenticated non-owner requests a device rename
- **THEN** the service returns HTTP 404 and leaves the device document unchanged

#### Scenario: Reject an unapproved browser origin

- **WHEN** a preflight or mutation request uses an origin different from the approved development Web origin
- **THEN** the response contains no permissive Access-Control-Allow-Origin value


<!-- @trace
source: deploy-development-member-api
updated: 2026-08-10
code:
  - deploy/development/deploy-member.d.mts
  - services/member-api/src/server.ts
  - deploy/development/verify-ingestion.mjs
  - scripts/audit-production-dependencies.mjs
  - deploy/development/deploy-ingestion.mjs
  - env.d.ts
  - firebase/development/seed-admin-adapter.mjs
  - deploy/development/verify-ingestion.d.mts
  - firebase/development/readiness.d.mts
  - firebase/development/readiness.mjs
  - services/member-api/cloudbuild.json
  - firebase/development/verify.mjs
  - firebase/development/environment.mjs
  - firebase/development/deploy.mjs
  - deploy/development/ingestion-service.yaml
  - .firebaserc
  - src/platform/firebase/config.ts
  - firebase/development/preflight.mjs
  - deploy/development/deploy-member.mjs
  - firebase/development/environment.d.mts
  - .env.example
  - firebase/development/README.md
  - firebase/development/environment.ts
  - firebase/development/deploy.d.mts
  - services/ingestion-api/cloudbuild.json
  - services/ingestion-api/package.json
  - firebase/development/seed.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - deploy/development/verify-member.d.mts
  - package.json
  - services/member-api/src/app.ts
  - services/member-api/src/config.ts
  - firebase/development/seed.d.mts
  - deploy/development/member-service.yaml
  - deploy/development/deploy-ingestion.d.mts
  - deploy/development/verify-member.mjs
  - scripts/install-workspaces.mjs
  - services/ingestion-api/src/app.ts
  - src/platform/firebase/client.ts
  - vitest.config.ts
  - firebase/development/readiness-admin-adapter.mjs
  - services/ingestion-api/tsconfig.json
  - scripts/check-release.mjs
  - firebase/development/preflight.d.mts
tests:
  - services/member-api/test/app.test.ts
  - deploy/development/verify-member.spec.ts
  - firebase/development/deploy.spec.ts
  - scripts/install-workspaces.spec.ts
  - src/platform/firebase/config.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/deploy-ingestion.spec.ts
  - firebase/development/seed.spec.ts
  - firebase/development/readiness.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-tool.spec.ts
  - scripts/audit-production-dependencies.spec.ts
  - src/platform/firebase/client.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - firebase/development/preflight.spec.ts
  - deploy/development/deploy-member.spec.ts
  - services/member-api/test/config.test.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Verified Member API origin handoff

The Web cloud build SHALL receive VITE_MEMBER_API_URL only from a healthy Member API release record. The origin MUST use HTTPS and MUST NOT contain credentials, a path, query, fragment, loopback host, Emulator host, or a service from another project.

#### Scenario: Build with the verified origin

- **WHEN** the Member API release passes health, authorization, CORS, and ownership smoke checks
- **THEN** its exact HTTPS origin becomes eligible for the development Web build

#### Scenario: Reject an unverified origin

- **WHEN** a Web build is given an origin that lacks a matching healthy Member API release record
- **THEN** Web deployment preflight exits non-zero before uploading Hosting files


<!-- @trace
source: deploy-development-member-api
updated: 2026-08-10
code:
  - deploy/development/deploy-member.d.mts
  - services/member-api/src/server.ts
  - deploy/development/verify-ingestion.mjs
  - scripts/audit-production-dependencies.mjs
  - deploy/development/deploy-ingestion.mjs
  - env.d.ts
  - firebase/development/seed-admin-adapter.mjs
  - deploy/development/verify-ingestion.d.mts
  - firebase/development/readiness.d.mts
  - firebase/development/readiness.mjs
  - services/member-api/cloudbuild.json
  - firebase/development/verify.mjs
  - firebase/development/environment.mjs
  - firebase/development/deploy.mjs
  - deploy/development/ingestion-service.yaml
  - .firebaserc
  - src/platform/firebase/config.ts
  - firebase/development/preflight.mjs
  - deploy/development/deploy-member.mjs
  - firebase/development/environment.d.mts
  - .env.example
  - firebase/development/README.md
  - firebase/development/environment.ts
  - firebase/development/deploy.d.mts
  - services/ingestion-api/cloudbuild.json
  - services/ingestion-api/package.json
  - firebase/development/seed.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - deploy/development/verify-member.d.mts
  - package.json
  - services/member-api/src/app.ts
  - services/member-api/src/config.ts
  - firebase/development/seed.d.mts
  - deploy/development/member-service.yaml
  - deploy/development/deploy-ingestion.d.mts
  - deploy/development/verify-member.mjs
  - scripts/install-workspaces.mjs
  - services/ingestion-api/src/app.ts
  - src/platform/firebase/client.ts
  - vitest.config.ts
  - firebase/development/readiness-admin-adapter.mjs
  - services/ingestion-api/tsconfig.json
  - scripts/check-release.mjs
  - firebase/development/preflight.d.mts
tests:
  - services/member-api/test/app.test.ts
  - deploy/development/verify-member.spec.ts
  - firebase/development/deploy.spec.ts
  - scripts/install-workspaces.spec.ts
  - src/platform/firebase/config.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/deploy-ingestion.spec.ts
  - firebase/development/seed.spec.ts
  - firebase/development/readiness.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-tool.spec.ts
  - scripts/audit-production-dependencies.spec.ts
  - src/platform/firebase/client.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - firebase/development/preflight.spec.ts
  - deploy/development/deploy-member.spec.ts
  - services/member-api/test/config.test.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Member API smoke and rollback

A healthy release SHALL pass public health, CORS, missing/wrong/revoked token, Owner rename, non-owner denial, and Firestore project-isolation checks. Rollback SHALL route traffic only to a prior healthy immutable revision of the same service.

#### Scenario: Record a healthy release

- **WHEN** every Member API smoke check succeeds
- **THEN** verification emits a sanitized healthy release record with the revision and image digest

#### Scenario: Roll back a failed revision

- **WHEN** post-deploy smoke fails and a prior healthy revision exists
- **THEN** rollback resolves that exact revision and restores its traffic without rebuilding an image

<!-- @trace
source: deploy-development-member-api
updated: 2026-08-10
code:
  - deploy/development/deploy-member.d.mts
  - services/member-api/src/server.ts
  - deploy/development/verify-ingestion.mjs
  - scripts/audit-production-dependencies.mjs
  - deploy/development/deploy-ingestion.mjs
  - env.d.ts
  - firebase/development/seed-admin-adapter.mjs
  - deploy/development/verify-ingestion.d.mts
  - firebase/development/readiness.d.mts
  - firebase/development/readiness.mjs
  - services/member-api/cloudbuild.json
  - firebase/development/verify.mjs
  - firebase/development/environment.mjs
  - firebase/development/deploy.mjs
  - deploy/development/ingestion-service.yaml
  - .firebaserc
  - src/platform/firebase/config.ts
  - firebase/development/preflight.mjs
  - deploy/development/deploy-member.mjs
  - firebase/development/environment.d.mts
  - .env.example
  - firebase/development/README.md
  - firebase/development/environment.ts
  - firebase/development/deploy.d.mts
  - services/ingestion-api/cloudbuild.json
  - services/ingestion-api/package.json
  - firebase/development/seed.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - deploy/development/verify-member.d.mts
  - package.json
  - services/member-api/src/app.ts
  - services/member-api/src/config.ts
  - firebase/development/seed.d.mts
  - deploy/development/member-service.yaml
  - deploy/development/deploy-ingestion.d.mts
  - deploy/development/verify-member.mjs
  - scripts/install-workspaces.mjs
  - services/ingestion-api/src/app.ts
  - src/platform/firebase/client.ts
  - vitest.config.ts
  - firebase/development/readiness-admin-adapter.mjs
  - services/ingestion-api/tsconfig.json
  - scripts/check-release.mjs
  - firebase/development/preflight.d.mts
tests:
  - services/member-api/test/app.test.ts
  - deploy/development/verify-member.spec.ts
  - firebase/development/deploy.spec.ts
  - scripts/install-workspaces.spec.ts
  - src/platform/firebase/config.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/deploy-ingestion.spec.ts
  - firebase/development/seed.spec.ts
  - firebase/development/readiness.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-tool.spec.ts
  - scripts/audit-production-dependencies.spec.ts
  - src/platform/firebase/client.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - firebase/development/preflight.spec.ts
  - deploy/development/deploy-member.spec.ts
  - services/member-api/test/config.test.ts
  - scripts/check-release.spec.ts
-->