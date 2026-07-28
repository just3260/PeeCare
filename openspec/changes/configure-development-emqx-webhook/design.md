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

## Implementation Contract

**Behavior:** canonical urination 或 battery telemetry message 產生一個符合 contract 的 POST；非匹配 topic 零 delivery；retry 參數未核准不得 apply。

**Interface:** sanitized template 只含 secret reference token；verify summary 包含 rule/action status 與 delivery counters。

**Failure modes:** target/secret/filter/policy gate 缺失時不修改 EMQX；probe 非 2xx 或 counter 未增加即失敗。

**Acceptance criteria:** template validation、dry-run diff、exact topic probes、JSON object/retained/qos envelope probes、legacy/commands/events-battery non-delivery 與 rotation rehearsal 通過。

**Scope boundaries:** in scope 是 webhook rule/action；out of scope 是 device auth/ACL、production 與 alert destination。

## Risks / Trade-offs

- [Risk] retry 放大 duplicate → ingestion idempotency 保護，仍需核准 buffer/TTL limits。
- [Risk] secret 出現在 export → template 只保存 reference，source scan 阻擋 literal secret。

## Open Questions

Buffer、retry interval、request TTL、queue limit 與 alert thresholds 是 apply 前 refinement gates。
