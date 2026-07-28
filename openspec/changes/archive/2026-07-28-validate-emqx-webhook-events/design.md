## Context

EMQX 會以公開 HTTPS endpoint 將 MQTT message 轉送到 Cloud Run。Cloud Run instance 可同時處理多個請求，因此入口不得依賴可變全域 request state。已歸檔的 device-event-contract 提供 Topic、Payload、重送與 mixed-time 規則，但尚未定義 EMQX HTTP envelope、Webhook authentication、HTTP errors 或 durable sink 邊界。

## Goals / Non-Goals

**Goals:**

- 建立可在 Cloud Run 執行且可由 Fastify inject 測試的 ingestion service。
- 在解析業務 Payload 前驗證 Bearer secret、HTTP method、content type 與大小。
- 驗證固定 EMQX envelope、publisher identity 與既有 device-event-contract。
- 產生 immutable ValidatedDeviceEvent 並只交給單一 EventSink。
- 讓 4xx、503、request ID 與 log redaction 行為穩定可測。

**Non-Goals:**

- 不讀寫 Firestore，不驗證裝置是否已登錄。
- 不計算 payload hash、不執行 eventId 去重。
- 不更新 device latest state 或 daily aggregate。
- 不設定 EMQX Cloud Action、Cloud Run deployment 或 Secret Manager。
- 不支援 Heartbeat、Availability、Command 或 OTA。

## Decisions

### 建立 Cloud Run 相容的單一 Fastify service

services/ingestion-api 使用 Node.js 22、TypeScript、Fastify 與 Vitest。server.ts 僅負責讀取 PORT、在 0.0.0.0 listen 及處理 SIGTERM；app.ts 以 dependency injection 建立 Fastify instance，使測試使用 inject 而不開 port。GET /healthz 回傳 200 與 status=ok，但不宣稱 Firestore ready。

Dockerfile 使用 Node.js 22 Linux image、多階段 build、非 root runtime user，並只複製 production output 與必要契約檔。Root npm scripts 提供 check:ingestion；service package 提供 build、type-check、test、check、start。

### 使用 current previous Bearer secrets

config.ts 要求 EMQX_WEBHOOK_SECRET_CURRENT 為非空字串，EMQX_WEBHOOK_SECRET_PREVIOUS 可省略；兩者相同時啟動失敗。Authorization 必須完全符合 Bearer 加一個 token。驗證器將 presented token 與所有有效 secret 轉為 Buffer，對相同長度執行 timingSafeEqual，對不同長度執行固定 dummy comparison 後判定失敗，避免明顯長度 shortcut。

缺少、重複、錯誤 scheme、空 token、current／previous 都不符，一律回 401 code=unauthorized，不指出是哪個 secret。Fastify logger redaction 覆蓋 authorization header 與兩個 secret config keys。

### 先限制 HTTP 再驗證 Envelope

POST /v1/emqx/events 只接受 application/json；允許 charset=utf-8 parameter。route bodyLimit 固定 65536 bytes。錯誤順序為 method／route、content type、body size、JSON parse、authorization、envelope、device event contract，避免無界 body 或非 JSON 進入 AJV。

Envelope 必須只有 topic、clientId、username、qos、retained、brokerReceivedAtMs、payload。clientId／username 為 1–128 字元，qos 為 0／1／2，retained 必須 false，brokerReceivedAtMs 為非負 safe integer，payload 必須是 plain object。未知欄位、缺漏、stringified payload 與 base64 payload 都以 invalid_envelope 拒絕。

### 重用裝置契約並正規化時間

contracts/device-events package 新增公開 index export 與 TypeScript declarations，輸出 validateEnvelope、loadValidators、deriveEffectiveTime 及 error codes，不複製 JSON Schema 或 Topic parser。

Webhook validator 先用既有 validator 檢查 topic＋payload，再要求 clientId 等於 Topic deviceId 與 payload.deviceId。username 只保存為 transport audit field。Clock dependency 在 route 開始時產生 receivedAtMs；deriveEffectiveTime 使用 recordedAtMs 與 receivedAtMs 產生 effectiveAtMs／timeSource。brokerReceivedAtMs 不影響統計時間。

