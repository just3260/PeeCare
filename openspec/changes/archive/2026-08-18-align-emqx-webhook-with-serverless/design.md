## Context

development 的 EMQX 是 Cloud Serverless 方案。實測其 Deployment API 後確認:HTTP GET /api/v5/clients 與 /api/v5/subscriptions 回 200、POST /api/v5/publish 端點存在,而 /api/v5/connectors、/api/v5/actions、/api/v5/rules、/api/v5/nodes 一律回 403 且回應主體為空,/api-spec.json 回 404。403 沒有任何應用層標頭,是 gateway 直接攔阻,不是 API key 權限不足 —— 同一組憑證存取開放端點可正常取得 200。官方文件亦載明 Serverless Deployment API 僅含 Client Management、Subscription Information 與 Message Publish。

因此 Data Integration 只能經 Dashboard 建立。Dashboard 的 Connector Name 由平台自動產生且不可編輯,Advanced Settings 僅暴露 HTTP Pipelining、Pool Type、Connection Pool Size、Connect Timeout、Start Timeout、Health Check Interval,未暴露 query mode、inflight window、max buffer bytes、request TTL。

ingestion service 端實測:根路徑回 404 not_found、/health 回 200、/v1/emqx/events 無憑證回 401。根路徑的 404 來自 Fastify 的預設 not-found handler,既有 spec 未將其列為 requirement,既有測試也未斷言它,所以若需為 health check 提供 200 回應,改動範圍侷限於實作與其測試。第一輪部署 `GET /` 後,Dashboard `Test` 仍失敗;Cloud Run request metadata 明確顯示 EMQX 使用 Go client 對 origin 發出 `POST /`,而帶 `content-type: application/json` 的空 body 在 Fastify routing 前觸發 parser error並由既有 catch-all handler sanitized 為 500。直接 GET 同一 origin 則為 200,排除 DNS、TLS 與 alias routing 問題。

完成 root POST health 後,Dashboard 可建立 connector 與 rule,但 live probe 命中 rule 後 action 固定收到 401。重開 action editor 證明新增的 `Authorization` header 不會持久化；以非敏感 `x-peecare-probe` 重測也同樣被移除,排除只有敏感 header 被遮蔽的可能。直接以同一 numeric secret version 呼叫 Cloud Run 則回 400 `invalid_envelope` 而不是 401,證明 secret 本身有效。另一次 action 建立以 `TLS Verify` 啟用時回 `{options,incompatible,[{verify,verify_peer},{cacerts,undefined}]}`,且 Serverless 表單沒有 CA bundle 欄位。

2026-08-18 在實際 Serverless Dashboard 建立 HTTP Server connector 時,以 ingestion origin 執行 `Test` 後測試失敗,且 `New` 按鈕維持 disabled。這證明 404 不只是可能影響週期性 health check,而是已先阻擋 connector 建立;在 connector 尚不存在時無法執行原先規劃的週期性狀態觀察。因此使用者核准以這份建立閘門證據直接選定分支 B,將週期性 connected 狀態與 Firestore 落地改為部署後驗收,不再作為分支選擇前提。

現行兩支腳本都停在平台限制上:設定腳本的第一個動作是讀取 API spec,驗證腳本依賴 action metrics 計數器。結果是 development 的遙測轉發目前完全沒有運作。

Serverless 的 Data Integration 額度為最多 2 個 connector、4 個 rule、每個 rule 1 個 action,而本變更只需各 1 個。免費額度為每月 100 萬次 rule action 執行。

最終 live 驗收確認,既有 device provisioning 設計同樣超出 Serverless Deployment API 的能力邊界:`devices/development/provision-device.mjs` 需要 built-in authentication user 與 per-user authorization rule 的讀寫端點,而免費 Serverless 不開放這些端點。操作者由 Dashboard 人工建立 device user/ACL 後,broker 接受訊息且 rule/action 將 webhook 送達 Cloud Run,但模擬 publisher identity 被 ingestion 既有 publisher-binding 契約安全拒絕,沒有形成可宣稱的 Firestore 端到端落地。這項 evidence 只證明 broker-to-ingestion reachability,不證明真實 device identity 或 persistence。

## Goals / Non-Goals

**Goals:**

