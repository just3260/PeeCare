## Why

Arduino 開發韌體目前只會發布舊版 `peecare/device/1/status` 狀態訊息，無法通過既有 canonical topic、payload 與 publisher identity 驗證，導致實機到 EMQX、Cloud Run 與 Firestore 的整條 development 線路無法先行驗收。實際 development EMQX 驗收已確認同一筆 legacy status 需要由兩條獨立 rule/action 分別轉成 ingestion 可接受的 urination 與 battery event，因此 repository artifacts 必須對齊這個已部署拓撲。

## What Changes

- 新增 opt-in、development-only 的 legacy status compatibility capability，在同一個已核准 HTTPS connector 下使用兩條精確匹配 `peecare/device/1/status` 的獨立 EMQX rules 與兩個 HTTP actions，分別輸出 urination 與 battery event。
- Urination rule 只接受核准的 legacy MQTT clientId／username、`retained=false`、`online=true`，且 `pumpSecondsToday` 是可轉成 uint32 毫秒的非負數值；Battery rule 則只接受 JSON object 中數字型別且介於 0–20V 的 `batteryV`。
- 將實體 ESP32 裝置識別碼定義為保留前導零、無分隔符的 12 碼大寫十六進位字串；目前核准硬體的 `deviceId` 為 `68E274BD2A58`。合成測試裝置仍可使用 `PC-DEV-######`，並由既有 `developmentTestTool` marker 識別，不以 ID 外觀作為可信來源證明。
- 固定輸出 `pc-mini`／`68E274BD2A58` urination identity、`schemaVersion: 1`、`eventType: urination`、`sequence: 1`、`firmwareVersion: 1.0.0` 與 `flushDurationMs: 0`；以 Broker 收訊時間填入 `recordedAtMs`，以 `round(pumpSecondsToday * 1000)` 填入 `pumpDurationMs`，並為每次合格 delivery 產生帶 compatibility prefix 的 UUID eventId。
- 固定輸出 `pc-mini`／`68E274BD2A58` battery identity、`schemaVersion: 1`、`eventType: battery`、`sequence: 1`、`firmwareVersion: 1.0.0` 與 username `Peecare`；以 `round(batteryV * 1000)` 產生 `batteryVoltageMv`，以 7.0／7.5／8.0／8.5V 門檻映射 0／25／50／75／100 的 `batteryLevelPercent`，並使用 `compatbattery:68E274BD2A58:` UUID eventId prefix。
- 依 EMQX Serverless Dashboard live SQL Test 的實際 evaluation order，先建立 decoded payload alias，再以 `CASE` 保護數字乘法，確保缺值與非數字輸入成為零 result 而不是 `select_and_transform_error`；Dashboard Test UI 無法提供 retain flag，因此 retained boundary 改由實際 MQTT delivery 驗證。
- Urination rule 忽略 retained snapshot、離線訊息、缺漏／非法／超界 pump seconds，以及 legacy payload 的 `wet`、`state`、`count`、`batteryV`；Battery rule 忽略缺漏、非數字、負值或高於 20V 的 `batteryV`，且不把完整 legacy payload 複製至 canonical envelope。
- 更新 development EMQX template、sanitized Dashboard checklist、驗證程式、runbook 與 MQTT 串接文件，使 operator 可確認一個 connector 恰好對應兩條 legacy rules 與兩個 actions；自動 verifier 只將一筆 urination 與一筆 battery Firestore event 回報為 `paired_shape_observed`，來源是否為 approved Arduino 則由 operator 另行人工佐證。
- 明確降級 compatibility acceptance 語義：現有 Firestore event shape 無法提供受信任的 broker-side source provenance，因此工具不得宣稱已由程式證明 approved Arduino delivery，synthetic publisher 排除與 Arduino 來源確認皆屬人工驗收責任。
- 明確標記 compatibility 事件為測試資料：累計 `pumpSecondsToday` 會被當成單次 duration 並影響尿量與每日統計；legacy 重送會為兩個 event type 各自產生新的 UUID，無法維持 stable retry identity。

## Capabilities

### New Capabilities

- `development-legacy-status-compatibility`: 定義同一 legacy status 的雙 rule/action 分流、canonical urination 與 battery 映射、驗證、啟停與移除邊界。

### Modified Capabilities

- `development-emqx-webhook`: 將 development compatibility 拓撲對齊為一個 connector 下的兩條 legacy rules／actions，並把受控 legacy delivery 驗證改為同時驗證 urination 與 battery。
- `development-device-mqtt-identity`: 將實體硬體的 deviceId 對齊 ESP32 12 碼大寫十六進位識別碼，同時保留合成測試裝置的獨立 marker 邊界。

## Impact

- Affected specs: `development-legacy-status-compatibility`（新增）、`development-emqx-webhook`（修改）、`development-device-mqtt-identity`（修改）
- Affected code:
  - New: none
  - Modified: `devices/development/device-inventory.schema.json`, `devices/development/device-inventory.json`, `devices/development/device-configuration.mjs`, their focused tests and firmware configuration examples, `deploy/development/emqx-webhook.template.json`, `deploy/development/configure-emqx-webhook.mjs`, `deploy/development/configure-emqx-webhook.spec.ts`, `deploy/development/verify-emqx-webhook.mjs`, `deploy/development/verify-emqx-webhook.spec.ts`, `deploy/development/EMQX_RUNBOOK.md`, `docs/mqtt-server-integration.md`, `package.json`
  - Removed: none
- Prerequisite: `align-emqx-webhook-with-serverless` 完成，且 development connector、body credential wrapper 與 canonical delivery 已驗收。
- Runtime systems: development EMQX Serverless、development ingestion API、development Firestore 測試裝置資料；不影響 production。
