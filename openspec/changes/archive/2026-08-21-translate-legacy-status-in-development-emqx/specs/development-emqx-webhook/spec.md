## MODIFIED Requirements

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
