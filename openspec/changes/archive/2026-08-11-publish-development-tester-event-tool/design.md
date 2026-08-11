## Context

`scripts/test-tool.mjs` 是 loopback-only Node proxy，UI可輸入任意 local base URL與 EMQX webhook secret，並以 Emulator-only `Bearer owner`直接建立/讀取 Firestore device。這些行為適合本機開發，但若直接允許 Cloud Run host、綁定公開介面或打包成 executable，共享 ingestion secret會進入 tester控制的環境，任意 proxy也形成 SSRF與未受限 event injection surface；live Firestore Rules則會拒絕 Emulator fake token。

既有 Web App已有 Firebase Auth、owned-device state與 protected routes。development Ingestion API已有 canonical validation、deduplication與 Firestore persistence，且 Cloud Run runtime從 Secret Manager接受 current/previous webhook secret。新的工具應重用這兩個已驗證邊界：browser用 Firebase identity，Test Tool API在 server-side重新授權並將 bounded typed request轉成 canonical ingestion request。

## Goals / Non-Goals

**Goals:**

- 第一階段讓 operator 在本機啟動既有測試工具，以 fail-closed development profile將事件送到已部署的 development Ingestion API，並開啟 Firebase Hosting Web App觀察投影結果。
- 第一階段維持 Node server只監聽 loopback、將 cloud upstream限制為核准的 exact origins／paths，且 webhook secret只存在於本機 Node process讀取的 operator-only file。
- 讓已登入 beta tester從 development Web App對自己被 operator標記的 test device產生排尿或電量事件。
- browser不持有 ingestion secret、不選 upstream URL、不建立 device registry、不提交完整 EMQX envelope。
- Test Tool API重新驗證 Firebase ID token、Owner、development marker、enabled status、request schema、rate/quota與 exact origin。
- Server生成 canonical topic、event identity、sequence與 transport metadata，再呼叫既有 development Ingestion API。
- 將 test-tool API納入 immutable Cloud Run deployment、Firebase integration、Web build config、live smoke與 rollback dry-run。
- 保留本機 `scripts/test-tool.mjs`現有 Emulator workflow。

**Non-Goals:**

- 第一階段不部署 `scripts/test-tool.mjs`、不新增公開 route或 service、不允許本機工具寫入 live Firestore registry，也不取代 operator既有的 device provisioning流程。
- 不建立桌面 executable、mobile native app或公開 anonymous simulator。
- 不讓 tester建立、刪除、轉移或任意更新 Firestore device。
- 不讓 tester指定 project、product model、topic、eventId、sequence、timestamp、username、Authorization header或 upstream URL。
- 不模擬 duplicate/conflict、retained message、錯誤 topic、任意 JSON payload或 EMQX delivery failure；負面 contract測試仍由本機 fixtures與 verifier負責。
- 不取代實機 MQTT/EMQX end-to-end certification。
- 不在本 change實作 App Check；後續 access-protection change可在既有 verifier seam疊加 attestation。

## Decisions

### Local development-cloud bridge remains loopback-only

第一階段在現有 Node工具加入 `local`與`development-cloud`兩個明確 profile。兩者都只監聽`127.0.0.1`；local profile保留既有 Emulator loopback操作，development-cloud profile則只接受核准的 Hosting origin、Ingestion origin及 Member API origin。Cloud origins必須是credential-free HTTPS origin、符合固定project/service identity，且 proxy只可執行 Ingestion `GET /healthz`、Member API `GET /healthz`及 Ingestion `POST /v1/emqx/events`；任何其他host、path、method或caller-supplied Authorization在fetch前拒絕。

Server新增sanitized config endpoint供頁面辨識profile與顯示非敏感origins。Development-cloud profile透過`PEECARE_TEST_TOOL_INGESTION_SECRET_FILE`讀取operator-only secret file，僅在送往固定Ingestion event path時由server注入Bearer header；secret不得進入HTML、DOM、localStorage、curl preview、proxy request body、response或log。缺少、空白、權限不可讀的secret file或未核准origin使process在listen前失敗。這比開放remote host allowlist更能限制SSRF與secret exfiltration，同時保留本機operator調整完整event envelope的診斷能力。

### Hosted Web observation handoff

Development-cloud profile不使用Emulator的`Bearer owner`寫法，也不從live Firestore REST讀取customName。建立／更新device與custom-name refresh在UI中停用並說明必須先由既有operator provisioning建立owner與marked test device；事件按鈕只針對operator輸入的development device ID送往Ingestion API。

