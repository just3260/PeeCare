## Why

development 的 EMQX 部署是 Cloud Serverless 方案,而其 Deployment API 只開放 Client Management、Subscription Information 與 Message Publish 三類端點。Data Integration 的管理端點(connectors、actions、rules)一律由 gateway 回 403 空回應,`/api-spec.json` 也不存在。現行 `deploy/development/configure-emqx-webhook.mjs` 第一步就是讀取 API spec,`deploy/development/verify-emqx-webhook.mjs` 則依賴 action metrics 計數器,兩支腳本在此方案下都無法執行,導致裝置遙測完全無法轉發到 ingestion service —— 資料流目前是斷開的。

現行 spec 假設可透過 API 指定 connector 名稱並精確設定六項 resource options,但 Serverless Dashboard 的 Connector Name 由平台自動產生且不可編輯,Advanced Settings 也只暴露其中兩項。spec 與平台能力之間的落差必須先解決,development 環境才能有可運作且可稽核的轉發路徑。

2026-08-18 的 Dashboard spike 進一步確認:HTTP Server connector 對現有 ingestion origin 執行 connectivity test 時,根路徑非成功回應會使測試失敗並停用 `New` 按鈕,因此 connector 根本無法建立,也無法先觀察週期性 health check。第一輪以 `GET /` 提供 health response 後,live Cloud Run request metadata 又確認 Dashboard `Test` 實際發出的是帶 JSON content type 的空 body `POST /`;它在既有 parser/error handler 下回 500。這份實證把分支 B 收斂為同時支援 sanitized `GET /` 與 `POST /` health surface,再完成 connector、rule、action 與端到端驗證。

建立 rule/action 後的 live probe 又揭露第二個 Serverless 能力邊界:Dashboard 允許輸入 action custom headers,但儲存後會無聲移除所有新增 header;`Authorization` 與一般 `x-*` header 都無法持久化,因此 webhook 固定收到 401。TLS Verify 同時會因平台未提供 CA bundle 欄位而以 `cacerts undefined` 拒絕 action 建立。為保留 shared-secret 認證且不把 secret 放進 URL,EMQX action 必須把 Bearer credential 放在固定的 outer JSON body wrapper；ingestion 在驗證 credential 後才將內層既有 envelope 交給原驗證與 persistence 流程。

最終 live 驗收再揭露第三個能力邊界:`devices/development/provision-device.mjs` 依賴 built-in authentication user 與 per-user authorization rule 管理端點,但 Serverless Deployment API 不開放這些端點。操作者改由 Dashboard 人工建立 device user/ACL 後,broker、rule 與 action 能把訊息送達 Cloud Run,但模擬的 publisher identity 無法滿足 ingestion 的 publisher-binding 契約,因此請求被安全拒絕且不能作為 Firestore 端到端落地證據。這證明 Serverless webhook transport 已可到達 ingestion boundary,但真實 device provisioning 與 canonical MQTT-to-Firestore 驗收必須由後續 change 處理；本變更不放寬 publisher binding,也不把失敗的模擬 probe 記為成功。

## What Changes

