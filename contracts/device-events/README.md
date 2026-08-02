# PeeCare 裝置事件契約 v1

語言無關的 MQTT Topic 與 JSON Schema 契約，定義 PeeCare 裝置發布**排尿事件**與**電量事件**時必須遵守的格式、識別、重送與時間語義。韌體、EMQX、Cloud Run ingestion 與 Web 團隊以同一組可執行 fixture 平行開發與驗收。

本套件本身只定義契約與驗證工具，**不**實作 EMQX Webhook、Firestore 寫入、尿量校正公式或任何 UI。為了讓韌體端能在同一份文件中看見「送出去之後會發生什麼」，本文件在契約章節之後另附下游的 ingestion HTTP 端點與 Firestore 資料模型總覽（見〈下游行為〉），該部分為現況描述，正式定義仍以各自原始碼與 `openspec/specs/` 為準。

## 資料流

```text
裝置 (韌體)
   │  發布 MQTT 訊息到 canonical topic
   ▼
EMQX Broker
   │  Webhook 轉發 (HTTP POST)
   ▼
ingestion-api (Cloud Run, Fastify)
   │  驗證 envelope + schema，計算 effectiveAtMs，冪等去重
   ▼
Firestore  (devices / events / dailyStats)
   ▲
   │  Owner-only 唯讀 (Security Rules)
Web client
```

## 快速開始

```bash
cd contracts/device-events
npm ci
npm test
```

`npm test` 會先執行驗證工具的單元測試，再以 AJV 2020 strict mode 載入三個 schema，並遞迴發現及驗證 `fixtures/` 下的所有 JSON 正例、重送、反例與時間來源案例。全部通過時輸出通過數量並以狀態碼 `0` 結束；任何案例不符預期時，將 fixture 名稱、穩定錯誤碼與驗證摘要寫入標準錯誤並以非零狀態碼結束。

## 正式 Topic（Canonical event topics）

版本 1 只使用兩個 Topic（定義於 `lib/topic.mjs`）：

| Topic | 事件類型 | Schema |
| --- | --- | --- |
| `products/{productModel}/devices/{deviceId}/events/urination` | 排尿事件 | `schemas/urination-event.v1.schema.json` |
| `products/{productModel}/devices/{deviceId}/status/battery` | 電量事件 | `schemas/battery-event.v1.schema.json` |

- `productModel` 與 `deviceId` 每個 segment 必須符合 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`（ASCII 英數起頭，其後可含底線與連字號，長度 1–64），不得包含空白、斜線或 MQTT 萬用字元（`+`、`#`）。
- Payload 內必須再次包含 `deviceId`，且必須與 Topic 的 `deviceId` segment 完全相同。
- Topic **不**含 `v1` segment；相容性由 Payload 的 `schemaVersion` 管理，避免每次 schema 演進都重建 Broker ACL。
- `peecare/device/1/status` 等舊版原型 Topic 不再是正式契約。

Topic 解析錯誤碼：

| 錯誤碼 | 意義 |
| --- | --- |
| `unsupported_topic` | Topic 結構不符任何版本 1 正式模板 |
| `topic_format` | 結構相符，但 `productModel`／`deviceId` segment 違反字元或長度規則 |

## 完整 Payload 範例

### 排尿事件（Urination event payload）

Topic：`products/pc-mini/devices/PC-000001/events/urination`