- 讓 development 的 EMQX Data Integration 能在 Serverless 能力內建立、保持 connected,並把符合 action contract 的 webhook request 送達 ingestion boundary。
- 讓 spec 描述的核准設定與驗證方式,對應 Serverless 平台實際可設定與可觀測的能力。
- 保留可稽核性:即使設定由人工在 Dashboard 建立,仍有明確的預期值清單可核對,且 verifier 對缺少真實 device credential、publisher-binding failure 與未落地結果維持 fail closed。
- 保留既有的機密處理原則:驗證輸出不得含 secret 值或事件 payload。
- 在 Serverless 無法持久化 custom headers 的限制下,仍讓 `/v1/emqx/events` 維持 shared-secret 認證,且不把 secret 放進 URL。

**Non-Goals:**

- 不升級 EMQX 方案,也不更換 broker。使用者已決定留在 Serverless。
- 不恢復 broker 端 delivery metrics 驗證與建立在其上的告警門檻。Serverless 不提供該資料,本變更明確接受此能力損失。
- 不改變 topic 契約、envelope 欄位、eventId 規則或 payload schema。裝置端契約完全不動。
- 不建立、輪替或變更裝置 MQTT 身分與 ACL；既有 provisioning 工具所需的 authentication/authorization management endpoints 在 Serverless 不可用。將 provisioning 改為 Serverless-compatible workflow、取得真實 device credential、完成 canonical MQTT-to-Firestore live 驗收與 rule-drift rehearsal,全部延後到後續 change。
- 不移除 ingestion service 既有的 `Authorization: Bearer` + raw envelope 路徑；非 Serverless 呼叫端與既有 deployment verifier 維持相容。
- 不處理前端直連 MQTT 的問題,也不處理韌體改發 canonical topic 的工作。兩者屬於各自獨立的變更。
- 不建立 EMQX 設定的自動化寫入。Serverless 沒有可用端點,不做迂迴實作。

## Decisions

### 以 Dashboard 建立閘門選定分支 B，部署後再驗證週期性 health check

EMQX 文件載明 health check 失敗會將 connector 標記為 Disconnected,而 disconnected 的 connector 會使 action 無法送出資料。原設計希望先建立 connector,觀察週期性 health check 對 404 的判定,再於分支 A(維持 404)與分支 B(根路徑提供成功 health response)之間選擇。

實際 Dashboard spike 發現更早的硬性閘門:HTTP Server connector 對 ingestion origin 執行 connectivity test 時因根路徑非成功回應失敗,`New` 按鈕保持 disabled,所以 connector 無法建立。這使「先建立 connector 再決定是否提供成功 health surface」形成循環。使用者已核准以這份可重現的建立閘門證據選定分支 B;分支 A 對目前部署已不可行。

ingestion 因此 SHALL 讓 `GET /` 與精確 `POST /` 沿用既有 health handler,回傳 `200 {"status":"ok"}` 與 `x-request-id`;`POST /` 必須涵蓋 Dashboard 實際發出的 JSON content type 空 body,而 `PUT /`、`PATCH /`、`DELETE /` 與 `HEAD /` 仍由 not-found contract 回 `404 not_found`。`/v1/emqx/events` 的 parser、Bearer 認證與狀態碼完全不變。完成 deployment 後,Dashboard connectivity test 必須成功並允許建立 connector,再建立 action 與 rule、發送 canonical urination probe,觀察 connector 維持 connected 且 Firestore 出現對應事件文件。後半段觀察是分支 B 的驗收證據,不是分支選擇前提。

### 將 Data Integration 設定改為 Dashboard 人工建立加檢查表

替代方案是保留腳本的 API 寫入路徑並加上平台偵測後跳過,但那會留下一段在目標環境永遠不會執行的程式碼,以及一份描述不可執行流程的 runbook。既然 Serverless 沒有可用端點,就明確承認設定由人工建立,並把可稽核性放到檢查表與端到端驗證上。

設定腳本因此從「執行 mutation」改為「產生預期設定值檢查表並驗證前置條件」,不再對 EMQX 發出任何寫入請求。

### 以 Action body credential wrapper 取代 Serverless 不持久化的 custom headers

