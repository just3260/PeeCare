# development-emqx-webhook Specification

## Purpose

Define the development EMQX rule and webhook action, secret rotation, delivery policy, and verification requirements for forwarding device telemetry to the ingestion service.

## Requirements

### Requirement: Exact development topic filter

The development EMQX integration SHALL expose an explicit canonical-only topology and an explicit paired legacy compatibility topology. In canonical-only topology, one canonical rule SHALL match only `products/{productModel}/devices/{deviceId}/events/urination` and `products/{productModel}/devices/{deviceId}/status/battery` selected for development and SHALL exclude `events/battery`, commands, legacy topics, and unrelated status topics.

In paired legacy compatibility topology, the approved HTTPS connector SHALL instead have exactly two event-type-specific rules. Both SHALL match exactly `peecare/device/1/status`; one SHALL invoke exactly one Urination action and the other SHALL invoke exactly one Battery action governed by `development-legacy-status-compatibility`. Their action envelopes SHALL target the canonical urination and battery topics. The connector SHALL report rule count `2` for this topology, and the two actions SHALL use the same connector.

#### Scenario: Preserve canonical-only filters

- **WHEN** an operator selects canonical-only topology
- **THEN** the canonical rule matches exactly the urination and battery canonical topic filters and excludes the legacy status topic

#### Scenario: Select paired legacy filters

- **WHEN** an operator selects paired legacy compatibility topology
- **THEN** one connector has exactly two rules matching `peecare/device/1/status`, with one rule/action pair for Urination and one for Battery

#### Scenario: Reject mixed or partial topology

- **WHEN** the selected paired topology retains a canonical broker-input rule, omits either legacy rule/action pair, binds both actions to one rule, or uses different connectors
- **THEN** configuration validation SHALL fail before reporting the topology as ready


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

---
### Requirement: Contract webhook envelope

The Serverless action SHALL use HTTP POST with `Content-Type: application/json` and SHALL send an outer object containing exactly `webhookAuthorization` and `event` to the approved development Cloud Run `/v1/emqx/events` URL. `webhookAuthorization` SHALL carry the referenced Bearer credential, and `event` SHALL contain exactly topic, clientId, username, qos, retained, brokerReceivedAtMs, and decoded JSON object payload. After authenticating the wrapper, ingestion SHALL pass only `event` to the existing envelope validation and persistence flow. A non-Serverless caller using the existing Authorization header SHALL continue sending the raw event envelope without the outer wrapper.

#### Scenario: Forward a urination event through the Serverless wrapper

- **WHEN** a valid urination message matches the Serverless rule
- **THEN** Cloud Run authenticates the outer wrapper and processes one contract-shaped inner event without persisting wrapper metadata

##### Example: Exact Serverless body shape

- **GIVEN** rule output object `${.}` and secret reference token `{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}`
- **WHEN** the action renders its request body
- **THEN** it renders `{ "webhookAuthorization": "Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}", "event": ${.} }` with no additional top-level field


<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->

---
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


<!-- @trace
source: add-device-claim-onboarding
updated: 2026-08-26
code:
  - deploy/development/emqx-webhook.template.json
  - src/features/device-claim/device-claim-store.ts
  - deploy/development/verify-member.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - src/features/device-claim/device-claim-api.ts
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/deploy-member.d.mts
  - src/views/HomeView.vue
  - src/views/DeviceConnectView.vue
  - deploy/development/verify-emqx-webhook.mjs
  - services/member-api/src/config.ts
  - services/member-api/src/http/errors.ts
  - devices/development/fixtures/legacy-bind-retry.json
  - devices/development/legacy-bind-policy.mjs
  - deploy/development/verify-member.d.mts
  - deploy/development/member-service.yaml
  - scripts/test-firebase.mjs
  - src/features/device-claim/device-claim-store-key.ts
  - deploy/development/deploy-member.mjs
  - deploy/development/EMQX_RUNBOOK.md
  - services/member-api/src/security/emqx-claim-auth.ts
  - firestore.rules
  - firebase/local/fixtures/device-claims.ts
  - services/member-api/src/app.ts
  - services/member-api/src/claims/claim-service.ts
  - package.json
  - src/components/WifiConnectionGuideDialog.vue
  - src/features/device-claim/device-id-input.ts
  - src/router/index.ts
  - services/member-api/src/claims/emqx-device-claim-route.ts
  - devices/development/legacy-bind-policy.json
  - deploy/development/configure-emqx-webhook.mjs
  - services/member-api/src/server.ts
  - services/member-api/src/firestore/device-claim-repository.ts
  - src/main.ts
  - src/features/device-claim/device-claim-session-storage.ts
  - services/member-api/src/claims/pair-code.ts
  - src/features/device-claim/device-claim-auth-lifecycle.ts
