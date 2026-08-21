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

---
### Requirement: Unique device credential

The test device SHALL use a non-superuser EMQX built-in-database password credential not shared with any other device or Web client. The provisioning flow SHALL expose its value once only through an explicitly approved interactive TTY and SHALL NOT accept or emit the device password through command arguments, environment variables, stdout, stderr, JSON, or project files.

#### Scenario: Scan project artifacts
- **WHEN** provisioning artifacts are inspected
- **THEN** no MQTT password, key, or reusable secret is present

##### Example: Reject a non-interactive handoff
- **GIVEN** `/dev/tty` cannot be opened before provisioning
- **WHEN** `--apply --secret-output-tty` runs
- **THEN** it returns `unsafe_handoff` and performs zero EMQX mutations

---
### Requirement: Own-topic publish ACL

The username-scoped principal SHALL publish only QoS 1 non-retained messages to `products/{productModel}/devices/{deviceId}/events/urination` and `products/{productModel}/devices/{deviceId}/status/battery` for its own identity and SHALL be denied `events/battery`, other-device, legacy, command, wildcard, retained-publish, and subscribe access.

#### Scenario: Publish another device topic
- **WHEN** the principal publishes an event for another deviceId
- **THEN** EMQX denies the operation

##### Example: Deny PC-000002
- **GIVEN** principal `device-PC-000001` connected as client `PC-000001`
- **WHEN** it publishes QoS 1 to `products/pc-mini/devices/PC-000002/events/urination`
- **THEN** MQTT 5 PUBACK reports not authorized or EMQX closes the connection

---
### Requirement: Identity consistency

Firmware configuration SHALL use the same deviceId in clientId, topic, payload, and Firestore registry. It SHALL use the inventory and registry productModel in the Topic; following `device-event-contract`, productModel SHALL NOT be duplicated into the payload.

#### Scenario: Detect mismatched firmware identity
- **WHEN** topic deviceId differs from configured clientId
- **THEN** configuration verification fails

##### Example: Reject mismatched client and topic
- **GIVEN** clientId `PC-000001` and topic `products/pc-mini/devices/PC-000002/events/urination`
- **WHEN** firmware configuration verification runs
- **THEN** it returns `device_identity_mismatch` before credential handoff

---
### Requirement: Credential lifecycle verification

The runbook SHALL verify initial strict-TLS connection, rotation to a new password for the same username, rejection of the old password, acceptance of the new password, and final revocation. Lifecycle output SHALL contain only mode, deviceId, principal, status, and verification names.

#### Scenario: Revoke an old credential
- **WHEN** rotation completes and the old credential is revoked
- **THEN** the old credential cannot connect and the new credential can connect

##### Example: Rotate device-PC-000001
- **GIVEN** `device-PC-000001` can connect with password A
- **WHEN** rotation installs password B
- **THEN** password A receives a not-authorized connection result and password B connects over strict-TLS MQTTS

---
### Requirement: Canonical publisher identity

Firmware configuration SHALL set clientId exactly to deviceId and username to `device-{deviceId}`. Topic productModel and deviceId and payload deviceId MUST equal the inventory values; productModel remains Topic routing data and SHALL NOT be duplicated into the canonical payload. The EMQX password authenticator SHALL use username identity and the management API SHALL be HTTPS under `/api/v5`.

#### Scenario: Verify device PC-000001 identity
- **WHEN** the inventory contains productModel `pc-mini` and deviceId `PC-000001`
- **THEN** clientId is `PC-000001`, username is `device-PC-000001`, and both canonical topics and payloads use those inventory values

---
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

---
### Requirement: Stable firmware retry identity

A retry of one unacknowledged device event MUST preserve eventId and every canonical payload field. The device SHALL create a new eventId only for a distinct physical event or distinct battery-level transition.

#### Scenario: Retry after a connection interruption
- **WHEN** a connection drops before acknowledgement of event `evt-000001`
- **THEN** the next delivery preserves eventId `evt-000001`, sequence, recordedAtMs, and measurement fields

---
### Requirement: Enabled registry alignment

Before credential handoff, the approved development Firestore project SHALL contain `devices/{deviceId}` with matching deviceId and productModel and `ingestionStatus: enabled`.

