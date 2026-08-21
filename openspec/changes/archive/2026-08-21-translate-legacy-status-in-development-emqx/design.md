## Context

目前 Arduino 開發韌體發布 `peecare/device/1/status`，payload 混合 online、wet、state、count、pumpSecondsToday 與 batteryV。正式 development ingestion 只接受 canonical urination／battery topics、固定 EMQX envelope、canonical payload schema 與 publisher identity binding；既有 canonical rule 也刻意排除 legacy topic。因此把 legacy 訊息原樣轉送只會得到 unsupported topic 或 publisher mismatch，無法完成實機端到端 smoke test。

`align-emqx-webhook-with-serverless` 已選擇由 Dashboard 人工建立 Data Integration，HTTP action 使用 body credential wrapper，canonical delivery 由真實 MQTT 裝置與 Firestore 查詢驗證。這個 change 以該成果為 prerequisite，不重新設計 connector、ingestion authentication 或 persistence。

Legacy payload 沒有穩定 eventId、boot identity、可信 sequence 或單次 pump duration。`pumpSecondsToday` 是每日累計值，仍依使用者決策暫時映射為單次 `pumpDurationMs`；產生的尿量與每日統計只具串接測試價值。

2026-08-20 的 development EMQX 人工驗收確認實際拓撲為一個 Connected HTTP Server connector 對應兩條 enabled legacy rules 與兩個 Available actions：兩條 rule 都匹配 `peecare/device/1/status`，其中一條輸出 Urination，另一條輸出 Battery。Battery SQL 與 action body 已由 operator 提供作為本次 ingest 的外部 requirement source。

韌體工程師已確認實體 ESP32 的 deviceId 直接取自開發板硬體識別碼，固定輸出保留前導零、無冒號或連字號的 12 碼大寫十六進位字串。這個實體來源格式與合成測試裝置的 `PC-DEV-######` 命名空間分離；目前核准硬體識別碼為 `68E274BD2A58`。

## Goals / Non-Goals

**Goals:**

- 建立兩條只限 development、可分別辨識與移除的 legacy compatibility rules 與 actions，並共用一個已核准 HTTPS connector。
- Urination route 只允許精確 legacy topic、核准 publisher identity、非 retained 線上訊息與合法 pumpSecondsToday 通過；Battery route 只允許精確 legacy topic與合法 0–20V batteryV 通過。
- 讓同一筆合格 legacy status 產生能通過現有 ingestion envelope、device event contract 與 Firestore registry 檢查的 canonical urination 與 battery deliveries。
- 讓實體裝置 inventory 驗證 `^[0-9A-F]{12}$`，並將目前 Arduino compatibility target 對齊 `68E274BD2A58`。
- 讓 checklist、unit verification、paired shape observation、runbook 與停用步驟明確呈現一 connector、兩 legacy rules、兩 actions 的 paired compatibility topology，並把 approved Arduino 來源確認保留為人工佐證。
- 保留 secret redaction、HTTPS connector、Serverless body credential wrapper 與既有 canonical rule 行為。

**Non-Goals:**

- 不修改 Arduino 韌體、正式 canonical payload schema、ingestion validator、Firestore schema 或尿量公式。
- 不修改 canonical battery schema或 ingestion 的五級 battery contract；Battery route 只轉換 `batteryV`，不轉換 wet、state 或 count。
- 不計算 pumpSecondsToday delta，不建立 Redis／資料庫計數器，也不讓 sequence 每筆加一。
- 不承諾 legacy retry 的 stable event identity、精確單次尿量或正確每日統計。
- 不套用至 production，不放寬既有 development device ACL，也不自動刪除已寫入的 compatibility 測試資料。
- 不把 ESP32 ID regex 當作硬體真實性的安全證明，也不收窄通用 device event contract 或淘汰 `PC-DEV-######` 合成測試裝置。
- 不以現有 Firestore event shape、eventId prefix 或 declared delivery values 宣稱已由程式證明 broker-side Arduino provenance；可信來源稽核紀錄不在本 change 範圍內。