```json
{
  "schemaVersion": 1,
  "eventId": "PC-000001:000007:42",
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
  "eventId": "PC-000001:000007:43",
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
| `eventId` | 字串，符合 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`；為重送冪等識別，字元集合限制確保可安全作為 Firestore Document ID。組成規則見下節 |
| `eventType` | 字串，`urination` 或 `battery` |
| `deviceId` | 字串，符合 Topic segment 格式 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` |
| `sequence` | 整數 0–4294967295；用於排序與漏訊診斷，**不**作為去重鍵 |
| `recordedAtMs` | 非負整數（UTC Unix epoch 毫秒）或 `null` |
| `firmwareVersion` | 字串，Semantic Versioning 核心版本，可含 pre-release／build metadata |

Schema 以 `unevaluatedProperties: false` 拒絕任何未宣告欄位，並以 AJV strict mode 拒絕 JSON 型別轉換：字串 `"3000"` 不會被當作整數 `3000`。

## eventId 組成規則（Event identity construction）

`eventId` 直接作為 Firestore Document ID（`devices/{deviceId}/events/{eventId}`），而排尿與電量事件**共用同一個 collection**。因此 eventId 的唯一性要求比「同一次開機內不重複」嚴格得多。

### 唯一性要求

- eventId 必須在**裝置的整個生命週期**內唯一 —— 跨電源循環、跨韌體更新、跨計數器循環皆不得重複。
- 唯一性範圍涵蓋**兩種事件類型**。排尿與電量事件不得產生相同的 eventId，Topic 不同並不能區分它們。
- 重送同一事件時 eventId 逐字元不變（見下節）。

### 禁止：`{deviceId}:{sequence}`

`deviceId` 燒錄於韌體、`sequence` 在重新開機後歸零，兩者組合會與先前事件的 eventId 碰撞。碰撞的後果是**靜默資料遺失**，且兩種結果都是零寫入：

| 情況 | ingestion 回應 | 後果 |
| --- | --- | --- |
| eventId 相同、payload 有差異 | `409 event_id_conflict` | 事件永久遺失。從重開機到 `sequence` 爬回先前最高水位為止，每一筆都會撞 |
| eventId 相同、payload 逐欄位相同 | `200 duplicate` | 更嚴重：裝置收到成功回應，後端零寫入，事件無聲蒸發。無時鐘裝置送 `recordedAtMs: null` 且流程時間量化重複時就會發生 |

### 建議組法：`{deviceId}:{bootId}:{sequence}`

```text
PC-000001:000007:42
└─ deviceId ┘└bootId┘└seq┘
```

- `bootId` 為存放於非揮發性儲存（NVS／flash）的開機計數器，**每次開機遞增並寫回一次**，而非每筆事件寫一次 —— flash 寫入次數與開機次數同階，不與事件量同階。
- `sequence` 維持在同一 boot session 內遞增，`sequence` 的漏訊診斷能力完整保留：同一 `bootId` 內看到 41、42、45 就知道 43、44 掉了。
- 建議 `bootId` 以固定寬度零填充（例如 6 位 `000007`），使 eventId 的字典序與時間順序一致。ingestion 在 `effectiveAtMs` 與 `receivedAtMs` 相同時會以 eventId 作為排序 tie-breaker。
- 長度安全：`deviceId`（≤64）+ `:` + `bootId`（≤10）+ `:` + `sequence`（≤10）≤ 86 字元，未超過 128 上限。

### 替代組法

- **隨機識別**：`{deviceId}:{128-bit 隨機值的 hex 或 base32}`。不需 NVS，碰撞機率可忽略。代價是重送時必須在 RAM 中保留原 eventId 與完整 payload，且 eventId 失去可讀性與排序意義。
- **不可採用以 `recordedAtMs` 為基礎的組法**。契約允許 `recordedAtMs` 為 `null`（時鐘未同步），因此不能假設事件產生時一定有可信時間。

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

---

# 下游行為（Downstream behaviour）

以下為契約下游的現況描述，供韌體端理解事件送出後的處理與儲存結果。此部分**不屬於**本套件的契約表面，正式定義以各自原始碼與 `openspec/specs/` 為準。

## EMQX Webhook 接收端點（ingestion-api HTTP）

定義於 `services/ingestion-api/src/app.ts`（Fastify，bodyLimit 64 KB）。

| Method + Path | 用途 | 主要回應 |
| --- | --- | --- |
| `GET /healthz` | 健康檢查 | `200 { status: "ok" }` |
| `POST /v1/emqx/events` | 接收 EMQX 轉發的裝置事件 | `201 stored` / `202 accepted` / `200 duplicate`；錯誤見下 |

`POST /v1/emqx/events` 規則：

- 只接受 `Content-Type: application/json`（否則 `415`）。
- 需 `Authorization` 驗證，支援 current／previous secret 輪替（`security/webhook-auth.ts`，否則 `401`）。
- Body 為 EMQX envelope（`contracts/emqx-webhook-envelope.ts`），欄位固定且不多不少：

| 欄位 | 規則 |
| --- | --- |
| `topic` | 字串 |
| `clientId` | 字串，長度 1–128 |
| `username` | 字串，長度 1–128 |
| `qos` | `0`／`1`／`2` |
| `retained` | 必須為 `false`（`true` → `422 retained_event`） |
| `brokerReceivedAtMs` | 非負 safe integer |
| `payload` | 物件（後續交由 schema 驗證） |

回應狀態碼對照：

| 狀態碼 | 情境 |
| --- | --- |
| `201` | `stored`（首次成功寫入） |
| `202` | `accepted` |
| `200` | `duplicate`（相同 `eventId` 且 `canonicalHash` 一致） |
| `400` | `invalid_envelope` / `malformed_json` |
| `401` | `unauthorized` |
| `403` | `device_disabled` |
| `405` | 對 `/v1/emqx/events` 使用非 POST |
| `409` | `event_id_conflict`（相同 `eventId` 但 payload 不同） |
| `413` | `body_too_large` |
| `415` | `unsupported_media_type` |
| `422` | `retained_event` / schema 驗證失敗 / `unknown_device` / `product_model_mismatch` |
| `503` | `persistence_unavailable` / `sink_unavailable` / `temporarily_unavailable` |
| `500` | `aggregation_integrity_error` / `internal_error` |

## Firestore 資料模型

集合結構以 `devices/{deviceId}` 為根，底下有 `events` 與 `dailyStats` 兩個子集合。寫入由 Admin SDK 在單一 transaction 中完成（`firestore/firestore-event-sink.ts`），並以 `eventId` 為 document id 進行冪等去重；client 端依 `firestore.rules` 僅限 owner 唯讀（所有 client 寫入一律拒絕）。

### `devices/{deviceId}` — 裝置註冊 + 最新狀態投影

ingestion 讀取校驗欄位（`ownerUid`、`ingestionStatus`、`productModel`、`deviceId`），並 `update` 下列投影欄位（僅在新事件比目前最新更晚時更新）。

> `deviceId`、`productModel`、`ownerUid`、`ingestionStatus` 由裝置佈建流程建立，ingestion 只讀取校驗，不新建裝置文件。

校驗與門檻：

| 條件 | 結果 |
| --- | --- |
| 裝置文件不存在或 `deviceId` 不符 | `unknown_device`（422） |
| `ingestionStatus !== 'enabled'` | `device_disabled`（403） |
| `productModel` 不符 | `product_model_mismatch`（422） |

投影欄位：

| 欄位 | 說明 |
| --- | --- |
| `lastReportedAtMs` | 任一事件都更新，取 `max(現值, receivedAtMs)` |
| `latestUrinationEventId` | 最新排尿事件 id |
| `latestUrinationAtMs` | 最新排尿 `effectiveAtMs` |
| `latestUrinationReceivedAtMs` | 最新排尿 `receivedAtMs` |
| `latestUrinationFirmwareVersion` | 最新排尿韌體版本 |
| `latestBatteryEventId` | 最新電量事件 id |
| `latestBatteryLevelPercent` | 最新電量百分比 |
| `latestBatteryAtMs` | 最新電量 `effectiveAtMs` |
| `latestBatteryReceivedAtMs` | 最新電量 `receivedAtMs` |
| `latestBatteryFirmwareVersion` | 最新電量韌體版本 |
| `latestBatteryVoltageMv` | 最新電壓；缺值時以 `FieldValue.delete()` 移除 |

最新性以三元組 `[effectiveAtMs, receivedAtMs, eventId]` 字典序比較，避免亂序處理將 metadata 倒退。

### `devices/{deviceId}/events/{eventId}` — 事件明細

以 `eventId` 為 document id。若已存在且 `canonicalHash` 相同 → `duplicate`；不同 → `event_id_conflict`。

排尿事件 record（`persistence/urination-event-record.ts`）：

| 欄位 | 值／來源 |
| --- | --- |
| `eventId` | payload |
| `eventType` | `'urination'` |
| `deviceId` | 事件 |
| `productModel` | 事件 |
| `schemaVersion` | payload |
| `sequence` | payload |
| `recordedAtMs` | payload（為數字時才寫入） |
| `brokerReceivedAtMs` | envelope |
| `receivedAtMs` | 伺服器接收時間 |
| `effectiveAtMs` | 依時間來源規則計算 |
| `timeSource` | `'device'` / `'server'` |
| `firmwareVersion` | payload |
| `flushDurationMs` | payload |
| `pumpDurationMs` | payload |
| `estimatedUrineMl` | `null`（尚未校正） |
| `estimationStatus` | `'pending_calibration'` |
| `canonicalHash` | 去重雜湊 |
| `createdAtMs` | `receivedAtMs` |
| `transport` | `{ topic, clientId, username, qos }` |

電量事件 record（`persistence/battery-event-record.ts`）：

| 欄位 | 值／來源 |
| --- | --- |
| `eventId` | payload |
| `eventType` | `'battery'` |
| `deviceId` | 事件 |
| `productModel` | 事件 |
| `schemaVersion` | payload |
| `sequence` | payload |
| `recordedAtMs` | payload（為數字時才寫入） |
| `brokerReceivedAtMs` | envelope |
| `receivedAtMs` | 伺服器接收時間 |
| `effectiveAtMs` | 依時間來源規則計算 |
| `timeSource` | `'device'` / `'server'` |
| `firmwareVersion` | payload |
| `batteryLevelPercent` | payload |
| `batteryVoltageMv` | payload（為數字時才寫入） |
| `canonicalHash` | 去重雜湊 |
| `createdAtMs` | `receivedAtMs` |
| `transport` | `{ topic, clientId, username, qos }` |

`canonicalHash` 的輸入恰為 `{ topic, clientId, payload }`，刻意排除 `username`、`qos`、`retained`、`brokerReceivedAtMs`、`receivedAtMs`、`effectiveAtMs` 與 `timeSource`，避免同一事件因傳輸或接收時間不同而失去冪等性。

### `devices/{deviceId}/dailyStats/{dayKey}` — 每日排尿彙總

`DailyUrinationRecord`（`aggregation/daily-urination-record.ts`）。`dayKey` 以 `Asia/Taipei` 日界計算，**僅排尿事件**在同一 transaction 內遞增；寫入前以 `assertValidDailyDocument` 做 fail-closed 校驗。

| 欄位 | 型別／值 |
| --- | --- |
| `date` | 字串 `dayKey`（Asia/Taipei 當地日期） |
| `timeZone` | `'Asia/Taipei'` |
| `urinationCount` | 整數，首筆為 `1`，之後 +1（溢位丟 `AggregationIntegrityError`） |
| `volumeStatus` | `'pending_calibration'` |
| `estimatedUrineTotalMl` | `null` |
| `estimatedUrineAverageMl` | `null` |
| `estimatedUrineMinMl` | `null` |
| `estimatedUrineMaxMl` | `null` |
| `lastEventAtMs` | `max(現值, effectiveAtMs)` |
| `updatedAtMs` | `max(現值, receivedAtMs)` |

## 備註

- 所有尿量欄位（event 的 `estimatedUrineMl`、daily 的四個 `estimatedUrine*Ml`）目前固定為 `null` 並標記 `pending_calibration`，因為校正公式尚未實作 —— 刻意讓讀取端能區分「尚未校正」與「數值為 0」。
- 事件寫入、裝置投影更新、每日彙總遞增皆在**同一個 Firestore transaction** 中完成，確保去重與計數一致性。

## 對應原始碼

| 主題 | 檔案 |
| --- | --- |
| Topic 解析與規則 | `contracts/device-events/lib/topic.mjs` |
| JSON Schema | `contracts/device-events/schemas/*.v1.schema.json` |
| 時間來源規則 | `contracts/device-events/lib/effective-time.mjs` |
| HTTP 端點 | `services/ingestion-api/src/app.ts` |
| EMQX envelope 驗證 | `services/ingestion-api/src/contracts/emqx-webhook-envelope.ts` |
| Webhook 驗證（secret 輪替） | `services/ingestion-api/src/security/webhook-auth.ts` |
| Firestore 寫入 transaction | `services/ingestion-api/src/firestore/firestore-event-sink.ts` |
| 排尿事件 record | `services/ingestion-api/src/persistence/urination-event-record.ts` |
| 電量事件 record | `services/ingestion-api/src/persistence/battery-event-record.ts` |
| 每日彙總 record | `services/ingestion-api/src/aggregation/daily-urination-record.ts` |
| Security Rules | `firestore.rules` |
