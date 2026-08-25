## ADDED Requirements

### Requirement: Protected device selection from QR or manual input

The Web application SHALL expose a protected `/connect` route that accepts at most one `deviceId` query value. It SHALL normalize trimmed manual ASCII hexadecimal input to uppercase, SHALL require exactly twelve uppercase hexadecimal characters, and SHALL display the selected device identifier for explicit member confirmation before creating a Claim Session. A QR deep link SHALL contain only the approved Hosting URL and the non-sensitive deviceId.

#### Scenario: Return to a scanned device after sign-in

- **WHEN** a signed-out visitor opens `/connect?deviceId=68E274BD2A58` and completes Google or Email Link authentication
- **THEN** the existing safe return-route flow opens the protected connect view for `68E274BD2A58`
- **AND** no Claim Session is created until the member explicitly confirms that identifier

#### Scenario: Normalize manual input

- **WHEN** a signed-in member enters ` 68e274bd2a58 ` through the manual fallback
- **THEN** the view presents `68E274BD2A58` for confirmation

##### Example: Device identifier boundaries

| Input | Result |
| --- | --- |
| `68E274BD2A58` | accepted |
| ` 68e274bd2a58 ` | normalized to `68E274BD2A58` |
| `68E274BD2A5` | rejected |
| `68E274BD2A5G` | rejected |
| two deviceId query values | rejected |

### Requirement: Authenticated Claim Session creation

The Member API SHALL expose `POST /v1/device-claim-sessions` with an exact JSON body containing only `deviceId`. It MUST verify a non-revoked Firebase ID token, validate the enabled registry device, and use the decoded UID as the only member identity. A successful response SHALL use HTTP 201 and SHALL contain exactly `sessionId`, `deviceId`, `pairCode`, `status: pending`, and `expiresAtMs`.

#### Scenario: Create a session for an ownerless device

- **WHEN** an authenticated member confirms enabled ownerless device `68E274BD2A58`
- **THEN** the API creates one pending session bound to that UID and device
- **AND** returns one eight-digit Pair Code

#### Scenario: Reject client-supplied ownership

- **WHEN** a create request contains `ownerUid`, `pairCode`, or any property other than `deviceId`
- **THEN** the API returns canonical HTTP 400 and performs zero persistence

### Requirement: Eight-digit short-lived Pair Code

The Claim domain SHALL generate Pair Codes uniformly with a cryptographically secure random source across `00000000` through `99999999`. It SHALL treat the code as an eight-character string, SHALL preserve leading zeroes, SHALL expire it exactly 300000 milliseconds after creation, and SHALL return its plaintext only in the successful create response.

The repository MUST store only an HMAC-SHA-256 code MAC computed with an injected Secret Manager key and the exact input `sessionId + ":" + deviceId + ":" + pairCode`. It MUST NOT persist or log the plaintext Pair Code or HMAC key.

#### Scenario: Preserve a leading-zero code

- **WHEN** the controlled random source produces numeric value 1234
- **THEN** the create response contains Pair Code `00001234`
- **AND** persisted session data contains no `00001234` plaintext

#### Scenario: Reach the expiry boundary

- **WHEN** a session created at `1000000` is evaluated at `1300000`
- **THEN** it is expired and cannot set ownership

### Requirement: One active Claim Session per device

The Claim repository SHALL use an Admin-only `activeDeviceClaims/{deviceId}` lock so one device has at most one unexpired pending session. A new create by the same UID SHALL transactionally mark the prior pending session `replaced` and return a new session and code. A different UID SHALL receive `claim_in_progress` while the lock remains unexpired. Expired locks SHALL be replaced lazily without a background scheduler.

#### Scenario: Replace the member's lost code

- **WHEN** the same UID creates another session for the same device before the first expires
- **THEN** the first session becomes `replaced`
- **AND** exactly one new pending session and active lock remain

#### Scenario: Block a concurrent different member

- **WHEN** another UID attempts to create a session for a device with an unexpired pending lock
- **THEN** the API returns `claim_in_progress`
- **AND** leaves the existing session and lock unchanged

### Requirement: Owner-private Claim Session status

The Member API SHALL expose `GET /v1/device-claim-sessions/{sessionId}`. It MUST verify a non-revoked Firebase ID token and SHALL return status only when the decoded UID created that session. The response SHALL contain exactly `sessionId`, `deviceId`, `status`, and `expiresAtMs`; it MUST NOT contain memberUid, Pair Code, code MAC, attempt metadata, token, or credential. A foreign session and a missing session SHALL both return canonical HTTP 404.

#### Scenario: Read a claimed session

- **WHEN** the creating member reads a session whose status is `claimed`
- **THEN** the API returns that terminal status without Pair Code or member identity

#### Scenario: Hide another member's session

- **WHEN** a different authenticated UID requests the session
- **THEN** the API returns the same canonical 404 used for an unknown session

### Requirement: Isolated EMQX Claim ingress

The Member API SHALL expose `POST /v1/emqx/device-claims` and SHALL accept only an exact outer wrapper containing `webhookAuthorization` and `event`. The route MUST authenticate an independent Claim webhook credential before validating the event. It MUST reject Firebase ID tokens and the ingestion webhook credential, while member routes MUST reject the Claim webhook credential.