## Decisions

### 依使用邊界區分實體與合成裝置 identity

實體裝置 provisioning inventory 對 deviceId 使用 `^[0-9A-F]{12}$`：固定 12 碼、大寫、無分隔符並保留前導零。`68E274BD2A58` 是目前 Arduino 韌體使用且本次 compatibility flow 核准的實機值。clientId、Topic device segment、payload deviceId、Firestore document ID 與 `device-{deviceId}` principal 必須沿用同一值。

通用 device event contract 繼續接受既有 MQTT-safe topic segment，因為 ingestion 同時服務合成測試事件。Test Tool 裝置繼續使用 Firestore `developmentTestTool` marker 判斷資格；ID 符合 ESP32 格式只代表語法正確，實體來源仍須由已登錄 registry、專屬 MQTT credential、principal 與 publisher binding 共同證明。因此不新增跨層 device-kind adapter，也不在 ingestion 依 regex 分流。

替代方案是把通用 deviceId 全面收窄為 ESP32 格式，但會破壞 `PC-DEV-######` fixtures、beta inventory 與 Test Tool。另一替代方案是只看 12 碼格式判斷實體裝置，但任意 publisher 都能偽造字串，不能取代 credential 與 registry binding，因此兩者皆拒絕。

### 使用成對的 legacy Battery 與 Urination rules/actions

Development compatibility topology 使用同一個已核准 HTTPS connector，並建立兩條都精確匹配 `peecare/device/1/status` 的獨立 rules。Urination rule 綁定 urination HTTP action；Battery rule 綁定 battery HTTP action。每條 rule 恰有一個 action，每個 action 都直接建構 Serverless body credential wrapper 與各自的 canonical inner envelope。Dashboard 的人工驗收畫面必須呈現 connector rule count 2、兩條 rule enabled、兩個 action Available，且 note／identity 能清楚區分 Battery 與 Urination。

Template 與 checklist 將 paired compatibility 視為一個 operator-selected topology；enable-ready output 必須同時包含兩條 rule/action contract，不能只啟用其中一條後宣稱完整。兩條 routes 可在故障隔離時分別停用，但完整 rollback 必須停用兩條 rules。Canonical topics仍是兩個 action 送往 ingestion 的固定 envelope topic；此 temporary topology 不要求同一 connector 同時保留第三條 canonical broker-input rule。

替代方案是以單一 rule 綁定兩個 actions，但兩個 event type 的 eligibility、projection 與失敗面不同，單一 SQL result會增加條件耦合，且與已人工驗收的兩 rule/two action topology不符，因此拒絕。另一替代方案是新增轉換 Cloud Run service，但目前映射固定且只限 development，新增部署面與 secret 不符合最小串接目標。

### 以 publisher allowlist 與 payload boundary 限制 legacy 輸入

Compatibility SQL 同時要求：topic 精確等於 `peecare/device/1/status`、clientid 等於設定的 approved legacy clientId、username 等於 approved legacy username、`flags.retain = false`、decoded payload 是 object、online 等於 true，且 pumpSecondsToday 是 integer 或 float、介於 0 與 4294967.295 秒。上限確保乘以 1000 並四捨五入後不超過 uint32 最大值 4294967295。

EMQX Serverless live SQL Test 證明 `SELECT` expression 會在 `WHERE` 排除非法值前求值，因此 decoded payload alias 必須先於任何引用該 alias 的 expression 建立，且 duration projection 使用 `CASE WHEN is_num(...) THEN round(...) ELSE 0 END`。`WHERE` 仍負責拒絕非數字與範圍外值；`CASE` 的 `0` 只是避免 eager evaluation 產生 `select_and_transform_error`，不會讓非法 delivery 通過。

任一條件不符時 rule 產生零 action invocation。retained snapshot 不以偽造 retained=false 的方式轉送；offline payload、缺漏 pumpSecondsToday、字串、負值、NaN／Infinity、超界值與非 object JSON 皆不送往 ingestion，且缺漏或非數字 pump seconds 不得增加 rule failure。這讓 compatibility route 的 publisher spoofing 面限於已知 principal 與精確 topic，而不是允許任何 legacy publisher宣稱 `68E274BD2A58`。