頁面顯示固定environment banner與核准的`https://petcare-c7483.web.app`按鈕，讓operator在獨立tab使用正常Firebase Auth登入，並到首頁、歷史或統計確認同一device的event projection。此handoff只開啟Hosting，不傳送token、secret、device設定或query參數，避免local tool與Web session建立新的credential channel。第一階段完成條件是local-to-cloud event與Hosted Web observation可重現；authenticated `/test-tool` route與dedicated Test Tool API仍是後續階段。

### Test tool lives behind existing member auth as a protected web route

新增 `/test-tool` protected Vue route，直接使用既有 Firebase Auth state與 route guard。頁面不提供 email/password表單，也不保存 token；API adapter每次 request從 current Firebase user取得 fresh ID token。Device selector只顯示 Test Tool API回傳的 eligible devices，避免以 Web Firestore query結果猜測 server authorization。

選擇整合既有 Web而不是獨立 Cloud Run HTML或 executable，可重用登入、PWA、Hosting、route guard與 deployment config，並減少另一套前端 credential lifecycle。Route不加入一般產品底部導航，只供 development build與核准 tester URL使用；production-like target或缺少 API URL時 build fail closed。

### Dedicated API exposes typed operations, never generic proxy

獨立 `services/test-tool-api`只暴露：

- `GET /health`：public liveness，不回傳 config。
- `GET /v1/test-devices`：需 Firebase ID token，回傳 caller有權使用的 marked devices。
- `POST /v1/test-devices/:deviceId/events`：需 Firebase ID token，接受 exact urination或 battery measurement body。

Urination body只允許 `eventType`、`flushDurationMs`、`pumpDurationMs`；battery body只允許 `eventType`、`batteryLevelPercent`與 optional `batteryVoltageMv`。Body上限8 KiB，拒絕 extra properties、method override、client-provided auth/header/url/topic/identity/transport欄位。CORS只允許 exact `https://petcare-c7483.web.app`，但 authorization仍由 token/Owner完成。

不採用現有 `/api/send` generic proxy，因為 allowlist host仍不能限制 method、path、headers與 secret exfiltration。

### Owner and development marker are rechecked server-side

Server先 revoked-aware驗證 Firebase ID token，只取 decoded UID；再於 Firestore transaction讀取 `devices/{deviceId}`，要求 document ID與 `deviceId`一致、`ownerUid`等於 decoded UID、`ingestionStatus: enabled`、合法 `productModel`，且 `developmentTestTool` exact等於 `{ enabled: true, marker: "petcare-c7483-beta-v1" }`。Missing、foreign、disabled或 unmarked device統一回 `404 test_device_not_found`，避免序號探測。

Eligible-device listing套用相同 parser與 owner/marker條件，只回 `deviceId`與 resolved `displayName`，不暴露 registry raw shape。Firestore Web client仍然唯讀；operator透過既有 admin provisioning流程設定 marker，tester不能變更。

### Server generates canonical event identity and forwards with mounted secret

Test Event Service從 registry取得 product model，從 usage transaction取得 sequence，並以 cryptographic UUID建立 `tt:<deviceId>:<uuid>` eventId；server設定 `recordedAtMs`及 `brokerReceivedAtMs`為目前時間、`firmwareVersion: "0.0.0-test-tool"`、`clientId: deviceId`、`username: "development-test-tool"`、QoS 1與 `retained: false`。Topic依 event type與 registry product model產生，payload只含 canonical contract欄位與 validated measurements。

Ingestion client只接受 deployment manifest中的 exact HTTPS origin與固定 `/v1/emqx/events` path，Authorization從唯讀 mounted secret file取得；不得接受 browser URL/header或把 resolved secret放入 object inspection/log。Upstream `201`與 `200`映射為 sanitized success；401/403視為 server configuration failure，422映射 validation/ineligible，503可重試，其他 response回一般 upstream failure。

### Firestore usage ledger enforces bounded development rate

同一 Firestore transaction完成 device authorization與 `developmentTestToolUsage/{sha256(projectId + ":" + uid)}` ledger reservation。Ledger記錄 UTC `dayKey`、`acceptedToday`及 per-device `lastAcceptedAtMs`／`nextSequence`，不保存 email、raw UID、payload、customName或 token。每個 UID每天最多500筆 accepted attempts，同 UID/device兩次 reservation至少相隔1000ms；超限回 `429 rate_limited`與 bounded `retryAfterSeconds`。

