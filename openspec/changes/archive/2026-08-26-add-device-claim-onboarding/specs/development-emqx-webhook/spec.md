## ADDED Requirements

### Requirement: Dedicated device-bind Claim forwarding

The development EMQX Serverless topology SHALL add one rule that matches exactly `peecare/device/1/bind` and invokes exactly one action through a second HTTPS connector targeting the verified Member API `/v1/emqx/device-claims` route. The action SHALL use QoS 0 source messages, SHALL preserve retained, clientId, username, broker timestamp, and decoded payload, and SHALL send an exact outer wrapper containing `webhookAuthorization` and `event`.

The Claim connector SHALL use an independent Claim webhook credential and MUST NOT reuse the ingestion webhook credential. The combined development topology SHALL remain within the platform limits of two connectors and four rules.

#### Scenario: Forward one bind delivery

- **WHEN** the approved shared publisher sends a canonical bind message
- **THEN** the Claim action sends one exact wrapper to the Member API Claim route
- **AND** the telemetry ingestion connector and rules remain unchanged

##### Example: Exact Claim event

- **GIVEN** topic `peecare/device/1/bind`, QoS 0, retained false, device_id `68E274BD2A58`, and pair_code `12345678`
- **WHEN** the Claim action renders the request body
- **THEN** event preserves those values together with clientId, username, and brokerReceivedAtMs

### Requirement: Claim forwarding credential isolation

Development verification SHALL prove that the Claim credential is accepted only by the Member API Claim route, the ingestion credential is accepted only by the ingestion route, and Firebase bearer tokens authenticate only member routes. Verification output MUST contain no credential, Pair Code, UID, complete payload, or Authorization value.

#### Scenario: Reject an ingestion credential at Claim ingress

- **WHEN** the Claim route receives a wrapper signed with the ingestion credential
- **THEN** it returns HTTP 401 and performs zero Claim persistence

#### Scenario: Produce sanitized bind evidence

- **WHEN** the bind verifier completes
- **THEN** its evidence contains only allowlisted connector, rule, route, HTTP status, requestId, and outcome metadata
- **AND** it does not describe the shared publisher as physical-device attestation
