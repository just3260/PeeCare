## ADDED Requirements

### Requirement: Exact development topic filter

The EMQX rule SHALL match only `products/{productModel}/devices/{deviceId}/events/urination` and `products/{productModel}/devices/{deviceId}/status/battery` selected for development and SHALL exclude `events/battery`, commands, legacy topics, and unrelated status topics.

#### Scenario: Exclude a legacy topic
- **WHEN** a message is published to the legacy prototype topic
- **THEN** the webhook action is not invoked

### Requirement: Contract webhook envelope

The action SHALL use HTTP POST with `Content-Type: application/json` and SHALL send exactly topic, clientId, username, qos, retained, brokerReceivedAtMs, and decoded JSON object payload to the approved development Cloud Run `/v1/emqx/events` URL.

#### Scenario: Forward a urination event
- **WHEN** a valid urination message matches the rule
- **THEN** Cloud Run receives one contract-shaped JSON request

### Requirement: Referenced Bearer secret

The action SHALL send the current Bearer secret through a custom Authorization header and SHALL NOT persist or log its value in repository artifacts or verification output.

#### Scenario: Inspect exported configuration
- **WHEN** configuration is exported or dry-run output is printed
- **THEN** it contains a secret reference and no secret value

##### Example: Export the current-secret reference
- **GIVEN** template header `Authorization: Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}` and a resolved current secret `sentinel-current-secret`
- **WHEN** dry-run output and configuration summary are emitted
- **THEN** both outputs contain the reference token and neither contains `sentinel-current-secret`

### Requirement: Approved retry policy

Configuration SHALL require exactly `query_mode: async`, `worker_pool_size: 2`, `inflight_window: 10`, `max_buffer_bytes: 8MB` per worker, `request_ttl: 30s`, and `health_check_interval: 15s` before EMQX mutation. It SHALL reject an independent `retry_interval`, because recoverable HTTP delivery retry is bounded by the buffer, request TTL, and connector health state. Preflight SHALL verify these fields against the live EMQX `/api-spec.json`. The approved warning thresholds SHALL be any retry or queue depth above zero for 60 seconds; critical thresholds SHALL be at least 3 failures in 5 minutes or any dropped or late-reply delivery.

#### Scenario: Reject missing policy
- **WHEN** any retry policy value is unapproved
- **THEN** configuration exits before changing the action

##### Example: Reject an oversized queue without mutation
- **GIVEN** a template whose `max_buffer_bytes` is `256MB` instead of `8MB`
- **WHEN** apply validation runs
- **THEN** it reports `unapproved_delivery_policy` and performs zero connector, action, or rule mutations

### Requirement: Webhook delivery verification

Verification SHALL prove urination and battery delivery, legacy non-delivery, and current-to-previous secret rotation without exposing payload or secret values.

#### Scenario: Rehearse secret rotation
- **WHEN** the action switches from old to new current secret during the dual-acceptance window
- **THEN** probes remain successful before the old secret is removed

##### Example: Verify previous then current secret
- **GIVEN** previous reference `projects/petcare-c7483/secrets/emqx-webhook-current/versions/6`, current reference `projects/petcare-c7483/secrets/emqx-webhook-current/versions/7`, and a Cloud Run revision accepting both
- **WHEN** a canonical urination probe succeeds with version 6, the action switches to version 7, and a canonical battery probe succeeds
- **THEN** the sanitized summary reports both rotation stages verified, two successful deliveries, and no secret or payload values

### Requirement: Transport metadata preservation

The action SHALL preserve qos as 0, 1, or 2, retained as a boolean, brokerReceivedAtMs as integer epoch milliseconds, and publisher clientId without substituting username. It SHALL forward retained true so the ingestion service can reject it with `retained_event`.

#### Scenario: Forward a retained delivery for rejection
- **WHEN** EMQX processes a matching message with retained true
- **THEN** the action sends retained true and Cloud Run returns the retained-event rejection

##### Example: Preserve a retained urination delivery
- **GIVEN** topic `products/pc-mini/devices/PC-000001/events/urination`, clientId `PC-000001`, username `device-PC-000001`, qos `1`, retained `true`, and brokerReceivedAtMs `1786358600000`
- **WHEN** the action renders the webhook envelope
- **THEN** it preserves those values without substituting username for clientId, and the ingestion response is HTTP 422 `retained_event`

### Requirement: Decoded object payload boundary

The action SHALL produce a decoded JSON object payload. A payload that cannot become an object SHALL fail the rule/action verification and SHALL NOT be reported as a successful webhook delivery.

#### Scenario: Receive a JSON array payload
- **WHEN** a matching MQTT message decodes to an array
- **THEN** verification records a failed contract delivery rather than a successful event

##### Example: Reject a decoded array
- **GIVEN** decoded payload `[{"deviceId":"PC-000001"}]`
- **WHEN** the action probe renders the webhook envelope
- **THEN** it fails with `invalid_payload` before the delivery can be counted as successful
