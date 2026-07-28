# PeeCare 裝置事件契約 v1

語言無關的 MQTT Topic 與 JSON Schema 契約，定義 PeeCare 裝置發布**排尿事件**與**電量事件**時必須遵守的格式、識別、重送與時間語義。韌體、EMQX、Cloud Run ingestion 與 Web 團隊以同一組可執行 fixture 平行開發與驗收。

本套件只定義契約與驗證工具，**不**實作 EMQX Webhook、Firestore 寫入、尿量校正公式或任何 UI。

## 快速開始

```bash
cd contracts/device-events
npm ci
npm test
```

`npm test` 會先執行驗證工具的單元測試，再以 AJV 2020 strict mode 載入三個 schema，並遞迴發現及驗證 `fixtures/` 下的所有 JSON 正例、重送、反例與時間來源案例。全部通過時輸出通過數量並以狀態碼 `0` 結束；任何案例不符預期時，將 fixture 名稱、穩定錯誤碼與驗證摘要寫入標準錯誤並以非零狀態碼結束。

## 正式 Topic（Canonical event topics）

版本 1 只使用兩個 Topic：

```text
products/{productModel}/devices/{deviceId}/events/urination
products/{productModel}/devices/{deviceId}/status/battery
```

- `productModel` 與 `deviceId` 每個 segment 必須符合 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`（ASCII 英數起頭，其後可含底線與連字號，長度 1–64），不得包含空白、斜線或 MQTT 萬用字元（`+`、`#`）。
- Payload 內必須再次包含 `deviceId`，且必須與 Topic 的 `deviceId` segment 完全相同。
- Topic **不**含 `v1` segment；相容性由 Payload 的 `schemaVersion` 管理，避免每次 schema 演進都重建 Broker ACL。
- `peecare/device/1/status` 等舊版原型 Topic 不再是正式契約。

## 完整 Payload 範例

### 排尿事件（Urination event payload）

Topic：`products/pc-mini/devices/PC-000001/events/urination`

```json
{
  "schemaVersion": 1,
  "eventId": "PC-000001:42",
  "eventType": "urination",
  "deviceId": "PC-000001",
  "sequence": 42,
  "recordedAtMs": 1785168000000,
  "firmwareVersion": "1.2.0",
  "flushDurationMs": 3000,
  "pumpDurationMs": 5000
}
```

- `flushDurationMs`、`pumpDurationMs`：0–4294967295 的整數，單位為毫秒；上限對應無號 32 位元傳輸邊界，各型號的實際合理範圍由後續 ingestion 驗證。
- 只傳送原始流程時間，**不得**包含 `estimatedUrineMl`、每日次數或其他衍生尿量；尿量由後端依校正版本計算。

### 電量事件（Battery event payload）

Topic：`products/pc-mini/devices/PC-000001/status/battery`

```json
{
  "schemaVersion": 1,
  "eventId": "PC-000001:43",
  "eventType": "battery",
  "deviceId": "PC-000001",
  "sequence": 43,
  "recordedAtMs": 1785168000000,
  "firmwareVersion": "1.2.0",
  "batteryLevelPercent": 75,
  "batteryVoltageMv": 3975
}
```

- `batteryLevelPercent`：只接受 `0`、`25`、`50`、`75`、`100`。
- `batteryVoltageMv`：選填，存在時為 0–20000 的整數。硬體未提供原始電壓時**省略**此欄位，不得以 `null` 或 `0` 表示未知。

## 共用欄位（Strict common event envelope）

每個版本 1 事件都必須包含下列共用欄位（`schemas/common-event.v1.schema.json`）：

| 欄位 | 型別與規則 |
| --- | --- |
| `schemaVersion` | 整數，固定為 `1` |
| `eventId` | 字串，符合 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`；為重送冪等識別，字元集合限制確保可安全作為 Firestore Document ID |
| `eventType` | 字串，`urination` 或 `battery` |
| `deviceId` | 字串，符合 Topic segment 格式 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` |
| `sequence` | 整數 0–4294967295；用於排序與漏訊診斷，**不**作為去重鍵 |
| `recordedAtMs` | 非負整數（UTC Unix epoch 毫秒）或 `null` |
| `firmwareVersion` | 字串，Semantic Versioning 核心版本，可含 pre-release／build metadata |

Schema 以 `unevaluatedProperties: false` 拒絕任何未宣告欄位，並以 AJV strict mode 拒絕 JSON 型別轉換：字串 `"3000"` 不會被當作整數 `3000`。

## eventId 與重送規則（Stable retry identity）

- `eventId` 是跨重送的**冪等識別**。裝置重送同一事件時，必須重用相同的 Topic、`eventId` 與完整 Payload，**逐欄位不變**。
- `sequence` 僅用於排序、漏訊診斷與韌體觀測。重新開機或計數器循環後，兩個不同事件即使 `sequence` 相同，只要 `eventId` 不同即視為**不同事件**；`sequence` 永不取代 `eventId` 作為去重鍵。
- 驗證器會逐欄位比較重送 fixture 的 `original` 與 `retry`；任一 Topic 或 Payload 欄位改變即以 `retry_mismatch` 拒絕。

