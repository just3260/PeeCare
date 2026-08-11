## Context

Repository 已實作受保護的 `/test-tool` route、Test Tool API adapter、Cloud Run deployment與 Firebase Hosting handoff。Route只有在 production mode且明確選擇 approved development environment時註冊；未註冊的路徑會落入 router fallback並導回首頁。實際 live Web App目前呈現後者，表示既有 unit/build契約未被可靠地綁定到目前 serving的 Hosting version。

此 change不重新設計工具，而是把既有 release流程收斂成可證明的 restoration operation：在任何 upload前確認 exact Test Tool API healthy record與 bundle route registration，upload後針對 exact Hosting version驗證 signed-out、authenticated、cache/privacy及 rollback邊界。實際操作已確認 protected route尚未部署時，browser-only API smoke與 Web upload gate形成 bootstrap cycle，因此需要一個受限的一次性 operator harness先取得真實 healthy API evidence。

## Goals / Non-Goals

**Goals:**

- 讓 approved development Hosting live version實際提供受保護的 `/test-tool` route。
- 在 upload前拒絕未註冊 route、缺少 verified Test Tool API origin、錯誤 Firebase environment、Emulator／loopback endpoint或 secret-bearing artifact。
- 在 upload後分別驗證 signed-out direct load保留 `returnTo=/test-tool`與 authenticated direct reload停留在 `/test-tool`。
- 將 route、API、eligible-device、event projection、cache/privacy與 rollback checks綁定到同一 exact Hosting version及 build hash。
- 在不 provision或修改 Firebase Auth identity的前提下，以一次性 bootstrap verification完成 exact live API smoke並產生 sanitized healthy handoff。
- 失敗時留下 sanitized evidence，且只產生 prior healthy Hosting version的 exact rollback dry-run。

**Non-Goals:**

- 不新增 Test Tool UI、API operation、event type、device provisioning或 authorization model。
- 不建立、重設、更新、刪除、輸出或保存 tester identity、credential、token、custom name或 event payload；一次性 harness只在 process memory持有短效 custom／ID token並於結束時清除 reference。
- 不變更 production、Firestore security rules、Ingestion API、Member API或 MQTT／EMQX設定。
- 不自動執行 rollback或以未驗證 build覆蓋 live traffic。

## Decisions

### Gate on exact healthy Test Tool API release

Web build必須由同一筆仍在有效期限內的 Test Tool API healthy release record解析 exact project、region、service、revision、immutable image digest及 HTTPS origin，再注入 `VITE_TEST_TOOL_API_URL`。缺少、stale、wrong-project、wrong-service、path-bearing、credential-bearing或非 HTTPS origin時，在 build與 Hosting mutation前失敗。

替代方案是由 operator手動輸入 API URL；這無法證明 origin對應 healthy immutable revision，也容易讓 stale或foreign service進入公開 bundle，因此不採用。

### Inspect route registration before upload

Inspected production bundle必須同時證明 development environment discriminator、approved Firebase project、exact Test Tool API origin及 `/test-tool` route存在，並掃描排除 Emulator、loopback endpoint、secret與 source environment file。Preflight另以 router/build tests驗證 test-tool disabled build不會誤發佈 functional route。

只依原始碼已有 route或只檢查 Hosting rewrite不足以證明實際 bundle含有 route；目前回首頁的症狀正是 build-time route omission仍能通過一般 shell availability的例子。

### Break the bootstrap cycle with a one-time operator harness

尚未部署 `/test-tool` 時，browser-only verifier無法從 protected route取得 owner與foreign authorization evidence；另一方面 Web upload gate又必須先取得 exact healthy Test Tool API release record。經 operator一次性核准後，bootstrap harness使用 ADC解析 exact approved project與已部署 immutable revision，從 assigned development test device解析既有 owner，並在 Firebase Auth inventory內部選取一個既有 non-owner user作為 foreign principal。兩者都必須可由 Auth確認為既有 user；找不到 owner或 foreign user時，在 marker、event及 Hosting mutation之前 fail closed。

Harness只建立短效 Firebase custom tokens並交換成 process-memory ID tokens，禁止透過 argument、environment、terminal、artifact或 release evidence輸出／保存 token或 user identifier；所有 token reference在 `finally`中清除。它不得呼叫 account create、update、delete、password reset或 ownership mutation。API verification仍必須執行既有11項 exact smoke checks，綁定同一 project、service、revision、immutable digest與 origin，只有全部通過才寫入 sanitized healthy API record。

替代方案包括 provisional healthy record、暫時放寬 Web upload gate或先發布未驗證 Hosting build；這些方案都會破壞 exact handoff與 zero-unverified-upload contract，因此不採用。要求 operator手動輸入 UID／token亦會增加 PII與credential外洩面，因此 harness只在 process內部解析並使用 opaque identity。

### Bind post-deploy verification to exact Hosting version

Upload後先解析 exact live Hosting version與 build hash，再以全新 browser context執行兩條 direct-load journey。Signed-out context開啟 `/test-tool`後必須到 `/sign-in?returnTo=/test-tool`且不 render tester data；authenticated tester context直接開啟及reload `/test-tool`後必須保留 route、載入 exactly assigned eligible device並完成一筆 bounded test event及 Web projection確認。

任何 journey落到首頁、非 exact sign-in return path、載入 unexpected device、API失敗、projection缺漏或 browser teardown失敗，都使該 exact Hosting version成為 failed release，不得沿用舊 healthy evidence。

### Preserve sanitized evidence and explicit rollback

Release record只保存 project、site、build hash、exact Hosting version、Test Tool API revision identity、verified timestamp、boolean／stable-code checks及 nullable exact prior version。Evidence不得保存 tester PII、credentials、tokens、device data、custom name、form values、event ID或 payload。

