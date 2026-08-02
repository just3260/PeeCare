## ADDED Requirements

### Requirement: Shared device custom name

A device SHALL store at most one optional `customName` on `devices/{deviceId}`. The name SHALL belong to the device rather than to an individual member preference, SHALL remain present when ownership changes, and SHALL NOT be required to be unique across devices. Existing device documents without `customName` SHALL remain valid without backfill.

#### Scenario: Store one shared name

- **WHEN** the current owner names `PC-000001` as `主浴室`
- **THEN** `devices/PC-000001.customName` equals `主浴室` for every member who subsequently owns that device

#### Scenario: Preserve the name across ownership transfer

- **WHEN** a device with `customName: 主浴室` changes from `ownerUid: member-001` to `ownerUid: member-002`
- **THEN** `customName` remains `主浴室`

#### Scenario: Allow duplicate names

- **WHEN** the owner assigns `主浴室` to two owned devices
- **THEN** both updates succeed and each device retains its distinct `deviceId`

### Requirement: Deterministic custom-name normalization

The Member API SHALL require request property `customName` to be a string or null. It SHALL trim leading and trailing whitespace. A null value or a string that is empty after trimming SHALL delete the Firestore field. A stored value MUST contain 1 through 30 Unicode code points and MUST NOT contain a newline or Unicode control character. Emoji SHALL be accepted when the normalized value satisfies those constraints.

#### Scenario: Normalize a valid name

- **WHEN** the owner submits `"  主浴室  "`
- **THEN** the API stores and returns `"主浴室"`

#### Scenario: Clear with whitespace

- **WHEN** the owner submits a string containing only whitespace
- **THEN** the API deletes `customName` and returns `customName: null`

#### Scenario: Reject an invalid name

- **WHEN** the owner submits a name containing 31 Unicode code points, a newline, or a Unicode control character
- **THEN** the API returns `400 invalid_custom_name` and performs no Firestore write

##### Example: Name boundaries

| Input | Expected result |
| ----- | --------------- |
| `null` | Delete `customName` |
| `"   "` | Delete `customName` |
| 1 Unicode code point | Store the normalized value |
| 30 Unicode code points | Store the normalized value |
| 31 Unicode code points | `400 invalid_custom_name` |
| `"一樓\n浴室"` | `400 invalid_custom_name` |

### Requirement: Authenticated display-name endpoint

The independent Member API SHALL expose `PATCH /v1/devices/:deviceId/display-name`. The route `deviceId` MUST match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. The request SHALL use `application/json`, SHALL be no larger than 8 KiB, SHALL contain exactly one `customName` property, and SHALL authenticate with `Authorization: Bearer <Firebase ID Token>`. The request MUST NOT contain a member UID. The API SHALL verify the token signature, issuer, audience, expiration, and revocation state and SHALL use only its decoded `uid` as member identity.

#### Scenario: Accept an authenticated request

- **WHEN** a signed-in member sends a valid Firebase ID Token and exactly `{"customName":"主浴室"}`
- **THEN** the endpoint evaluates ownership using the UID decoded from that token

#### Scenario: Reject an invalid token

- **WHEN** the Bearer token is missing, malformed, expired, revoked, or fails Firebase verification
- **THEN** the API returns `401 unauthorized` and performs no Firestore read or write

#### Scenario: Reject an expanded request shape

- **WHEN** the body omits `customName`, adds `ownerUid`, or adds any other property
- **THEN** the API returns `400 invalid_request` and performs no Firestore write

#### Scenario: Reject an unsafe device identifier

- **WHEN** the route device identifier is empty, longer than 128 characters, contains a slash, or starts outside the allowed character set
- **THEN** the API returns `400 invalid_device_id` without creating a Firestore document path

#### Scenario: Reject an oversized request

- **WHEN** the request body exceeds 8 KiB
- **THEN** the API returns `413 body_too_large` without processing the body as a naming command

### Requirement: Transactional owner authorization

The Member API SHALL read and update the device in one Firestore transaction. It SHALL update only when the document exists and its current non-empty `ownerUid` equals the decoded UID. The transaction SHALL re-evaluate ownership after a concurrent document change. A missing device and a foreign-owned device SHALL both return `404 device_not_found` and SHALL perform no write.

#### Scenario: Owner renames an owned device

- **WHEN** token UID `member-001` renames a device whose `ownerUid` is `member-001`
- **THEN** the transaction updates the normalized `customName`

#### Scenario: Foreign member cannot discover or rename a device

- **WHEN** token UID `member-002` addresses a device owned by `member-001`
- **THEN** the API returns the same `404 device_not_found` response used for a missing device and performs no write

#### Scenario: Ownership changes during the transaction

- **WHEN** ownership changes from `member-001` to `member-002` after member-001 starts a rename request
- **THEN** the retried transaction rejects member-001 with `404 device_not_found` and does not change `customName`

### Requirement: Registry-preserving update

A successful naming transaction SHALL modify only the optional `customName` field. It SHALL preserve `deviceId`, `ownerUid`, `productModel`, `ingestionStatus`, latest event projections, `lastReportedAtMs`, and all event and dailyStats child documents. Hardware ingestion updates SHALL preserve an existing `customName`.