ValidatedDeviceEvent 以 discriminated union 表示 urination／battery，包含 productModel、deviceId、topic、clientId、username、qos、brokerReceivedAtMs、receivedAtMs、effectiveAtMs、timeSource 與原始 payload，並在交給 sink 前 deep-freeze。

### 單一 EventSink 控制成功回應

EventSink 只有 accept(event, requestContext) 一個行為，回傳 accepted、stored 或 duplicate outcome；route 依 outcome 回 202、201 或 200。此 change 的 production default 為 UnconfiguredEventSink，永遠拋出 sink_unavailable，route 回 503。

只有 sink 成功完成後才回 2xx。測試可注入 RecordingEventSink 驗證 validated event；後續 persist change 以 FirestoreEventSink 取代 default。這是唯一 adapter boundary，不在 route 與 service 間再疊 repository wrapper。

### 使用穩定 errors 與敏感資料 redaction

所有 error body 使用 {"error":{"code","requestId"}}；非 production test 可另外檢查內部 detail，但 HTTP 不回傳 AJV path、payload、secret 或 stack。狀態對應：401 unauthorized、404 not_found、405 method_not_allowed、413 body_too_large、415 unsupported_media_type、400 malformed_json／invalid_envelope、422 invalid_event／publisher_mismatch／retained_event、503 sink_unavailable／temporarily_unavailable、500 internal_error。

每個 response 都含 x-request-id。Log 只記錄 requestId、statusCode、errorCode；validated success 可記 eventId、eventType、deviceId，但不記完整 body、username、Authorization 或 secret。

## Implementation Contract

**Observable behavior**

- 有效 health request 回 200。
- 只有通過 secret、HTTP、Envelope、publisher identity 與 device-event-contract 的 request 才呼叫 EventSink。
- default production sink 對有效事件回 503，不回假成功。
- 注入成功 sink 時，route 依 accepted／stored／duplicate 回 202／201／200。
- invalid requests 一律不呼叫 sink。

**Interface**

POST /v1/emqx/events envelope 固定為 topic、clientId、username、qos、retained、brokerReceivedAtMs、payload；最大 65536 bytes。ValidatedDeviceEvent 與 EventSink 為後續 changes 的唯一輸入 contract。

**Acceptance criteria**

- npm run check:ingestion 通過 type-check、unit tests、service build 與 Docker build context 檢查。
- current 與 previous secrets 均可通過；其他 Authorization variants 均回同一 401 body shape。
- 64 KiB 內有效 body 可驗證，超過一 byte 回 413 且 sink 未被呼叫。
- clientId／Topic／payload deviceId 不一致回 422 publisher_mismatch。
- retained=true 回 422 retained_event；qos 0、1、2 分別可通過。
- receivedAtMs 由注入 clock 決定，mixed-time outputs 符合 device-event-contract。
- source、dist 與 logs 不出現測試 secret 或完整 Authorization header。

**Scope boundaries**

只實作 ingress HTTP／security／validation／normalization／sink port 與 service scaffold。不實作任何 durable data adapter 或 Cloud deployment。

## Risks / Trade-offs

- [Risk] Static Bearer secret 無法防止持有者重放 request → 後續 EventSink 以 eventId 冪等；Secret 需由 Secret Manager 注入並輪替。
- [Risk] 接受 previous secret 擴大有效憑證集合 → previous 為單一可省略值，輪替完成立即移除。
- [Risk] 64 KiB 可能限制未來大型 payload → 目前事件僅為小型 telemetry；大型附件不應走此 endpoint。
- [Risk] service 在 persistence 前對有效 request 回 503 → 刻意避免資料遺失；此 change 不單獨部署到 EMQX production Action。
- [Risk] 共用 MJS 契約與 TypeScript service 需要 declarations → declarations 與 exports 由 contract tests 和 ingestion compile 共同驗證。

## Migration Plan

1. 匯出既有 device-event-contract runtime API 與 declarations。
2. 以 Fastify inject 測試固定 auth、body、envelope、identity、time 與 errors。
3. 建立 service scaffold、default unavailable sink 與 Cloud Run container entry。
4. 執行兩個 package tests、check:ingestion 與 container smoke test。
5. persist-urination-events-idempotently 完成前不設定 EMQX production Action。

回滾只需移除 ingestion service 與契約 exports；既有 contract fixtures 與 Web App 不受影響。