替代方案是只依 topic 過濾並硬寫 canonical clientId，但任何能發布到 legacy topic 的 principal 都可替測試裝置寫入事件，因此拒絕。

Battery rule 的實際 SQL boundary 與 Urination rule 不相同：它先建立 `json_decode(payload) AS legacyPayload`，以 `CASE` 將非數字 batteryV 投影為 -1，接著只讓 JSON object 且 `batteryV` 為數字、介於 0 與 20V 的 delivery 通過。它不依賴 `online` 或 `pumpSecondsToday`，也不把 source clientId、source username或 retain flag當成 SQL filter；因此 topic publish authorization仍由既有 development broker ACL負責。這個差異必須在 template、checklist與風險說明中明確呈現，不能誤稱兩條 rules 有相同 eligibility。

### 將合格 delivery 建構為固定目標的 canonical urination envelope

Compatibility action 的 inner envelope 固定 topic 為 `products/pc-mini/devices/68E274BD2A58/events/urination`、clientId 為 `68E274BD2A58`、retained 為 false，保留來源 qos 與 approved legacy username，並把 `publish_received_at` 同時放入 brokerReceivedAtMs 與 payload.recordedAtMs。

Payload 固定 `schemaVersion: 1`、`eventType: urination`、`deviceId: 68E274BD2A58`、`sequence: 1`、`firmwareVersion: 1.0.0`、`flushDurationMs: 0`。pumpDurationMs 使用受 `CASE` 保護的 EMQX `round(pumpSecondsToday * 1000)`，例如 10.4 秒輸出 10400 毫秒；只有已通過 `is_num` 與範圍條件的 delivery 可到達 action。eventId 使用 `compat:68E274BD2A58:` 加 `uuid_v4_no_hyphen()`，符合事件識別字元與長度限制並讓每次合格 delivery 有不同 Firestore document identity。

Action outer object仍恰含 webhookAuthorization 與 event；credential 使用 reference token，不能出現在 dry-run、summary、error 或 log。wet、state、count、batteryV 與完整原始 payload 不進入 inner envelope。

替代方案是固定 eventId `68E274BD2A58:1001`，但第二筆不同 payload 會成為 event_id_conflict，因此拒絕。使用 Broker timestamp 作為 eventId 仍有同毫秒碰撞風險，且會把 recorded time誤當永久 identity，因此使用 UUID。

### 將 batteryV 轉成 canonical battery envelope

Battery SQL 將 numeric `batteryV` 保留為 `batteryVolts`，以 `round(batteryVolts * 1000)` 產生 0–20000 的整數 `batteryVoltageMv`，並依門檻映射五級 `batteryLevelPercent`：`>= 8.5` 為 100、`>= 8.0` 為 75、`>= 7.5` 為 50、`>= 7.0` 為 25，其餘合法非負值為 0。缺值、非數字、負值與大於 20V產生零 result。

Battery action 的 inner envelope 固定 topic為 `products/pc-mini/devices/68E274BD2A58/status/battery`、clientId為 `68E274BD2A58`、username為 `Peecare`、retained為 false，並保留 source qos與 `publish_received_at`。Payload固定 `schemaVersion: 1`、`eventType: battery`、`deviceId: 68E274BD2A58`、`sequence: 1`、`firmwareVersion: 1.0.0`、計算後的batteryLevelPercent與batteryVoltageMv；eventId使用 `compatbattery:68E274BD2A58:` 加32字元無連字號 UUID。Outer object恰含webhookAuthorization與event。

替代方案是只傳 batteryVoltageMv 或輸出任意百分比，但現有 canonical battery contract要求 batteryLevelPercent恰為0／25／50／75／100，且已驗收 SQL 使用上述電壓門檻，因此拒絕。

### 接受 per-delivery identity 與累計 duration 的 test-only 語義