#### Scenario: Preserve registry projection fields

- **WHEN** an owned device contains ingestion and latest projection fields and the owner changes its name
- **THEN** every field and child document other than `customName` remains unchanged

#### Scenario: Preserve the name during ingestion

- **WHEN** the ingestion service applies a later battery or urination projection to a named device
- **THEN** the device retains its existing `customName`

### Requirement: Canonical success and error responses

A successful update SHALL return HTTP 200 with exactly `deviceId`, `customName`, and resolved `displayName`. Removing the name SHALL return `customName: null` and `displayName` equal to `deviceId`. Repeating the same PATCH SHALL produce the same stored state without an idempotency key. Error responses SHALL use `{"error":{"code":"<machine-code>","requestId":"<request-id>"}}` and SHALL include the same request ID in the `x-request-id` header.

#### Scenario: Return a canonical saved name

- **WHEN** `PC-000001` successfully stores `customName: 主浴室`
- **THEN** the response is `{"deviceId":"PC-000001","customName":"主浴室","displayName":"主浴室"}`

#### Scenario: Return a canonical cleared name

- **WHEN** `PC-000001` successfully removes its custom name
- **THEN** the response is `{"deviceId":"PC-000001","customName":null,"displayName":"PC-000001"}`

#### Scenario: Map persistence unavailability

- **WHEN** Firestore reports a transient persistence failure
- **THEN** the API returns `503 persistence_unavailable` with a request ID and does not report success

### Requirement: Browser-origin and log privacy boundary

The Member API SHALL return CORS allow-origin only for the configured PeeCare Web origin and SHALL support its display-name `OPTIONS` preflight. Every naming mutation SHALL still require token and owner authorization regardless of request origin. Application logs MUST NOT contain Authorization headers, raw tokens, `customName`, or request bodies; sanitized outcomes SHALL be correlated by request ID.

#### Scenario: Permit the configured Web origin

- **WHEN** the configured PeeCare Web origin sends a valid preflight for the PATCH endpoint
- **THEN** the API returns the required CORS headers for that origin and method

#### Scenario: Do not trust CORS as authorization

- **WHEN** a request has an allowed origin but lacks a valid Firebase ID Token
- **THEN** the mutation returns `401 unauthorized` and performs no Firestore operation

#### Scenario: Redact sensitive request data

- **WHEN** a naming request succeeds or fails
- **THEN** its logs contain a request ID and sanitized outcome without the token, name, Authorization header, or body

### Requirement: Settings device-name editor

The settings device-management list SHALL display each resolved display name with `裝置序號：<deviceId>` beneath it. At most one device row SHALL be editable at a time. Entering edit mode SHALL focus and select the current display name, replace the edit control with save and cancel controls, and disable edit controls for other rows. Enter or save SHALL submit, while Escape or cancel SHALL discard the draft. Clicking outside SHALL neither save nor discard the draft.

#### Scenario: Enter and cancel editing

- **WHEN** the member opens the editor, changes the draft, and presses Escape
- **THEN** the row exits edit mode and continues to display the committed name and serial number

#### Scenario: Prevent concurrent editors

- **WHEN** one row is editing
- **THEN** edit controls for every other row are disabled until the active row saves or cancels

#### Scenario: Show the immutable serial number

- **WHEN** a device named `主浴室` has `deviceId: PC-000001`
- **THEN** settings displays `主浴室` and the subordinate text `裝置序號：PC-000001`

### Requirement: Save-state reconciliation

The Web App SHALL apply the same name validation before calling the API. During an in-flight request, the active row SHALL expose a saving state and prevent duplicate submissions. A successful response SHALL replace committed shared-device state with the canonical response and exit editing. A validation or API failure SHALL leave committed state unchanged, retain the draft and editing state, and display a non-sensitive error that distinguishes session failure, retryable service failure, and general save failure.

#### Scenario: Reconcile a successful save

- **WHEN** the API returns a canonical success response for `PC-000001`
- **THEN** the shared store commits that response exactly once and the editor exits

#### Scenario: Retain a failed draft

- **WHEN** the API rejects or cannot persist a valid draft
- **THEN** the editor remains open with that draft, committed device state remains unchanged, and a non-sensitive error is visible

#### Scenario: Block duplicate submission

- **WHEN** a save request is in flight
- **THEN** Enter and save controls cannot start a second request

### Requirement: Independent scale-to-zero runtime

The Member API SHALL be packaged as an independently buildable container and SHALL expose `GET /healthz` as `200 {"status":"ok"}` without registering ingestion routes or accepting the EMQX webhook secret. Its Cloud Run deployment contract SHALL use request-based billing, minimum instances 0, one configured PeeCare Web origin, a dedicated runtime identity, and a Firestore-compatible location. The container SHALL run as a non-root process.

#### Scenario: Build an independent service image

- **WHEN** the Member API container image is built and started
- **THEN** its health endpoint succeeds, its process is non-root, and `/v1/emqx/events` is not registered

#### Scenario: Scale to zero when idle

- **WHEN** the Member API Cloud Run service has no requests
- **THEN** its configured minimum instance count is 0 and no instance is kept warm by this service
