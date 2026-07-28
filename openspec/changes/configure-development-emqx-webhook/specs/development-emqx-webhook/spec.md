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

### Requirement: Approved retry policy

Configuration SHALL require approved buffer, retry, request TTL, queue, and failure-threshold values before EMQX mutation.

#### Scenario: Reject missing policy
- **WHEN** any retry policy value is unapproved
- **THEN** configuration exits before changing the action

### Requirement: Webhook delivery verification

Verification SHALL prove urination and battery delivery, legacy non-delivery, and current-to-previous secret rotation without exposing payload or secret values.

#### Scenario: Rehearse secret rotation
- **WHEN** the action switches from old to new current secret during the dual-acceptance window
- **THEN** probes remain successful before the old secret is removed

### Requirement: Transport metadata preservation

The action SHALL preserve qos as 0, 1, or 2, retained as a boolean, brokerReceivedAtMs as integer epoch milliseconds, and publisher clientId without substituting username. It SHALL forward retained true so the ingestion service can reject it with `retained_event`.

#### Scenario: Forward a retained delivery for rejection
- **WHEN** EMQX processes a matching message with retained true
- **THEN** the action sends retained true and Cloud Run returns the retained-event rejection

### Requirement: Decoded object payload boundary

The action SHALL produce a decoded JSON object payload. A payload that cannot become an object SHALL fail the rule/action verification and SHALL NOT be reported as a successful webhook delivery.

#### Scenario: Receive a JSON array payload
- **WHEN** a matching MQTT message decodes to an array
- **THEN** verification records a failed contract delivery rather than a successful event