- **BREAKING** Data Integration 的建立方式從「腳本呼叫 EMQX API 執行 mutation」改為「Dashboard 人工設定 + 可稽核的設定檢查表」。`deploy/development/configure-emqx-webhook.mjs` 不再對 EMQX 做任何寫入,改為產生預期設定值檢查表並驗證可存取的前置條件。
- **BREAKING** 移除 delivery policy 對 live `/api-spec.json` 的 preflight 驗證要求。該端點在 Serverless 不存在。
- **BREAKING** 核准的 delivery policy 從六項精確值縮減為 Serverless Dashboard 實際可設定的子集(connection pool size、health check interval、HTTP pipelining、connect timeout)。query mode、inflight window、max buffer bytes、request TTL 四項改為記錄為平台預設、不由本專案約束。
- **BREAKING** 放棄 broker 端 delivery metrics 驗證與建立在其上的 warning/critical 告警門檻。Serverless 不開放 actions metrics 端點,retried、queuing、dropped、late_reply 計數器都無法取得。改以端到端結果作為唯一交付證據。
- Webhook delivery verifier 保留真實 MQTT 5/TLS device publish 加 Firestore 查詢的 fail-closed 路徑,且 device password 只能由 hidden interactive TTY 取得。Serverless Message Publish API 與 Dashboard 人工建立 user/ACL 後的模擬 publisher 都不能提供 ingestion publisher-binding 所需的可靠 identity；live 訊息雖到達 Cloud Run,仍被安全拒絕,因此不得把它們當作 canonical E2E 證據。真實 device provisioning、三項 live delivery 驗收與 rule-drift rehearsal 延後到後續 change。
- connector、action 與 rule 的識別方式從硬編碼常數改為由環境變數提供,以容納平台自動產生的名稱。
- 修正既有文件 drift:Secret Manager 名稱由 `emqx-webhook-current` 更正為實際部署的 `peecare-emqx-webhook-current`,並記錄 Cloud Run 目前僅掛載 current、沒有 previous 的事實。
- 依 Dashboard connectivity test 與 Cloud Run request metadata 選定並補齊分支 B:ingestion origin 的 `GET /` 與精確 `POST /` 提供 `200 {"status":"ok"}` 給 connector test 與週期性 health check,其餘根路徑 method 與其他既有路徑維持原契約;部署後建立 Data Integration、確認 connector 持續 connected,並以 sanitized Cloud Run evidence 確認 webhook request 可到達 ingestion boundary。
- **BREAKING** EMQX Serverless action 的 credential transport 從無法持久化的 custom `Authorization` header 改為固定 JSON body wrapper `{ "webhookAuthorization": "Bearer <secret>", "event": <既有 envelope> }`。ingestion 保留既有 header + raw envelope 路徑給非 Serverless 呼叫端,並新增 wrapper 認證與解包；任一 secret 值都不得出現在 repository artifact、sanitized output、structured log 或 URL。
- 記錄 Serverless Dashboard 的 TLS 限制:HTTPS 維持啟用,但 `TLS Verify` 在沒有 CA bundle 輸入欄位的方案上無法啟用；checklist 與 runbook 必須把這項風險明確列為平台例外,不得誤記為 `verify_peer`。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `development-emqx-webhook`: 移除 API spec preflight 與 API mutation 要求;縮減核准 delivery policy 至平台可設子集;將 delivery verifier 改為真實 MQTT device publish 加 Firestore 查詢的 fail-closed 路徑,並明確區分「webhook 到達 ingestion boundary」與「通過 publisher binding 後落地 Firestore」;識別名稱改為可配置;移除依賴 broker metrics 的告警門檻要求。

## Impact

- Affected specs: `development-emqx-webhook`
- Affected code:
  - Modified:
    - deploy/development/configure-emqx-webhook.mjs
    - deploy/development/configure-emqx-webhook.spec.ts
    - deploy/development/verify-emqx-webhook.mjs
    - deploy/development/verify-emqx-webhook.spec.ts
    - deploy/development/emqx-webhook.template.json
    - deploy/development/EMQX_RUNBOOK.md
    - docs/mqtt-server-integration.md
    - package.json
    - services/ingestion-api/src/app.ts
    - services/ingestion-api/src/contracts/emqx-webhook-envelope.ts
    - services/ingestion-api/src/security/webhook-auth.ts
    - services/ingestion-api/test/app.test.ts
  - New:
    - deploy/development/emqx-serverless-console-checklist.md
  - Removed: (none)
- Affected external configuration: EMQX Cloud Serverless Dashboard 的 connector、action 與 rule 由人工建立,不再由腳本管理。
- Affected operations: EMQX 設定與驗證的 runbook 操作流程改變;secret rotation 演練不再有 broker 端計數器可觀察;Serverless device provisioning 與 canonical MQTT-to-Firestore live 驗收記為後續 change 的前置工作。
