## ADDED Requirements

### Requirement: Opt-in paired compatibility routes

The development integration SHALL define two legacy status compatibility rules and two HTTP actions under one approved HTTPS connector. Both rules SHALL match exactly `peecare/device/1/status`; one SHALL produce canonical urination events and the other SHALL produce canonical battery events. Each rule SHALL reference exactly one event-type-specific action. The enable-ready checklist SHALL treat the two rule/action pairs as one paired compatibility topology and SHALL NOT report complete enablement when either pair is absent.

#### Scenario: Render the accepted paired topology

- **WHEN** an operator renders an enable-ready compatibility checklist
- **THEN** it identifies one shared connector, one legacy Urination rule with one Urination action, and one legacy Battery rule with one Battery action

#### Scenario: Reject a partial topology

- **WHEN** either event-type-specific rule or action is missing, both rules do not match the exact legacy topic, a rule references more than one action, or the pairs use different connectors
- **THEN** configuration validation SHALL fail before reporting the topology as enable-ready

#### Scenario: Keep compatibility disabled by default

- **WHEN** an operator renders the development checklist without explicitly selecting paired compatibility mode
- **THEN** neither legacy rule is enable-ready and a legacy delivery produces no compatibility action invocation

### Requirement: Urination legacy payload eligibility

The Urination compatibility rule SHALL accept a delivery only when the MQTT topic equals `peecare/device/1/status`, `clientid` equals the configured approved legacy client ID, `username` equals the configured approved legacy username, the retain flag is false, and the decoded payload is a JSON object whose `online` field equals boolean true. The payload `pumpSecondsToday` SHALL be an integer or float from `0` through `4294967.295` inclusive. The rule SHALL guard arithmetic projection from missing and non-numeric pump values before multiplication is evaluated. A delivery that fails any condition SHALL produce zero Urination action invocations and SHALL NOT fail with a SQL expression type error.

#### Scenario: Accept an eligible urination status

- **WHEN** the approved publisher sends a non-retained JSON object with `online: true` and `pumpSecondsToday: 10.4` to `peecare/device/1/status`
- **THEN** the Urination rule produces exactly one result for its HTTP action

#### Scenario: Reject an ineligible urination status

- **WHEN** a legacy delivery is retained, offline, published by a different client ID or username, not a JSON object, missing `pumpSecondsToday`, or contains a string, negative, non-finite, or greater-than-`4294967.295` pump value
- **THEN** the Urination rule produces zero results, invokes no Urination action, and does not raise `select_and_transform_error` for a missing or non-numeric pump value

##### Example: Urination eligibility boundaries

| Payload condition | Publisher and retain condition | Urination results |
| --- | --- | --- |
| `online: true`, `pumpSecondsToday: 0` | approved identity, non-retained | one |
| `online: true`, `pumpSecondsToday: 4294967.295` | approved identity, non-retained | one |
| `online: true`, `pumpSecondsToday: 4294967.296` | approved identity, non-retained | zero |
| `online: false` | approved identity, non-retained | zero |
| missing or string `pumpSecondsToday` | approved identity, non-retained | zero |
| valid payload | unapproved username or retained | zero |

### Requirement: Battery legacy payload eligibility

The Battery compatibility rule SHALL decode the payload before referencing its fields and SHALL match only `peecare/device/1/status`. It SHALL produce one result only when the decoded payload is a JSON object and `batteryV` is numeric from `0` through `20` inclusive. It SHALL project a non-numeric `batteryV` to sentinel `-1` before dependent arithmetic, while the `WHERE` boundary SHALL exclude that sentinel from action delivery. Missing, non-numeric, negative, and greater-than-20 values SHALL produce zero Battery action invocations without a SQL expression error.

The accepted Battery SQL contract SHALL NOT require `online`, `pumpSecondsToday`, source `clientid`, source `username`, or `flags.retain` as rule predicates. Topic publish authorization SHALL remain the responsibility of the existing development broker ACL.

#### Scenario: Accept an eligible battery voltage

- **WHEN** a JSON object containing `batteryV: 7.74` is delivered to `peecare/device/1/status`
- **THEN** the Battery rule produces exactly one result for its HTTP action

#### Scenario: Reject an ineligible battery voltage

- **WHEN** the payload is not a JSON object or `batteryV` is missing, non-numeric, negative, or greater than `20`
- **THEN** the Battery rule produces zero results and invokes no Battery action

##### Example: Battery eligibility boundaries

| `batteryV` | Battery results |
| --- | --- |
| `0` | one |
| `7.74` | one |
| `20` | one |
| `-0.001` | zero |
| `20.001` | zero |
| `"7.74"` or missing | zero |

