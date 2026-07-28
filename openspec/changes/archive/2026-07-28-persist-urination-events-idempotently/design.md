## Context

`validate-emqx-webhook-events` 會把通過 Bearer、Envelope、Topic 與 device payload 驗證的資料交給單一 `EventSink`。本 change 實作第一個 durable sink：只處理 `urination`，使用 Firestore 的 server SDK 與 transaction，在 MQTT/EMQX 至少一次投遞語意下保證同一 eventId 不會重複寫入或覆蓋。

裝置由測試資料或管理流程預先建立於 `devices/{deviceId}`；一位會員可擁有多台裝置，但每台裝置現階段只有一位 Owner。Owner 關聯不參與本 change 的 ingestion 授權，事件接收資格只由裝置登錄狀態與產品型號決定。

## Goals / Non-Goals

**Goals:**

- 僅讓已登錄、`ingestionStatus: enabled` 且產品型號相符的裝置保存事件。
- 以 deterministic identity 與 Firestore transaction 區分首次寫入、相同重送與 eventId 衝突。
- 保存不可變排尿事件與可單調前進的最新排尿投影。
- 讓本機 Firestore Emulator 能重現裝置 fixtures、交易與失敗案例。

**Non-Goals:**

- 不實作裝置 Claim、Owner 轉移或多 Owner 權限。
- 不計算每日排尿次數；該責任由 `aggregate-daily-urination-counts` change 承擔。
- 不推導尿量公式，所有尿量統計仍為 pending calibration。
- 不處理 battery、heartbeat、online 狀態、歷史資料回填或跨專案 migration。

## Decisions

### 使用 Firestore server SDK 與 Emulator 相同程式路徑

service 使用 Google Cloud Firestore server SDK；雲端依 Application Default Credentials 連線，本機在 `FIRESTORE_EMULATOR_HOST` 存在時連同一套 repository/sink 程式到 Emulator。相較於 client SDK，此選擇符合受信任後端與 transaction 需求，也不讓 ingestion 依賴瀏覽器 Firestore Rules。

### 先以裝置登錄資料建立 ingestion gate

transaction 先讀 `devices/{deviceId}`，要求 document 存在、document `deviceId` 與 path 一致、`ingestionStatus` 恰為 `enabled`，且 `productModel` 等於 payload。不存在回報 `unknown_device`，停用回報 `device_disabled`，型號不符回報 `product_model_mismatch`。Owner 欄位只保留給其他授權流程，不影響 webhook 驗證。

### 使用 stable JSON SHA-256 建立 canonical identity

`canonicalHash` 是 UTF-8 stable JSON 的 SHA-256 hex digest，輸入恰為 `{ topic, clientId, payload }`，object keys 遞迴依 Unicode code point 排序且 arrays 保持原順序。輸入刻意排除 `username`、`qos`、`retained`、`brokerReceivedAtMs`、server `receivedAtMs`、`effectiveAtMs` 與 `timeSource`，避免同一 device payload 因傳輸或接收時間不同而失去冪等性。相較於只 hash payload，此設計也固定發布 Topic 與 client identity。

### 在單一 transaction 內分類並寫入不可變事件

transaction 在所有 writes 前依序讀 device document 與 `devices/{deviceId}/events/{eventId}`。若 event document 不存在，建立事件並更新裝置投影；若存在且 `canonicalHash` 相同，回報 duplicate 且零 writes；若存在但 hash 不同，回報 event_id_conflict 且零 writes。Firestore transaction 的自動 retry 負責 concurrent 首次投遞，event document 不允許 update 或 overwrite。

### 保存原始排尿量測與 pending calibration

事件 document 保存 contract 與 transport audit 欄位、三種時間、raw `flushDurationMs`/`pumpDurationMs`，並固定 `estimatedUrineMl: null`、`estimationStatus: pending_calibration`。`createdAtMs` 使用首次 transaction 的 server-side received time；duplicate 不更動原 document。

### 以排序 tuple 維護最新排尿投影

新事件一律保存，但只有當 `(effectiveAtMs, receivedAtMs, eventId)` lexicographically 大於裝置目前的排尿 projection tuple 時，才更新 `latestUrinationEventId`、`latestUrinationAtMs`、`latestUrinationReceivedAtMs`、`latestUrinationFirmwareVersion`。`lastReportedAtMs` 則取目前值與新事件 `receivedAtMs` 的最大值。此規則讓 late event 可保存但不倒退首頁摘要，且同毫秒事件仍有 deterministic tie-break。

