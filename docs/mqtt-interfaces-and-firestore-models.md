# PeeCare — MQTT 接口與 Firestore Model 總覽

本文件整理 PeeCare 專案目前**提供給裝置經由 MQTT 上報**的所有接口，以及**最終寫入 Firestore 的資料模型（Model）**。

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

契約（Topic + JSON Schema + fixtures）只定義格式與驗證，**不**實作 Webhook、Firestore 寫入或尿量校正；ingestion 服務負責實際持久化。

---

## 一、提供給 MQTT 的接口

### 1.1 Canonical MQTT Topics（v1）

版本 1 只使用兩個 Topic（定義於 `contracts/device-events/lib/topic.mjs`）：

| Topic | 事件類型 | Schema |
|---|---|---|
| `products/{productModel}/devices/{deviceId}/events/urination` | 排尿事件 | `schemas/urination-event.v1.schema.json` |
| `products/{productModel}/devices/{deviceId}/status/battery` | 電量事件 | `schemas/battery-event.v1.schema.json` |

**Topic 規則**

- `productModel` 與 `deviceId` 每個 segment 必須符合 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`（ASCII 英數起頭，可含底線、連字號，長度 1–64）。
- 不得包含空白、斜線或 MQTT 萬用字元（`+`、`#`）。
- Payload 內必須再次包含 `deviceId`，且需與 Topic 的 `deviceId` segment 完全相同（否則 `device_mismatch`）。
- Topic **不含** `v1` segment；相容性由 payload 的 `schemaVersion` 管理。
- 舊版原型 Topic（如 `peecare/device/1/status`）不再是正式契約。

**Topic 解析錯誤碼**

| 錯誤碼 | 意義 |
|---|---|
| `unsupported_topic` | Topic 結構不符任何 v1 正式模板 |
| `topic_format` | 結構相符，但 `productModel`／`deviceId` segment 違反字元或長度規則 |

### 1.2 共用 Payload 欄位（Common Event Envelope）

每個 v1 事件都必須包含下列共用欄位（`schemas/common-event.v1.schema.json`），以 `unevaluatedProperties: false` 與 AJV strict mode 拒絕未知欄位與型別轉換：

| 欄位 | 型別與規則 |
|---|---|
| `schemaVersion` | 整數，固定為 `1` |
| `eventId` | 字串，符合 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`；跨重送的冪等識別，可安全作為 Firestore Document ID。組成規則見 1.5 |
| `eventType` | 字串，`urination` 或 `battery` |
| `deviceId` | 字串，符合 Topic segment 格式 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` |
| `sequence` | 整數 0–4294967295；用於排序與漏訊診斷，**不**作為去重鍵 |
| `recordedAtMs` | 非負整數（UTC Unix epoch 毫秒）或 `null` |
| `firmwareVersion` | 字串，Semantic Versioning 核心版本，可含 pre-release／build metadata |

### 1.3 排尿事件 Payload

Topic：`products/{productModel}/devices/{deviceId}/events/urination`

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

- `flushDurationMs`、`pumpDurationMs`：0–4294967295 的整數（毫秒）。
- 只傳送原始流程時間，**不得**包含 `estimatedUrineMl`、每日次數或其他衍生尿量；尿量由後端依校正版本計算。

### 1.4 電量事件 Payload

Topic：`products/{productModel}/devices/{deviceId}/status/battery`

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

### 1.5 eventId 組成、重送與時間語義

**eventId 組成規則**

`eventId` 直接作為 Firestore Document ID（`devices/{deviceId}/events/{eventId}`），而排尿與電量事件**共用同一個 collection**。因此：

