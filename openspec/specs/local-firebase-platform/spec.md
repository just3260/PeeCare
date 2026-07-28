# local-firebase-platform Specification

## Purpose

TBD - created by syncing change 'bootstrap-local-firebase-platform'. Update Purpose after archive.

## Requirements

### Requirement: Isolated demo Firebase project

Every local Firebase CLI, Web SDK, reset, and rules-test operation SHALL use project ID `demo-peecare`. The local platform MUST bind Authentication, Cloud Firestore, and Emulator Suite UI to `127.0.0.1` on ports 9099, 8085, and 4000 respectively. No local command SHALL select, create, or access a real Firebase project.

#### Scenario: Start the isolated Emulator project

- **WHEN** an operator starts the configured Firebase Emulators
- **THEN** the CLI SHALL report project `demo-peecare` and SHALL bind Auth, Firestore, and UI to the three specified loopback endpoints

#### Scenario: Reject a real project identifier

- **WHEN** a local adapter, reset command, or test receives project ID `peecare-production`
- **THEN** it SHALL exit before a Firebase app or destructive request is created

#### Scenario: Reject a network-visible host

- **WHEN** local configuration contains `0.0.0.0`, a LAN address, or a non-loopback hostname
- **THEN** the local operation SHALL fail with a non-loopback-host error

---
### Requirement: Repeatable Emulator startup

The package scripts SHALL provide `emulators:start` to run Authentication, Cloud Firestore, and Emulator Suite UI with the committed Firebase configuration. Startup MUST use fixed ports, MUST load `firestore.rules` and `firestore.indexes.json`, and MUST exit non-zero when a required port is unavailable or a rules file cannot compile.

#### Scenario: Start all configured services

- **WHEN** an operator runs `npm run emulators:start` with ports 9099, 8085, and 4000 available
- **THEN** all three Emulator services SHALL become ready under project `demo-peecare`

#### Scenario: Fail on a port conflict

- **WHEN** port 8085 is already occupied
- **THEN** `npm run emulators:start` SHALL exit non-zero and SHALL NOT silently select another Firestore port

#### Scenario: Fail on invalid Security Rules

- **WHEN** `firestore.rules` contains a compilation error
- **THEN** Emulator startup or the rules test SHALL exit non-zero and identify the rules compilation failure

---
### Requirement: Fail-closed local Firebase client

The web platform SHALL expose `getLocalFirebaseServices` as the single local Firebase SDK entry point. It SHALL initialize one Firebase app and connect Authentication and Firestore to their fixed Emulators only after validating explicit Emulator enablement, project ID, loopback hosts, ports, and non-production mode. Invalid configuration MUST throw `LocalFirebaseConfigurationError` before `initializeApp` is called.

#### Scenario: Initialize local services once

- **WHEN** valid local configuration calls `getLocalFirebaseServices` twice
- **THEN** both calls SHALL return identical app, auth, and firestore instances connected to the configured Emulators

#### Scenario: Reject disabled Emulator mode

- **WHEN** `VITE_FIREBASE_USE_EMULATORS` is absent or not equal to `true`
- **THEN** the adapter SHALL throw code `emulator_disabled` before initializing Firebase

#### Scenario: Reject a project mismatch

- **WHEN** `VITE_FIREBASE_PROJECT_ID` does not equal `demo-peecare`
- **THEN** the adapter SHALL throw code `project_mismatch` before initializing Firebase

#### Scenario: Reject production mode

- **WHEN** the adapter is invoked from a production build
- **THEN** it SHALL throw code `production_mode` and SHALL NOT connect to live or emulated Firebase services

#### Scenario: Build without local Firebase configuration

- **WHEN** the Vue app shell is type-checked and built without importing `getLocalFirebaseServices`
- **THEN** the build SHALL succeed without `.env.local` or running Emulators

---
### Requirement: Deny-by-default Firestore rules

The initial Cloud Firestore Security Rules SHALL deny every read and write for every document path. The denial MUST apply to unauthenticated clients and authenticated clients with arbitrary user IDs or custom claims.

