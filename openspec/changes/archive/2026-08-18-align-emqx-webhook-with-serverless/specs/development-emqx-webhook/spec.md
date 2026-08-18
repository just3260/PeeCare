## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Contract webhook envelope

The Serverless action SHALL use HTTP POST with `Content-Type: application/json` and SHALL send an outer object containing exactly `webhookAuthorization` and `event` to the approved development Cloud Run `/v1/emqx/events` URL. `webhookAuthorization` SHALL carry the referenced Bearer credential, and `event` SHALL contain exactly topic, clientId, username, qos, retained, brokerReceivedAtMs, and decoded JSON object payload. After authenticating the wrapper, ingestion SHALL pass only `event` to the existing envelope validation and persistence flow. A non-Serverless caller using the existing Authorization header SHALL continue sending the raw event envelope without the outer wrapper.

#### Scenario: Forward a urination event through the Serverless wrapper

- **WHEN** a valid urination message matches the Serverless rule
- **THEN** Cloud Run authenticates the outer wrapper and processes one contract-shaped inner event without persisting wrapper metadata

##### Example: Exact Serverless body shape

- **GIVEN** rule output object `${.}` and secret reference token `{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}`
- **WHEN** the action renders its request body
- **THEN** it renders `{ "webhookAuthorization": "Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}", "event": ${.} }` with no additional top-level field

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

### Requirement: Webhook delivery verification

Verification tooling SHALL retain a fail-closed path that can prove urination delivery, battery delivery, and legacy non-delivery only when an existing registered development device credential can publish over strict-TLS MQTT 5 with the inventory deviceId as MQTT client ID and the inventory principal as username. It SHALL read the device password only from a hidden interactive TTY, SHALL keep it only in memory, and SHALL reject password input through arguments, environment variables, files, stdout, or stderr. The verifier SHALL NOT provision a device through built-in authentication-user or per-user authorization-rule management endpoints because the deployed Serverless plan does not expose them. The Serverless message-publish endpoint and a Dashboard-created user/ACL combined with a simulated publisher identity SHALL NOT be accepted as canonical end-to-end evidence. A webhook request that reaches Cloud Run but is rejected by publisher binding SHALL be recorded only as broker-to-ingestion reachability and SHALL NOT be reported as Firestore delivery. Canonical MQTT-to-Firestore live acceptance and the rule-drift live rehearsal SHALL remain deferred until a Serverless-compatible device provisioning flow provides a valid device credential. Verification SHALL NOT depend on broker-side delivery counters, and secret rotation rehearsal SHALL require two distinct numeric secret versions accepted concurrently by the ingestion deployment as a stated precondition.

#### Scenario: Refuse an unavailable device credential precondition

- **WHEN** the Serverless deployment exposes no device-provisioning management endpoint and the operator has no usable existing device credential
- **THEN** verification reports `device_credential_precondition_unmet`, performs no synthetic canonical publish, and does not report any delivery as verified

#### Scenario: Record broker-to-ingestion reachability without claiming persistence

- **WHEN** a Dashboard-created user and ACL allow a simulated publisher message to reach the rule, action, and Cloud Run, but ingestion rejects the publisher identity
- **THEN** the acceptance record reports webhook reachability and the sanitized rejection, and does not report canonical Firestore delivery or a successful end-to-end result

##### Example: Observed simulated publisher boundary

| Publisher path | Broker/action | Cloud Run | Firestore | Reported result |
| -------------- | ------------- | --------- | --------- | --------------- |
| Dashboard-created user/ACL with simulated device identity | accepted and forwarded | HTTP 422 `publisher_mismatch` | no canonical event document | ingestion boundary reachable; end-to-end delivery not verified |

#### Scenario: Refuse a synthetic publisher as canonical evidence

- **WHEN** the Serverless deployment message-publish endpoint or a simulated Dashboard identity publishes a canonical topic without the registered device publisher identity
- **THEN** verification does not report canonical delivery as satisfied and preserves the ingestion publisher-binding requirement

#### Scenario: Refuse rotation rehearsal without dual acceptance

- **WHEN** rotation rehearsal is requested while the ingestion deployment accepts only one secret version
- **THEN** verification reports the unmet precondition and does not report rotation as verified
