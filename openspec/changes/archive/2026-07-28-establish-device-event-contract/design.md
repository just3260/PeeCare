## Context

目前原型由瀏覽器訂閱 peecare/device/1/status，Payload 使用 wet、count、urineToday 等畫面導向欄位。目標架構改為裝置發布原始事件，EMQX 將事件交給 Cloud Run，再由後端驗證、去重、保存與計算。韌體、EMQX、Cloud Run 與後續 Vue Web App 因此需要一個不依賴任一程式語言、可由固定案例驗證的共同邊界。

這個 change 只建立版本 1 契約套件與驗證工具，不修改目前 PWA，也不實作 Webhook 或 Firestore。契約必須容許後端尚未取得正式尿量校正公式，因此排尿事件只傳送原始流程時間。

## Goals / Non-Goals

**Goals:**

- 建立排尿與電量事件的正式 MQTT Topic 與 Payload 契約。
- 以 JSON Schema 2020-12 作為可供韌體、後端及測試工具共用的規範來源。
- 明確定義事件版本、識別、重送、單位及裝置時間語義。
- 提供能在本機重複執行的正例、反例與重送 fixture 驗證。
- 讓後續 Cloud Run ingestion 與實機整合 change 不需重新發明事件格式。

**Non-Goals:**

- 不實作 EMQX Webhook HTTP envelope、Authorization Header 或 Secret 驗證。
- 不實作 Firestore 寫入、事件去重交易、每日彙總或 Web 畫面。
- 不定義 Heartbeat、Last Will、在線狀態、Command、Claim、Provisioning 或 OTA Payload。
- 不定義尿量校正公式或硬體型號專屬的合理運轉時間範圍。
- 不修改或移除目前 public/app.js 中的原型 MQTT 程式；該工作屬於 Vue 遷移 change。

## Decisions

### 以版本化 JSON Schema 作為契約來源

契約套件放在 contracts/device-events，使用 JSON Schema Draft 2020-12。common-event.v1.schema.json 定義共用欄位，排尿與電量 schema 透過 $ref 重用共同定義，並以 unevaluatedProperties: false 拒絕未宣告欄位。每個事件 schema 使用 const 限定 schemaVersion 與 eventType。

選擇 JSON Schema 而不是 TypeScript 型別，是因為 Arduino 韌體、Cloud Run 與測試工具不保證使用相同語言。只用 Markdown 表格則無法自動驗證 fixture。

### 依事件類型分離 Topic 並交叉核對身分

版本 1 使用以下 Topic：

- products/{productModel}/devices/{deviceId}/events/urination
- products/{productModel}/devices/{deviceId}/status/battery

productModel 與 deviceId 每個 segment 必須符合 [A-Za-z0-9][A-Za-z0-9_-]{0,63}，不得包含 MQTT 萬用字元、斜線或空白。Payload 必須再次包含 deviceId；驗證工具會確認 Topic 中的 deviceId 與 Payload deviceId 相同。productModel 暫不重複放入 Payload，以 Topic 作為路由資訊，後續 ingestion 再以裝置註冊資料核對型號。

不採用單一 status Topic，因為它會混合不同保存策略與驗證規則。Topic 不加入 v1 segment；相容性由 Payload schemaVersion 管理，避免每次 schema 演進都重建 Broker ACL。

### 固定事件識別與重送語義

所有事件必須包含：

- schemaVersion：固定為整數 1。
- eventId：1 至 128 字元，符合 [A-Za-z0-9][A-Za-z0-9._:-]{0,127}。
- eventType：固定為 urination 或 battery。
- deviceId：符合 Topic segment 的格式。
- sequence：0 至 4294967295 的整數。
- recordedAtMs：UTC Unix epoch milliseconds，或在裝置沒有可信時間時為 null。
- firmwareVersion：符合 Semantic Versioning 核心版本及可選的 pre-release／build metadata。

