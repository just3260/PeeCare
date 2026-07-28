# emqx-webhook-validation Specification

## Purpose

TBD - created by archiving change 'validate-emqx-webhook-events'. Update Purpose after archive.

## Requirements

### Requirement: Cloud Run compatible HTTP service

The ingestion service SHALL run on Node.js 22 with TypeScript and Fastify. Its production process MUST listen on `0.0.0.0` using the `PORT` environment variable and MUST handle concurrent requests without shared mutable request state. `GET /healthz` SHALL return HTTP 200 with `{"status":"ok"}`.

#### Scenario: Start with the Cloud Run port

- **WHEN** the process starts with `PORT=8080`
- **THEN** it SHALL listen on `0.0.0.0:8080`

#### Scenario: Inject a request without opening a port

- **WHEN** a test builds the Fastify application and injects `GET /healthz`
- **THEN** it SHALL receive HTTP 200 and `{"status":"ok"}`


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Rotatable Bearer authentication

`POST /v1/emqx/events` SHALL require exactly one `Authorization` header containing `Bearer <token>`. The service SHALL accept `EMQX_WEBHOOK_SECRET_CURRENT` and, when configured, one distinct `EMQX_WEBHOOK_SECRET_PREVIOUS`. It MUST compare tokens with a timing-safe operation and MUST return the same HTTP 401 error shape for every authentication failure.

#### Scenario: Accept the current secret

- **WHEN** a request presents the configured current Bearer secret
- **THEN** authentication SHALL pass to HTTP envelope validation

#### Scenario: Accept the previous secret during rotation

- **WHEN** distinct current and previous secrets are configured and a request presents the previous secret
- **THEN** authentication SHALL pass to HTTP envelope validation

#### Scenario: Reject malformed or invalid authorization

- **WHEN** the header is missing, duplicated, uses a non-Bearer scheme, has an empty token, or matches neither configured secret
- **THEN** the service SHALL return HTTP 401 with code `unauthorized` and SHALL NOT invoke the event sink

#### Scenario: Reject identical rotation secrets

- **WHEN** current and previous secrets are both configured to the same value
- **THEN** application startup SHALL fail before accepting requests


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Bounded JSON request

The event endpoint SHALL accept only `POST` requests with `application/json` and an optional UTF-8 charset. The raw body MUST NOT exceed 65536 bytes. The service SHALL reject malformed JSON before event validation.

#### Scenario: Accept JSON with UTF-8 charset

- **WHEN** a POST request uses `Content-Type: application/json; charset=utf-8` and a body at or below 65536 bytes
- **THEN** it SHALL proceed to authentication and envelope validation

#### Scenario: Reject an oversized body

- **WHEN** a request body contains 65537 bytes
- **THEN** the service SHALL return HTTP 413 with code `body_too_large` and SHALL NOT invoke the sink

#### Scenario: Reject unsupported media type

- **WHEN** a request uses `text/plain` or omits Content-Type
- **THEN** the service SHALL return HTTP 415 with code `unsupported_media_type`

#### Scenario: Reject malformed JSON

- **WHEN** an authenticated request body is not valid JSON
- **THEN** the service SHALL return HTTP 400 with code `malformed_json`


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Strict EMQX webhook envelope

The JSON body SHALL be an object containing exactly `topic`, `clientId`, `username`, `qos`, `retained`, `brokerReceivedAtMs`, and `payload`. `clientId` and `username` MUST contain 1 through 128 characters. `qos` MUST equal 0, 1, or 2. `retained` MUST equal false. `brokerReceivedAtMs` MUST be a non-negative safe integer. `payload` MUST be a JSON object.

#### Scenario: Accept a complete envelope

- **WHEN** an authenticated request supplies every envelope field with `qos: 1`, `retained: false`, and an object payload
- **THEN** it SHALL proceed to device event validation

#### Scenario: Reject a stringified payload

- **WHEN** `payload` is a JSON string or Base64 string
- **THEN** the service SHALL return HTTP 400 with code `invalid_envelope`

#### Scenario: Reject retained telemetry

- **WHEN** the envelope contains `retained: true`
- **THEN** the service SHALL return HTTP 422 with code `retained_event` and SHALL NOT invoke the sink

#### Scenario: Accept every MQTT QoS value

- **WHEN** three otherwise valid requests contain QoS 0, 1, and 2
- **THEN** each request SHALL proceed to device event validation


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Publisher and device event validation

The service SHALL validate `topic` and `payload` with the archived `device-event-contract`. It SHALL require `clientId`, the Topic device identifier, and payload `deviceId` to be identical. The `username` SHALL be retained as transport audit data and SHALL NOT be required to equal the device identifier.

