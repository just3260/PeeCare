## ADDED Requirements

### Requirement: One-time bootstrap verification without identity provisioning

Before the protected tester route exists on live Hosting, an explicitly approved one-time operator harness SHALL be permitted to produce the required Test Tool API healthy handoff only by using the assigned device owner and one non-owner Firebase Auth account that already exist. The harness MUST keep custom tokens and ID tokens in process memory, MUST clear token references when execution ends, and MUST NOT create, reset, update, delete, output, or persist an account, credential, token, user identifier, resolved secret, device payload, or event identifier. It MUST bind verification to the exact approved project, service, revision, immutable image digest, and origin, and it MUST execute all required Test Tool API smoke checks before emitting sanitized healthy evidence.

#### Scenario: Produce the bootstrap handoff from existing identities

- **WHEN** the assigned device owner and at least one non-owner Firebase Auth account already exist, the exact deployed Test Tool API target is healthy, and all required smoke checks pass
- **THEN** the harness SHALL emit one sanitized healthy API release record bound to that exact target, clear all in-memory token references, and perform no Firebase Auth account mutation

##### Example: Bind a complete run to one immutable revision

- **GIVEN** the assigned owner and one non-owner user already exist and revision `peecare-test-tool-development-00002-rte` serves the approved immutable image digest
- **WHEN** all eleven named API smoke checks pass against that revision and origin
- **THEN** one healthy record identifies the exact revision and digest without an account identifier, credential, token, resolved secret, device payload, or event identifier

#### Scenario: Fail closed when an existing principal is unavailable

- **WHEN** the assigned owner cannot be confirmed as an existing Firebase Auth account or no existing non-owner account is available
- **THEN** the harness SHALL exit non-zero before marker, event, release-record, or Hosting mutation and SHALL expose no account identifier or credential

##### Example: No foreign account exists

- **GIVEN** the assigned owner exists but every Firebase Auth account resolves to that same owner
- **WHEN** the harness resolves the foreign authorization principal
- **THEN** it exits with a stable sanitized failure before token exchange, marker write, event submission, or release-record write

#### Scenario: Reject incomplete or drifting bootstrap verification

- **WHEN** the project, service, revision, digest, or origin differs from the approved deployed target, any required smoke check fails, or output privacy validation finds protected data
- **THEN** the harness SHALL exit non-zero, SHALL NOT emit healthy evidence, SHALL clear in-memory token references, and SHALL perform zero Hosting mutation

##### Example: Require the complete API smoke set

- **GIVEN** ten API checks pass but `webProjection` fails for the exact deployed revision
- **WHEN** the harness evaluates the bootstrap result
- **THEN** no healthy API release record is written and Web upload remains blocked

### Requirement: Exact test-tool route restoration gate

A development Web release that restores the tester event tool SHALL prove before upload that the inspected production bundle registers `/test-tool`, selects the approved development Firebase environment, and binds the exact HTTPS Test Tool API origin from a current healthy immutable release record. The release MUST reject a bundle that omits the route or contains a stale, mismatched, loopback, Emulator, credential-bearing, or secret-bearing configuration.

#### Scenario: Accept an inspected test-tool bundle

- **WHEN** the production bundle contains the protected `/test-tool` route and its Test Tool API origin matches the current healthy release record for the approved project, region, service, revision, and immutable image digest
- **THEN** Web release preflight SHALL permit the operator to review the Hosting upload plan

#### Scenario: Reject a bundle that would fall back to home

- **WHEN** the inspected production bundle does not register `/test-tool` even though the Hosting rewrite can serve the application shell
- **THEN** Web release preflight SHALL exit non-zero before Hosting upload and SHALL report a stable route-absent failure

#### Scenario: Reject an invalid Test Tool API handoff

- **WHEN** the Test Tool API release record is missing, stale, unhealthy, bound to another project or service, or resolves a non-approved origin
- **THEN** Web release preflight SHALL exit non-zero before build artifact upload and SHALL perform zero Hosting mutation