tests:
  - src/router/index.spec.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - src/views/HomeView.spec.ts
  - src/features/device-claim/device-id-input.spec.ts
  - services/member-api/test/member-claim-routes.test.ts
  - services/member-api/test/device-claim-firestore.integration.test.ts
  - src/features/device-claim/device-claim-store.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-firebase.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - services/member-api/test/app.test.ts
  - services/member-api/test/emqx-device-claim-route.test.ts
  - src/components/WifiConnectionGuideDialog.spec.ts
  - src/views/DeviceConnectView.spec.ts
  - services/member-api/test/pair-code.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-member.spec.ts
  - devices/development/legacy-bind-policy.spec.ts
  - src/features/device-claim/device-claim-auth-lifecycle.spec.ts
  - services/member-api/test/config.test.ts
  - deploy/development/deploy-member.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
  - services/member-api/test/emqx-claim-auth.test.ts
  - services/member-api/test/claim-service.test.ts
  - src/features/device-claim/device-claim-api.spec.ts
  - src/features/device-claim/device-claim-session-storage.spec.ts
-->

---
### Requirement: Claim forwarding credential isolation

Development verification SHALL prove that the Claim credential is accepted only by the Member API Claim route, the ingestion credential is accepted only by the ingestion route, and Firebase bearer tokens authenticate only member routes. Verification output MUST contain no credential, Pair Code, UID, complete payload, or Authorization value.

#### Scenario: Reject an ingestion credential at Claim ingress

- **WHEN** the Claim route receives a wrapper signed with the ingestion credential
- **THEN** it returns HTTP 401 and performs zero Claim persistence

#### Scenario: Produce sanitized bind evidence

- **WHEN** the bind verifier completes
- **THEN** its evidence contains only allowlisted connector, rule, route, HTTP status, requestId, and outcome metadata
- **AND** it does not describe the shared publisher as physical-device attestation


<!-- @trace
source: add-device-claim-onboarding
updated: 2026-08-26
code:
  - deploy/development/emqx-webhook.template.json
  - src/features/device-claim/device-claim-store.ts
  - deploy/development/verify-member.mjs
  - deploy/development/MEMBER_API_RUNBOOK.md
  - src/features/device-claim/device-claim-api.ts
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/deploy-member.d.mts
  - src/views/HomeView.vue
  - src/views/DeviceConnectView.vue
  - deploy/development/verify-emqx-webhook.mjs
  - services/member-api/src/config.ts
  - services/member-api/src/http/errors.ts
  - devices/development/fixtures/legacy-bind-retry.json
  - devices/development/legacy-bind-policy.mjs
  - deploy/development/verify-member.d.mts
  - deploy/development/member-service.yaml
  - scripts/test-firebase.mjs
  - src/features/device-claim/device-claim-store-key.ts
  - deploy/development/deploy-member.mjs
  - deploy/development/EMQX_RUNBOOK.md
  - services/member-api/src/security/emqx-claim-auth.ts
  - firestore.rules
  - firebase/local/fixtures/device-claims.ts
  - services/member-api/src/app.ts
  - services/member-api/src/claims/claim-service.ts
  - package.json
  - src/components/WifiConnectionGuideDialog.vue
  - src/features/device-claim/device-id-input.ts
  - src/router/index.ts
  - services/member-api/src/claims/emqx-device-claim-route.ts
  - devices/development/legacy-bind-policy.json
  - deploy/development/configure-emqx-webhook.mjs
  - services/member-api/src/server.ts
  - services/member-api/src/firestore/device-claim-repository.ts
  - src/main.ts
  - src/features/device-claim/device-claim-session-storage.ts
  - services/member-api/src/claims/pair-code.ts
  - src/features/device-claim/device-claim-auth-lifecycle.ts