### Requirement: Canonical urination transformation

For each eligible Urination delivery, the Urination action SHALL send the existing Serverless body credential wrapper with exactly `webhookAuthorization` and `event`. The inner event SHALL contain exactly topic, clientId, username, qos, retained, brokerReceivedAtMs, and payload. It SHALL set topic to `products/pc-mini/devices/68E274BD2A58/events/urination`, clientId to `68E274BD2A58`, username to the approved legacy username, qos to the source delivery qos, retained to false, and brokerReceivedAtMs to the EMQX `publish_received_at` value.

The payload SHALL contain exactly `schemaVersion: 1`, an eventId consisting of `compat:68E274BD2A58:` followed by a 32-character lowercase hexadecimal UUID v4 without hyphens, `eventType: urination`, `deviceId: 68E274BD2A58`, `sequence: 1`, recordedAtMs equal to brokerReceivedAtMs, `firmwareVersion: 1.0.0`, `flushDurationMs: 0`, and pumpDurationMs equal to `round(pumpSecondsToday * 1000)`. The action SHALL NOT copy `wet`, `state`, `count`, `batteryV`, or the complete legacy payload into the inner event.

#### Scenario: Transform decimal seconds into integer milliseconds

- **WHEN** an eligible Urination delivery has `pumpSecondsToday: 10.4`, qos `0`, username `approved-legacy-device`, and `publish_received_at: 1786982400123`
- **THEN** the inner event has qos `0`, username `approved-legacy-device`, brokerReceivedAtMs and recordedAtMs `1786982400123`, flushDurationMs `0`, and pumpDurationMs `10400`

##### Example: Exact urination payload projection

- **GIVEN** generated UUID `d7a39aa4195a42068b962eb9a665503e`
- **WHEN** the Urination action renders its inner payload
- **THEN** the payload is `{ "schemaVersion": 1, "eventId": "compat:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e", "eventType": "urination", "deviceId": "68E274BD2A58", "sequence": 1, "recordedAtMs": 1786982400123, "firmwareVersion": "1.0.0", "flushDurationMs": 0, "pumpDurationMs": 10400 }`

### Requirement: Canonical battery transformation

For each eligible Battery delivery, the Battery action SHALL send a Serverless body credential wrapper with exactly `webhookAuthorization` and `event`. The inner event SHALL contain exactly topic, clientId, username, qos, retained, brokerReceivedAtMs, and payload. It SHALL set topic to `products/pc-mini/devices/68E274BD2A58/status/battery`, clientId to `68E274BD2A58`, username to `Peecare`, qos to the source delivery qos, retained to false, and brokerReceivedAtMs to the EMQX `publish_received_at` value.

The payload SHALL contain exactly `schemaVersion: 1`, an eventId consisting of `compatbattery:68E274BD2A58:` followed by a 32-character lowercase hexadecimal UUID v4 without hyphens, `eventType: battery`, `deviceId: 68E274BD2A58`, `sequence: 1`, recordedAtMs equal to brokerReceivedAtMs, `firmwareVersion: 1.0.0`, batteryVoltageMv equal to `round(batteryV * 1000)`, and batteryLevelPercent selected from the accepted voltage tiers. The action SHALL preserve no other legacy payload field.

The voltage tiers SHALL map `batteryV >= 8.5` to `100`, `batteryV >= 8.0` and below `8.5` to `75`, `batteryV >= 7.5` and below `8.0` to `50`, `batteryV >= 7.0` and below `7.5` to `25`, and an eligible value below `7.0` to `0`.

#### Scenario: Transform battery voltage into canonical measurements

- **WHEN** an eligible Battery delivery has `batteryV: 7.74`, qos `0`, and `publish_received_at: 1786982400123`
- **THEN** the inner event has username `Peecare`, qos `0`, brokerReceivedAtMs and recordedAtMs `1786982400123`, batteryVoltageMv `7740`, and batteryLevelPercent `50`

##### Example: Battery tier boundaries

| `batteryV` | `batteryVoltageMv` | `batteryLevelPercent` |
| --- | --- | --- |
| `6.9` | `6900` | `0` |
| `7.0` | `7000` | `25` |
| `7.5` | `7500` | `50` |
| `8.0` | `8000` | `75` |
| `8.5` | `8500` | `100` |
| `20` | `20000` | `100` |

##### Example: Exact battery payload projection

