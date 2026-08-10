# development-device-mqtt-identity Specification

## Purpose

Define the identity, credential, authorization, publishing, retry, and registry safeguards required to provision a physical development MQTT device.

## Requirements

### Requirement: Non-secret device inventory

The development inventory SHALL uniquely map one physical test device to deviceId, productModel, broker principal reference, and Firestore registry state and SHALL NOT contain credentials.

#### Scenario: Detect duplicate identity
- **WHEN** two inventory entries use the same deviceId
- **THEN** validation fails before provisioning

##### Example: Duplicate PC-000001
- **GIVEN** two entries both set `deviceId` to `PC-000001`
- **WHEN** inventory validation runs
- **THEN** it returns `duplicate_device_id` and performs zero EMQX mutations

### Requirement: Unique device credential

The test device SHALL use a non-superuser EMQX built-in-database password credential not shared with any other device or Web client. The provisioning flow SHALL expose its value once only through an explicitly approved interactive TTY and SHALL NOT accept or emit the device password through command arguments, environment variables, stdout, stderr, JSON, or project files.

#### Scenario: Scan project artifacts
- **WHEN** provisioning artifacts are inspected
- **THEN** no MQTT password, key, or reusable secret is present

##### Example: Reject a non-interactive handoff
- **GIVEN** `/dev/tty` cannot be opened before provisioning
- **WHEN** `--apply --secret-output-tty` runs
- **THEN** it returns `unsafe_handoff` and performs zero EMQX mutations

### Requirement: Own-topic publish ACL

The username-scoped principal SHALL publish only QoS 1 non-retained messages to `products/{productModel}/devices/{deviceId}/events/urination` and `products/{productModel}/devices/{deviceId}/status/battery` for its own identity and SHALL be denied `events/battery`, other-device, legacy, command, wildcard, retained-publish, and subscribe access.

#### Scenario: Publish another device topic
- **WHEN** the principal publishes an event for another deviceId
- **THEN** EMQX denies the operation

##### Example: Deny PC-000002
- **GIVEN** principal `device-PC-000001` connected as client `PC-000001`
- **WHEN** it publishes QoS 1 to `products/pc-mini/devices/PC-000002/events/urination`
- **THEN** MQTT 5 PUBACK reports not authorized or EMQX closes the connection

### Requirement: Identity consistency

Firmware configuration SHALL use the same deviceId in clientId, topic, payload, and Firestore registry. It SHALL use the inventory and registry productModel in the Topic; following `device-event-contract`, productModel SHALL NOT be duplicated into the payload.

#### Scenario: Detect mismatched firmware identity
- **WHEN** topic deviceId differs from configured clientId
- **THEN** configuration verification fails

##### Example: Reject mismatched client and topic
- **GIVEN** clientId `PC-000001` and topic `products/pc-mini/devices/PC-000002/events/urination`
- **WHEN** firmware configuration verification runs
- **THEN** it returns `device_identity_mismatch` before credential handoff

### Requirement: Credential lifecycle verification

The runbook SHALL verify initial strict-TLS connection, rotation to a new password for the same username, rejection of the old password, acceptance of the new password, and final revocation. Lifecycle output SHALL contain only mode, deviceId, principal, status, and verification names.

#### Scenario: Revoke an old credential
- **WHEN** rotation completes and the old credential is revoked
- **THEN** the old credential cannot connect and the new credential can connect

##### Example: Rotate device-PC-000001
- **GIVEN** `device-PC-000001` can connect with password A
- **WHEN** rotation installs password B
- **THEN** password A receives a not-authorized connection result and password B connects over strict-TLS MQTTS

### Requirement: Canonical publisher identity

Firmware configuration SHALL set clientId exactly to deviceId and username to `device-{deviceId}`. Topic productModel and deviceId and payload deviceId MUST equal the inventory values; productModel remains Topic routing data and SHALL NOT be duplicated into the canonical payload. The EMQX password authenticator SHALL use username identity and the management API SHALL be HTTPS under `/api/v5`.

#### Scenario: Verify device PC-000001 identity
- **WHEN** the inventory contains productModel `pc-mini` and deviceId `PC-000001`
- **THEN** clientId is `PC-000001`, username is `device-PC-000001`, and both canonical topics and payloads use those inventory values

### Requirement: Non-retained bounded QoS publishing

Urination and battery telemetry SHALL publish with retained false and QoS 1. Firmware configuration MUST reject QoS 0, QoS 2, every other QoS value, and retained true. The Broker URL SHALL use `mqtts`, port 8883, and certificate verification that cannot be disabled.

#### Scenario: Reject a retained telemetry configuration
- **WHEN** the firmware manifest sets retained true for battery
- **THEN** manifest verification fails before credential handoff

##### Example: QoS and retained policy table
| QoS | Retained | Expected |
| --- | --- | --- |
| 1 | false | valid |
| 0 | false | `invalid_publish_policy` |
| 2 | false | `invalid_publish_policy` |
| 1 | true | `invalid_publish_policy` |

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

##### Example: Disabled PC-000001
- **GIVEN** `petcare-c7483/devices/PC-000001` contains `deviceId: PC-000001`, `productModel: pc-mini`, and `ingestionStatus: disabled`
- **WHEN** provisioning preflight runs
- **THEN** it returns `registry_device_disabled` and performs zero EMQX mutations