eventId 是跨重送的冪等識別；同一事件重送必須逐欄位保持相同。sequence 用於排序、漏訊診斷及韌體觀測，重新開機或計數器循環不影響 eventId 的唯一性，因此 sequence 不作為去重鍵。

不指定 UUID 格式，因為微控制器可採用安全亂數識別或由持久裝置識別與本機計數器組合產生；字元集合仍受限制，確保能安全作為 Firestore Document ID 候選值。

### 使用明確單位與傳輸邊界

排尿事件必須包含 flushDurationMs 與 pumpDurationMs，兩者均為 0 至 4294967295 的整數。此上限對應無號 32 位元傳輸邊界；各商品型號的實際合理範圍由後續 ingestion 驗證，不在通用裝置契約內硬編碼。

電量事件必須包含 batteryLevelPercent，且只能是 0、25、50、75、100。batteryVoltageMv 為選填欄位；存在時必須是 0 至 20000 的整數。欄位缺少代表硬體未提供原始電壓，不以 null 或 0 混用未知狀態。

所有 schema 拒絕 JSON 型別轉換，例如字串 "3000" 不得當作整數 3000。

### 以裝置時間候選值產生混合時間來源

recordedAtMs 為必填但可為 null。裝置只有在時鐘已同步為 UTC 時才可傳送整數；沒有可信時間時必須傳送 null，不可填入開機後經過時間或預設 epoch。

後續 ingestion 取得 receivedAtMs 後，依下列規則產生 effectiveAtMs 與 timeSource：

1. recordedAtMs 為整數、不得早於 2026-01-01T00:00:00Z，且不得晚於 receivedAtMs 五分鐘時，effectiveAtMs 使用 recordedAtMs，timeSource 為 device。
2. recordedAtMs 為 null、早於允許下限或超過未來容忍值時，effectiveAtMs 使用 receivedAtMs，timeSource 為 server。
3. 原始 recordedAtMs 永久保留，時間回退不得覆寫裝置提供值。

固定歷史下限能拒絕未同步裝置常見的 1970 epoch，同時不對離線補送設定最長天數。五分鐘未來容忍值涵蓋小幅時鐘偏差，但避免事件被歸入明顯尚未發生的時間。

### 以 fixture manifest 驗證結構與跨欄位規則

有效 fixture 使用 topic 與 payload envelope，驗證工具先解析 Topic，再以對應 JSON Schema 驗證 payload。重送 fixture 包含 original 與 retry 兩次 delivery，驗證兩者 Topic、eventId 與完整 Payload 相同。無效 fixture manifest 為具名稱、輸入與預期錯誤代碼的案例陣列，至少覆蓋未知欄位、錯誤 schemaVersion、Topic／Payload Device ID 不一致、字串型 duration、非法電量級距、無效 eventId 及無效 recordedAtMs。驗證工具遞迴發現 fixtures 下所有 JSON 檔，依 valid、invalid、retry、time-source 群組處理；放在未知群組的 JSON fixture、無法讀取或解析的 JSON，以及缺少必要成員或型別錯誤的 manifest 都以 fixture_format 安全拒絕，避免新增案例被靜默漏驗或以原始 stack trace 終止。完整套件至少必須包含有效排尿、有效電量、相同重送及具名反例；缺少任一類別時不得以零案例或部分案例成功。

contracts/device-events/package.json 提供 npm test 命令。驗證成功時程序輸出案例總數並以狀態碼 0 結束；任何有效案例失敗、無效案例意外通過、預期錯誤代碼不符或重送內容改變時，以非零狀態碼結束並列出 fixture 名稱與實際錯誤。

## Implementation Contract

**Observable behavior**

- 執行 contracts/device-events 套件的 npm test 後，所有正例、反例與重送 fixture 都會被載入並驗證。
- 排尿與電量事件能依 Topic 選到唯一 schema；不支援的 Topic 會回報 unsupported_topic。
- 有效 fixture 通過時不產生驗證錯誤；無效 fixture 必須以 manifest 指定的錯誤代碼被拒絕。
- 驗證器不得修改、補值或型別轉換 Payload。