Legacy message 沒有穩定 event identity，compatibility layer 無法辨識 MQTT retry、裝置重送與真正的新狀態。每條合格 route都產生自己的新UUID：Urination使用`compat:` prefix，Battery使用`compatbattery:` prefix。同一筆legacy status最多產生兩個不同event documents；重送會再產生新的paired documents。固定sequence 1只滿足schema，不能用於排序或gap diagnosis。

pumpSecondsToday 是累計值，但 mapping 把每次 delivery 的完整累計秒數當成單次 pump duration。Persistence 會依既有公式估算尿量並累加 daily stats，因此 compatibility mode 的 event document 與 aggregate 都必須視為測試資料。eventId 的 `compat:` prefix提供人工辨識與後續受控清理依據，但此 change 不執行刪除。

替代方案是由 EMQX 保存上一筆數值並計算 delta／sequence，但 Rule SQL 沒有此 change 核准的持久狀態，加入 Redis 又會擴大部署與 retry 複雜度，因此延後到韌體正式 publisher 解決。

### 使用 paired mode-aware verification 驗證雙事件

設定工具在 compatibility disabled 時維持既有 sanitized disabled checklist。在 enabled 時同時驗證兩條 rule identities、各自 SQL boundary、兩個 action bodies、shared connector reference、固定 target identity、Urination duration conversion、Battery voltage與tier conversion及兩種UUID prefix，並輸出需在Dashboard建立／啟用的paired fields；工具仍不得呼叫EMQX rule/action mutation API。

Enabled verifier先記錄驗證開始時間，在operator人工聲明已觸發一筆帶有已知pumpSecondsToday與batteryV的legacy status後，於bounded polling內分別找出恰一筆`compat:` Urination event與恰一筆`compatbattery:` Battery event。兩筆event的broker timestamp與qos必須符合declared delivery；Urination比對declared transport username與rounded pump duration，Battery比對固定username `Peecare`、rounded voltage及五級battery level。結果順序不作保證，summary不得輸出payload、eventId或credentials，且只能回報`paired_shape_observed`與`human_attestation_required`，不得宣稱來源 provenance 已由程式驗證。

Compatibility shape observation要求 Firestore registry 中 `devices/68E274BD2A58` 存在、deviceId／productModel相符且 ingestionStatus enabled。若 prerequisite、operator-declared publisher identity、expected pump seconds、expected battery volts或操作者觸發條件缺失，驗證以 typed precondition failure 結束。Firestore shape本身無法區分 approved Arduino 與持有 webhook credential 的 synthetic publisher，因此工具不得把成功觀察描述為外部來源證明；operator必須另行人工佐證觸發來源。零筆、任一類型多筆、只出現一種event或欄位不符都必須回typed failure。

### 以停用兩條 rules 作為回滾邊界

Battery與Urination rules/actions具有獨立identity。停用其中一條只停止對應event type；完整rollback必須先後停用兩條rules，不需修改shared connector或ingestion。確認無新`compat:`與`compatbattery:` events後，才可從Dashboard移除兩個actions與兩條rules；既有events與aggregates保留供稽核，任何資料清理都需另行核准。

Runbook必須醒目標示enable前會污染`68E274BD2A58` urination daily stats、battery history與latest battery projection，並要求operator在測試結束、韌體改發canonical topics或source identity無法確認時停用兩條compatibility rules。

## Implementation Contract

**Observable behavior**

