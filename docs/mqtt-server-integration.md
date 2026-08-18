# PeeCare — MQTT Server 串接規格（development）

本文件整理 **MQTT Broker（EMQX）端串接 PeeCare 雲端所需的 endpoint 與參數**。
資料流：裝置 → MQTT Broker → Webhook（HTTP POST）→ ingestion-api（Cloud Run）→ Firestore。

Broker 只需要做兩件事：

1. 依 ACL 收下裝置發布到 canonical topic 的訊息。
2. 用固定的 envelope 格式，把訊息 POST 到 ingestion webhook endpoint。

> 事件 payload 的完整 JSON Schema 與 Firestore 資料模型見 [mqtt-interfaces-and-firestore-models.md](./mqtt-interfaces-and-firestore-models.md)。

---

## 一、環境與 Endpoint

| 項目 | 值 |
|---|---|
| Firebase / GCP Project ID | `petcare-c7483` |
| Region | `asia-east1` |
| Cloud Run 服務名 | `peecare-ingestion-development` |
| Origin | `https://peecare-ingestion-development-348528459946.asia-east1.run.app` |
| Ingress | public（`allowUnauthenticated: true`，由應用層 shared-secret 驗證把關） |

| Method + Path | 用途 | 認證 | 成功回應 |
|---|---|---|---|
| `GET /` / `POST /` | Dashboard connectivity test 與週期性 connector health check | 不需要 | `200 {"status":"ok"}` |
| `GET /health` | Cloud Run 公開健康檢查 | 不需要 | `200 {"status":"ok"}` |
| `GET /healthz` | 相容保留，**Cloud Run 會攔截此路徑**，不要拿來做線上探測 | 不需要 | `200 {"status":"ok"}` |
| `POST /v1/emqx/events` | 接收 Broker 轉發的裝置事件 | Serverless body credential wrapper；相容 caller 可用 header transport | `201` / `202` / `200` |

- `POST /v1/emqx/events` 以外的 method 打同一路徑 → `405 method_not_allowed`。
- 其他路徑 → `404 not_found`。
- 每個回應都帶 `x-request-id` header；成功的 `/v1/emqx/events` 回應 body 為
  `{"eventId": "...", "requestId": "..."}`，root health 回應則維持
  `{"status":"ok"}`。

### 完整 Webhook URL

```
https://peecare-ingestion-development-348528459946.asia-east1.run.app/v1/emqx/events
```

---

## 二、認證

| 項目 | 值 |
|---|---|
| Serverless transport | outer JSON 的 `webhookAuthorization` 欄位承載 Bearer credential |
| Secret 來源 | GCP Secret Manager `projects/petcare-c7483/secrets/peecare-emqx-webhook-current`，**必須指定 numeric version，不可用 `latest`** |
| 目前部署 | current version `1`；previous 尚未掛載，不得宣稱 rotation 已驗證 |
| 輪替機制 | 服務端可同時接受 `EMQX_WEBHOOK_SECRET_CURRENT` 與 `EMQX_WEBHOOK_SECRET_PREVIOUS`，兩者值必須不同 |
| 比對方式 | 常數時間比對，格式必須完全是 `Bearer <token>`（單一空格、token 不含空白） |
| 失敗 | `401 unauthorized` |

Secret 值不得寫進 repo、log、工單或匯出設定；文件與 checklist 只保留 redaction
token（例如 `{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}`）。這個 token 不是 EMQX 或
Secret Manager 會解析的 placeholder。操作者必須在受控 shell 中臨時讀取精確 numeric
version 的 secret 值，直接代入 Dashboard Action Body 的 Bearer token 位置；不得把
resolved 值或完整 body 輸出、存檔、貼到工單或留在 shell history。Serverless custom
headers 儲存後不會持久化，所以 Action 必須用固定 body wrapper，且不可把 credential
放進 URL。

輪替順序：先讓 Cloud Run 同時接受新舊 → EMQX Action 切到新 current → 驗證通過 → 才從 Cloud Run 移除舊的。

---