實際 Serverless Dashboard 會接受 action custom header 的輸入,但儲存後無聲移除,所以既有 Bearer header 設計在此方案無法交付。把 secret 放在 URL query 或 path 會進入 Cloud Run request URL 與 access log,不可接受；取消 webhook 認證或公開一條僅靠 topic/payload 的寫入路徑也不可接受；平台又不提供可供 connector 使用的 Cloud Run IAM identity 或 mTLS client certificate。

因此 EMQX 專用 Action Body 固定為 `{ "webhookAuthorization": "Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}", "event": ${.} }`。ingestion 的 `/v1/emqx/events` 先執行以下互斥解析:

1. 若有 `Authorization` header,維持現況:以 current/previous secret 驗證 header,並把 request body 當成既有 raw envelope。
2. 若沒有 `Authorization` header,request body 必須恰為 `webhookAuthorization` 與 `event` 兩個欄位；以相同 constant-time secret comparison 驗證 `webhookAuthorization`,成功後只把 `event` 交給既有 envelope validator。
3. 缺漏、額外欄位、非字串 credential、非 plain-object event、錯誤 credential,以及同時提供兩種 credential transport 的請求一律回既有 sanitized 401 `unauthorized`,且不觸發 sink。

outer wrapper 只屬於 Serverless transport adapter,不改 topic、內層 envelope、payload schema、eventId 或 Firestore 資料模型。任何 log、error、summary 與 runbook 都不得輸出 wrapper credential 或完整 request body。

同一平台也不提供 CA bundle 欄位；啟用 `TLS Verify` 會讓 action 建立失敗。development connector 因此維持 HTTPS/TLS enabled,但 checklist 必須把 `TLS Verify: disabled` 標為 Serverless 平台例外與已知風險,不得把它描述成等同於 `verify_peer`。

### 以環境變數提供平台產生的 connector 與 action 識別名稱

平台自動產生的 connector 名稱形如 c-<deployment>-<suffix>,無法預先寫死。硬編碼常數必須改為由環境變數提供,腳本則負責驗證格式安全(不含空白與換行、長度有界),而非驗證等於某個特定字串。

### 將核准 delivery policy 縮減為 Serverless 可設子集

核准值縮減為 Dashboard 實際可設定的四項:connection pool size、health check interval、HTTP pipelining、connect timeout。query mode、inflight window、max buffer bytes、request TTL 四項在 UI 不存在,改為明確記錄「由平台預設決定、不由本專案約束」,而不是繼續在 spec 中要求無法設定也無法驗證的值。

同時移除對 live /api-spec.json 的 preflight 要求,該端點在 Serverless 回 404。

### 以真實 MQTT 裝置身分加 Firestore 查詢取代 action metrics 驗證

原設計假設 Serverless Message Publish API 可作為端到端 probe publisher。2026-08-18 live verifier 證明該假設錯誤:API 接受 canonical publish,rule/action 亦送達 Cloud Run,但 ingestion 回 422 且 Firestore 無文件。probe device 在 Firestore 已確認存在、productModel 正確且 enabled；即使 request 加入通用 EMQX schema 中 deprecated 的 `clientid`,結果仍相同。Serverless 的正式 Message Publish request shape沒有 publisher `username`,也不保證 `clientid`,無法滿足 ingestion 對 `envelope.clientId === topic.deviceId` 的 publisher binding。

不得為了讓 synthetic API probe 通過而把 rule SQL 的 `clientId` 改成 payload 值,因為那會讓裝置自行宣稱 publisher identity並削弱既有安全契約。canonical E2E verifier 因此改用 inventory 中既有 development device 的真實 MQTT 5/TLS connection,以 `clientId === deviceId`、既有 `device-{deviceId}` username、QoS 1、retained false 發送 probe,再查 Firestore 確認文件存在且欄位相符。裝置密碼只能由 hidden interactive TTY 讀取並停留在記憶體,不得透過 argv、environment、stdout/stderr 或檔案傳遞。

實作完成後的 live acceptance 發現,這個真實 device 路徑仍有未滿足的前置條件。免費 Serverless Deployment API 不提供 provisioning 工具所需的 built-in authentication user 與 per-user authorization rule 管理端點；Dashboard 人工建立 user/ACL 雖讓 broker 接受訊息並讓 action 把 webhook 送達 Cloud Run,操作者可用的模擬 publisher identity 仍被 ingestion publisher binding 拒絕。這是正確的安全失敗,不可藉由放寬 `clientId === topic.deviceId`、信任 payload identity 或改用 Message Publish API 消除。

