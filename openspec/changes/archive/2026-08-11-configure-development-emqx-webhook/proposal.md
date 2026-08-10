## Why

Cloud Run 部署後需要由 development EMQX 將正式 Topic 轉為已確認的 webhook envelope。此骨架固定 topic filter、Authorization secret 與可驗證的 retry boundary。

## What Changes

- 建立 canonical urination event topic 與 battery status topic rule，以及 Cloud Run webhook action inventory。
- 使用 current Bearer secret custom header，保留 previous secret rotation runbook。
- 明確設定 envelope 欄位並禁止把 secret 寫入匯出檔或 logs。
- 核准 async buffer policy：2 workers、每 worker 10 inflight、8MB queue、30s request TTL 與 15s health check；HTTP Action 不設定獨立 `retry_interval`。
- 告警基準為 retry 或持續 queue 產生 warning，5 分鐘內 3 次 failed 或任何 dropped／late reply 產生 critical。
- Rule 必須精確匹配 `products/{productModel}/devices/{deviceId}/events/urination` 與 `products/{productModel}/devices/{deviceId}/status/battery`，不得把 battery 改成 events path。
- Action 使用 `POST application/json` 並完整輸出已確認 envelope；`retained` 必須保留供 ingestion 拒絕 retained delivery。

## Capabilities

### New Capabilities

- `development-emqx-webhook`: 定義 development EMQX rule/action、secret rotation 與 delivery verification 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `development-emqx-webhook`（新增）
- Affected code:
  - New:
    - `deploy/development/emqx-webhook.template.json`
    - `deploy/development/configure-emqx-webhook.mjs`
    - `deploy/development/verify-emqx-webhook.mjs`
    - `deploy/development/EMQX_RUNBOOK.md`
  - Modified: none
  - Removed: none
- Prerequisites: `deploy-development-ingestion-api` 與 `validate-emqx-webhook-events`。
- Upstream contract: body 上限 64 KiB；Topic device ID、clientId、payload deviceId 必須一致；qos 接受 0/1/2；username 僅供 audit。
