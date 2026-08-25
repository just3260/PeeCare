## Context

PeeCare 已有 Firebase Authentication、Owner-only Firestore reads、可部署的 Member API、實機 registry、EMQX Serverless webhook 與純說明式 Wi-Fi guide。缺少的是把已登入會員、機身 QR 所指向的實機、硬體設定頁輸入的 Pair Code 與 `devices/{deviceId}.ownerUid` 串成一條可驗證且可恢復的首次綁定流程。

硬體已確認以共用 MQTT credential 發布 `peecare/device/1/bind`，QoS 為 0，payload 為 `device_id` 與 `pair_code`。這條 development/MVP 路徑無法提供 per-device cryptographic proof；本設計保留該限制但不得把共用 username 或 payload device_id 描述為硬體身分證明。

## Goals / Non-Goals

**Goals:**

- 讓 QR deep link 或手動序號輸入在登入後開啟同一個 protected onboarding 頁。
- 以 Member API 內的獨立 Claim domain 建立與查詢短效 Claim Session，並由不同 authentication adapter 接受會員與 EMQX 請求。
- 以 8 位數 Pair Code、5 分鐘 TTL、5 個 distinct 錯誤碼上限、HMAC、每台裝置單一 active lock 與 Firestore transaction 完成首次 ownership。
- 讓 QoS 0 的相同 bind 重送對成功與錯誤結果都具冪等性。
- 維持 Web Firestore client 全面唯讀、單一 Owner、既有 ingestion registry 與 projection 完整性。
- 明確接受 Member API runtime 的 `roles/datastore.user` 是 database-wide，並以 repository transaction、route boundary 與 release probes 強制 Claim 的 collection／field／first-owner logical scope。
- 提供可部署、可驗證、可回滾且不洩漏 Pair Code、UID、token 或 webhook credential 的 development 路徑。

**Non-Goals:**

- 不提供 Owner 轉移、解除綁定、分享、多 Owner、factory reset reclaim 或帳號合併。
- 不宣稱共用 MQTT credential 能證明實體裝置身分，也不在本 change 改成 per-device bind credential。
- 不讓 PWA 直接傳 Wi-Fi credential、直接連裝置 HTTP API 或直接寫 Firestore Claim documents。
- 不建立第三個 Cloud Run；未來責任或流量需要時才拆出獨立 Claim deployment。
- 不宣稱 Firestore IAM 或 Firestore Rules 能將 Admin SDK runtime identity 限制到指定 collection／field；真正的 identity-level persistence isolation 與 runtime compromise containment 留給後續架構 change。
- 不自動產生或燒錄機身 QR；本 change 定義 URL contract、PWA parsing 與驗證。

## Decisions

### Claim domain shares Member API deployment but isolates adapters

MVP 在既有 Member API Cloud Run 加入 Claim domain、repository 與三個 routes：會員以 Firebase ID token 建立／查詢 session，EMQX 以獨立 body-wrapper credential 提交 bind。兩個 route group 使用互斥 authentication adapters；CORS 只決定瀏覽器可讀取的 origin，不作為認證。

替代方案是第三個 Cloud Run。它能提供 deployment isolation，但會增加 IAM、Secret Manager、release verification 與 monitoring，而目前 request-based `minInstances: 0` 流量不值得。另一替代是把 device claim 放進 ingestion API；這會把 immutable telemetry persistence 與 ownership mutation 混在同一 domain，因此不採用。

Claim domain 不知道 Fastify、Firebase token、EMQX wrapper 或 CORS；它接受已驗證的 member UID 或 broker envelope，隱藏 Pair Code、TTL、attempt、lock、idempotency 與 transaction。若刪除該 module，新裝置綁定停止，但既有 rename、telemetry 與 Owner reads 不受影響。

### Firestore IAM remains database-wide while logical scope is application-enforced

Member API runtime identity 保留既有 project-level `roles/datastore.user` 與 `roles/firebaseauth.viewer`，另只對兩個核准的 Claim secrets持有 direct `roles/secretmanager.secretAccessor`。Firestore IAM 無法把 Admin SDK 權限限制到 collection、document field 或 first-set-only mutation，Firestore Rules也不約束 Admin SDK；因此 `deviceClaimSessions`、`activeDeviceClaims`、enabled registry reads與首次 `ownerUid` write是 application-enforced logical scope，不是 IAM isolation。

部署 preflight 與 release verification會檢查 runtime identity 的 exact direct project roles，透過 Secret Manager list結果列舉專案 secrets並拒絕任何未核准的 direct binding，且對空白、malformed或duplicate inventory fail closed。Release evidence只使用 `directIamBindings` 描述這項直接綁定稽核，不得宣稱已證明 Secret Manager list結果的外部完整性、group-derived、inherited或 collection-level IAM isolation。Repository transaction與live Claim probes則證明正常應用流程只建立／更新 Claim collections、first-set `ownerUid`，並保留其他 device fields與 duplicate terminal state。

