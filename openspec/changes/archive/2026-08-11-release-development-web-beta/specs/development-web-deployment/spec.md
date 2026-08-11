## ADDED Requirements

### Requirement: Live beta Hosting availability

A beta release SHALL publish the inspected development cloud build to the approved Firebase Hosting live channel and SHALL verify that the root shell and every protected-route entry point return the application shell instead of a 404 response.

#### Scenario: Publish the first live beta shell

- **WHEN** the approved build is uploaded and the live channel selects the resulting Hosting version
- **THEN** `/`, `/history`, `/stats`, and `/sign-in` SHALL return the application shell from `petcare-c7483.web.app`

#### Scenario: Reject an unavailable live origin

- **WHEN** the live origin or any required route returns 404, a non-shell response, or an unapproved redirect
- **THEN** the beta release SHALL be marked failed and SHALL NOT produce a healthy release record

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

### Requirement: Ephemeral tester credential handling

The verifier SHALL obtain the single tester email and password only through a hidden interactive session, SHALL keep them only for the current tester authentication operation, and MUST NOT place them in command arguments, environment files, standard output, standard error, browser artifacts, or release records.

#### Scenario: Verify credentials in an interactive session

- **WHEN** an operator supplies a tester email and password through the hidden prompt
- **THEN** the verifier SHALL authenticate the tester, SHALL use the resulting session only for that tester journey, and SHALL omit the identity and credentials from all persisted output

#### Scenario: Reject non-interactive credential input

- **WHEN** no secure TTY is available or credentials are supplied through a command argument or inventory field
- **THEN** verification SHALL return `credential_input_unavailable` before tester authentication or Member API mutation

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

## MODIFIED Requirements

### Requirement: Hosting release record

A healthy release SHALL record the build hash, Hosting version, target, verification timestamp, and explicit rollback availability without credentials. When a prior live version exists, the record SHALL include that exact rollback version. For the first live release without channel history, the record SHALL contain `rollbackAvailable: false` and `rollbackVersion: null` only after exact operator bootstrap confirmation.

#### Scenario: Record a verified release

- **WHEN** all smoke checks pass and a prior live Hosting version exists
- **THEN** the release record SHALL identify the deployed version and exact rollback version

#### Scenario: Record a verified first release

- **WHEN** all smoke checks pass for an explicitly confirmed first live release with no channel history
- **THEN** the release record SHALL identify the deployed version and SHALL explicitly state that rollback is unavailable
