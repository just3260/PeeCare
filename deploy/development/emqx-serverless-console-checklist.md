# EMQX Serverless Dashboard Checklist

Use this checklist for the PeeCare development deployment. Data Integration is
created and reviewed in the Dashboard because the Serverless Deployment API
does not expose connector, action, or rule mutation endpoints. Keep resolved
secret values out of this file, command output, URLs, logs, tickets, and chat.

## Connector

| Dashboard field | Expected value | Notes |
| --- | --- | --- |
| Connector Name | `$PEECARE_EMQX_CONNECTOR_NAME` | Platform-assigned or operator-selected bounded identity. |
| Connector Type | `HTTP Server` | Dashboard-managed. |
| URL | `$PEECARE_DEVELOPMENT_INGESTION_ORIGIN` | HTTPS origin only; no path, query, or credentials. |
| TLS | `enabled` | HTTPS remains mandatory. |
| `TLS Verify` | `disabled` | Development Serverless exception: the console exposes no CA-bundle field. This is not peer verification. |
| HTTP Pipelining | `1` | Project-constrained value. |
| Pool Type | `random` | Console default; not constrained by the project. |
| Connection Pool Size | `2` | Project-constrained value. |
| Connect Timeout | `10s` | Project-constrained value. |
| Start Timeout | Console default | Not constrained by the project. |
| Health Check Interval | `15s` | Project-constrained value. |

## Rule

| Dashboard field | Expected value |
| --- | --- |
| Enable | `true` |
| SQL projection | `topic`, `clientid AS clientId`, `username`, `qos`, `flags.retain AS retained`, `publish_received_at AS brokerReceivedAtMs`, `json_decode(payload) AS payload` |
| Topic filter 1 | `products/+/devices/+/events/urination` |
| Topic filter 2 | `products/+/devices/+/status/battery` |
| Legacy filters | None |
| Action count | `1` |

## Action

| Dashboard field | Expected value | Notes |
| --- | --- | --- |
| Action Name | `$PEECARE_EMQX_ACTION_NAME` | Platform-assigned or operator-selected bounded identity. |
| Connector | `$PEECARE_EMQX_CONNECTOR_NAME` | Must reference the connector reviewed above. |
| Method | `POST` | Fixed. |
| URL Path | `/v1/emqx/events` | Fixed; the resolved secret must never be placed in the URL. |
| Content Type | `application/json` | Fixed. |
| Body | `{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":${.}}` | Exactly two top-level fields; the token is a reference, not a secret value. |
| Custom headers | None | Serverless custom headers are not persisted after save. |

The Dashboard does not expose `query_mode`, `worker_pool_size`,
`inflight_window`, `max_buffer_bytes`, or `request_ttl`. These fields remain
platform defaults and are deliberately not constrained by this project.

After saving, reopen the action and verify the redacted body shape, wait longer
than one health-check interval, confirm the connector remains Connected, and
run the end-to-end verification command. Do not copy the resolved body or event
payload into acceptance evidence.
