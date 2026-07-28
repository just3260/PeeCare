## Why

可信事件管線必須先確認裝置有登錄且可接收資料，再以交易方式保存不可變事件；否則 MQTT QoS 重送可能造成重複紀錄，eventId 被重用也可能靜默覆蓋既有資料。

## What Changes

- 在 Firestore `devices/{deviceId}` 登錄資料上檢查裝置存在、`ingestionStatus` 與 `productModel`。
- 以 deterministic canonical hash 比對 Topic、clientId 與原始 device payload，區分新事件、相同重送與 eventId 衝突。
- 以 Firestore transaction 將新排尿事件寫入 `devices/{deviceId}/events/{eventId}`，並維護不會被較舊事件倒退的裝置最新排尿投影。
- 將排尿量衍生欄位保存為 `estimatedUrineMl: null` 與 `estimationStatus: pending_calibration`，保留原始毫秒數據。
- 對裝置拒絕、duplicate、conflict 與暫時性 Firestore 失敗提供穩定 sink outcomes，讓 webhook route 對應明確 HTTP 狀態。

## Capabilities

### New Capabilities

- `urination-event-persistence`: 定義已驗證排尿事件的裝置授權、交易式持久化、冪等判定、衝突處理與最新事件投影。

### Modified Capabilities

(none)

## Impact

- Affected specs: `urination-event-persistence`（新增）
- Affected code:
  - New:
    - `services/ingestion-api/src/firestore/firestore-client.ts`
    - `services/ingestion-api/src/firestore/device-registry.ts`
    - `services/ingestion-api/src/firestore/firestore-event-sink.ts`
    - `services/ingestion-api/src/persistence/canonical-event-hash.ts`
    - `services/ingestion-api/src/persistence/urination-event-record.ts`
    - `services/ingestion-api/test/urination-event-persistence.test.ts`
    - `firebase/local/fixtures/devices.ts`
  - Modified:
    - `services/ingestion-api/package.json`
    - `services/ingestion-api/src/app.ts`
    - `services/ingestion-api/src/config.ts`
    - `services/ingestion-api/src/sinks/event-sink.ts`
    - `package.json`
    - `package-lock.json`
  - Removed: none
- Runtime dependencies: Google Cloud Firestore server SDK；本機整合測試使用既有 Firestore Emulator。
- Prerequisites: `validate-emqx-webhook-events`、`bootstrap-local-firebase-platform` 與既有 `device-event-contract`。