Reservation在呼叫 ingestion前 commit；若 upstream失敗，quota與 sequence仍消耗，避免 retry storm或重用 event identity。UTC day變更時 transaction重設 daily count但保留 per-device sequence；sequence達 unsigned 32-bit上限後下一筆回 `sequence_exhausted`，不自動回繞造成排序混淆。

### Independent immutable Cloud Run deployment and Web handoff

Test Tool API使用 dedicated non-root container、dedicated runtime service account、request-based billing、min instances 0、max instances 2、concurrency 20與 exact `asia-east1` region。Identity只取得 Firestore usage/device操作與 single numeric ingestion secret version所需權限，不使用 service-account key、不接受 Emulator host、不共用 Member API或 Ingestion runtime identity。

Deploy只接受 immutable Artifact Registry digest與 approved budget record，live verify覆蓋 health、CORS、401 zero-Firestore-call、foreign/unmarked denial、valid urination/battery event、rate limit、Firestore/Web projection與 log secret scan。Healthy release record才可提供 `VITE_TEST_TOOL_API_URL`給 Web build；Web deploy驗證 HTTPS exact development origin、protected route direct reload及 service worker不cache test-tool API/member data。

## Implementation Contract

**Behavior:** 第一階段operator可在本機以local profile維持既有Emulator流程，或以development-cloud profile對預先建立的development device送出排尿／電量事件，再從固定Hosting入口確認首頁、歷史或統計投影；cloud profile不提供live device registry寫入或任意proxy。後續階段已登入 development tester可開啟 `/test-tool`、看到自己已標記的 eligible devices，按表單送出排尿或電量測試事件，並在結果中看到 event ID、sequence與 stored outcome；事件隨後出現在同 tester的首頁、歷史或統計。匿名、foreign、disabled、unmarked、超限或 malformed request不會呼叫 ingestion或寫入 event。

**Interface / data shape:**

- 本機工具profile由`PEECARE_TEST_TOOL_PROFILE=local|development-cloud`選擇；cloud profile要求`PEECARE_DEVELOPMENT_WEB_ORIGIN`、`PEECARE_DEVELOPMENT_INGESTION_ORIGIN`、`PEECARE_DEVELOPMENT_MEMBER_ORIGIN`及`PEECARE_TEST_TOOL_INGESTION_SECRET_FILE`，並以sanitized config response只回profile與核准origins。
- Cloud proxy只接受固定health與event operations；event Authorization由server覆寫，browser送入的Authorization或非核准URL／method／path一律拒絕。HTML在cloud profile隱藏secret control、停用Firestore registry/custom-name操作並顯示Hosting open control。
- `GET /v1/test-devices` success：`{ devices: [{ deviceId, displayName }] }`。
- `POST /v1/test-devices/:deviceId/events` urination body：exact `{ eventType: "urination", flushDurationMs, pumpDurationMs }`。
- Battery body：exact `{ eventType: "battery", batteryLevelPercent, batteryVoltageMv? }`。
- Event success：`{ status: "stored" | "duplicate", eventId, eventType, deviceId, sequence }`；不回傳 webhook envelope或 secret。
- Stable errors至少包含 `unauthorized`、`test_device_not_found`、`invalid_request`、`unsupported_media_type`、`payload_too_large`、`rate_limited`、`sequence_exhausted`、`ingestion_unavailable`、`internal_error`，含 sanitized request ID。
- Cloud runtime只接受 `NODE_ENV=production`、`GOOGLE_CLOUD_PROJECT=petcare-c7483`、`PEECARE_WEB_ORIGIN`、`PEECARE_INGESTION_ORIGIN`、`PEECARE_INGESTION_SECRET_FILE`、`PEECARE_TEST_TOOL_ENABLED=true`與 platform `PORT`。
- Root scripts新增 Test Tool API check、Firebase integration、development deploy/verify/rollback與 Web build handoff commands。

**Failure modes:** 第一階段cloud profile的missing/invalid origin、non-HTTPS origin、unexpected service identity、missing/unreadable/empty secret file在listen前失敗且不輸出敏感值；runtime收到非核准host/path/method或browser Authorization時在fetch前回傳sanitized error；live Firestore操作保持disabled。後續API的missing/invalid/revoked token回401且零 repository/ingestion call；missing/foreign/disabled/unmarked device回同一404；malformed body回400、wrong media type回415、超過8 KiB回413；rate/quota回429；disabled switch回503；upstream/network transient回503。Server logs不含 Authorization、token、secret、email、raw UID、customName、body、payload或 full upstream response。

