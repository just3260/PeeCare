## Why

Cloud Run endpoint 將暴露在公開網路並接收 EMQX 轉送的裝置事件；如果沒有一致的 HTTP、Secret、Envelope 與事件契約驗證，無效或偽造請求可能進入資料層，EMQX 也無法依狀態碼判斷是否重試。先建立可信且可注入測試 sink 的入口，能讓後續 Firestore changes 只接收已正規化的事件。

## What Changes

- 建立 services/ingestion-api 的 Node.js 22、TypeScript、Fastify service 與 Cloud Run PORT／0.0.0.0 啟動邊界。
- 提供 GET /healthz 與 POST /v1/emqx/events；其他 method、content type、oversized body 與 malformed JSON 使用穩定錯誤回應。
- 使用 Authorization Bearer current／previous secrets 與 timing-safe comparison，缺漏或錯誤 token 統一回傳 401 且不寫入日誌。
- 將 HTTP body 限為 64 KiB，並驗證固定的 topic、clientId、username、qos、retained、brokerReceivedAtMs、payload envelope。
- 要求 retained=false，且 clientId、Topic Device ID、Payload deviceId 三者一致；payload 必須是 JSON object。
- 重用 device-event-contract 的 Topic、Payload 與 mixed-time validator，產生包含 receivedAtMs、effectiveAtMs、timeSource 的 ValidatedDeviceEvent。
- 建立單一 EventSink port；production 預設 sink 回傳 503，直到 persist-urination-events-idempotently 提供 durable adapter。
- 建立結構化 error body、request ID 與敏感欄位 redaction；所有無效輸入回傳非重試型 4xx，sink／內部暫時失敗回傳 503。

## Capabilities

### New Capabilities

- `emqx-webhook-validation`: 驗證 EMQX HTTP 請求身分、傳輸 Envelope 與既有裝置事件契約，並只把正規化事件交給唯一 sink。

### Modified Capabilities

（無）

## Impact

- Affected specs: emqx-webhook-validation; reuses device-event-contract
- Prerequisites: establish-device-event-contract, bootstrap-vue-web-app
- Affected code:
  - New:
    - services/ingestion-api/package.json
    - services/ingestion-api/tsconfig.json
    - services/ingestion-api/Dockerfile
    - services/ingestion-api/src/server.ts
    - services/ingestion-api/src/app.ts
    - services/ingestion-api/src/config.ts
    - services/ingestion-api/src/http/errors.ts
    - services/ingestion-api/src/routes/emqx-events.ts
    - services/ingestion-api/src/security/webhook-auth.ts
    - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
    - services/ingestion-api/src/contracts/validate-emqx-webhook-event.ts
    - services/ingestion-api/src/domain/validated-device-event.ts
    - services/ingestion-api/src/sinks/event-sink.ts
    - services/ingestion-api/src/sinks/unconfigured-event-sink.ts
    - services/ingestion-api/test/emqx-events.test.ts
    - contracts/device-events/lib/index.mjs
    - contracts/device-events/lib/index.d.mts
  - Modified:
    - package.json
    - package-lock.json
    - contracts/device-events/package.json
  - Removed: none
- Affected systems: EMQX HTTP Action request template, Cloud Run container runtime, later Firestore persistence adapters, and ingestion logs.