因此本變更保留已完成且有單元測試覆蓋的 fail-closed verifier,但不再把三項 live delivery 結果列為本變更的封存前置條件。Serverless-compatible device provisioning、真實 device credential handoff、canonical Firestore delivery 與 live rule-drift rehearsal 另由後續 change 承接。封存 evidence 只記錄 connector/action connected、webhook 到達 Cloud Run,以及 publisher-binding rejection；不得把它描述為端到端成功。

legacy probe 使用同一裝置身分發起 publish attempt；若 ACL 直接拒絕,即已滿足端到端未交付,若 broker 接受則仍須在有界輪詢內確認 Firestore 無文件。這項結果不能單獨證明是哪一層排除 legacy topic。

此路徑證明的是最終結果而非 broker 內部狀態,因此無法區分「事件成功送達」與「事件經重試後才送達」。同理,legacy non-delivery 無法區分「ACL/rule 正確排除」與「broker 已轉發、但 ingestion 以 unsupported_topic 拒絕」,所以 verifier 不得把結果宣稱為 broker filter exclusion 的直接證據。這是接受的取捨:端到端結果是交付價值所在,而 broker 內部計數器在此平台不可得。

**已取消的 live 故障演練:**

原驗收計畫把 legacy filter 暫時加入 rule,期望 verifier 因 legacy 文件出現而失敗；但 ingestion 的既有 topic contract 會拒絕 `peecare/device/1/status`,即使 rule 錯誤轉發也不會建立 Firestore 文件,所以該演練不可觀測且可能誤報通過。

原規劃曾改為暫時移除 battery canonical filter,讓缺少 battery 文件成為可觀測的 delivery failure；但這項演練依賴尚未成立的真實 device credential 與 canonical Firestore delivery baseline。使用者決定在不修改 live rule 的狀態下封存本變更,把故障注入與還原驗收延後到 device provisioning 能力完成後執行。

### 沿用 adapter 注入模式改寫驗證腳本

專案既有的 verification/real-device/run.mjs 已採純函數加 adapter 注入,把外部依賴抽象為 readCorrelation、readState、publishUnauthorized 等方法,設定腳本亦以 createEmqxWebhookManagementAdapter 注入管理端點。改寫後的驗證腳本沿用同一模式,adapter 提供發送 probe 與讀取事件文件兩類能力,使核心驗證邏輯可在不接觸真實 broker 與 Firestore 的情況下測試。

Firestore 讀取使用專案已有的 firebase-admin 依賴,不新增第三方套件。

### 移除依賴 broker metrics 的告警門檻並改記錄營運後果

既有 warning 與 critical 門檻全部建立在 retried、queuing、failed、dropped、late_reply 計數器上,這些在 Serverless 都取不到。spec 移除這些門檻要求,並改為明確記錄營運後果:轉發異常的偵測改依賴 Cloud Run 端的結構化日誌與端到端 probe，broker 端的佇列堆積與丟棄不再可觀測。這個損失必須寫進 spec 與 runbook，而不是靜默消失。

### 修正 Secret Manager 名稱與雙 secret 前置條件的文件 drift

文件寫的 emqx-webhook-current 在專案中不存在;實際部署的 secret 名為 peecare-emqx-webhook-current,且目前只有 version 1。Cloud Run 的 ingestion 服務只掛載 current,沒有 previous。因此既有驗證腳本要求的「previous 與 current 為兩個不同 numeric version」前置條件在現況下無法成立。文件更正為實際名稱,並記錄雙 secret 演練需要先建立第二個版本並掛載,而不是把它當成已滿足的前提。

## Implementation Contract

**行為:broker health surface**