## 三、Webhook Request 規格

### Headers

| Header | 值 |
|---|---|
| `Content-Type` | `application/json`（或 `application/json; charset=utf-8`）；其他值 → `415` |

Body 上限 64 KB，超過 → `413 body_too_large`。

### Serverless outer wrapper（**必須剛好 2 個 key**）

```json
{
  "webhookAuthorization": "Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}",
  "event": ${.}
}
```

`webhookAuthorization` 與 `event` 以外不得有第三個 top-level 欄位。ingestion 驗證
credential 後只把 inner `event` 交給既有 envelope validator；wrapper metadata 不會
寫入 Firestore。既有非 Serverless caller 的 header + raw envelope transport 保持相容，
但兩種 transport 不可同時使用。

### Inner envelope 欄位（**必須剛好 7 個 key，不多不少**）

| 欄位 | 型別與規則 | EMQX SQL 來源 |
|---|---|---|
| `topic` | 字串 | `topic` |
| `clientId` | 字串，長度 1–128（**必須等於 payload/topic 的 `deviceId`**） | `clientid AS clientId` |
| `username` | 字串，長度 1–128（不可用 clientId 代入） | `username` |
| `qos` | `0` / `1` / `2` | `qos` |
| `retained` | 必須為 `false`；`true` 也要照實轉送，服務端回 `422 retained_event` | `flags.retain AS retained` |
| `brokerReceivedAtMs` | 非負 safe integer（epoch 毫秒） | `publish_received_at AS brokerReceivedAtMs` |
| `payload` | **已解碼的 JSON 物件**（不是字串、不是陣列） | `json_decode(payload) AS payload` |

多帶或少帶任何一個 key、型別不符 → `400 invalid_envelope`。
payload 解碼結果不是物件（例如陣列）→ `400 invalid_envelope`，且不得計為成功轉送。

上面的 wrapper 是文件與稽核用 redacted shape，不可把
`{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}` 原樣存進 Dashboard。操作者必須臨時解析
文件所列 numeric secret version，只在 Action Body 編輯器把 Bearer token 位置替換成
resolved 值；`${.}` 仍由 rule SQL 的完整 selected row 取代。不要把 resolved body
輸出、複製到 shell history、repo 或驗收紀錄。

---

## 四、Topic 與 Payload（v1 只有兩個 topic）

| Topic | 事件 | 必填 payload 專屬欄位 |
|---|---|---|
| `products/{productModel}/devices/{deviceId}/events/urination` | 排尿 | `flushDurationMs`、`pumpDurationMs`（整數 0–4294967295） |
| `products/{productModel}/devices/{deviceId}/status/battery` | 電量 | `batteryLevelPercent`（只接受 0/25/50/75/100）、`batteryVoltageMv`（選填，整數 0–20000，無值時省略欄位） |

- `productModel`、`deviceId` segment 規則：`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`，不得含空白、斜線或 `+` `#`。
- Topic **沒有** `v1` segment，版本由 payload 的 `schemaVersion` 管理。
- `events/battery`、命令類、舊版原型 topic（如 `peecare/device/1/status`）都不在契約內，Broker 規則必須排除。

共用 payload 欄位（每筆事件都要有，且 schema 拒絕未宣告欄位與型別轉換）：
`schemaVersion`(固定 1)、`eventId`、`eventType`、`deviceId`、`sequence`(0–4294967295)、`recordedAtMs`(非負整數或 `null`)、`firmwareVersion`(SemVer)。

`eventId` 規則（會直接當成 Firestore document id，排尿與電量共用同一 collection）：

- 全裝置生命週期唯一，跨重開機、跨韌體更新都不可重複。
- **禁止** `{deviceId}:{sequence}`（重開機後 sequence 歸零會碰撞）。
- 建議 `{deviceId}:{bootId}:{sequence}`，或 `{deviceId}:{≥128-bit 隨機值}`。
- 不可由 `recordedAtMs` 推導（該欄允許為 `null`）。
- 重送必須完整重用原 topic、`eventId` 與所有 payload 欄位。