**Acceptance criteria:** 第一階段server tests覆蓋profile parsing、listen-before-fail、exact origin/path/method allowlist、server-side secret injection、caller Authorization rejection與zero-fetch denial；DOM tests覆蓋environment banner、Hosting fixed link、cloud-only disabled controls、secret absence及local profile regression；manual smoke以marked development device送出urination/battery後，在`https://petcare-c7483.web.app`登入並確認對應projection。後續unit tests覆蓋 exact body schemas、token outcomes、Owner/marker matrix、canonical topic/envelope generation、rate/day/sequence boundaries、upstream mapping、CORS與 log privacy；Firebase Emulator integration覆蓋 transaction authorization、concurrent reservations、500/day reset與 zero unauthorized write；Web tests覆蓋 route guard、eligible devices、form validation、ID-token adapter、stored result及 failure state；Docker smoke確認 non-root與 health；deployment dry-run/verify確認 immutable digest、dedicated identity、numeric secret reference與 live urination/battery-to-Web journey；`npm run check:release`與 repository secret scan通過。

**Scope boundaries:** 第一階段in scope是loopback local tool、development-cloud exact upstream profile、server-side local secret injection、pre-provisioned device event送出與Hosting observation handoff；第一階段out of scope是live registry mutation、工具部署、tester自助授權與任何公開listener。完整change後續in scope是 development-only authenticated test event UI/API、device marker/usage ledger、server-side ingestion forwarding、Cloud Run deployment與 Web handoff。Out of scope是 account/device provisioning、desktop executable、generic proxy、negative MQTT protocol testing、App Check、production deployment及 real-device certification。

## Risks / Trade-offs

- [Risk] 第一階段operator本機process持有development ingestion secret → 只從operator-only file讀取、只注入exact event endpoint、server維持loopback且browser／log／preview永不取得secret；beta tester仍不得使用此profile。
- [Risk] Cloud profile無法直接建立live device，初次操作多一步 → 明確要求沿用既有operator provisioning與marked development device，避免繞過Security Rules或引入Admin credential。
- [Risk] Test Tool API取得 ingestion secret可代表 EMQX呼叫 endpoint → dedicated identity只能讀 exact numeric secret version，API request surface固定 typed operations，且 browser永遠看不到 secret。
- [Risk] Admin SDK繞過 Firestore Rules → transaction內重新驗證 Owner、marker與 status，所有拒絕路徑以 call-count tests確保零 usage/event write。
- [Risk] Usage reservation後 upstream失敗會消耗 quota → 明確回可重試錯誤但不回滾 reservation，優先避免 retry storm與 duplicate identity。
- [Risk] Test event與實機事件混在同 device history → eventId與 firmwareVersion帶 test-tool marker，且只允許 operator標記的 beta devices。
- [Risk] 500 events/day可能限制密集測試 → 對3–4人 beta足夠，threshold固定並可在後續 reviewed change調整，不提供 runtime任意 override。
- [Risk] Cloud Run scale-to-zero造成首次送出延遲 → UI呈現 sending state與可重試錯誤，不為低頻 beta工具配置常駐 instance。
- [Risk] 新 service增加部署與監控負擔 → 獨立 package、manifest、release record與 rollback dry-run，後續納入 cloud observability change。

## Migration Plan

1. 先實作loopback development-cloud profile與server-side secret injection，保留local profile既有Emulator行為並完成automated regression。
2. Operator以既有provisioning準備marked development device；執行local-to-cloud urination/battery smoke並在Hosting Web App確認projection。若失敗，切回`local` profile即可回滾，不改Cloud Run、Hosting或Firestore schema。
3. 建立 Test Tool API package、typed domain、Firebase adapters、usage ledger與 Emulator tests，不移除第一階段 local operator tool。
4. 加入 Web protected route、API adapter、form UI與 development-only config，預設缺少 verified API origin時 cloud build fail closed。
5. 建立 dedicated service account、numeric secret access、immutable image與 Cloud Run deployment dry-run。
6. Operator在 beta device加上 exact `developmentTestTool` marker；先部署 API並完成 authorization/rate/ingestion smoke。
7. 以 healthy Test Tool API release record將 origin交付 Web build，再發布 Hosting並完成 route、PWA cache與 event-to-Web smoke。
8. Rollback先回復前一版 Web Hosting移除 route入口，再將 Test Tool API traffic回復 prior healthy revision或設定 disable switch；usage ledger與 marker保留供後續重試。
9. 若永久移除，由 operator清除 marker與 marker-scoped usage documents；不得刪除 device、event或 daily stats。

## Open Questions

此 change沒有未決產品問題。Beta device清單與 tester帳號由 operator在 apply前提供；不進入 proposal artifacts。