- 預設執行設定／驗證命令時，系統維持 canonical-only mode，legacy topic不產生 Firestore event。
- 明確啟用 paired compatibility mode且設定必要inputs後，verifier若在觀察窗內找到恰一筆`68E274BD2A58` canonical urination event與恰一筆canonical battery event，回報`paired_shape_observed`；兩者順序不保證，來源 provenance仍標記`human_attestation_required`。
- `pumpSecondsToday: 10.4` 產生 `flushDurationMs: 0` 與 `pumpDurationMs: 10400`；sequence固定 1，recordedAtMs等於該 delivery的brokerReceivedAtMs，eventId以 `compat:68E274BD2A58:` 開頭並接32字元無連字號 UUID。
- `batteryV: 7.74`產生`batteryVoltageMv: 7740`與`batteryLevelPercent: 50`；eventId以`compatbattery:68E274BD2A58:`開頭並接32字元無連字號UUID。
- Urination route對retained、offline、publisher identity不符、payload非object、pumpSecondsToday缺漏／非數字／負值／超界產生零action result；Battery route對payload非object、batteryV缺漏／非數字／負值／高於20V產生零action result。
- pumpSecondsToday缺漏或非數字時，受保護的 duration projection不得產生 `select_and_transform_error` 或增加 rule failure。
- 一筆只符合其中一條route的legacy status只產生該event type，不能因另一條route零result而把成功route視為失敗。

**Interface and data shape**

- Template定義獨立Urination與Battery compatibility rule/action區段，兩條rule都精確匹配`peecare/device/1/status`，各綁定一個action並沿用同一connector與`{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}` reference。
- Runtime inputs包含一個明確paired enable flag、approved legacy MQTT clientId、approved legacy MQTT username、live verification expected pumpSecondsToday、expected batteryV與expected qos；identity不得含換行或null且須為bounded non-empty strings，pump seconds與battery volts必須符合各自映射範圍。
- Compatibility inner envelope恰含 topic、clientId、username、qos、retained、brokerReceivedAtMs、payload；payload恰含 schemaVersion、eventId、eventType、deviceId、sequence、recordedAtMs、firmwareVersion、flushDurationMs、pumpDurationMs。
- Battery inner envelope使用相同event outer keys；payload恰含schemaVersion、eventId、eventType、deviceId、sequence、recordedAtMs、firmwareVersion、batteryLevelPercent與batteryVoltageMv，username固定為`Peecare`。
- Sanitized checklist與verifier summary只輸出mode、兩組rule/action identity、固定target identity、每個verification name與status，不輸出secret、MQTT password、完整payload或eventId。

**Failure modes**

- prerequisite change未完成、shared connector未驗收、target registry不一致或paired live inputs缺失時，不輸出可啟用的compatibility checklist並回typed precondition failure。
- 任一template route的topic、eligibility、fixed fields、round conversion、battery tier、UUID prefix、body wrapper或shared connector reference不符時，configuration validation以非零狀態結束，且不呼叫EMQX mutation API。
- EMQX SQL test對任一負例仍產生 output時，Dashboard設定不得啟用。
- enabled shape observation在bounded polling內找不到任一required event type、任一類型找到多筆、只找到單一event type、欄位不符或Firestore讀取失敗時，以不同typed code失敗，不把舊event誤判為新shape；成功也不得升格為source provenance證明。
- 任何error、summary、test snapshot與runbook不得包含resolved webhook secret、MQTT password或完整legacy payload。

**Acceptance criteria**

- configure-emqx-webhook unit tests覆蓋disabled default、paired enabled complete inputs、兩rule/two action/shared connector topology、Urination 10.4秒映射與既有負例、Battery 0–20V boundary、round mV、五級tier及invalid battery負例，並斷言零mutation。
- verify-emqx-webhook unit tests覆蓋disabled legacy non-delivery、enabled paired matching events、任一類型timeout／multiple matches／field mismatch、registry mismatch與redaction。
- EMQX Dashboard SQL Test對Urination與Battery SQL分別執行文件化正反例；Battery具體例子至少涵蓋6.9→0%、7.0→25%、7.5→50%、8.0→75%、8.5→100%、7.74→7740mV/50%，以及missing、string、negative與20V以上zero result。
- Paired shape observation以operator宣告的pumpSecondsToday、batteryV與qos比對Firestore恰一筆新Urination compatibility event與恰一筆新Battery compatibility event；成功summary恰含`paired_shape_observed`與`human_attestation_required`，不宣稱approved Arduino provenance。
- 人工驗收另行佐證Arduino觸發來源，並確認一個Connected connector、兩條enabled legacy rules、每條恰一個action及兩個Available actions；現有device event contract、ingestion與development checks全部通過，source scan確認production設定與code不含legacy compatibility enablement。

