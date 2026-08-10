# cloud-release-quality-baseline Specification

## Purpose

Define the repository-wide release quality gate, production dependency audit threshold, deterministic dependency installation guarantees, and stable device update-mask regression coverage required before shipping the cloud services and Web application.

## Requirements

### Requirement: Complete cloud release quality gate

The repository SHALL expose one release quality command that runs the root Web checks, Member API checks, Ingestion API checks, Firebase Emulator integration tests, and production dependency audits. The command MUST return success only after every stage succeeds.

#### Scenario: Pass the complete release gate

- **WHEN** an operator runs the release quality command from a clean checkout with all three lockfiles installed
- **THEN** every required check, build, Emulator test, and production audit completes and the command exits zero

#### Scenario: Stop on a failed stage

- **WHEN** any required type check, test, build, Emulator test, or audit fails
- **THEN** the release quality command exits non-zero and identifies the workspace and failed stage


<!-- @trace
source: restore-cloud-release-quality-baseline
updated: 2026-08-10
code:
  - scripts/install-workspaces.mjs
  - services/ingestion-api/tsconfig.json
  - vitest.config.ts
  - scripts/audit-production-dependencies.mjs
  - package.json
  - services/ingestion-api/package.json
  - scripts/check-release.mjs
tests:
  - scripts/audit-production-dependencies.spec.ts
  - scripts/install-workspaces.spec.ts
  - scripts/test-tool.spec.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Production dependency audit threshold

The release quality command MUST audit the production dependency tree of the root Web application, Member API, and Ingestion API. Each tree SHALL contain zero moderate, high, or critical advisories before the gate succeeds.

#### Scenario: Reject a moderate advisory

- **WHEN** one production dependency tree reports one moderate advisory and no higher-severity advisory
- **THEN** the release quality command exits non-zero and reports the affected workspace and severity count

#### Scenario: Reject an unavailable audit result

- **WHEN** the package registry audit endpoint is unavailable or returns invalid output
- **THEN** the release quality command exits non-zero and SHALL NOT classify the dependency tree as safe


<!-- @trace
source: restore-cloud-release-quality-baseline
updated: 2026-08-10
code:
  - scripts/install-workspaces.mjs
  - services/ingestion-api/tsconfig.json
  - vitest.config.ts
  - scripts/audit-production-dependencies.mjs
  - package.json
  - services/ingestion-api/package.json
  - scripts/check-release.mjs
tests:
  - scripts/audit-production-dependencies.spec.ts
  - scripts/install-workspaces.spec.ts
  - scripts/test-tool.spec.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Deterministic workspace lockfiles

All three npm workspaces SHALL install through their committed lockfiles. A clean release gate run MUST NOT change any package manifest or lockfile.

#### Scenario: Install and verify a clean dependency graph

- **WHEN** the three workspaces are installed with npm clean-install semantics and the release gate completes
- **THEN** the package manifests and lockfiles remain byte-for-byte unchanged


<!-- @trace
source: restore-cloud-release-quality-baseline
updated: 2026-08-10
code:
  - scripts/install-workspaces.mjs
  - services/ingestion-api/tsconfig.json
  - vitest.config.ts
  - scripts/audit-production-dependencies.mjs
  - package.json
  - services/ingestion-api/package.json
  - scripts/check-release.mjs
tests:
  - scripts/audit-production-dependencies.spec.ts
  - scripts/install-workspaces.spec.ts
  - scripts/test-tool.spec.ts
  - scripts/check-release.spec.ts
-->

---
### Requirement: Stable test-tool device update mask

The local test tool SHALL render a device update request whose Firestore update mask includes deviceId and ownerUid and excludes customName. Its test SHALL wait for observable rendering completion rather than a fixed delay.

#### Scenario: Preserve a custom device name

- **WHEN** an operator expands the device request preview after a customName exists
- **THEN** the generated request updates deviceId and ownerUid without including customName in the update mask

#### Scenario: Repeat the regression test

- **WHEN** the focused update-mask test runs three consecutive times
- **THEN** all three executions pass without timing-dependent failure

<!-- @trace
source: restore-cloud-release-quality-baseline
updated: 2026-08-10
code:
  - scripts/install-workspaces.mjs
  - services/ingestion-api/tsconfig.json
  - vitest.config.ts
  - scripts/audit-production-dependencies.mjs
  - package.json
  - services/ingestion-api/package.json
  - scripts/check-release.mjs
tests:
  - scripts/audit-production-dependencies.spec.ts
  - scripts/install-workspaces.spec.ts
  - scripts/test-tool.spec.ts
  - scripts/check-release.spec.ts
-->