---

## 五、回應狀態碼

| 狀態碼 | code | 情境 | Broker 應對 |
|---|---|---|---|
| `201` | `stored` | 首次成功寫入 | 成功 |
| `202` | `accepted` | 已接受 | 成功 |
| `200` | `duplicate` | 相同 `eventId` 且內容一致 | 成功，不重送 |
| `400` | `invalid_envelope` / `malformed_json` | envelope 格式錯 | 不重送，修設定 |
| `401` | `unauthorized` | secret 錯或缺 | 不重送，檢查 secret |
| `403` | `device_disabled` | 裝置在 Firestore 被停用 | 不重送 |
| `405` | `method_not_allowed` | 非 POST | 不重送 |
| `409` | `event_id_conflict` | 相同 `eventId` 但內容不同 | 不重送，屬裝置 eventId 組法問題 |
| `413` | `body_too_large` | 超過 64 KB | 不重送 |
| `415` | `unsupported_media_type` | Content-Type 錯 | 不重送 |
| `422` | `retained_event` / `invalid_event` / `publisher_mismatch` / `unknown_device` / `product_model_mismatch` | 契約或註冊資料不符 | 不重送 |
| `500` | `aggregation_integrity_error` / `internal_error` | 服務端錯誤 | 可重送 |
| `503` | `persistence_unavailable` / `sink_unavailable` / `temporarily_unavailable` | 後端暫時不可用 | 可重送 |

`publisher_mismatch`：`clientId`、topic 的 `deviceId`、payload 的 `deviceId` 三者不一致。

---

## 六、EMQX Rule / Action 核准設定

Rule SQL（只匹配兩個 canonical topic）：

```sql
SELECT
  topic,
  clientid AS clientId,
  username,
  qos,
  flags.retain AS retained,
  publish_received_at AS brokerReceivedAtMs,
  json_decode(payload) AS payload
FROM "products/+/devices/+/events/urination",
  "products/+/devices/+/status/battery"
```

Connector：

| 參數 | 值 |
|---|---|
| `type` | `http` |
| `url` | `https://peecare-ingestion-development-348528459946.asia-east1.run.app`（必須 HTTPS origin，不得含帳密） |
| `connect_timeout` | `10s` |
| `pool_size` | `2` |
| `enable_pipelining` | `1` |
| `health_check_interval` | `15s` |
| TLS / `TLS Verify` | enabled / disabled（Serverless 無 CA bundle 欄位的 development 平台例外） |

此 deployment 必須維持 TLS enabled、`TLS Verify` disabled，並把後者視為已知的
Serverless 平台例外，不得描述為 peer verification。

Action：

| 參數 | 值 |
|---|---|
| `method` | `post` |
| `path` | `/v1/emqx/events` |
| `headers.content-type` | `application/json` |
| custom headers | 不使用；Serverless 儲存後不持久化 |
| `body` | redacted shape：`{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":${.}}`；實際 Dashboard 值須臨時解析 numeric version 後代入，不能儲存 literal token |

以下 action buffering 欄位未由 Serverless Dashboard 暴露，由平台預設決定，本專案
不宣稱可設定或驗證：

| 參數 | 核准狀態 |
|---|---|
| `query_mode` | platform default |
| `worker_pool_size` | platform default |
| `inflight_window` | platform default |
| `max_buffer_bytes` | platform default |
| `request_ttl` | platform default |
| `retry_interval` | 不得設定 |

Serverless 不提供 action metrics，broker-side queue depth、retry 與 drops 不可觀測。
營運偵測依賴 Cloud Run structured logs 與可重複執行的 end-to-end probe，不建立
無法取數的 broker 告警門檻。

---

## 七、Broker 端裝置身分與 ACL

| 項目 | 值 |
|---|---|
| Broker URL | `mqtts://<mqtt-host>:8883`（強制 TLS 憑證驗證，不可關閉） |
| Management API | HTTPS，`/api/v5`，使用最小權限 API key（不可用 Dashboard 帳密） |
| 認證方式 | EMQX built-in database，**username 身分**，非 superuser |
| `clientId` | 等於 `deviceId`，例如 `PC-000001` |
| `username` | `device-{deviceId}`，例如 `device-PC-000001` |
| 發布政策 | QoS **1**、retained **false**（QoS 0/2 或 retained true 一律視為設定錯誤） |

