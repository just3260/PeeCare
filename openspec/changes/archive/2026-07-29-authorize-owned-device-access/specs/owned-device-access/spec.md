## ADDED Requirements

### Requirement: Single-owner device model

Each readable device SHALL contain exactly one non-empty `ownerUid`. One UID SHALL be permitted to own multiple device documents.

#### Scenario: Represent multiple owned devices
- **WHEN** devices A and B both contain `ownerUid: member-001`
- **THEN** both devices belong to member-001

### Requirement: Owner-only device reads

Firestore Rules SHALL allow an authenticated member to read a device only when its ownerUid equals `request.auth.uid`.

#### Scenario: Owner reads a device
- **WHEN** member-001 reads a device owned by member-001
- **THEN** the read succeeds

#### Scenario: Another member reads a device
- **WHEN** member-002 reads a device owned by member-001
- **THEN** the read is denied

### Requirement: Owner-only child data reads

Firestore Rules SHALL allow event and dailyStats reads only when the authenticated member owns the parent device.

#### Scenario: Owner reads event history
- **WHEN** a device owner reads an event under that device
- **THEN** the read succeeds

#### Scenario: Anonymous user reads daily data
- **WHEN** an unauthenticated client reads dailyStats
- **THEN** the read is denied

### Requirement: Constrained owned-device query

The Web repository SHALL query devices with `ownerUid == authenticatedUid` and SHALL NOT issue an unconstrained device collection query.

#### Scenario: List a member's devices
- **WHEN** member-001 owns devices A and B and member-002 owns device C
- **THEN** the repository returns A and B only

### Requirement: Client write denial

Firestore Rules SHALL deny all Web client creates, updates, and deletes for devices, events, dailyStats, and ownership fields.

#### Scenario: Owner attempts a write
- **WHEN** an owner attempts to update a device display field through the Web SDK
- **THEN** the write is denied

### Requirement: Ingestion registry preservation

The Admin-only ownership fixture SHALL merge a non-empty `ownerUid` into an existing device registry document and SHALL preserve `deviceId`, `productModel`, `ingestionStatus`, latest projection fields, and `lastReportedAtMs`.

#### Scenario: Add an owner to an ingested device
- **WHEN** `devices/PC-000001` already contains ingestion and latest projection fields and the fixture assigns `member-001`
- **THEN** only `ownerUid` and fixture marker fields change

### Requirement: Malformed ownership denial

Firestore Rules and the Web repository MUST treat a missing, empty, non-string, or mismatched ownerUid as unauthorized. The repository SHALL reject a document whose `deviceId` differs from its document ID.

#### Scenario: Read a device with an empty owner
- **WHEN** an authenticated member reads a device with `ownerUid: ""`
- **THEN** the read is denied and the repository returns no device model

### Requirement: Owned device runtime model

The repository SHALL validate `deviceId`, `ownerUid`, `productModel`, and `ingestionStatus` before exposing an owned device and SHALL surface a typed data-integrity error instead of silently omitting required fields.

#### Scenario: Parse a mismatched device identifier
- **WHEN** document `devices/PC-000001` contains `deviceId: PC-000002`
- **THEN** model parsing fails with a data-integrity error