公開 ingestion origin 的 `GET /` 與 `POST /` 回傳 HTTP 200、JSON `{"status":"ok"}` 與非空 `x-request-id`,不要求認證,供 EMQX Dashboard connectivity test 與週期性 connector health check 使用。`POST /` 同時接受 Dashboard 實際送出的 `content-type: application/json` 空 body,不解析為 webhook、不觸發 sink。`PUT /`、`PATCH /`、`DELETE /` 與 `HEAD /` 仍回既有 sanitized `404 not_found`;既有 `/health` 與 `/healthz` 行為不變。`/v1/emqx/events` 保留 header + raw envelope 契約,另新增上述 body credential wrapper transport。Dashboard test 成功後才建立 connector,且 connector 建立後必須維持 connected 並能交付 canonical probe。

**行為:設定腳本**

以 dry-run 模式執行時,輸出一份 sanitized JSON 摘要,內容包含:目標 ingestion origin、secret 的 numeric version reference、由環境變數取得的 connector 與 action 識別名稱、核准的四項 delivery policy 值、以及應在 Dashboard 核對的 rule SQL 與 action 參數。摘要不得含 secret 值。腳本不得對 EMQX 發出任何寫入請求;移除 apply 模式,或使其明確以錯誤碼拒絕並說明 Serverless 不支援 API 寫入。

**行為:驗證腳本**

腳本保留從 development device inventory 取得 deviceId、productModel 與 MQTT principal,再由 hidden interactive TTY 讀取密碼並建立 strict-TLS MQTT 5 connection 的實作。只有真實 device credential 能建立符合 publisher-binding 的連線時,它才依序驗證 canonical urination、canonical battery 與 legacy non-delivery。若 Serverless provisioning 前置條件不成立、密碼不可得、MQTT identity 被拒絕、Cloud Run 拒絕 publisher binding 或 Firestore 未落地,腳本必須輸出 sanitized error code 並以非零狀態結束,不得改用 Deployment API 或模擬 publisher 宣稱成功。live acceptance 記錄 webhook 已到達 Cloud Run但被安全拒絕,不把三項 delivery summary 列為本變更的封存條件。

**介面與資料形狀**

- 環境變數新增 connector 與 action 識別名稱兩項；設定與 E2E 驗證腳本都不需要 EMQX Deployment API key/secret。E2E 驗證只從環境讀取 credential-free `PEECARE_DEVICE_MQTT_URL`;device password 必須由 hidden TTY reader 注入。
- 驗證腳本的 adapter 至少提供兩個方法:以既有 device identity 發送 canonical 或 legacy MQTT 訊息、依 deviceId 與 eventId 讀取 Firestore 事件文件。兩者皆為注入,核心邏輯不直接建立網路或 Firestore 連線。
- 檢查表文件以表格形式列出 Dashboard 每個欄位的預期值,涵蓋 connector、rule SQL 與 action 三部分,並標明哪些欄位在 UI 不存在因而不受約束。
- EMQX Action Body 固定為 outer wrapper:top-level `webhookAuthorization` 是 `Bearer` credential,top-level `event` 是 rule SQL 產生的既有 envelope；不得增加第三個欄位,不得把 credential 移到 URL。
- ingestion 保留既有 `Authorization` header transport；body wrapper 與 header transport 互斥,兩者共用 current/optional previous secret 的 constant-time 比對。

**失敗模式**

- `GET /` 或 Dashboard 實際使用的空 body `POST /` 未回 200,或 connectivity test 仍失敗 → 不建立 connector,不把 health surface 標為已驗收。
- 環境變數缺漏或格式不安全 → 在任何網路請求之前失敗,輸出錯誤碼。
- canonical MQTT connect/PUBACK 失敗或拒絕 → 輸出安全錯誤碼,不將該 probe 記為成功。
- device password 不可從 hidden interactive TTY 取得 → 回報 `device_credential_precondition_unmet`,不嘗試 publish,也不把 Deployment API publish誤記為替代證據。
- Serverless 不提供 device provisioning 所需的 authentication/authorization management endpoints,且沒有既有可用 credential → 回報未滿足的 provisioning 前置條件,不得建立或猜測 credential。
- Dashboard 人工建立 user/ACL 後的模擬 publisher 訊息到達 Cloud Run但無法滿足 publisher binding → 保留 ingestion 的 sanitized rejection,只記錄 broker-to-ingestion reachability,不得記為 Firestore delivery。
- Firestore 在有界輪詢後仍未出現預期文件 → 記為該項失敗,錯誤碼區分「未落地」與「讀取失敗」。
- legacy topic probe 若導致 Firestore 出現文件 → 記為失敗,因為端到端 legacy non-delivery 已遭破壞；若未出現文件,只證明未落庫,不宣稱已直接證明 broker rule 排除該 topic。
- body wrapper 缺漏、含額外欄位、credential 非字串、event 非 plain object、credential 錯誤或與 Authorization header 同時出現 → 回 sanitized 401 `unauthorized`,不觸發 sink。
- 所有錯誤輸出不得含 secret 值、Authorization 標頭、body credential wrapper 或事件 payload。