tests:
  - src/router/index.spec.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - src/views/HomeView.spec.ts
  - src/features/device-claim/device-id-input.spec.ts
  - services/member-api/test/member-claim-routes.test.ts
  - services/member-api/test/device-claim-firestore.integration.test.ts
  - src/features/device-claim/device-claim-store.spec.ts
  - services/member-api/test/server.test.ts
  - scripts/test-firebase.spec.ts
  - firebase/local/firestore.rules.spec.ts
  - services/member-api/test/app.test.ts
  - services/member-api/test/emqx-device-claim-route.test.ts
  - src/components/WifiConnectionGuideDialog.spec.ts
  - src/views/DeviceConnectView.spec.ts
  - services/member-api/test/pair-code.test.ts
  - src/router/auth-guard.spec.ts
  - deploy/development/verify-member.spec.ts
  - devices/development/legacy-bind-policy.spec.ts
  - src/features/device-claim/device-claim-auth-lifecycle.spec.ts
  - services/member-api/test/config.test.ts
  - deploy/development/deploy-member.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
  - services/member-api/test/emqx-claim-auth.test.ts
  - services/member-api/test/claim-service.test.ts
  - src/features/device-claim/device-claim-api.spec.ts
  - src/features/device-claim/device-claim-session-storage.spec.ts
-->

---
### Requirement: Referenced Bearer secret

The Serverless action SHALL send the current Bearer secret through the fixed `webhookAuthorization` field in the outer JSON body because the deployed console does not persist custom action headers. The ingestion endpoint SHALL continue accepting the existing custom Authorization header with a raw envelope for compatible non-Serverless callers. Header and body credential transports SHALL be mutually exclusive, SHALL use the same constant-time current-or-previous secret comparison, and SHALL NOT persist or log their value in repository artifacts, URLs, Firestore, structured logs, or verification output.

#### Scenario: Inspect exported configuration

- **WHEN** configuration is exported or dry-run output is printed
- **THEN** it contains a secret reference and body-wrapper token, and contains no secret value

##### Example: Export the current-secret reference

- **GIVEN** template field `webhookAuthorization: Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}` and a resolved current secret `sentinel-current-secret`
- **WHEN** dry-run output and configuration summary are emitted
- **THEN** both outputs contain the reference token and neither contains `sentinel-current-secret`

#### Scenario: Preserve the existing header transport

- **WHEN** a non-Serverless caller sends a valid Authorization header with a raw contract envelope
- **THEN** ingestion authenticates and processes it with the existing status codes and persistence behavior

#### Scenario: Reject unsafe wrapper variants

- **WHEN** a request has a missing or invalid body credential, extra wrapper field, non-object event, or simultaneous header and body credentials
- **THEN** ingestion returns sanitized HTTP 401 `unauthorized`, invokes no sink, and emits no credential or request body value


<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->

---
### Requirement: Approved retry policy

Configuration SHALL require exactly `pool_size: 2`, `enable_pipelining: 1`, `connect_timeout: 10s`, and `health_check_interval: 15s` on the connector, because these are the delivery fields the deployed console exposes. It SHALL reject an independent `retry_interval`, because recoverable HTTP delivery retry is bounded by the request timeout and connector health state. The action buffering fields `query_mode`, `worker_pool_size`, `inflight_window`, `max_buffer_bytes`, and `request_ttl` SHALL be recorded as platform defaults outside this project's control, because the deployed console does not expose them and the deployment exposes no API to read or set them. Configuration SHALL NOT verify delivery fields against a live API specification document, because the deployed plan does not serve one.

#### Scenario: Reject missing policy

- **WHEN** any constrained delivery value is unapproved
- **THEN** configuration exits before emitting a checklist

##### Example: Reject an unapproved pool size without mutation

- **GIVEN** a configuration template whose connector `pool_size` is `16` instead of `2`
- **WHEN** validation runs
- **THEN** it reports `unapproved_delivery_policy` and performs zero connector, action, or rule mutations

##### Example: Constrained versus unconstrained delivery fields

| Field | Layer | Console exposes it | Approved value |
| ----- | ----- | ------------------ | -------------- |
| `pool_size` | connector | yes | `2` |
| `enable_pipelining` | connector | yes | `1` |
| `connect_timeout` | connector | yes | `10s` |
| `health_check_interval` | connector | yes | `15s` |
| `query_mode` | action | no | platform default |
| `worker_pool_size` | action | no | platform default |
| `inflight_window` | action | no | platform default |
| `max_buffer_bytes` | action | no | platform default |
| `request_ttl` | action | no | platform default |
| `retry_interval` | action | no | rejected if present |


<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->

---
### Requirement: Webhook delivery verification