- eventId 必須在**裝置的整個生命週期**內唯一 —— 跨電源循環、跨韌體更新、跨計數器循環皆不得重複，且唯一性範圍涵蓋兩種事件類型。
- **禁止使用 `{deviceId}:{sequence}`**。`deviceId` 燒錄於韌體、`sequence` 重開機後歸零，組合起來會與先前事件碰撞。碰撞的兩種結果都是**零寫入的靜默資料遺失**：payload 有差異 → `409 event_id_conflict`；payload 逐欄位相同 → `200 duplicate`（裝置收到成功回應但事件從未寫入）。
- **建議組法 `{deviceId}:{bootId}:{sequence}`**，例如 `PC-000001:000007:42`。`bootId` 為存放於 NVS／flash 的開機計數器，每次開機遞增並寫回一次（非每筆事件寫一次）；`sequence` 維持在同一 boot session 內遞增，漏訊診斷能力完整保留。建議 `bootId` 固定寬度零填充，使字典序與時間順序一致。長度上 `deviceId`(≤64) + `:` + `bootId`(≤10) + `:` + `sequence`(≤10) ≤ 86 字元，未超過 128 上限。
- **替代組法**：`{deviceId}:{≥128-bit 隨機值}`，不需 NVS，但重送時必須在 RAM 保留原 eventId 與完整 payload。
- **不可**以 `recordedAtMs` 為基礎組成 —— 契約允許 `recordedAtMs` 為 `null`，不能假設事件產生時有可信時間。

**重送與時間語義**

- **重送冪等**：`eventId` 是跨重送的冪等識別。重送同一事件必須重用相同 Topic、`eventId` 與完整 payload，逐欄位不變；否則 `retry_mismatch`。`sequence` 永不取代 `eventId` 作為去重鍵。
- **時間來源**（`lib/effective-time.mjs`）：
  1. `recordedAtMs` 為整數、不早於 `1767225600000`（2026-01-01T00:00:00Z）、且不晚於 `receivedAtMs + 300000`（5 分鐘容忍）→ `effectiveAtMs = recordedAtMs`，`timeSource = "device"`。
  2. 否則（`null`、過早或超過未來容忍）→ `effectiveAtMs = receivedAtMs`，`timeSource = "server"`。
  3. 原始 `recordedAtMs` 永久保留，時間回退不覆寫裝置提供值。

### 1.6 EMQX Webhook 接收端點（ingestion-api HTTP）

定義於 `services/ingestion-api/src/app.ts`（Fastify，bodyLimit 64 KB）。

| Method + Path | 用途 | 主要回應 |
|---|---|---|
| `GET /healthz` | 健康檢查 | `200 { status: "ok" }` |
| `POST /v1/emqx/events` | 接收 EMQX 轉發的裝置事件 | `201 stored` / `202 accepted` / `200 duplicate`；錯誤見下 |

**`POST /v1/emqx/events` 規則**

- 只接受 `Content-Type: application/json`（否則 `415`）。
- 需 `Authorization` 驗證，支援 current／previous secret 輪替（`security/webhook-auth.ts`，否則 `401`）。
- Body 為 EMQX envelope（`contracts/emqx-webhook-envelope.ts`），欄位固定且不多不少：

| 欄位 | 規則 |
|---|---|
| `topic` | 字串 |
| `clientId` | 字串，長度 1–128 |
| `username` | 字串，長度 1–128 |
| `qos` | `0`／`1`／`2` |
| `retained` | 必須為 `false`（`true` → `422 retained_event`） |
| `brokerReceivedAtMs` | 非負 safe integer |
| `payload` | 物件（後續交由 schema 驗證） |

**回應狀態碼對照**

| 狀態碼 | 情境 |
|---|---|
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

---

## 二、寫入 Firestore 的 Model

集合結構以 `devices/{deviceId}` 為根，底下有 `events` 與 `dailyStats` 兩個子集合。寫入由 Admin SDK 在單一 transaction 中完成（`firestore/firestore-event-sink.ts`），並以 `eventId` 為 document id 進行冪等去重；client 端依 `firestore.rules` 僅限 owner 唯讀（所有 client 寫入一律拒絕）。

### 2.1 `devices/{deviceId}` — 裝置註冊 + 最新狀態投影

ingestion 讀取校驗欄位（`ownerUid`、`ingestionStatus`、`productModel`、`deviceId`），並 `update` 下列投影欄位（僅在新事件比目前最新更晚時更新）。

> `deviceId`、`productModel`、`ownerUid`、`ingestionStatus` 由裝置佈建流程建立，ingestion 只讀取校驗，不新建裝置文件。

**校驗與門檻**

| 條件 | 結果 |
|---|---|
| 裝置文件不存在或 `deviceId` 不符 | `unknown_device`（422） |
| `ingestionStatus !== 'enabled'` | `device_disabled`（403） |
| `productModel` 不符 | `product_model_mismatch`（422） |

**投影欄位**