An accepted event SHALL use topic `peecare/device/1/bind`, QoS 0, retained false, a configured shared development username, and an exact payload containing only `device_id` and `pair_code`. The device_id SHALL match `^[0-9A-F]{12}$` and pair_code SHALL match `^[0-9]{8}$`. Publisher metadata SHALL be preserved for sanitized diagnostics but SHALL NOT be treated as per-device cryptographic proof.

#### Scenario: Accept a canonical bind wrapper

- **WHEN** the Claim route receives an authenticated QoS 0 non-retained bind for `68E274BD2A58` with an eight-digit code
- **THEN** it invokes the Claim domain once and returns HTTP 202 with a sanitized acknowledgement

#### Scenario: Reject credential cross-use

- **WHEN** an ingestion credential or Firebase bearer token is submitted to the Claim route
- **THEN** the route returns canonical HTTP 401 and performs zero Claim persistence

##### Example: Bind envelope boundaries

| Topic | QoS | Retained | Payload | Result |
| --- | ---: | --- | --- | --- |
| `peecare/device/1/bind` | 0 | false | exact device_id and pair_code | accepted |
| `peecare/device/1/bind` | 1 | false | exact device_id and pair_code | rejected |
| `peecare/device/1/bind` | 0 | true | exact device_id and pair_code | rejected |
| another topic | 0 | false | exact device_id and pair_code | rejected |
| canonical topic | 0 | false | payload with ownerUid | rejected |

### Requirement: Distinct-attempt limit and QoS 0 idempotency

A pending Claim Session SHALL permit at most five distinct incorrect Pair Codes. The repository SHALL compare code MACs in constant time. The first occurrence of an incorrect code SHALL increment `attemptCount` and store its rejected MAC; an immediately repeated identical incorrect code SHALL perform zero increment. The fifth distinct incorrect code SHALL mark the session and lock `failed`.

A correct bind and every identical retry SHALL produce at most one ownership mutation. The device integration contract SHALL publish the same device_id and Pair Code at 0, 5, and 10 seconds because QoS 0 provides no delivery acknowledgement.

#### Scenario: Deduplicate one incorrect code retry

- **WHEN** incorrect Pair Code `11111111` is delivered three consecutive times for one pending session
- **THEN** attemptCount increases by exactly one

#### Scenario: Fail on the fifth distinct code

- **WHEN** one pending session receives `11111111`, `22222222`, `33333333`, `44444444`, and `55555555`
- **THEN** its status becomes `failed` after the fifth delivery

#### Scenario: Deduplicate a successful bind

- **WHEN** the correct bind is delivered at 0, 5, and 10 seconds
- **THEN** ownerUid is set at most once and every later delivery causes zero ownership mutation

### Requirement: Atomic first-owner assignment

The Claim repository SHALL read the active lock, Claim Session, and device registry and SHALL complete all Claim state and ownership writes in one Firestore transaction. It SHALL set ownerUid to the session memberUid only when the device is enabled, its registry identity is valid, and ownerUid is absent. An existing equal ownerUid SHALL be idempotent success. A different non-empty ownerUid SHALL mark the session `conflict` and MUST NOT be replaced.

The transaction SHALL preserve deviceId, productModel, ingestionStatus, customName, latest projections, lastReportedAtMs, events, and dailyStats.

#### Scenario: Claim an ownerless device

- **WHEN** the correct code is submitted for an enabled ownerless device
- **THEN** the transaction sets ownerUid to the session memberUid and marks the session and lock `claimed`

#### Scenario: Preserve another owner

- **WHEN** the correct code is submitted after another UID owns the device
- **THEN** the session becomes `conflict`
- **AND** the device document and child documents remain unchanged

### Requirement: Server-authoritative onboarding recovery

The PWA SHALL treat only the authenticated status endpoint returning `claimed` as successful ownership. It MUST NOT treat an MQTT publish, EMQX HTTP 202, local setup page message, or elapsed time as success. It SHALL store at most `version`, `sessionId`, `deviceId`, and `expiresAtMs` in sessionStorage and MUST NOT store Pair Code.

After `claimed`, the PWA SHALL reload the constrained owned-device list and return to the member home. For `expired`, `failed`, `conflict`, or `replaced`, it SHALL show a non-sensitive restart path. When storage is unavailable, current-view in-memory polling SHALL remain functional.

#### Scenario: Recover after network switching

- **WHEN** the browser returns to the normal network with a stored sessionId and the Claim status is `claimed`
- **THEN** the PWA reloads owned devices and shows the newly owned device

#### Scenario: Avoid persisting the Pair Code

- **WHEN** a pending session is created and browser storage is inspected
- **THEN** no Pair Code, code MAC, UID, Firebase token, or webhook credential is present

### Requirement: Explicit shared-credential MVP boundary

The development Claim flow SHALL document that its shared MQTT credential cannot prove physical-device possession. Product UI, evidence, logs, and release verification MUST NOT describe payload device_id, clientId, or the shared username as per-device attestation. Production readiness SHALL remain blocked until a separate change provides per-device MQTT credentials or an inventory-verified factory setup secret.

#### Scenario: Report a successful MVP Claim

- **WHEN** a Claim completes through the shared development credential
- **THEN** evidence states that the member session and broker message were correlated
- **AND** does not state that physical possession was cryptographically verified