接受此方案的 trade-off 是 runtime compromise仍可能利用 database-wide datastore capability讀寫 Claim domain以外資料；direct IAM audit與application probes無法縮小這個 RCE blast radius。替代方案是拆到具有獨立 persistence boundary的 database／service，但會破壞目前同一 Firestore transaction完成 active lock、session與 registry owner mutation的契約，也違反本 change不建立第三個 Cloud Run的範圍，因此留給後續獨立架構 change。

### QR deep link pre-binds an explicit physical device

QR URL 使用 approved Hosting origin 的 `/connect?deviceId={12-uppercase-hex}`，只攜帶非敏感 deviceId。Protected router guard 保存完整 same-application path；Google popup 或 Email Link 完成後返回同一 deviceId。頁面先顯示序號並要求會員明確確認，確認前不得建立 session。

手動 fallback 使用相同頁面，trim 後將 ASCII a-f 正規化為大寫，再驗證 `^[0-9A-F]{12}$`。不合法、重複 query、外部 return URL、QR 中的 Pair Code／token／UID 一律拒絕或忽略，不得自動建立 session。

替代方案是未綁 deviceId 的 session。這會讓任何合法 publisher 先消耗取得的 code，因此不採用。

### Pair Code uses HMAC and an active device lock

Pair Code 由 server CSPRNG 均勻產生於 `00000000` 至 `99999999`，以字串回傳一次並保留前導零；顯示可分組，但 MQTT canonical form 固定八個 ASCII digits。Session 有 5 分鐘 TTL 與 5 個 distinct 錯誤 code 上限。

Firestore 使用 `deviceClaimSessions/{sessionId}` 保存 memberUid、expectedDeviceId、codeMac、codeKeyVersion、status、attemptCount、最多五筆的 `rejectedCodeMacs`、createdAtMs、expiresAtMs 與 terminal metadata；使用 `activeDeviceClaims/{deviceId}` 指向該裝置唯一 active／recent terminal session。codeMac 為 HMAC-SHA-256(key, sessionId + ":" + deviceId + ":" + pairCode)，key 由獨立 Secret Manager secret 注入，Firestore、log 與 response 均不保存其值。

同一 UID 對同一裝置再次 POST 會 transactionally 將舊 pending session 標成 replaced，並建立新 code；不同 UID 遇到未過期 lock 得到 `claim_in_progress`。Terminal lock 保留到 expiresAt，讓 QoS 0 duplicate 可辨認，之後由後續建立／查詢懶清理；本 change 不要求背景 scheduler。

替代方案是 salted SHA-256；八位數可被離線枚舉，因此不採用。把 Pair Code 明碼加密保存以支援 response replay 會擴張 secret exposure，也不採用。

### EMQX bind transport remains legacy QoS 0

Claim action 只匹配 `peecare/device/1/bind`，只接受 QoS 0、retained false 與 exact payload `{"device_id": string, "pair_code": string}`。Serverless action 送出和 ingestion transport 同型的 exact outer wrapper `webhookAuthorization + event`，但使用不同 connector、Member API Claim URL 與 Claim credential；event 保留 topic、clientId、username、qos、retained、brokerReceivedAtMs、payload。

共用 username 只需等於 deployment 設定的 allowlisted legacy value；clientId 與 payload device_id 會保存並驗證格式，但不被描述為 cryptographic binding。Claim credential 不得通過 ingestion route，ingestion credential 不得通過 Claim route，Firebase token 也不得通過 EMQX route。

Authenticated 且 schema-valid 的 domain outcome一律回 HTTP 202 sanitized acknowledgement，避免 EMQX 對 wrong／expired／conflict 結果反覆 delivery。Invalid Claim credential 回 401；malformed wrapper／event 回 400；暫時性 Firestore failure 回 503，允許 action retry。所有 response 與 structured log 排除 pair_code、codeMac、UID、token、credential 與完整 payload。

### Ownership completes in one Firestore transaction

Bind handler由 payload device_id 讀 active lock、session 與 device registry，並在單一 transaction 內驗證 status、TTL、expectedDeviceId、distinct attempt、codeMac、registry identity、productModel／ingestionStatus 與目前 ownerUid。

錯誤 code 第一次出現才把其 MAC 加入 bounded `rejectedCodeMacs` 並增加 attemptCount；相同錯誤 code 即使不是相鄰重送，只要其 MAC 已存在就零增量。第五個 distinct 錯誤將 session／lock 標成 failed。正確 code 在 ownerUid 缺失時只 merge ownerUid 與 claimedAtMs；ownerUid 等於 session memberUid 時視為冪等成功；其他非空 ownerUid 產生 conflict 且絕不覆蓋。Terminal retry 不再次修改 device。

