## ADDED Requirements

### Requirement: Hosted Google sign-in release boundary

A healthy development Web release SHALL verify that the exact hosted build renders the Google sign-in control, that the development readiness record proves `google.com` enabled, and that the provider adapter quality gate proves direct control activation calls Firebase popup authentication without additional scopes. The automated release SHALL NOT store or automate a Google account credential and MUST NOT claim external Google account end-to-end coverage unless a separate sanitized live acceptance record exists.

#### Scenario: Accept the Google release surface

- **WHEN** the exact hosted build renders the Google control, provider readiness passes, and the provider adapter tests pass
- **THEN** the Google release-surface check passes without requesting or storing a Google credential

#### Scenario: Reject a missing hosted Google control

- **WHEN** the uploaded Hosting version omits or disables the Google sign-in control
- **THEN** the release is marked failed and no healthy release record is emitted

#### Scenario: Avoid an unsupported E2E claim

- **WHEN** the release completes only the Email Link live tester journey
- **THEN** its evidence identifies Google provider readiness and hosted-control checks without claiming external Google account end-to-end verification

## MODIFIED Requirements

### Requirement: Non-PII beta tester inventory

Beta release verification SHALL require exactly one opaque tester alias mapped to one marked development test device identifier matching `^PC-DEV-[0-9]{6}$`. The committed schema and example SHALL NOT contain or permit Email addresses, Firebase UIDs, passwords, Email Links, OOB codes, ID tokens, refresh tokens, secrets, or production device identifiers, and the populated local inventory MUST remain untracked.

#### Scenario: Accept one tester assignment

- **WHEN** the local inventory contains alias `tester-1` mapped to marked development device `PC-DEV-000001`
- **THEN** beta release preflight SHALL accept the tester structure before requesting interactive authentication material

##### Example: Tester count boundaries

| Tester entries | Expected result |
| --- | --- |
| 0 | `inventory_invalid` |
| 1 | accepted |
| 2 | `inventory_invalid` |

#### Scenario: Reject identity or credential data in inventory

- **WHEN** an inventory key or value contains an Email, Firebase UID, password, Email Link, OOB code, ID token, refresh token, webhook secret, or service-account material
- **THEN** preflight SHALL return `inventory_invalid` before build, browser, Firebase, or Hosting mutation

### Requirement: Ephemeral tester credential handling

The verifier SHALL obtain exactly one tester Email and one received Firebase Email Link only through a hidden interactive TTY. It SHALL keep both values only for the current tester authentication operation and MUST NOT place either value or the link's OOB code in command arguments, environment files, standard output, standard error, traces, screenshots, HAR files, browser artifacts, or release records. The verifier SHALL reject password input and every file, JSON, environment, or CLI authentication-material source.

#### Scenario: Verify an Email Link in an interactive session

- **WHEN** an operator supplies the tester Email, requests the link through the hosted sign-in view, and pastes the received one-time link through the hidden prompt
- **THEN** the verifier completes authentication in the isolated browser context and omits the Email, full link, OOB code, UID, and token from all persisted output

#### Scenario: Reject non-interactive authentication input

- **WHEN** no secure TTY is available or authentication material is supplied through a command argument, environment value, inventory field, file, or JSON input
- **THEN** verification returns `credential_input_unavailable` before tester authentication or Member API mutation

#### Scenario: Reject password-based beta authentication

- **WHEN** an operator or caller supplies a password field or password option
- **THEN** verification returns `credential_input_unavailable` before browser launch and performs no Firebase password sign-in request

#### Scenario: Reject an invalid one-time link

- **WHEN** the pasted link is not HTTPS, is outside the approved Firebase action or Hosting domains, does not declare `mode=signIn`, or has no non-empty OOB code
- **THEN** verification returns `email_link_invalid`, clears the in-memory Email and link references, and performs no protected journey

### Requirement: Isolated beta tester journeys

Verification SHALL run the single tester in a fresh browser context and SHALL submit the hidden tester Email through the hosted Email Link form before accepting the received one-time link through the hidden TTY. It SHALL complete the public `/auth/email-link` callback and then cover the assigned owned-device overview, history, daily statistics, Member API display-name rename and clear, protected-route reload, and sign-out. The signed-in Firebase UID SHALL own the inventory-assigned device, and the context MUST be torn down after the journey. Google external-account authentication SHALL remain outside this automated tester journey.

#### Scenario: Complete the single tester Email Link journey

- **WHEN** the single operator-provisioned tester completes the hosted Email Link callback and owns `PC-DEV-000001`
- **THEN** every required view and mutation succeeds, the marker display name is cleared, and the tester stage is recorded as passed without identity, Email Link, OOB code, or payload data

#### Scenario: Detect an incorrect device assignment

- **WHEN** the Email Link authenticated tester does not own the device assigned to that tester alias
- **THEN** verification returns `tester_device_mismatch`, performs no display-name mutation, and marks the release failed

#### Scenario: Tear down a tester context

- **WHEN** a tester journey succeeds or fails
- **THEN** the verifier closes that browser context, clears Auth persistence, IndexedDB, Cache Storage, service-worker-controlled member state, and every mutable Email, Email Link, OOB code, and token reference before exit

#### Scenario: Avoid external mailbox automation

- **WHEN** the release requires the live Email Link
- **THEN** the operator retrieves it from the tester mailbox and the verifier invokes no mailbox API, mail credential, custom mail relay, or Firebase Admin link-generation path