### 將 domain outcomes 映射為穩定 HTTP 結果

`FirestoreEventSink` 對首次寫入回傳 `stored`，相同重送回傳 `duplicate`，eventId 衝突回傳 `event_id_conflict`，裝置 gate 回傳其明確 rejection code；Firestore unavailable、deadline、aborted retries exhausted 等暫時性錯誤統一回傳 unavailable。route 分別映射為 `201`、`200`、`409`、`422`/`403` 與 `503`，且不暴露 SDK error 或 document 內容。

## Implementation Contract

**Behavior:** 合法且具接收資格的首次排尿事件回覆 `201` 並產生一筆 immutable Firestore event；相同 Topic、clientId、payload 的 eventId 重送回覆 `200` 且完全不改寫；相同 eventId 搭配不同 canonical input 回覆 `409`。未登錄、停用、型號不符與 Firestore 暫時失敗都不建立事件。

**Interfaces and data shape:**

- Registry document `devices/{deviceId}` 至少包含 `deviceId: string`、`productModel: string`、`ingestionStatus: "enabled" | "disabled"`。
- Urination event document `devices/{deviceId}/events/{eventId}` 包含 `eventId`、`eventType: "urination"`、`deviceId`、`productModel`、`schemaVersion`、`sequence`、`recordedAtMs`（可省略）、`brokerReceivedAtMs`、`receivedAtMs`、`effectiveAtMs`、`timeSource`、`firmwareVersion`、`flushDurationMs`、`pumpDurationMs`、`estimatedUrineMl: null`、`estimationStatus: "pending_calibration"`、`canonicalHash`、`createdAtMs`，以及 `transport` object 的 `topic`、`clientId`、`username`、`qos`。
- Sink outcomes 為 `stored`、`duplicate`、`event_id_conflict`、`unknown_device`、`device_disabled`、`product_model_mismatch`、`unavailable`；route response 仍使用 validation change 定義的安全 JSON error shape。

**Failure modes:** rejected/conflict/duplicate 均為 domain result，不丟出含資料的 raw SDK error；非暫時性 programmer/configuration errors 可由 service error boundary 記錄 sanitized metadata 並回覆 `500 internal_error`。transaction 在 commit 前失敗不得留下 event 或 projection 的部分寫入。

**Acceptance criteria:** unit tests 固定 canonical hash 與 projection ordering；Emulator integration tests 覆蓋首次寫入、相同重送、衝突、三種 device gate、concurrent duplicate、late event 與暫時性失敗映射；`npm run check` 全部通過。

**Scope boundaries:** in scope 是排尿事件的 device gate、identity、event document、最新排尿 projection 與 HTTP outcome；out of scope 是 dailyStats、battery projection、Owner/Claim、尿量公式與 production infrastructure provisioning。

## Risks / Trade-offs

- [Risk] stable serialization 實作差異會造成相同 payload hash 不一致 → 使用單一 canonicalizer、固定 test vectors 與 SHA-256 golden values。
- [Risk] transaction contention 可能增加 latency → 每次只讀寫單一 device/event，依 SDK retry；壓力測試與 production tuning 留在實際流量可觀測後。
- [Risk] projection tie-break 與業務認知不同 → 將 tuple 規則寫入 spec 並以同毫秒、late event 測試鎖定。
- [Risk] server SDK 可繞過 Firestore Rules → service identity 採最小 IAM 權限，且 ingestion gate 必須在 transaction 內執行。

## Migration Plan

1. 先部署含 Firestore 連線但仍可用 unavailable sink 的 service，確認設定與健康檢查。
2. 用管理流程或 test fixtures 建立 enabled device documents。
3. 啟用 `FirestoreEventSink`，以測試 event 驗證 `201`、duplicate `200` 與 Firestore document。
4. 若需 rollback，切回 unavailable sink 或上一版 service；既有 immutable event documents 保留，不做 destructive migration。

## Open Questions

None for this change；每日統計與 battery 行為由後續 changes 的 artifacts 定義。