Canonical-only verification SHALL prove urination delivery and battery delivery by publishing probes from an existing registered development device over strict-TLS MQTT 5 and reading the resulting Firestore event documents, without exposing payload or secret values. It SHALL use the inventory deviceId as MQTT client ID, the inventory principal as username, QoS 1, and retained false. It SHALL read the device password only from a hidden interactive TTY, keep it only in memory, and reject password input through arguments, environment variables, files, stdout, or stderr. It SHALL additionally prove legacy non-delivery by accepting an ACL rejection or confirming no matching Firestore document.

Paired compatibility verification SHALL NOT publish canonical probes or report legacy non-delivery in the same run. It SHALL record a start time, accept operator-declared `pumpSecondsToday`, `batteryV`, username, and qos, and locate exactly one new Urination compatibility event and exactly one new Battery compatibility event for `68E274BD2A58`. It SHALL validate both canonical output topics, the event-type-specific UUID prefixes, calculated fields, fixed fields, a shared broker timestamp, usernames, and qos without assuming event order. A successful automated result SHALL be named `paired_shape_observed` and SHALL identify source provenance as `human_attestation_required`. Firestore event shape SHALL NOT be described as code-verified proof that the source was the approved Arduino.

Verification SHALL NOT depend on broker-side delivery counters. Delivery-failure detection SHALL rely on ingestion-side structured logs together with repeatable end-to-end probes. Secret rotation rehearsal SHALL require two distinct numeric secret versions accepted concurrently by the ingestion deployment as a stated precondition.

#### Scenario: Prove canonical-only delivery end to end

- **WHEN** canonical-only verification publishes canonical urination and battery probes
- **THEN** it reports both as delivered by locating exactly one Firestore event document for each and reports legacy non-delivery without exposing payload or secret values

#### Scenario: Observe paired controlled legacy shapes

- **WHEN** paired compatibility verification is active and an operator declares the expected values for one status eligible for both routes
- **THEN** verification reports `paired_shape_observed` only after finding exactly one new canonical Urination event and exactly one new canonical Battery event that satisfy `development-legacy-status-compatibility`, and reports `human_attestation_required` for source provenance

#### Scenario: Refuse contradictory mode assertions

- **WHEN** paired compatibility verification is selected
- **THEN** verification SHALL NOT report canonical broker-input probes or legacy non-delivery as passed in that run

#### Scenario: Refuse partial paired evidence

- **WHEN** paired polling finds only one event type, zero or multiple events for either type, or an event with a mismatched field
- **THEN** verification SHALL exit non-zero with an event-type-specific typed outcome

#### Scenario: Do not infer provenance from a synthetic-compatible shape

- **WHEN** the Serverless deployment message-publish endpoint or another credentialed caller produces one or both compatibility event shapes
- **THEN** verification SHALL NOT claim approved Arduino provenance, and final source acceptance MUST remain a separately recorded human attestation

#### Scenario: Refuse rotation rehearsal without dual acceptance

- **WHEN** rotation rehearsal is requested while the ingestion deployment accepts only one secret version
- **THEN** verification reports the unmet precondition and does not report rotation as verified

##### Example: Mode-aware verification outcomes

| Topology | Delivery evidence | Firestore evidence | Result |
| --- | --- | --- | --- |
| canonical-only | canonical urination and battery probes | exactly one of each | delivered |
| canonical-only | legacy topic probe | none | legacy non-delivery satisfied |
| paired compatibility | operator-declared legacy values | exactly one Urination and one Battery compatibility event | `paired_shape_observed`; human attestation required |
| paired compatibility | operator-declared legacy values | only one event type | typed partial-delivery failure |
| paired compatibility | operator-declared legacy values | multiple events of either type | typed ambiguous-delivery failure |


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

---
### Requirement: Transport metadata preservation

The action SHALL preserve qos as 0, 1, or 2, retained as a boolean, brokerReceivedAtMs as integer epoch milliseconds, and publisher clientId without substituting username. It SHALL forward retained true so the ingestion service can reject it with `retained_event`.

#### Scenario: Forward a retained delivery for rejection
- **WHEN** EMQX processes a matching message with retained true
- **THEN** the action sends retained true and Cloud Run returns the retained-event rejection

