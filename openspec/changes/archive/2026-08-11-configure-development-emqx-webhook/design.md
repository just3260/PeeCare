## Context

EMQX rule/action is the only development bridge from MQTT topics to Cloud Run. Misconfigured filters or headers can drop events or leak secrets.

## Goals / Non-Goals

**Goals:** exact event topics、contract envelope、Bearer header、rotation、delivery metrics/probe。

**Non-Goals:** 不決定 device ACL、QoS final policy、production action 或 alert service integration。

## Decisions

### Rule 選取 canonical urination 與 battery telemetry topics

只匹配 `products/+/devices/+/events/urination` 與 `products/+/devices/+/status/battery` 的 exact structural rules，不轉送 commands、其他 status wildcard 或 legacy topic。Battery 的 canonical suffix 是 `status/battery`，不能誤設為 `events/battery`。

### Action 產生固定 webhook envelope

Action 固定使用 `POST` 與 `Content-Type: application/json`。Mapping 明確輸出且只輸出 topic、clientId、username、qos、retained、brokerReceivedAtMs、decoded JSON object payload，目標為 development Cloud Run `/v1/emqx/events`。不得預先丟棄 retained=true；ingestion 需要收到該欄位並以 `retained_event` 拒絕。

### Secret rotation 採 current then previous window

Action 使用 current secret；rotation runbook 先讓 Cloud Run 接受新舊、再切 action、驗證後移除舊 secret。

### Approved bounded delivery policy

HTTP Action 固定使用 `query_mode: async`、`worker_pool_size: 2`、`inflight_window: 10`、每 worker `max_buffer_bytes: 8MB`、`request_ttl: 30s` 與 `health_check_interval: 15s`。不設定獨立 `retry_interval`；HTTP delivery 的 recoverable retry 必須受 buffer、request TTL 與 connector health state 共同限制。Apply 前必須從 EMQX `/api-spec.json` 確認這些 action resource options 均受目前版本支援，任何欄位缺失或 schema 不相容皆為零 mutation failure。

告警基準固定如下：`retried > 0` 或 `queuing > 0` 持續 60 秒為 warning；5 分鐘內 `failed >= 3`，或任何 `dropped > 0`／`late_reply > 0` 為 critical。刻意執行 retained rejection probe 或 rotation rehearsal 時，以 probe 前後 counter delta 和預期結果判定，不把既有累積 counter 誤報為新 failure。

Sanitized template 的 Authorization header 只保存 `{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}` reference token。Configure flow 只能在記憶體內把 numeric Secret Manager version reference 解析成 current value 並送到 EMQX；dry-run、export、summary、error 與 logs 均維持 reference，不得輸出 resolved value。

## Implementation Contract

**Behavior:** canonical urination 或 battery telemetry message 產生一個符合 contract 的 POST；非匹配 topic 零 delivery；delivery policy 必須逐欄等於核准值，且不得包含獨立 `retry_interval`，否則不得 apply。

**Interface:** sanitized template 只含 secret reference token；verify summary 包含 rule/action status 與 delivery counters。

**Failure modes:** target/secret/filter/policy/API-schema gate 缺失時不修改 EMQX；probe 非 2xx 或 counter 未增加即失敗；sanitized output 出現 resolved secret 即失敗。

**Acceptance criteria:** template validation、dry-run diff、exact topic probes、JSON object/retained/qos envelope probes、legacy/commands/events-battery non-delivery 與 rotation rehearsal 通過。

**Scope boundaries:** in scope 是 webhook rule/action；out of scope 是 device auth/ACL、production 與 alert destination。

## Risks / Trade-offs

- [Risk] retry 放大 duplicate → ingestion idempotency 保護，並以 30s TTL、20 total inflight 與約 16MB aggregate queue 限制重試窗口。
- [Risk] secret 出現在 export → template 只保存 reference，source scan 阻擋 literal secret。
