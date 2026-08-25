# EMQX Serverless Dashboard Checklist

Use this checklist for the PeeCare development deployment. Data Integration is
created and reviewed in the Dashboard because the Serverless Deployment API
does not expose connector, action, or rule mutation endpoints. Keep resolved
secret values out of this file, command output, URLs, logs, tickets, and chat.

## Capacity boundary

The complete template contains exactly **2 HTTPS connectors** and **4 rule
definitions**, which exhausts the Serverless limits of 2 connectors and 4
rules. The Claim rule is always independent; choose either the canonical
ingestion rule or the two legacy compatibility rules as documented below. Do
not create another connector or rule without redesigning this topology.

## Mutually exclusive topology modes

`canonical_only` and `paired_compatibility` describe the selected ingestion
route; the Claim rule and action remain enabled in both modes. Configure exactly
one row—never enable the canonical ingestion pair together with either legacy
compatibility pair.

| Mode | Canonical ingestion rule/action | Legacy urination rule/action | Legacy battery rule/action | Claim rule/action | Selected total |
| --- | --- | --- | --- | --- | --- |
| `canonical_only` (`PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE=disabled`) | Enabled / Enabled | Disabled / Disabled | Disabled / Disabled | **Enabled / Enabled** | 2 rules / 2 actions |
| `paired_compatibility` (`PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE=enabled`) | Disabled / Disabled | Enabled / Enabled | Enabled / Enabled | **Enabled / Enabled** | 3 rules / 3 actions |

## Ingestion connector

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

## Ingestion rule

| Dashboard field | Expected value | Notes |
| --- | --- | --- |
| Enable | Mode-dependent | Follow the mutually exclusive topology matrix above. |
| SQL projection | `topic`, `clientid AS clientId`, `username`, `qos`, `flags.retain AS retained`, `publish_received_at AS brokerReceivedAtMs`, `json_decode(payload) AS payload` | Fixed. |
| Topic filter 1 | `products/+/devices/+/events/urination` | Fixed. |
| Topic filter 2 | `products/+/devices/+/status/battery` | Fixed. |
| Legacy filters | None | Fixed. |
| Action count | `1` | Fixed when canonical ingestion is selected. |

## Ingestion action

| Dashboard field | Expected value | Notes |
| --- | --- | --- |
| Action Name | `$PEECARE_EMQX_ACTION_NAME` | Platform-assigned or operator-selected bounded identity. |
| Connector | `$PEECARE_EMQX_CONNECTOR_NAME` | Must reference the connector reviewed above. |
| Enable | Mode-dependent | Follow the mutually exclusive topology matrix above. |
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

## Claim connector

| Dashboard field | Expected value | Notes |
| --- | --- | --- |
| Connector Name | `$PEECARE_EMQX_CLAIM_CONNECTOR_NAME` | Must differ from `$PEECARE_EMQX_CONNECTOR_NAME`. |
| Connector Type | `HTTP Server` | Dashboard-managed second connector. |
| URL | `$PEECARE_DEVELOPMENT_MEMBER_ORIGIN` | Verified Member API HTTPS origin only; no path, query, or credentials. |
| TLS | `enabled` | HTTPS remains mandatory. |
| `TLS Verify` | `disabled` | Development Serverless exception: the console exposes no CA-bundle field. This is not peer verification. |
| HTTP Pipelining | `1` | Project-constrained value. |
| Pool Type | `random` | Console default; not constrained by the project. |
| Connection Pool Size | `2` | Project-constrained value. |
| Connect Timeout | `10s` | Project-constrained value. |
| Start Timeout | Console default | Not constrained by the project. |
| Health Check Interval | `15s` | Project-constrained value. |

## Claim rule

| Dashboard field | Expected value |
| --- | --- |
| Rule ID / Name | `peecare_development_device_claim` |
| Enable | `true` |
| SQL projection | `topic`, `clientid AS clientId`, `username`, `qos`, `flags.retain AS retained`, `publish_received_at AS brokerReceivedAtMs`, `json_decode(payload) AS payload` |
| Topic filter | Exact `peecare/device/1/bind` |
| SQL predicates | Exact `qos = 0` and `flags.retain = false` |
| Action count | Exactly `1` |

The exact SQL is in `emqx-webhook.template.json`. Do not broaden the topic,
remove either predicate, add another action, or describe the shared MQTT
username, clientId, or payload device identifier as hardware attestation.

## Claim action

| Dashboard field | Expected value | Notes |
| --- | --- | --- |
| Action Name | `$PEECARE_EMQX_CLAIM_ACTION_NAME` | Must differ from every ingestion action name. |
| Connector | `$PEECARE_EMQX_CLAIM_CONNECTOR_NAME` | Must reference only the Claim connector reviewed above. |
| Method | `POST` | Fixed. |
| URL Path | `/v1/emqx/device-claims` | Fixed Member API route; authentication remains in the body wrapper only. |
| Content Type | `application/json` | Fixed. |
| Body | `{"webhookAuthorization":"Bearer {{PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT}}","event":${.}}` | Exactly two top-level fields; this Claim token is a reference and differs from the ingestion token. |
| Custom headers | None | Serverless custom headers are not persisted after save. |

Before saving, verify that
`$PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF` is a numeric version of the approved
Claim secret and is not `$PEECARE_INGESTION_SECRET_CURRENT_REF`. Never put a
resolved credential, Pair Code, UID, Authorization value, or complete bind
payload in console screenshots, dry-run output, logs, tickets, or acceptance
evidence. After saving, reopen the action and confirm only the redacted wrapper
shape is visible.