Transaction 必須保存 deviceId、productModel、ingestionStatus、customName、latest projections、lastReportedAtMs、events 與 dailyStats。Web client rules仍拒絕 devices、claim sessions 與 active locks 的所有 writes，並拒絕 claim collection reads。

### PWA polls server-authoritative session state

PWA API adapter取得目前 Firebase ID token呼叫 POST／GET。Store保存 sessionId、deviceId、expiresAtMs 與狀態；sessionStorage 只保存這些非敏感欄位，不保存 Pair Code。頁面顯示一次 code、倒數與 Wi-Fi／本機設定頁步驟，回到一般網路後有界輪詢 GET。

GET 只向建立 session 的相同 UID回傳 exact `sessionId, deviceId, status, expiresAtMs`；其他 UID與不存在 session同為 404。claimed 後 store 重新載入 owned devices並返回首頁；expired、failed、conflict 顯示可操作但不敏感的重新開始路徑。頁面 reload 若遺失一次性 code，會員明確要求重新產生，POST 取代同 UID舊 session。

裝置端以相同 device_id／pair_code 在第 0、5、10 秒發布三次 QoS 0；PWA 不把 publish 或 HTTP 202當成 Claim 成功，只有 authenticated GET 的 claimed status 是成功來源。

### Shared MQTT credential remains an MVP limitation

共用 MQTT credential 的持有者可替任意 device_id 發布自己的合法 Pair Code，因此本流程只達成會員 session 與 broker message correlation，不達成 per-device hardware attestation。所有 UI、spec、evidence 與 release summary 禁止宣稱已驗證實體持有。

Production hardening gate 是 per-device MQTT credential 或由 inventory 驗證的一次性 factory setup secret。這個 gate 不阻塞 development/MVP，但未完成前不得將 Claim deployment描述為 production-ready。

## Implementation Contract

**Behavior**

- 掃描 approved deep link 後，未登入會員完成 Google／Email Link 登入會返回同一 connect route；登入會員確認 deviceId 後取得一次性八位 Pair Code。
- PWA 能在切換 Wi-Fi 後以 sessionId 恢復查詢，只有 claimed 才重新載入 Owner devices並顯示成功。
- Member API 的 member routes只接受 non-revoked Firebase ID token；EMQX route只接受獨立 Claim wrapper credential；任何 credential cross-use 都被拒絕且零 persistence。
- 一筆正確 bind 在未綁定 registry device 上設定目前 session UID；三次相同 QoS 0 bind 最多產生一次 ownership mutation。
- 五個 distinct 錯誤 codes 使 session failed；相同錯誤 code重送不重複計數。
- 已屬同 UID為冪等成功，已屬其他 UID為 conflict，任何流程都不做 ownership transfer。
- Runtime inventory明載 `roles/datastore.user` 為 database-wide；Claim collection／field／first-owner restriction由 application repository與release probes強制，不描述為 IAM isolation。

**Interfaces and data shape**

- QR／manual route: `/connect?deviceId=68E274BD2A58`。
- Member create: `POST /v1/device-claim-sessions`，exact JSON body `{"deviceId":"68E274BD2A58"}`；201 response含 sessionId、deviceId、pairCode、status pending、expiresAtMs。
- Member status: `GET /v1/device-claim-sessions/{sessionId}`；200 response含 sessionId、deviceId、status與 expiresAtMs，且不含 Pair Code或 UID。
- EMQX ingest: `POST /v1/emqx/device-claims`；exact wrapper含 webhookAuthorization與 event；event metadata加 exact bind payload。
- MQTT contract: topic `peecare/device/1/bind`、QoS 0、retained false、payload device_id為 12碼大寫 hex、pair_code為八位數字字串。
- Session statuses: pending、claimed、expired、failed、conflict、replaced。
- Pair Code TTL: 300000 milliseconds；distinct attempt limit: 5；device retry schedule: 0／5／10 seconds。
- Persistence enforcement inventory: `iam = database-wide-datastore-role-with-direct-binding-audit`、`logicalScope = application-repository-and-release-probe`；release evidence欄位為 `directIamBindings: verified`。

**Failure modes**

- Invalid deviceId、body shape、query、pair code或 envelope得到 canonical 400且零 domain mutation。
- Missing／revoked Firebase token或錯誤 Claim credential得到 canonical 401。
- Foreign session與不存在 session均得到 404；already claimed、claim in progress與 ownership conflict使用固定 canonical codes且不暴露 UID。
- Expired／wrong／terminal bind在通過 webhook authentication與 schema後回 202 sanitized acknowledgement；只有 status GET揭露該會員自己的可操作狀態。
- Firestore transient failure回 503；unexpected errors回 sanitized 500；log只保留 requestId、route class、status code與 allowlisted outcome。
- Missing／extra direct project role、任何未核准 secret的 direct binding、空白或malformed IAM／Secret inventory均在 IAM grant或 Cloud Run revision mutation前 fail closed；這項失敗不代表 group-derived或inherited effective IAM已被證明不存在。
- sessionStorage不可用時頁面仍能在當次 component lifetime輪詢；reload後要求重新掃描或手動輸入。