**Interface and data shape**

- Topic segment 使用 ASCII 英數字、底線與連字號，長度 1 至 64。
- 共用 Payload 欄位為 schemaVersion、eventId、eventType、deviceId、sequence、recordedAtMs、firmwareVersion。
- urination Payload 另外包含 flushDurationMs、pumpDurationMs。
- battery Payload 另外包含 batteryLevelPercent，並可包含 batteryVoltageMv。
- fixture envelope 使用 topic 與 payload；重送 fixture 使用 original 與 retry；無效 manifest 的每個案例使用 name、input、expectedError，契約要求的七個核心反例另以 covers 標記其 coverage ID。

**Failure modes**

驗證工具提供 unsupported_topic、topic_format、device_mismatch、schema_validation、retry_mismatch、fixture_format 與 fixture_expectation 七種穩定錯誤代碼。fixture_expectation 專門表示 fixture 的實際結果與 manifest 預期不一致，避免測試工具輸出未記錄的臨時錯誤字串。CLI 會把 fixture 名稱、錯誤代碼與 AJV 摘要寫到標準錯誤，不輸出憑證或其他秘密。

**Acceptance criteria**

- 在 contracts/device-events 執行 npm test，程序以狀態碼 0 結束並報告全部 fixture 通過。
- 將任一有效 fixture 的 deviceId 改成與 Topic 不同後，測試以 device_mismatch 失敗。
- 將 batteryLevelPercent 改成 30 後，測試以 schema_validation 失敗。
- 將 retry Payload 的 pumpDurationMs 改變後，測試以 retry_mismatch 失敗。
- 所有 JSON Schema 能以 AJV 2020 strict mode 載入，不出現 unknown keyword 或 unresolved reference。

**Scope boundaries**

本 change 的實作範圍僅限 contracts/device-events 契約套件、schema、fixture、驗證腳本與說明文件。Cloud Run、Firebase、Vue、EMQX 設定及韌體程式均不在範圍內。

## Risks / Trade-offs

- [Risk] Topic 不含 schema 版本，Broker 無法只靠 Topic 區隔版本 → 後續 ingestion 必須先讀取 schemaVersion，並在停止支援舊版前維持明確的相容性政策。
- [Risk] 通用 uint32 duration 上限無法攔截馬達異常長時間運轉 → 後續 ingestion 依 productModel 與校正設定套用更窄的合理範圍。
- [Risk] 自訂 eventId 格式比 UUID 更寬鬆 → 限制安全字元與長度，並要求裝置端測試跨重啟不重複。
- [Risk] recordedAtMs 過去時間不設最大離線天數，錯誤但看似合理的時鐘仍可能通過 → 永久保留 receivedAtMs 與 timeSource，並在連線策略 change 決定裝置時鐘健康度訊號。
- [Risk] 契約套件使用 Node 驗證工具，但韌體端無法直接執行 → JSON Schema 與 fixture 保持語言無關，韌體可用同一 fixture 建立自身序列化測試。

## Migration Plan

1. 先發布契約套件並以 fixture 固定版本 1 行為。
2. Cloud Run ingestion change 以版本 1 schema 與錯誤代碼實作驗證。
3. 實機相容性 change 讓韌體發布新 Topic 與 Payload，並用相同 fixture 驗證序列化結果。
4. Vue 遷移完成前，現有原型可繼續使用舊 Topic，但不得將舊 Payload 寫入正式 Firestore。
5. 新端到端管線驗收後輪替目前暴露的共用 MQTT 憑證，並停用舊 Topic 的公開 Web 訂閱權限。

若後續消費端尚未準備完成，可回復其部署版本並暫停新 Topic 發布；契約檔案與 fixture 保留，避免回滾期間產生第二套未記錄格式。
