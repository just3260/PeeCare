## ADDED Requirements

### Requirement: Non-secret device inventory

The development inventory SHALL uniquely map one physical test device to deviceId, productModel, broker principal reference, and Firestore registry state and SHALL NOT contain credentials.

#### Scenario: Detect duplicate identity
- **WHEN** two inventory entries use the same deviceId
- **THEN** validation fails before provisioning

### Requirement: Unique device credential

The test device SHALL use a credential not shared with any other device or Web client, and the provisioning flow SHALL expose its value only through the approved one-time handoff.

#### Scenario: Scan project artifacts
- **WHEN** provisioning artifacts are inspected
- **THEN** no MQTT password, key, or reusable secret is present

### Requirement: Own-topic publish ACL

The principal SHALL publish only `products/{productModel}/devices/{deviceId}/events/urination` and `products/{productModel}/devices/{deviceId}/status/battery` for its own identity and SHALL be denied `events/battery`, other device, legacy, command, and wildcard topic access.

#### Scenario: Publish another device topic
- **WHEN** the principal publishes an event for another deviceId
- **THEN** EMQX denies the operation

### Requirement: Identity consistency

Firmware configuration SHALL use the same deviceId and productModel in clientId, topic, payload, and Firestore registry.

#### Scenario: Detect mismatched firmware identity
- **WHEN** topic deviceId differs from configured clientId
- **THEN** configuration verification fails

### Requirement: Credential lifecycle verification

The runbook SHALL verify initial connection, rotation to a new credential, and revocation of the old credential.

#### Scenario: Revoke an old credential
- **WHEN** rotation completes and the old credential is revoked
- **THEN** the old credential cannot connect and the new credential can connect

### Requirement: Canonical publisher identity

Firmware configuration SHALL set clientId exactly to deviceId and username to `device-{deviceId}`. Topic productModel and deviceId and payload productModel and deviceId MUST equal the inventory values.

#### Scenario: Verify device PC-000001 identity
- **WHEN** the inventory contains productModel `pc-mini` and deviceId `PC-000001`
- **THEN** clientId is `PC-000001`, username is `device-PC-000001`, and both canonical topics and payloads use those inventory values

### Requirement: Non-retained bounded QoS publishing

Urination and battery telemetry SHALL publish with retained false and with one approved QoS value from 0, 1, or 2. Firmware configuration MUST reject any other QoS value and retained true.

#### Scenario: Reject a retained telemetry configuration
- **WHEN** the firmware manifest sets retained true for battery
- **THEN** manifest verification fails before credential handoff

### Requirement: Stable firmware retry identity

A retry of one unacknowledged device event MUST preserve eventId and every canonical payload field. The device SHALL create a new eventId only for a distinct physical event or distinct battery-level transition.

#### Scenario: Retry after a connection interruption
- **WHEN** a connection drops before acknowledgement of event `evt-000001`
- **THEN** the next delivery preserves eventId `evt-000001`, sequence, recordedAtMs, and measurement fields

### Requirement: Enabled registry alignment

Before credential handoff, the approved development Firestore project SHALL contain `devices/{deviceId}` with matching deviceId and productModel and `ingestionStatus: enabled`.

#### Scenario: Detect a disabled registry device
- **WHEN** the inventory device is disabled in Firestore
- **THEN** provisioning verification fails before the credential is handed to firmware