**Acceptance criteria**

- Member API unit／integration tests覆蓋 CSPRNG格式與 leading zero、HMAC key isolation、TTL邊界、5個 distinct attempts、duplicate wrong code、same-code success retry、concurrent session lock、same／foreign Owner與 field preservation。
- Fastify tests以表格覆蓋三 routes的 method、content type、body size、exact shape、Firebase／Claim credential cross-rejection、sanitized logs與 transient mapping。
- Vue tests覆蓋 QR query、manual normalization、safe returnTo、explicit confirmation、one-time code、sessionStorage redaction、polling terminal states與 owned-device reload。
- EMQX／device tooling tests覆蓋 exact topic、QoS 0、retained false、shared username、wrapper shape、separate secret、connector/rule/action checklist與三次 retry fixtures。
- Firestore Rules Emulator tests證明 Web client不能讀寫 claimSessions／activeDeviceClaims且仍只讀本人 device。
- Deploy／verify tests證明 exact direct project roles、全專案 Secret Manager direct-binding inventory、空白／malformed inventory fail-closed、`__proto__` secret evidence不消失，以及 session creation／credential cross-use／first-owner／duplicate bind只產生核准的 logical mutations。
- `npm run check`、`npm run check:member`、`npm run test:firebase`及相關 development verifier dry-runs通過；Spectra analyze／validate無 Critical或Warning。

**Scope boundaries**

In scope是 Vue onboarding、Member API內 Claim domain、Firestore claim資料與 ownership transaction、database-wide datastore IAM的明確揭露、direct IAM binding audit、application-enforced logical persistence scope、Secret Manager HMAC／webhook keys、development EMQX bind forwarding、ACL／verification、Rules tests與文件。Out of scope是 identity-level collection／field IAM isolation、runtime compromise containment、獨立 persistence database、韌體 SoftAP／HTTP頁實作、production hardware identity、Owner transfer／unbind／sharing、background cleanup scheduler、QR印製與新的 Cloud Run service。

## Risks / Trade-offs

- [共用 MQTT credential無法證明實機身分] → 明確限制在 development/MVP，保留 publisher metadata但不宣稱 attestation，將 per-device credential／factory secret列為 production gate。
- [QoS 0可能遺失或重複] → 裝置三次相同重送、terminal lock保留至到期、成功與錯誤 code比較均冪等，PWA只信任 status GET。
- [八位 Pair Code可被線上猜測] → 5分鐘、5個 distinct attempt、單一 active lock、CSPRNG、HMAC、rate-limit與中性 response。
- [同 Cloud Run混合兩種 caller] → route-scoped互斥 adapters、separate secrets、cross-use tests與最小 IAM release verification。
- [QR deep link被竄改] → deviceId僅作候選值，建立 session前驗證 registry並要求會員明確確認；URL不含 secret。
- [Member API runtime仍有 database-wide datastore capability] → artifacts明確揭露此限制與 RCE blast radius；deployment只核准 exact direct project／secret bindings，repository transaction與release probes強制正常流程的 Claim collection／first-owner logical scope，不宣稱 collection-level IAM isolation。
- [Serverless connector/rule容量耗盡] → Claim使用第二個 connector並記錄2-connector／4-rule平台上限；新增整合前必須重新評估方案。

## Migration Plan

1. 先部署 Firestore／Secret Manager與 Member API Claim routes，但保持 EMQX Claim rule停用；執行 route、IAM、cross-credential與Rules驗證。
2. 部署含 connect route的 Web build，驗證 QR／manual flow可建立 session但不宣稱實機完成。
3. 在 EMQX Dashboard建立第二個 connector與 bind rule/action，使用獨立 Claim credential，先以 ownerless development fixture執行 sanitized dry-run與負例。
4. 以核准實機執行一次 Pair Code bind，確認 ownerUid只寫一次、PWA轉為 claimed、Owner device list重新載入且 telemetry持續正常。
5. 驗證錯誤 code、QoS 0 duplicate、foreign Owner、secret cross-use與rollback evidence後才啟用 onboarding入口。

Rollback先停用 EMQX bind rule，接著回滾 Web與 Member API revision；未完成 session保留至自然到期，已成功設定的 ownerUid不自動刪除。若需要移除測試 ownership，只能使用明確核准且針對標記 fixture的 Admin cleanup，不以 rollback大範圍刪除資料。

## Open Questions

None.