**驗收標準**

- ingestion application tests 斷言 `GET /` 與精確 `POST /` 回 `200 {"status":"ok"}` 且含 `x-request-id`,包含 EMQX 的 JSON content type 空 body probe;並以表格驅動斷言 `PUT /`、`PATCH /`、`DELETE /` 與 `HEAD /` 仍為 `404 not_found`;既有 ingestion tests 全數通過。
- ingestion application tests 先以 failing cases 鎖定有效 body wrapper 成功寫入、既有 header transport 相容,以及 wrapper 六種拒絕邊界；所有拒絕 case 都斷言 sink 零呼叫且回 401 `unauthorized`。
- 更新後的 Cloud Run revision 通過既有 deployment verification;EMQX Dashboard connectivity test 成功、`New` 可用,connector 建立後顯示 connected,action 顯示 available,且 sanitized request metadata 證明 webhook 可到達 Cloud Run。
- 設定腳本以 dry-run 執行後輸出 sanitized 摘要且退出碼為零,並且以 grep 確認輸出不含 secret 值。
- 驗證腳本的 adapter tests 覆蓋三項成功結果、canonical delivery failure、ACL rejection、hidden-TTY precondition與 sanitized output；live Serverless acceptance 記錄 provisioning endpoint 不可用,以及 Dashboard 人工 user/ACL 的訊息到達 Cloud Run後被 publisher binding 安全拒絕。這項結果不得宣稱為 canonical Firestore delivery。
- 既有的 configure-emqx-webhook.spec.ts 與 verify-emqx-webhook.spec.ts 更新後全數通過,且涵蓋上述每個失敗模式。
- 專案 spec 中不再出現對 /api-spec.json、action metrics 計數器或固定 connector 名稱的要求。
- docs/mqtt-server-integration.md 與 deploy/development/EMQX_RUNBOOK.md 所載 secret 名稱與實際部署一致。

**範圍邊界**

在範圍內:development-emqx-webhook 的 spec requirement、上述兩支腳本與其測試、webhook 設定範本、EMQX runbook 與 MQTT 串接文件、npm script 名稱、新增的 Dashboard 檢查表,以及已選定分支 B 的 ingestion 根路徑 GET／POST health 行為、body credential wrapper 認證與解包、測試、development deployment、Dashboard connector/action 驗收與 broker-to-ingestion reachability evidence。

在範圍外:topic 契約、內層 envelope 與 payload schema、既有 header credential transport、Serverless-compatible 裝置 provisioning、裝置憑證與 ACL lifecycle、canonical MQTT-to-Firestore live acceptance、rule-drift live rehearsal、前端直連 MQTT 的改造、韌體改發 canonical topic、EMQX 方案升級、以及 Firestore 資料模型。

## Risks / Trade-offs