## recordedAtMs 與混合時間來源（Mixed event time source）

- 裝置時鐘已同步 UTC 時才可傳送整數 `recordedAtMs`；沒有可信時間時**必須**傳送 `null`，不可填入開機後經過時間或預設 epoch。
- 後續 ingestion 取得自身 `receivedAtMs` 後，依下列規則產生 `effectiveAtMs` 與 `timeSource`（見 `lib/effective-time.mjs`）：
  1. `recordedAtMs` 為整數、不早於 `1767225600000`（2026-01-01T00:00:00Z）、且不晚於 `receivedAtMs + 300000`（5 分鐘容忍）時，`effectiveAtMs = recordedAtMs`，`timeSource = "device"`。
  2. 否則（`null`、早於下限或超過未來容忍）`effectiveAtMs = receivedAtMs`，`timeSource = "server"`。
  3. 原始 `recordedAtMs` 永久保留，時間回退不覆寫裝置提供值。

## 錯誤碼

驗證器與 fixture runner 提供七個穩定錯誤碼（`lib/error-codes.mjs`），為契約表面的一部分：

| 錯誤碼 | 意義 |
| --- | --- |
| `unsupported_topic` | Topic 結構不符任何版本 1 正式模板（例如舊版 `peecare/device/1/status`） |
| `topic_format` | Topic 結構相符，但 `productModel`／`deviceId` segment 違反字元或長度規則 |
| `device_mismatch` | Topic 的 `deviceId` 與 Payload 的 `deviceId` 不一致 |
| `schema_validation` | Payload 未通過對應 JSON Schema（未知欄位、錯誤 `schemaVersion`、型別轉換、非法電量級距、無效 `eventId`／`recordedAtMs` 等） |
| `retry_mismatch` | 重送的 Topic 或 Payload 與原始事件不同 |
| `fixture_format` | fixture JSON 無法解析、位於未知群組、缺少必要成員，或 manifest 成員型別／expectation 不合法 |
| `fixture_expectation` | fixture 的實際結果與 manifest 預期不一致，例如反例意外通過或時間來源輸出不符 |

驗證器只將 fixture 名稱、錯誤碼與 AJV 摘要寫到標準錯誤，不輸出憑證或其他秘密。

## Fixture 使用方式（Executable contract fixtures）

```text
fixtures/
├── valid/
│   ├── urination-event*.json           # 排尿正例與共用／duration 邊界
│   ├── battery-event*.json             # 電量正例、選填電壓與邊界
│   └── urination-event-retry.v1.json   # 相同重送 { original, retry }，應被接受
├── invalid/
│   └── *-cases.v1.json                 # 反例陣列 [{ name, input, expectedError }]
├── retry/
│   └── retry-cases.v1.json             # 重送案例 [{ name, original, retry, expected }]
└── time-source/
    └── time-cases.v1.json              # 時間來源案例 [{ name, recordedAtMs, receivedAtMs, expected }]
```

- **正例 envelope**：`{ topic, payload }`，必須通過路由與 schema 驗證且 `deviceId` 一致。
- **重送 fixture**：`{ original, retry }`，兩次 delivery 必須逐欄位相同。
- **反例 manifest**：每個案例含非空 `name`、`input`（一個 envelope）與 `expectedError`（上表錯誤碼），驗證器確認每案以指定錯誤碼被拒；七個契約必要反例另以 `covers` 標記 `unknown_property`、`unsupported_schema_version`、`device_mismatch`、`string_duration`、`invalid_battery_tier`、`invalid_event_id`、`invalid_recorded_time`。
- **重送案例 manifest**：每個案例含非空 `name`、`expected` 及 delivery；`expected` 只接受 `retry_mismatch`、`distinct`、`fixture_format`。
- **時間來源案例**：每案需有非空 `name`，以整數或 `null` 的 `recordedAtMs`、整數 `receivedAtMs` 輸入，比對完整 `expected` 的 `effectiveAtMs`、`timeSource` 與保留的 `recordedAtMs`。
- **自動發現**：四個已知群組下的所有 `.json` 都會被載入；未知群組中的 JSON 會以 `fixture_format` 失敗，新增 fixture 不會被靜默忽略。
- **最低覆蓋**：套件至少要有有效排尿、有效電量、相同重送、具名反例及上述七個 `covers` ID；移除或誤放任一必要類別／案例會讓測試失敗，不會出現 `PASS all 0`。

其他語言（例如 Arduino 韌體）可直接重用這些 JSON fixture 建立自身序列化測試，確保與本契約一致。JSON Schema 檔案位於 `schemas/`，可供任何支援 Draft 2020-12 的驗證器載入。