##### Example: Preserve a retained urination delivery
- **GIVEN** topic `products/pc-mini/devices/PC-000001/events/urination`, clientId `PC-000001`, username `device-PC-000001`, qos `1`, retained `true`, and brokerReceivedAtMs `1786358600000`
- **WHEN** the action renders the webhook envelope
- **THEN** it preserves those values without substituting username for clientId, and the ingestion response is HTTP 422 `retained_event`

---
### Requirement: Decoded object payload boundary

The action SHALL produce a decoded JSON object payload. A payload that cannot become an object SHALL fail the rule/action verification and SHALL NOT be reported as a successful webhook delivery.

#### Scenario: Receive a JSON array payload
- **WHEN** a matching MQTT message decodes to an array
- **THEN** verification records a failed contract delivery rather than a successful event

##### Example: Reject a decoded array
- **GIVEN** decoded payload `[{"deviceId":"PC-000001"}]`
- **WHEN** the action probe renders the webhook envelope
- **THEN** it fails with `invalid_payload` before the delivery can be counted as successful

---
### Requirement: Serverless management API capability boundary

Configuration and verification SHALL NOT depend on EMQX management endpoints that the deployed plan does not expose. The development deployment exposes client listing, subscription listing, and message publishing, and SHALL NOT be assumed to expose connector, action, rule, node, API specification, built-in authentication-user, or per-user authorization-rule endpoints. Any tooling step that requires an unexposed endpoint SHALL be removed rather than attempted and error-handled.

#### Scenario: Configuration runs without the API specification endpoint

- **WHEN** configuration tooling runs against the development deployment
- **THEN** it completes without requesting an API specification document and without requesting any connector, action, or rule endpoint

##### Example: Endpoint availability on the development deployment

| Endpoint | Method | Observed status | Permitted dependency |
| -------- | ------ | --------------- | -------------------- |
| `/api/v5/clients` | GET | 200 | yes |
| `/api/v5/subscriptions` | GET | 200 | yes |
| `/api/v5/publish` | POST | reachable | yes |
| `/api/v5/connectors` | GET | 403 | no |
| `/api/v5/actions` | GET | 403 | no |
| `/api/v5/rules` | GET | 403 | no |
| `/api/v5/authentication/password_based%3Abuilt_in_database/users` | GET/POST | unavailable | no |
| `/api/v5/authorization/sources/built_in_database/rules/users` | GET/PUT | unavailable | no |
| `/api-spec.json` | GET | 404 | no |


<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->

---
### Requirement: Configurable platform-assigned integration identity

The connector, action, and rule identities SHALL be supplied through configuration rather than fixed literals, because the deployment platform assigns connector names automatically and rejects caller-chosen values. Tooling SHALL validate that each supplied identity is a bounded string containing no whitespace, carriage return, line feed, or null character, and SHALL NOT require a specific name value.

#### Scenario: Accept a platform-assigned connector name

- **WHEN** tooling receives a platform-assigned connector identity that differs from any previously fixed name
- **THEN** it accepts the identity and proceeds

#### Scenario: Reject an unsafe identity

- **WHEN** a supplied identity contains a line feed or is empty
- **THEN** tooling fails before issuing any network request

##### Example: Identity validation cases

| Supplied identity | Result | Notes |
| ----------------- | ------ | ----- |
| `c-d1f775fd-efa39d` | accepted | platform-assigned form |
| `peecare_development_ingestion` | accepted | operator-chosen form |
| `` | rejected | empty string |
| `name%0Ainjected` containing a literal line feed | rejected | header injection risk |


<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->

---
### Requirement: Console-managed integration with auditable checklist

Because the deployed plan exposes no write path for data integration, the connector, rule, and action SHALL be created through the provider console, and configuration tooling SHALL NOT issue any write request to EMQX. Tooling SHALL instead emit a sanitized expected-value checklist covering every console field it constrains, and SHALL mark fields the console does not expose as unconstrained. The checklist SHALL name the Secret Manager secret that the deployment actually uses, SHALL specify the Serverless body credential wrapper rather than a custom action header, SHALL record HTTPS enabled with `TLS Verify` disabled as a platform exception, and SHALL NOT contain a secret value.

#### Scenario: Emit the checklist without mutating the broker

- **WHEN** configuration tooling runs
- **THEN** it emits a sanitized checklist and performs zero connector, action, and rule write requests

#### Scenario: Checklist names the deployed secret without claiming custom header support

- **WHEN** the checklist reports the Bearer secret source and action transport
- **THEN** it names the secret that the ingestion deployment consumes, contains a version reference rather than a secret value, and renders the credential token only in the fixed action body wrapper

