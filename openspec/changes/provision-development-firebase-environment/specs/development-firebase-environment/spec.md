## ADDED Requirements

### Requirement: Approved development inventory

Cloud mutation SHALL require an approved inventory containing the development project ID, Firestore region, billing owner, enabled Auth provider, and operator confirmation.

#### Scenario: Reject incomplete inventory
- **WHEN** any required inventory field is absent
- **THEN** preflight exits non-zero before cloud mutation

### Requirement: Development target isolation

Preflight SHALL reject demo, production, or non-allowlisted project IDs and SHALL print the selected development target without secrets.

#### Scenario: Reject a production target
- **WHEN** the target matches the production denylist
- **THEN** no Firebase deploy or seed command runs

### Requirement: Explicit cloud Firebase adapter

The Web build SHALL use a development Firebase adapter only when the environment explicitly selects the approved project and SHALL NOT fall back from missing configuration.

#### Scenario: Build with missing cloud config
- **WHEN** required development Firebase values are absent
- **THEN** configuration fails before Firebase initialization

### Requirement: Development rules and index deployment

The deployment flow SHALL deploy Firestore Rules and indexes to the approved development project and SHALL verify an Owner read and non-owner denial.

#### Scenario: Verify deployed authorization
- **WHEN** smoke identities access one seeded device
- **THEN** the Owner read succeeds and the non-owner read fails

### Requirement: Disposable development seed

The Admin seed runner SHALL create only marker-scoped test members and domain documents and SHALL support marker-scoped verification and cleanup.

#### Scenario: Seed development smoke data
- **WHEN** the approved seed command completes
- **THEN** one test Owner can read its marked device and no unmarked document is changed

### Requirement: Pre-initialization environment isolation

The shared Firebase service entry SHALL select local or development mode from an explicit environment discriminator before SDK initialization. Development mode MUST reject `demo-peecare`, loopback hosts, enabled Emulator flags, and project IDs different from the approved inventory. A rejected configuration SHALL call neither Firebase initialization nor Emulator connector functions.

#### Scenario: Reject Emulator settings in development mode
- **WHEN** development mode includes `VITE_FIREBASE_USE_EMULATORS=true`
- **THEN** configuration fails before initializeApp and before either Emulator connector

### Requirement: Complete development Web configuration

Development mode SHALL require projectId, apiKey, authDomain, and appId and SHALL verify that authDomain belongs to the approved Firebase project. Firebase client configuration SHALL be treated as public build configuration, not as an authorization mechanism.

#### Scenario: Reject a mismatched auth domain
- **WHEN** projectId identifies the approved development project but authDomain identifies another project
- **THEN** the adapter fails before Firebase initialization

### Requirement: Seed preserves ingestion state

The development seed SHALL merge ownerUid and marker fields into an existing device registry document and SHALL preserve deviceId, productModel, ingestionStatus, latest urination and battery projections, and lastReportedAtMs.

#### Scenario: Seed an already-ingested device
- **WHEN** a development device contains latest event projections before owner seeding
- **THEN** the Owner can read the device afterward and every pre-existing ingestion field is unchanged

### Requirement: Deployed Auth and Firestore readiness

The environment verification SHALL confirm the approved Auth provider and authorized Hosting domain are enabled, required Firestore indexes are ready, and deployed Rules pass Owner, non-owner, anonymous, and client-write denial probes.

#### Scenario: Detect a building index
- **WHEN** a required Firestore index is not ready
- **THEN** environment verification fails and downstream Web deployment remains blocked