##### Example: Reject a stale foreign-service record

- **GIVEN** a record marked healthy was verified more than 24 hours ago and identifies service `peecare-test-tool-staging`
- **WHEN** the operator starts the approved development Web release preflight
- **THEN** preflight exits non-zero before build or upload and reports zero Hosting mutations

### Requirement: Exact live test-tool route verification

A development Hosting release that includes the tester event tool SHALL bind post-deploy verification to the exact uploaded Hosting version and build hash. The release MUST NOT be marked healthy unless signed-out and authenticated direct-load journeys prove that `/test-tool` no longer reaches the unknown-route home fallback, the authenticated tester sees exactly the assigned eligible device, one bounded test event reaches its Web projection, and sign-out/offline verification exposes no prior tester state.

#### Scenario: Preserve the signed-out return path

- **WHEN** a fresh signed-out browser context directly opens `/test-tool` on the exact deployed Hosting version
- **THEN** the router SHALL render sign-in with `returnTo=/test-tool`, SHALL NOT redirect to home, and SHALL NOT render tester devices, forms, or prior results

#### Scenario: Preserve the authenticated tester route

- **WHEN** the assigned authenticated tester directly opens and reloads `/test-tool` on the exact deployed Hosting version
- **THEN** the router SHALL remain on `/test-tool`, the tool SHALL load exactly the assigned eligible device, and one bounded event submission SHALL produce the expected development Web projection

#### Scenario: Reject the home fallback after upload

- **WHEN** either direct-load journey resolves to `/`, loses the exact return path, loads an unexpected device, or fails the event projection
- **THEN** verification SHALL record the exact Hosting version as failed, SHALL NOT emit a healthy release record, and SHALL preserve only sanitized failure and rollback metadata

#### Scenario: Exclude tester state after sign-out

- **WHEN** the authenticated journey submits an event, signs out, clears its isolated context, and reloads `/test-tool` offline
- **THEN** the application SHALL expose no tester device, form value, event identifier, sequence, result, credential, or Test Tool API response from cache

### Requirement: Sanitized test-tool restoration evidence

A healthy test-tool restoration release record SHALL identify the approved project and site, exact build hash, exact Hosting version, exact Test Tool API revision identity, verification timestamp, check statuses, and explicit rollback availability. The record MUST NOT contain tester PII, credentials, tokens, device data, custom names, form values, event identifiers, or event payloads.

#### Scenario: Record a healthy restoration

- **WHEN** bundle inspection, signed-out routing, authenticated routing, eligible-device authorization, bounded event projection, cache exclusion, privacy scan, and rollback checks all pass for the same exact Hosting version
- **THEN** the release SHALL emit one sanitized healthy record bound to that Hosting version and Test Tool API revision

##### Example: Bind one healthy record to exact versions

- **GIVEN** Test Tool API revision `peecare-test-tool-development-00042-abc`, Hosting version `sites/petcare-c7483/versions/123`, and a distinct prior Hosting version `sites/petcare-c7483/versions/122`
- **WHEN** every required restoration check passes for version `123`
- **THEN** one record has status `healthy`, identifies revision `00042-abc`, identifies Hosting version `123`, and declares version `122` as the exact rollback target without tester data

#### Scenario: Preserve failed evidence without automatic rollback

- **WHEN** Hosting upload succeeds but any required restoration check fails
- **THEN** the release SHALL emit sanitized failed evidence, SHALL NOT label the release healthy, and SHALL produce only an exact prior-version rollback dry-run when a distinct prior healthy version exists

##### Example: Home fallback fails the new Hosting version

- **GIVEN** uploaded Hosting version `sites/petcare-c7483/versions/124` falls back from `/test-tool` to `/` and prior healthy version `sites/petcare-c7483/versions/123` exists
- **WHEN** live route verification evaluates version `124`
- **THEN** evidence has status `failed`, identifies failed version `124`, offers only a rollback dry-run for version `123`, and performs no automatic rollback