ACL（每個裝置只能發布自己的兩個 topic，其餘全拒）：

```json
{
  "username": "device-PC-000001",
  "rules": [
    { "permission": "allow", "action": "publish", "topic": "products/pc-mini/devices/PC-000001/events/urination", "qos": [1], "retain": false },
    { "permission": "allow", "action": "publish", "topic": "products/pc-mini/devices/PC-000001/status/battery", "qos": [1], "retain": false },
    { "permission": "deny", "action": "all", "topic": "#" }
  ]
}
```

裝置密碼每台唯一、不與 Web client 共用，只透過互動式 TTY 交付一次，不可經由參數、環境變數、stdout/stderr 或檔案傳遞。

交付憑證前，Firestore `petcare-c7483` 必須已有 `devices/{deviceId}`，且 `deviceId`、`productModel` 相符、`ingestionStatus: enabled`。

### 目前 development 裝置清冊

| deviceId | productModel | MQTT principal | Firestore |
|---|---|---|---|
| `PC-000001` | `pc-mini` | `device-PC-000001` | `petcare-c7483/devices/PC-000001`，`ingestionStatus: enabled` |

---

## 八、環境變數（設定／驗證腳本用）

```sh
export PEECARE_DEVELOPMENT_INGESTION_ORIGIN='https://peecare-ingestion-development-348528459946.asia-east1.run.app'
export PEECARE_DEVICE_MQTT_URL='mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883'
export PEECARE_EMQX_CONNECTOR_NAME='<dashboard-assigned-connector-name>'
export PEECARE_EMQX_ACTION_NAME='<dashboard-assigned-action-name>'
export PEECARE_INGESTION_SECRET_CURRENT_REF='projects/petcare-c7483/secrets/peecare-emqx-webhook-current/versions/1'
```

只有 Cloud Run 已實際掛載不同的 numeric previous version 時，才設定
`PEECARE_INGESTION_SECRET_PREVIOUS_REF`。目前 previous 尚未部署。

Serverless Data Integration 由 Dashboard 人工建立；本地命令只產生可稽核 checklist，
不呼叫 connector、action 或 rule management API，也不寫入 EMQX：

```bash
npm run emqx:development:checklist
```

```bash
npm run emqx:development:verify
```

E2E verifier 從 `devices/development/device-inventory.json` 讀取既有 deviceId、
productModel 與 MQTT principal，並以 hidden interactive TTY 讀取 device password。
密碼只停留在記憶體，不可放入 environment、argv、檔案、stdout/stderr 或 shell
history；此流程不建立、輪替或修改 device credential/ACL。Serverless Message Publish
API 缺少 ingestion publisher binding 所需的可靠 identity，所以不能替代真實 MQTT
device probe。

詳細操作與 rollback 見 [EMQX_RUNBOOK.md](../deploy/development/EMQX_RUNBOOK.md)。

---

## 九、對應原始碼

| 主題 | 檔案 |
|---|---|
| HTTP endpoint 與狀態碼 | `services/ingestion-api/src/app.ts` |
| Envelope 驗證 | `services/ingestion-api/src/contracts/emqx-webhook-envelope.ts` |
| Bearer 驗證與輪替 | `services/ingestion-api/src/security/webhook-auth.ts` |
| 執行環境變數 | `services/ingestion-api/src/config.ts` |
| Cloud Run 部署參數 | `deploy/development/ingestion-service.yaml` |
| EMQX rule/action 範本 | `deploy/development/emqx-webhook.template.json` |
| Topic 規則 | `contracts/device-events/lib/topic.mjs` |
| JSON Schema | `contracts/device-events/schemas/*.v1.schema.json` |
| 裝置清冊／ACL／韌體設定 | `devices/development/` |
