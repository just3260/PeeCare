## Why

裝置電量事件已納入共用 device event contract，但可信管線若只保存排尿事件，前端與營運流程無法取得裝置最後回報的離散電量。此 change 在既有冪等持久化邊界上加入 battery 分支，維持相同安全與交易保證。

## What Changes

- 讓 durable sink dispatch 已驗證的 `battery` event，重用裝置登錄 gate、canonical identity、duplicate 與 conflict 行為。
- 將 battery event 永久保存於 `devices/{deviceId}/events/{eventId}`，保留五段式電量與可省略的電壓值。
- 只在新事件排序 tuple 較新時更新裝置 latest battery projection，較舊事件仍保存但不倒退目前電量。
- 新的較新事件未提供 `batteryVoltageMv` 時，清除 latest projection 中先前的電壓，避免電壓與電量來自不同事件。
- 維持固定 stored、duplicate、conflict 與 persistence failure HTTP outcomes。

## Capabilities

### New Capabilities

- `battery-event-ingestion`: 定義 battery 事件的冪等保存、完整資料形狀與單調 latest battery projection。

### Modified Capabilities

(none)

## Impact

- Affected specs: `battery-event-ingestion`（新增）
- Affected code:
  - New:
    - `services/ingestion-api/src/persistence/battery-event-record.ts`
    - `services/ingestion-api/test/battery-event-ingestion.test.ts`
  - Modified:
    - `services/ingestion-api/src/firestore/firestore-event-sink.ts`
    - `services/ingestion-api/src/sinks/event-sink.ts`
    - `services/ingestion-api/test/urination-event-persistence.test.ts`
  - Removed: none
- Data model: 新增 battery event document 欄位與 device latest battery projection 欄位，不新增 collection。
- Prerequisites: `persist-urination-events-idempotently` 與既有 `device-event-contract`。