- **GIVEN** generated UUID `d7a39aa4195a42068b962eb9a665503e`
- **WHEN** the Battery action renders an eligible `batteryV: 7.74` delivery
- **THEN** the payload is `{ "schemaVersion": 1, "eventId": "compatbattery:68E274BD2A58:d7a39aa4195a42068b962eb9a665503e", "eventType": "battery", "deviceId": "68E274BD2A58", "sequence": 1, "recordedAtMs": 1786982400123, "firmwareVersion": "1.0.0", "batteryLevelPercent": 50, "batteryVoltageMv": 7740 }`

### Requirement: Explicit paired test-only event semantics

Each eligible route SHALL generate a new eventId and SHALL use fixed `sequence: 1`. A legacy status eligible for both routes SHALL produce two independently stored events: one Urination event with the `compat:` prefix and one Battery event with the `compatbattery:` prefix. The compatibility layer SHALL NOT claim stable retry identity, monotonic sequence, per-event pump duration, or accurate daily aggregation. Repeating an identical legacy status SHALL generate a new pair of eventIds.

#### Scenario: Deliver one status through both routes

- **WHEN** one legacy status satisfies both Urination and Battery eligibility
- **THEN** the two actions produce one Urination event and one Battery event with distinct eventIds and fixed sequence `1`

#### Scenario: Receive the same paired status twice

- **WHEN** the same status eligible for both routes is delivered twice
- **THEN** the compatibility layer generates four distinct eventIds and both deliveries can be stored as two Urination and two Battery test events

#### Scenario: Allow one route to reject independently

- **WHEN** one legacy status has valid `batteryV` but fails the Urination eligibility boundary
- **THEN** the Battery route produces one event and the Urination route produces zero results

### Requirement: Sanitized paired configuration and verification

Configuration tooling SHALL issue zero EMQX connector, action, or rule mutation requests. In disabled mode it SHALL emit a disabled compatibility checklist. In enabled mode it SHALL validate both rule/action contracts, the shared connector, fixed target identity, both UUID prefixes, Urination duration projection, Battery voltage and tier projection, and the exact action wrappers. It SHALL emit no credential or complete legacy payload.

Enabled verification SHALL record its start time and accept operator-declared `pumpSecondsToday`, `batteryV`, username, and qos for one compatibility observation window. Bounded polling SHALL find exactly one new `68E274BD2A58` Urination event with the `compat:` prefix and exactly one new Battery event with the `compatbattery:` prefix. Verification SHALL validate each event's fixed fields, calculated fields, shared broker timestamp, transport username, and qos without assuming result order. A successful result SHALL be `paired_shape_observed` and SHALL report source provenance as `human_attestation_required`; it SHALL NOT claim that Firestore shape proves an approved Arduino source. It SHALL distinguish unmet prerequisites, timeout by event type, multiple matches by event type, field mismatch, registry mismatch, and Firestore read failure with typed outcomes. It SHALL NOT print eventId, full payload, webhook secret, or MQTT password.

#### Scenario: Observe one paired event shape

- **WHEN** enabled verification records its start time and the operator declares values for one status eligible for both routes
- **THEN** verification returns `paired_shape_observed` only after locating and validating exactly one new Urination event and exactly one new Battery event, and identifies source provenance as `human_attestation_required`

#### Scenario: Refuse partial paired evidence

- **WHEN** bounded polling finds only one event type, zero events for either type, more than one event of either type, or an unexpected field
- **THEN** verification exits non-zero with the corresponding typed result and does not report paired compatibility delivery as passed

#### Scenario: Preserve redaction

- **WHEN** configuration or verification succeeds or fails
- **THEN** its output contains no resolved credential, MQTT password, eventId, complete payload, or Firestore document data

### Requirement: Reversible paired development-only lifecycle

The checklist and runbook SHALL label both routes as development-only test infrastructure. Before enablement they SHALL warn that Urination events affect event history and daily aggregates and Battery events affect battery history and latest battery projection for `68E274BD2A58`. Disabling one rule SHALL stop only that event type. Complete rollback SHALL disable both rules and SHALL preserve the shared connector, ingestion service, and existing Firestore data. Compatibility enablement SHALL NOT appear in production configuration or code paths.

#### Scenario: Roll back both compatibility routes

- **WHEN** an operator disables the Battery and Urination rules after the smoke test
- **THEN** subsequent legacy statuses produce neither event type while the shared connector and ingestion service remain unchanged

#### Scenario: Detect a partial rollback

- **WHEN** only one compatibility rule is disabled
- **THEN** the runbook classifies the topology as degraded and requires disabling the remaining rule before declaring rollback complete

#### Scenario: Preserve test records during removal

- **WHEN** an operator removes both disabled rules and both actions
- **THEN** existing compatibility event documents, daily aggregates, and battery projections remain unchanged pending separately approved cleanup
