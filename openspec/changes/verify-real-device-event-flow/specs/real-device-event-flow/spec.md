## ADDED Requirements

### Requirement: Frozen development preflight

Verification SHALL record and validate the device inventory version, EMQX rule/action version, Cloud Run image digest, Firebase project, and Hosting version before a physical trigger.

#### Scenario: Detect revision drift
- **WHEN** a component version changes after preflight
- **THEN** the run stops before accepting test evidence

### Requirement: Event ID end-to-end correlation

The runner SHALL use one device-produced eventId to correlate EMQX delivery, Cloud Run outcome, one Firestore event document, applicable projection and daily count, and the Web view.

#### Scenario: Correlate a urination event
- **WHEN** the device reports one urination eventId
- **THEN** every required layer resolves that same eventId exactly once

### Requirement: Real battery flow

A physical battery event SHALL reach one immutable Firestore event, update the latest battery projection when newer, and appear in the selected-device overview within the approved observation window.

#### Scenario: Observe a battery event
- **WHEN** the operator triggers an approved battery report
- **THEN** Firestore and the Web show the reported battery level for that event

### Requirement: Duplicate and ACL verification

The run SHALL verify that replaying the same event does not create or count another event and that an unauthorized topic publish is denied.

#### Scenario: Replay a urination event
- **WHEN** the same eventId and payload are delivered again
- **THEN** event cardinality and daily count remain unchanged

### Requirement: Sanitized evidence bundle

Every run SHALL produce a schema-valid immutable evidence bundle containing only allowlisted revisions, eventId, timestamps, status codes, paths, hashes, and assertions.

#### Scenario: Scan completed evidence
- **WHEN** a run finishes or fails
- **THEN** the bundle contains no credential, token, complete payload, email, or raw member UID

### Requirement: Explicit cleanup and failure result

The run SHALL identify marker-scoped test data cleanup and SHALL preserve a failed result when any timeout, mismatch, duplicate, ACL, Web, or sanitization assertion fails.

#### Scenario: Encounter an observation timeout
- **WHEN** a required layer does not observe the event within the approved window
- **THEN** the run records failure, performs marker-scoped cleanup, and does not report success

### Requirement: Exact urination side effects

The first canonical urination delivery SHALL return HTTP 201, create exactly one immutable event at `devices/{deviceId}/events/{eventId}`, update the latest urination tuple to that event when newer, and increment exactly one `Asia/Taipei` daily document by one. Its canonical replay SHALL return HTTP 200 and SHALL produce zero Firestore writes.

#### Scenario: Verify first delivery and replay
- **WHEN** one physical urination event is delivered and then replayed with the same canonical identity
- **THEN** responses are 201 then 200, event cardinality is one, and daily urinationCount increases exactly once

### Requirement: Exact battery side effects

The battery run SHALL publish through the canonical `status/battery` topic, SHALL return HTTP 201 for first delivery, SHALL create one immutable battery event, and SHALL update a coherent latest battery snapshot when newer. It SHALL NOT create or update any daily urination document.

#### Scenario: Verify battery does not alter daily counts
- **WHEN** one physical battery event is delivered successfully
- **THEN** the battery event and latest snapshot are present and every daily urination document is byte-for-byte unchanged

### Requirement: Owner-visible and non-owner-denied Web result

The marked test Owner SHALL observe the resulting overview, history, and daily count through the hosted Web app, while a second authenticated non-owner SHALL receive permission denial and SHALL see none of the test device data.

#### Scenario: Compare Owner and non-owner
- **WHEN** both smoke members open the test device routes after a urination event
- **THEN** the Owner sees the event and updated count and the non-owner sees no device data

### Requirement: Domain and request correlation separation

Evidence SHALL use deviceId plus eventId as the cross-system domain identity. It SHALL record Cloud Run requestId only as transport diagnostics and MUST NOT use requestId as a replacement event identity.

#### Scenario: Replay creates another request ID
- **WHEN** a duplicate delivery has a different Cloud Run requestId
- **THEN** evidence still correlates both requests to the same deviceId and eventId and one stored event
