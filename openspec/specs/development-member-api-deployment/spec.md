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