- [新增 `GET /` 與 `POST /` 可能意外擴張公開 API] → 兩者僅回既有 static sanitized health response,`POST /` 不解析或寫入事件,明確停用自動 HEAD 暴露,並以表格驅動測試證明其他根路徑 method 仍回 404;`/v1/emqx/events` 契約不變。
- [失去 broker 端 delivery metrics,佇列堆積與丟棄不再可觀測] → 明確接受並寫入 spec 與 runbook;偵測改依賴 Cloud Run 結構化日誌與可重複執行的端到端 probe。這是本變更最主要的能力損失,不以任何迂迴實作掩蓋。
- [Dashboard 人工設定會隨時間漂移,且無法用腳本比對] → 以檢查表逐欄位列出預期值供核對,並以端到端驗證作為實際行為的把關;驗證腳本可重複執行,漂移會表現為 probe 失敗。
- [action 名稱是否同樣不可自訂尚未確認] → 識別名稱一律改由環境變數提供,無論平台是否允許自訂都能運作,因此此不確定性不阻塞實作。
- [probe 會計入 Serverless 的 rule action 執行額度] → 每月 100 萬次額度對驗證用量而言遠遠充足。
- [Serverless 上限為 2 connector 與 4 rule,未來新增環境或整合會受限] → 本變更只需各 1 個;若未來需要更多,屆時面對的是方案選擇而非本變更的設計缺陷。
- [人工設定時把 secret 貼入 Dashboard,無法如腳本般只存在於記憶體] → runbook 明確要求 secret 僅從 Secret Manager 即時取得後貼入,不得寫入檔案、工單或聊天記錄;Dashboard 本身會遮蔽已儲存的值。
- [body credential 讓 secret 成為 request payload 的一部分] → wrapper 在驗證後立即解包,不進入 event model、Firestore 或 structured log；body size limit 與 constant-time comparison 沿用既有保護,測試斷言所有失敗輸出都不含 credential。
- [Serverless 沒有 CA bundle 欄位且 TLS Verify 無法啟用] → development connector 仍強制使用 HTTPS 並把 `TLS Verify: disabled` 明確列為平台例外；不把此設定推廣到其他環境,升級方案或平台補齊 CA 能力後優先恢復 peer verification。
- [Serverless 不開放 device provisioning management endpoints,模擬 publisher 又無法滿足 ingestion publisher binding] → 不放寬 identity contract；本變更只宣稱 webhook 到達 ingestion boundary,將 Serverless-compatible provisioning、真實 device credential handoff、Firestore E2E 與 rule-drift rehearsal 延後到後續 change。

## Migration Plan

1. 將 Dashboard connectivity test 因根路徑 404 失敗且 `New` disabled 的證據記入 runbook,正式記錄分支 B 已選定。
2. 以測試先行讓 ingestion `GET /` 回 200、其他根路徑 method 維持 404,執行完整 ingestion check 後部署並驗證新 Cloud Run revision。
3. ingest Dashboard 與 Cloud Run request metadata 顯示 `Test` 實際發出空 body `POST /` 的證據,以測試先行讓該 probe 同樣回 200,且保持 `/v1/emqx/events` 契約不變。
4. 再次部署並重新執行 Dashboard connectivity test;建立 connector、rule 與 action後,以 live 401、Action editor 重開結果與非敏感 custom header 重測記錄 custom headers 不持久化的 Serverless 證據。
5. 以測試先行新增 body credential wrapper 認證與解包,重新部署 immutable ingestion revision；Dashboard action body 改用固定 wrapper,再發送 canonical urination probe,確認 connector connected 與 Firestore 落地。
6. 改寫設定腳本為檢查表產生與前置驗證,移除 API 寫入路徑。
7. 改寫驗證腳本為真實 MQTT device publish 加 Firestore 端到端驗證,沿用 adapter 注入模式並以 hidden TTY 取得既有 device password。
8. 更新 spec、runbook 與 MQTT 串接文件,含 secret 名稱、body credential、TLS Verify 例外與能力損失記錄。
9. 記錄 live acceptance 的安全邊界:Dashboard 人工 user/ACL 可讓訊息經 rule/action 到達 Cloud Run,但模擬 publisher identity 被 ingestion 拒絕；在不修改 live rule、不宣稱 Firestore E2E 成功的狀態下封存,由後續 change 處理 device provisioning 與三項 live delivery 驗收。

回滾策略:在 Dashboard 停用 rule 即可立即停止轉發,不影響 ingestion 服務與既有 Firestore 資料;腳本與文件改動以 git revert 回復。分支 B 若已部署,ingestion 的根路徑改動可獨立回滾,因為它不被任何既有功能依賴。

## Open Questions

- Dashboard 的 action 名稱是否可自訂。已以「識別名稱一律由環境變數提供」的決策使此問題不影響實作。
- Serverless-compatible device provisioning 與真實 device credential handoff 尚未設計；在後續 change 完成前,canonical E2E 與 rule-drift rehearsal 均維持 precondition unmet,不得以 Deployment API 或 Dashboard 模擬 publisher 取代。