**Scope boundaries**

範圍內：實體development device inventory格式與一致性驗證、development EMQX paired legacy template與sanitized checklist、paired mode-aware verification與unit tests、runbook、MQTT integration文件、npm command wiring、`development-legacy-status-compatibility`新spec，以及`development-emqx-webhook`與`development-device-mqtt-identity`delta specs。

範圍外：Arduino firmware、production broker、device event schema、ingestion authentication／validation、Firestore persistence／aggregation邏輯、Redis或其他counter store、ACL變更與測試資料刪除。

## Risks / Trade-offs

- [Legacy重送被存成不同event] → eventId加 `compat:` prefix並把能力限於短期smoke test；正式韌體仍須提供stable eventId。
- [單一legacy重送同時複製兩種event] → Urination與Battery使用不同prefix並在runbook標記paired test data；verification以event type分組，避免把兩筆預期結果誤判為multiple matches。
- [每日累計秒數被重複加入單次事件與daily stats] → runbook在enable前警告資料污染，只使用核准的 `68E274BD2A58` development實體裝置並禁止production。
- [12 碼字串被偽裝成實體硬體] → regex只用於實體inventory語法；可信來源仍要求registry、專屬credential、principal與publisher binding。
- [硬寫canonical clientId削弱publisher binding] → rule同時filter精確source clientId與username，保留username供transport audit，且預設disabled。
- [UUID函數或SQL expression與Serverless實際版本不相容] → enable前以Dashboard SQL Test逐一驗證正反例；任一不符即維持disabled。
- [Dashboard SQL Test 無 retain flag 且 SELECT eager evaluation 早於 WHERE rejection] → retain boundary 改由真實 MQTT delivery 驗證；decoded alias 前置並以 `CASE` 保護 arithmetic，使非法型別成為零 result 而非 rule failure。
- [Battery SQL未過濾source identity、online或retain] → 明確記錄與Urination eligibility不同，依既有broker ACL限制topic publisher；如需收緊SQL boundary必須另行ingest，不在本次把未驗收條件寫成既有行為。
- [Firestore compatibility shape可由非Arduino來源偽造] → 自動結果降級為`paired_shape_observed`並顯示`human_attestation_required`；operator以人工紀錄佐證Arduino觸發，未來若需code-verified provenance則另建broker-side audit evidence change。
- [兩條rules無法原子停用] → runbook將partial disable視為degraded state，完整rollback逐條停用並確認兩種prefix都停止新增。
- [現有active change同時修改webhook檔案] → apply前先完成並archive `align-emqx-webhook-with-serverless`，再以其final artifacts為基線，避免覆寫未完成工作。
- [停用後Firestore仍保留測試event與aggregate] → 不自動破壞性清理；event prefix支援後續另案盤點與核准清理。

## Migration Plan

1. 完成並驗收 `align-emqx-webhook-with-serverless`，確認canonical connector、body credential wrapper及兩個canonical topics可用。
2. 更新template、checklist、tests與文件，使paired compatibility flag預設disabled；執行全部local checks。
3. 在Dashboard建立disabled的Urination與Battery actions/rules，逐條以SQL Test執行正例及全部負例。
4. 核對`68E274BD2A58` registry與approved legacy source identity，向operator顯示urination stats與battery projection污染警告後才啟用兩條rules。
5. 啟動paired live verifier並讓Arduino送出一筆包含已知pumpSecondsToday與batteryV的status，確認恰兩筆新event及所有固定／計算欄位。
6. 完成串接驗收後停用兩條compatibility rules；韌體改發canonical topics後移除兩個actions與兩條rules。

Rollback：依序停用Battery與Urination compatibility rules；shared connector、ingestion與既有events不變。待確認無新`compat:`或`compatbattery:` event後才人工移除兩個actions與兩條rules，不自動刪除Firestore資料。

## Open Questions

無；approved legacy clientId與username是enable時的runtime prerequisite，不影響artifact與implementation contract。