若 upload後失敗且 prior healthy version存在，先產生 exact rollback dry-run供 operator review；不存在 distinct prior healthy version時回報 `rollback_unavailable`，不得猜測或自動切 traffic。

## Implementation Contract

**Behavior:** Operator完成 preflight及明確 apply後，approved development Web App的 signed-out `/test-tool` direct load導向 sign-in並保留 exact return path；同一 tester登入後返回並reload `/test-tool`時仍停留在工具頁，且只看到其 assigned eligible device。未知 route fallback至首頁的行為不得被誤判為 test-tool成功。

**Interface / data shape:** 沿用 `npm run check:release`、`npm run test-tool:development:verify`、`npm run web:development:beta:dry-run`、`npm run web:development:beta:release`與 `npm run web:development:beta:rollback`。一次性 operator bootstrap由專用 executable啟動，command arguments只允許 non-secret target selectors與 apply acknowledgement；resolved Firebase identity、custom token、ID token、secret value及 event identifier不得出現在 argv、environment、stdout、stderr或 persisted JSON。Web release preflight接受其 sanitized Test Tool API release record及 beta tester inventory；healthy Web record新增或明確保存 test-tool route registration、signed-out return path、authenticated reload、eligible-device boundary、event projection及 cache exclusion的 check status，並綁定 exact API revision與 Hosting version。

**Failure modes:** Bootstrap harness遇到 missing owner、missing foreign user、Auth lookup失敗、token exchange失敗、identity mutation attempt、revision／digest drift、任何 smoke failure或 privacy finding時non-zero，清除 in-memory token reference，且不得寫入 healthy API record。Missing／stale／mismatched Test Tool API record、錯誤 build environment、route absent、artifact scan failure或 cloud inventory mismatch在 upload前 non-zero且零 Hosting mutation。Upload後首頁 fallback、sign-in return path遺失、authentication失敗、unexpected device、event/projection失敗、cache殘留或 teardown失敗均輸出 sanitized failed evidence，不得輸出 healthy record或自動 rollback。

**Acceptance criteria:** Bootstrap focused tests固定 existing-only identity、zero-foreign、zero-account-mutation、token cleanup、exact revision／digest binding、11-check completeness與 non-secret output；真實 run只產生 sanitized healthy／failed evidence。Focused router、build、deploy與 release tests涵蓋 route enabled／disabled matrix、missing／stale API record、bundle route absence、signed-out exact return path、authenticated direct reload及首頁 fallback rejection。完整 `npm run check:release`通過。Read-only dry-run回傳 exact approved target與零 mutation。Live apply後，以 exact deployed Hosting version完成 signed-out與 authenticated journeys、event projection、sign-out/offline cache exclusion及 secret/PII scan，才產生 healthy record；rollback command只由 distinct prior healthy version解析。

**Scope boundaries:** In scope是 development Test Tool API release handoff、Web build inspection、Firebase Hosting重新發布、exact route/auth/event/cache smoke及 sanitized rollback evidence。Out of scope是產品功能修改、account/device provisioning、API/schema/security policy變更、production deployment、automatic rollback及 real-device certification。

## Risks / Trade-offs

- [Risk] Test Tool API本身不是 healthy或 release record已 stale，導致 Web restoration被阻擋 → 先執行 read-only API verify；只有同一 exact revision重新取得 healthy evidence後才進入 Web build。
- [Risk] 一次性 harness在 route之外接觸 Firebase Auth token，擴大 operator能力 → 僅接受 ADC、existing-only identities、short-lived process-memory tokens、zero identity mutation與 sanitized output；任何必要條件無法證明即 fail closed。
- [Risk] Hosting upload成功但新 route smoke失敗，短暫 serving failed version → 上傳前解析 exact prior version並完成 rollback dry-run；失敗後立即停止 tester handoff並由 operator審閱 traffic rollback。
- [Risk] Service worker仍提供舊 shell，使新 Hosting version看似回首頁 → live verification使用全新 browser context並檢查 service-worker/cache狀態，再驗證 sign-out/offline不殘留 tester data。
- [Risk] Live event smoke產生 development資料 → 僅使用 operator標記的 assigned test device與 bounded event，並禁止將 event ID或 payload寫入 release evidence。
- [Trade-off] 嚴格綁定 API與Hosting evidence增加部署步驟，但避免以 stale build或錯誤 origin宣稱 route已恢復。

## Migration Plan

1. 執行 release quality gate與 Test Tool API read-only verify，解析 exact immutable revision及 bootstrap cycle。
2. 在 operator一次性核准下，以 existing-only／memory-only harness完成11項 live API smoke；只在全部通過時保存 sanitized healthy API record。
3. 產生 Web beta dry-run，確認 approved target、prior Hosting version、API handoff、route inspection及零 mutation。
4. 若 focused tests發現 preflight或 live verifier未拒絕首頁 fallback，先以測試固定 failure code，再最小修正 deployment tooling及 runbook。
5. 由 operator明確執行 Web beta release並取得 exact Hosting version。
6. 以 isolated signed-out與 authenticated contexts完成 `/test-tool` direct-load、event projection、sign-out/offline及 cache/privacy驗證。
7. 全部 checks通過後保存 sanitized healthy record並交付 tester；失敗時保存 failed evidence，若 prior version存在則產生 rollback dry-run供 operator審閱。

## Open Questions

無未決產品或架構決策；一次性 operator harness已獲核准，live Hosting apply所需 tester credential及 cloud operator approval仍只在執行階段透過既有安全流程提供。