#### Scenario: Detect a disabled registry device
- **WHEN** the inventory device is disabled in Firestore
- **THEN** provisioning verification fails before the credential is handed to firmware

##### Example: Disabled PC-000001
- **GIVEN** `petcare-c7483/devices/PC-000001` contains `deviceId: PC-000001`, `productModel: pc-mini`, and `ingestionStatus: disabled`
- **WHEN** provisioning preflight runs
- **THEN** it returns `registry_device_disabled` and performs zero EMQX mutations

---
### Requirement: ESP32-derived physical device identifier

A physical ESP32 device provisioned through the development device inventory SHALL use the board-derived identifier as its canonical `deviceId`. The identifier MUST preserve leading zeroes and MUST match `^[0-9A-F]{12}$`: exactly twelve uppercase hexadecimal characters without a colon, hyphen, whitespace, or other separator. The inventory `deviceId`, MQTT client ID, canonical Topic device segment, payload `deviceId`, Firestore `devices/{deviceId}` document ID, and the suffix of MQTT principal `device-{deviceId}` SHALL all use that same value.

This physical-device constraint SHALL NOT narrow the generic `device-event-contract` identifier grammar. Synthetic development devices SHALL remain permitted to use the `PC-DEV-######` namespace and SHALL be identified through their trusted `developmentTestTool` registry marker rather than by treating identifier shape as proof of origin. A value matching the ESP32 pattern SHALL qualify as physically registered only when the approved registry, per-device MQTT credential, principal, and publisher identity binding also match.

#### Scenario: Accept the current ESP32 identifier

- **WHEN** the physical development inventory declares deviceId `68E274BD2A58`, MQTT client ID `68E274BD2A58`, principal `device-68E274BD2A58`, canonical Topic device segment `68E274BD2A58`, payload deviceId `68E274BD2A58`, and registry path `devices/68E274BD2A58`
- **THEN** physical device identity validation SHALL accept the consistent identity

##### Example: Preserve a leading zero

- **GIVEN** an ESP32 board-derived identifier whose first hexadecimal digit is zero
- **WHEN** firmware formats the identifier for provisioning and publishing
- **THEN** it emits all twelve uppercase digits, such as `00E274BD2A58`, without dropping either leading zero

#### Scenario: Reject a malformed physical identifier

- **WHEN** a physical development inventory uses lowercase hexadecimal, fewer or more than twelve characters, a colon-separated MAC form, a hyphen, whitespace, or a non-hexadecimal character
- **THEN** validation SHALL return `invalid_device_id` before credential handoff or broker mutation

#### Scenario: Keep a synthetic test device distinct

- **WHEN** a registered Test Tool device uses `PC-DEV-000001` and carries the exact approved `developmentTestTool` marker
- **THEN** the Test Tool marker flow SHALL remain permitted to authorize it without classifying it as an ESP32 physical inventory identity

#### Scenario: Refuse format-only hardware trust

- **WHEN** an unregistered or incorrectly credentialed publisher claims a twelve-character uppercase hexadecimal deviceId
- **THEN** the system SHALL reject it through registry, credential, principal, or publisher-binding validation and SHALL NOT trust it solely because the identifier matches the ESP32 pattern

<!-- @trace
source: translate-legacy-status-in-development-emqx
updated: 2026-08-21
code:
  - devices/development/firmware-config.template.json
  - deploy/development/EMQX_RUNBOOK.md
  - deploy/development/configure-emqx-webhook.mjs
  - devices/development/device-inventory.json
  - docs/mqtt-server-integration.md
  - services/ingestion-api/src/app.ts
  - devices/development/device-configuration.mjs
  - package.json
  - deploy/development/verify-emqx-webhook.mjs
  - deploy/development/emqx-serverless-console-checklist.md
  - devices/development/acl-policy.json
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/Dockerfile
  - devices/development/device-inventory.schema.json
  - deploy/development/emqx-webhook.template.json
  - services/ingestion-api/cloudbuild.json
  - deploy/development/verify-ingestion.mjs
  - devices/development/registry-alignment.mjs
tests:
  - devices/development/verify-device-acl.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - services/ingestion-api/test/app.test.ts
  - devices/development/registry-alignment.spec.ts
  - services/test-tool-api/test/test-device-repository.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/device-inventory.spec.ts
  - devices/development/firmware-config.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
-->