#### Scenario: Accept matching publisher identity

- **WHEN** `clientId`, Topic device identifier, and payload `deviceId` all equal `PC-000001`
- **THEN** publisher validation SHALL pass

#### Scenario: Reject a publisher mismatch

- **WHEN** any one of `clientId`, Topic device identifier, or payload `deviceId` differs
- **THEN** the service SHALL return HTTP 422 with code `publisher_mismatch`

#### Scenario: Reject an invalid device event

- **WHEN** the payload violates its version 1 device event schema or the Topic is unsupported
- **THEN** the service SHALL return HTTP 422 with code `invalid_event` and SHALL NOT invoke the sink


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Normalized validated event

For a valid request, the service SHALL create an immutable discriminated `ValidatedDeviceEvent` containing event type, product model, device identifier, Topic, publisher fields, QoS, broker receive time, server `receivedAtMs`, derived `effectiveAtMs`, `timeSource`, and the original validated payload. `receivedAtMs` MUST come from the server clock at request entry. The service SHALL derive effective time through `device-event-contract` and SHALL NOT use `brokerReceivedAtMs` as the statistical receive time.

#### Scenario: Normalize a valid device time

- **WHEN** the server clock returns `1785168060000` and the payload records `1785168000000`
- **THEN** the sink SHALL receive `receivedAtMs: 1785168060000`, `effectiveAtMs: 1785168000000`, and `timeSource: "device"`

#### Scenario: Normalize an unavailable device time

- **WHEN** the server clock returns `1785168060000` and the payload records null
- **THEN** the sink SHALL receive `receivedAtMs: 1785168060000`, `effectiveAtMs: 1785168060000`, and `timeSource: "server"`

#### Scenario: Prevent post-validation mutation

- **WHEN** a sink attempts to mutate the validated event or nested payload
- **THEN** the immutable event SHALL reject or ignore the mutation and retain its validated values


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Durable sink acknowledgement boundary

The route SHALL invoke exactly one configured `EventSink` after all validation succeeds. It SHALL return a 2xx response only after the sink resolves. The production default sink MUST return HTTP 503 code `sink_unavailable`. Sink outcomes `accepted`, `stored`, and `duplicate` SHALL map to HTTP 202, 201, and 200 respectively.

#### Scenario: Refuse success without a durable sink

- **WHEN** a valid request reaches the production default sink
- **THEN** the service SHALL return HTTP 503 with code `sink_unavailable`

#### Scenario: Map an injected sink outcome

- **WHEN** a test sink resolves with `accepted`, `stored`, or `duplicate`
- **THEN** the route SHALL return the corresponding HTTP 202, 201, or 200 status with eventId and requestId

#### Scenario: Map a temporary sink failure

- **WHEN** the sink reports a retryable temporary failure
- **THEN** the route SHALL return HTTP 503 with code `temporarily_unavailable`


<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->

---
### Requirement: Safe structured errors and logs

Every response SHALL contain `x-request-id`. Every error response SHALL use `{"error":{"code":"<stable-code>","requestId":"<id>"}}`. HTTP responses and logs MUST NOT contain Authorization values, configured secrets, complete request bodies, MQTT usernames, or stack traces.

#### Scenario: Return a stable error body

- **WHEN** a request fails validation
- **THEN** the response SHALL contain the request ID and stable error code without AJV paths or payload values

#### Scenario: Redact sensitive values

- **WHEN** request logs and error logs are captured for authenticated and unauthenticated cases
- **THEN** no current secret, previous secret, Authorization header, full body, or MQTT username SHALL appear

<!-- @trace
source: validate-emqx-webhook-events
updated: 2026-07-28
code:
  - services/ingestion-api/src/server.ts
  - contracts/device-events/package.json
  - services/ingestion-api/src/http/errors.ts
  - services/ingestion-api/vitest.config.ts
  - contracts/device-events/lib/index.d.mts
  - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
  - services/ingestion-api/tsconfig.json
  - services/ingestion-api/package.json
  - services/ingestion-api/Dockerfile
  - package.json
  - contracts/device-events/lib/index.mjs
  - services/ingestion-api/src/config.ts
  - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
  - services/ingestion-api/src/domain/validated-device-event.ts
  - services/ingestion-api/src/security/webhook-auth.ts
  - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
  - services/ingestion-api/src/sinks/event-sink.ts
  - services/ingestion-api/src/app.ts
tests:
  - services/ingestion-api/test/app.test.ts
-->