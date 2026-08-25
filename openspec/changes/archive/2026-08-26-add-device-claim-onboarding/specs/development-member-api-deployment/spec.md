## ADDED Requirements

### Requirement: Co-deployed isolated Claim domain

The development Member API Cloud Run revision SHALL deploy the device Claim domain in the existing service without creating a third Cloud Run service. It SHALL expose Firebase-authenticated create and status routes and an independently authenticated EMQX route. Route-scoped authentication MUST reject credential cross-use and SHALL keep the existing device-name route behavior unchanged.

#### Scenario: Verify all Member API route classes

- **WHEN** deployment verification probes device naming, member Claim creation and status, and EMQX Claim ingress
- **THEN** each route accepts only its documented authentication adapter
- **AND** every cross-use probe is rejected before Firestore mutation

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