#### Scenario: Checklist records the Serverless TLS exception

- **WHEN** the checklist reports connector transport security fields
- **THEN** it requires an HTTPS origin and TLS enabled, records `TLS Verify` as disabled because the deployed console provides no CA bundle field, and does not describe the connector as `verify_peer`


<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->

---
### Requirement: Broker-reachable health surface

The ingestion origin SHALL expose unauthenticated `GET /` and `POST /` as HTTP 200 with JSON `{"status":"ok"}` and a non-empty `x-request-id`, because live Cloud Run request metadata shows that the deployed Serverless Dashboard connectivity test sends `POST /` with an empty body and JSON content type. The root POST health probe SHALL NOT parse or persist an event. `PUT /`, `PATCH /`, `DELETE /`, and `HEAD /` SHALL retain the sanitized `404 not_found` contract. Existing `/health` and `/healthz` behavior SHALL remain unchanged. `/v1/emqx/events` SHALL retain the existing Authorization-header transport and SHALL additionally accept the Serverless body credential wrapper defined by this change. After connector creation, the forwarding path SHALL keep the connector connected under the broker's periodic health check and SHALL continue delivering canonical messages.

#### Scenario: Connector creation passes the root health gate

- **WHEN** the Serverless Dashboard connectivity test posts an empty JSON health probe to the ingestion origin root
- **THEN** the origin returns HTTP 200 with `{"status":"ok"}`, the connector creation action becomes available, and no authentication secret is required

##### Example: Root method contract

| Method and path | Expected status | Expected result |
| --------------- | --------------- | --------------- |
| `GET /` | 200 | `{"status":"ok"}` and non-empty `x-request-id` |
| `POST /` | 200 | static health response, including for empty JSON body; no event write |
| `PUT /` | 404 | sanitized `not_found` error |
| `HEAD /` | 404 | no successful implicit health route |

#### Scenario: Forwarding proceeds while the connector stays connected

- **WHEN** a canonical message matches the rule and the connector is connected
- **THEN** the action delivers the webhook request to the ingestion service

#### Scenario: Health check evaluation does not disable delivery

- **WHEN** the broker's periodic health check evaluates the ingestion origin root path
- **THEN** the connector remains connected and subsequent canonical messages continue to deliver

<!-- @trace
source: align-emqx-webhook-with-serverless
updated: 2026-08-18
code:
  - deploy/development/EMQX_RUNBOOK.md
  - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - vitest.config.ts
  - devices/development/registry-alignment.mjs
  - scripts/test-tool-macos-build.mjs
  - scripts/test-tool.mjs
  - docs/mqtt-server-integration.md
  - services/ingestion-api/cloudbuild.json
  - scripts/test-tool-macos-build.json
  - deploy/development/emqx-serverless-console-checklist.md
  - deploy/development/verify-emqx-webhook.mjs
  - scripts/test-tool-macos-verify.mjs
  - scripts/test-tool-operator-entry.mjs
  - deploy/development/configure-emqx-webhook.mjs
  - deploy/development/verify-ingestion.mjs
  - devices/development/fixtures/retry-after-disconnect.json
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - deploy/development/emqx-webhook.template.json
  - scripts/check-release.mjs
  - services/ingestion-api/src/app.ts
  - scripts/test-tool-operator.mjs
  - services/ingestion-api/Dockerfile
  - devices/development/acl-policy.json
  - devices/development/device-inventory.json
  - devices/development/firmware-config.template.json
  - package.json
  - devices/development/device-inventory.schema.json
tests:
  - scripts/check-release.spec.ts
  - deploy/development/deploy-ingestion.spec.ts
  - scripts/test-tool-operator.spec.ts
  - services/ingestion-api/test/app.test.ts
  - deploy/development/verify-emqx-webhook.spec.ts
  - devices/development/firmware-config.spec.ts
  - devices/development/verify-device-acl.spec.ts
  - scripts/test-tool-server.spec.ts
  - devices/development/credential-lifecycle.spec.ts
  - devices/development/provision-device.spec.ts
  - devices/development/device-inventory.spec.ts
  - scripts/test-tool-macos-verify.spec.ts
  - scripts/test-tool-macos-build.spec.ts
  - devices/development/registry-alignment.spec.ts
  - deploy/development/verify-ingestion.spec.ts
  - deploy/development/configure-emqx-webhook.spec.ts
-->