## ADDED Requirements

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

### Requirement: Claim storage remains Admin-only

Firestore Rules SHALL deny every Web client read and write under `deviceClaimSessions` and `activeDeviceClaims`. Claim Session authorization SHALL be enforced only by the authenticated Member API status route.

#### Scenario: Owner attempts direct Claim Session access

- **WHEN** an authenticated device Owner reads or writes either Claim collection through the Web SDK
- **THEN** Firestore returns permission-denied
