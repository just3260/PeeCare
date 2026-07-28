## Why

目前 PWA 使用單一舊版 Topic 與未版本化 Payload，且畫面直接相信裝置傳來的累計次數與尿量，無法作為 Cloud Run ingestion、事件去重或實機相容性驗收的穩定邊界。先建立語言無關、可自動驗證的裝置事件契約，能讓韌體、EMQX、後端與 Web 團隊以同一組 fixture 平行開發。

## What Changes

- 定義版本 1 的排尿事件與電量事件 JSON Schema，以及對應的 MQTT Topic 模板。
- 定義共用事件識別、裝置識別、遞增序號、韌體版本與裝置時間欄位的型別和語義。
- 規定同一事件重送時必須維持相同的 eventId，sequence 僅用於排序與漏訊診斷，不取代 eventId 去重。
- 將沖水與抽水時間明確定義為毫秒，並將電量級距限制為 0、25、50、75、100。
- 允許裝置無可信時鐘時傳送空的 recordedAtMs，讓後續 ingestion 使用伺服器接收時間。
- 提供有效、無效及重送案例的固定 fixture，以及可重複執行的契約驗證命令。
- **BREAKING**：後續實機與雲端整合將採用新 Topic 與版本化 Payload，不再以 peecare/device/1/status 與 wet、count、urineToday 作為正式契約。

## Capabilities

### New Capabilities

- `device-event-contract`: 定義 PeeCare 裝置發布排尿與電量事件時必須遵守的 Topic、Payload、重送及 fixture 驗證契約。

### Modified Capabilities

（無）

## Impact

- Affected specs: device-event-contract
- Affected code:
  - New:
    - contracts/device-events/README.md
    - contracts/device-events/package.json
    - contracts/device-events/schemas/common-event.v1.schema.json
    - contracts/device-events/schemas/urination-event.v1.schema.json
    - contracts/device-events/schemas/battery-event.v1.schema.json
    - contracts/device-events/fixtures/valid/urination-event.v1.json
    - contracts/device-events/fixtures/valid/battery-event.v1.json
    - contracts/device-events/fixtures/valid/urination-event-retry.v1.json
    - contracts/device-events/fixtures/invalid/device-event-cases.v1.json
    - contracts/device-events/scripts/validate-fixtures.mjs
  - Modified: none
  - Removed: none
- Affected systems: device firmware MQTT publishing, EMQX topic routing, Cloud Run ingestion validation, Firestore event persistence, and Web fixture-driven development.