| 欄位 | 說明 |
|---|---|
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
| `todayDate` | 今日投影所屬日期，字串 `yyyy-MM-dd`（Asia/Taipei） |
| `todayUrinationCount` | 該日排尿次數，取自同一 transaction 的每日文件 |
| `todayEstimatedUrineTotalMl` | 該日累加尿量（mL），取自同一 transaction 的每日文件 |

最新性以三元組 `[effectiveAtMs, receivedAtMs, eventId]` 字典序比較，避免亂序處理將 metadata 倒退。

**今日投影**（`aggregation/today-urination-projection.ts`）

`todayDate`、`todayUrinationCount`、`todayEstimatedUrineTotalMl` 三個欄位構成一組必須完整的 tuple，**僅排尿事件**寫入，且一律取自同一 transaction 剛算出的每日文件，不獨立累加，因此不會與 `dailyStats` 漂移。電量事件不寫這三個欄位；`duplicate`、`unknown_device`、`device_disabled`、`product_model_mismatch` 這些零寫入結果也不改動投影。

遲到事件不得讓投影倒退：只有當事件的 `dayKey` 不早於現有 `todayDate`（或現有 `todayDate` 不存在）時才覆寫三個欄位；`dayKey` 較早的事件只遞增該日的 `dailyStats`，投影原封不動。`yyyy-MM-dd` 固定寬度且為 Latin 數字，字典序即時間序。

跨日過期由讀取端判定：投影本身不會在午夜自動歸零（沒有事件時 ingestion 不會被喚醒），讀取端以當下的 Asia/Taipei 日期比對 `todayDate`，不相等時解讀為今日 0 次 0 mL。

### 2.2 `devices/{deviceId}/events/{eventId}` — 事件明細

以 `eventId` 為 document id。若已存在且 `canonicalHash` 相同 → `duplicate`；不同 → `event_id_conflict`。

**排尿事件 record**（`persistence/urination-event-record.ts`）

| 欄位 | 值／來源 |
|---|---|
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

**電量事件 record**（`persistence/battery-event-record.ts`）

| 欄位 | 值／來源 |
|---|---|
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

### 2.3 `devices/{deviceId}/dailyStats/{dayKey}` — 每日排尿彙總

`DailyUrinationRecord`（`aggregation/daily-urination-record.ts`）。`dayKey` 以 `Asia/Taipei` 日界計算，**僅排尿事件**在同一 transaction 內遞增；寫入前以 `assertValidDailyDocument` 做 fail-closed 校驗。

| 欄位 | 型別／值 |
|---|---|
| `date` | 字串 `dayKey`（Asia/Taipei 當地日期） |
| `timeZone` | `'Asia/Taipei'` |
| `urinationCount` | 整數，首筆為 `1`，之後 +1（溢位丟 `AggregationIntegrityError`） |
| `estimatedUrineTotalMl` | 非負有限數，該日每筆事件校正尿量的加總（mL） |
| `lastEventAtMs` | `max(現值, effectiveAtMs)` |
| `updatedAtMs` | `max(現值, receivedAtMs)` |

舊 shape（`volumeStatus: 'pending_calibration'` 加上四個恆為 `null` 的 `estimatedUrine*Ml`）的每日文件在現行契約下會被 `assertValidDailyDocument` 判定為 `aggregation_integrity_error`，該日後續事件一律寫不進去，前端統計頁也會拒絕解析。**不提供回填**：開發環境的處置是清除 `dailyStats` 子集合（`npm run emulators:reset`）後由新事件重建；正式環境尚未部署過帶資料的版本，沒有回填對象。

---

## 三、備註

- 事件層級的 `estimatedUrineMl` / `estimationStatus` 兩列（§2.2）仍描述 `pending_calibration` 舊行為，與現行實作不符，屬於獨立待修的文件債。每日彙總與裝置投影的尿量欄位以本文件 §2.1、§2.3 的敘述為準。
- 事件寫入、裝置投影更新、每日彙總遞增皆在**同一個 Firestore transaction** 中完成，確保去重與計數一致性。

## 四、對應原始碼

| 主題 | 檔案 |
|---|---|
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
| 今日投影規則 | `services/ingestion-api/src/aggregation/today-urination-projection.ts` |
| Security Rules | `firestore.rules` |