#### Scenario: Deny unauthenticated access

- **WHEN** an unauthenticated test client attempts get, create, update, or delete on any Firestore document
- **THEN** each operation SHALL fail with `permission-denied`

#### Scenario: Deny authenticated access

- **WHEN** an authenticated test client attempts get, create, update, or delete on any Firestore document
- **THEN** each operation SHALL fail with `permission-denied`

#### Scenario: Permit rules-disabled test setup

- **WHEN** a rules test uses the test environment's rules-disabled context to arrange a fixture
- **THEN** the fixture write SHALL succeed without changing client authorization behavior

##### Example: Seed a denied document for a client-read assertion

- **GIVEN** the rules-disabled context writes `{ "seeded": true }` to `anything/doc-1`
- **WHEN** an unauthenticated client reads `anything/doc-1`
- **THEN** the fixture write SHALL have succeeded and the client read SHALL fail with `permission-denied`

---
### Requirement: Deterministic local reset

The local platform SHALL provide `emulators:reset` to delete every Auth Emulator account and every Firestore Emulator document for `demo-peecare`. The reset MUST validate the exact project ID and loopback endpoints before issuing DELETE requests, MUST await both responses, and MUST exit non-zero when either reset fails.

#### Scenario: Clear Auth and Firestore state

- **WHEN** the demo Emulators contain one Auth account and one Firestore document and an operator runs `npm run emulators:reset`
- **THEN** both resources SHALL be absent and the command SHALL report successful Auth and Firestore resets

#### Scenario: Keep repeated reset idempotent

- **WHEN** an operator runs `npm run emulators:reset` twice against already empty demo Emulators
- **THEN** both invocations SHALL complete successfully and leave both services empty

#### Scenario: Refuse a non-demo reset

- **WHEN** reset configuration targets a project other than `demo-peecare`
- **THEN** the command SHALL exit non-zero before issuing any DELETE request

#### Scenario: Surface an unavailable Emulator

- **WHEN** either Auth or Firestore Emulator is not reachable
- **THEN** the command SHALL exit non-zero and identify the endpoint that failed

##### Example: Auth Emulator is stopped

- **GIVEN** Firestore is reachable at `127.0.0.1:8085` and Auth is not reachable at `127.0.0.1:9099`
- **WHEN** an operator runs `npm run emulators:reset`
- **THEN** the command SHALL exit non-zero and identify the Auth endpoint `http://127.0.0.1:9099`

---
### Requirement: Emulator quality gates

The package scripts SHALL provide `test:firebase` that starts Auth and Firestore through `firebase emulators:exec`, runs local client and Security Rules tests, and shuts the Emulators down after the test command. The package scripts SHALL provide `check:all` that runs the existing fast `check` gate followed by `test:firebase`.

#### Scenario: Run Firebase integration tests from a clean state

- **WHEN** no Emulator process is running and an operator runs `npm run test:firebase`
- **THEN** the command SHALL start required Emulators, execute client and rules tests, stop the Emulators, and exit with status 0

#### Scenario: Preserve the fast frontend gate

- **WHEN** an operator runs `npm run check`
- **THEN** type checking, unit tests, and the Vue production build SHALL complete without requiring Java or running Firebase Emulators

#### Scenario: Run the complete local gate

- **WHEN** an operator runs `npm run check:all`
- **THEN** the fast frontend gate and Firebase integration tests SHALL both pass before the command exits with status 0

---
### Requirement: Documented local workflow

The repository SHALL include a local Firebase guide that states the supported Node and Java prerequisites, demo project ID, fixed endpoints, environment-file setup, startup, reset, test, and full-check commands. The guide SHALL state that Emulator traffic is unencrypted and SHALL NOT instruct developers to expose Emulator ports beyond loopback.

#### Scenario: Follow the setup guide

- **WHEN** a developer with the documented Node and Java versions follows the guide from a clean checkout after the Vue bootstrap is applied
- **THEN** the developer SHALL create a local environment file, start the three Emulator services, run the reset command, and complete `npm run check:all` without selecting a cloud project
