## 1. 基線與失敗契約

- [x] 1.1 以全新 signed-out browser context重現 live `/test-tool`落入首頁 fallback，保存不含 cookie、token、PII或 member data的 pre-change evidence；以 URL、route name與 rendered heading斷言確認實際結果是 `/`而非預期的 `/sign-in?returnTo=/test-tool`。
- [x] 1.2 依「Exact test-tool route restoration gate」、「Gate on exact healthy Test Tool API release」與「Inspect route registration before upload」先新增失敗測試，固定 missing／stale／mismatched API release record、production bundle未註冊 `/test-tool`及 artifact含 Emulator／loopback／secret時必須在 Hosting upload前 non-zero且 mutation count為零；以 `npm run test:unit -- deploy/development/deploy-web.spec.ts deploy/development/release-web-beta.spec.ts src/pwa-build.spec.ts`驗證測試在修正前精確失敗。

## 2. Release preflight與驗證工具

- [x] 2.1 實作「Gate on exact healthy Test Tool API release」：讓 Web build只接受 current healthy `peecare-test-tool-development` immutable revision的 exact HTTPS origin，並將 project、region、service、revision及 digest綁定到 release plan；以 focused deploy/release tests驗證 invalid inputs全部 zero-upload，valid record產生 sanitized plan。
- [x] 2.2 實作「Inspect route registration before upload」與「Exact test-tool route restoration gate」：讓 inspected production artifact明確證明 development environment、approved Firebase project、Test Tool API origin及 `/test-tool` route存在，並拒絕首頁 shell可達但 route缺漏的 bundle；以 router enabled／disabled matrix、bundle fixture及 artifact secret/Emulator scan驗證。
- [x] 2.3 實作「Bind post-deploy verification to exact Hosting version」與「Exact live test-tool route verification」：將 signed-out exact return path、authenticated direct open/reload、exact eligible device、bounded event projection、sign-out/offline及 Cache Storage exclusion綁定到同一 Hosting version與 build hash，且首頁 fallback必須輸出 stable failure；以 browser harness tests與 release record assertions驗證成功及每個 short-circuit路徑。
- [x] 2.4 實作「Preserve sanitized evidence and explicit rollback」與「Sanitized test-tool restoration evidence」：healthy／failed record只保存 approved identities、exact versions、timestamps及 check statuses，並只由 distinct prior healthy Hosting version產生 rollback dry-run；以 privacy scan、secret/PII fixtures、same-version／missing-prior rollback tests及 runbook content review驗證。

## 3. Read-only release readiness

- [x] 3.1 執行 `npm run check:release`與所有 focused router、PWA build、deploy、release tests，確認 lockfile零 drift、production audit通過、test-tool enabled／disabled matrix成立且 repository secret scan無 findings；以 command exit code與 `git diff --check`驗證。
- [x] 3.2 依「Break the bootstrap cycle with a one-time operator harness」與「One-time bootstrap verification without identity provisioning」先新增失敗測試再實作一次性 verifier：只使用既有 owner／foreign Firebase Auth users、short-lived process-memory tokens及 exact approved API target，禁止 account mutation與 protected output，missing principal、target drift、任一11項 smoke failure或 privacy finding皆在 healthy record／Hosting mutation前 fail closed；以 focused harness tests、sanitized output scan及真實 exact-revision run驗證。
- [x] 3.3 對 approved project執行 Test Tool API verify dry-run及 `npm run web:development:beta:dry-run`，確認 exact healthy API revision、approved Hosting target、prior version、tester alias、route checks與 zero mutation；逐欄審閱 sanitized JSON plan，任何 stale／foreign／credential-bearing值都必須阻擋 apply。

## 4. Hosting重新發布與交付

- [x] 4.1 由 operator透過 hidden interactive credential流程執行 `npm run web:development:beta:release`，將 inspected build發布到 approved development Hosting live channel；以 exact Hosting version、build hash及 upload result確認 mutation只發生一次，且 terminal／artifacts不含 tester identity、credential、token或 payload。
- [x] 4.2 對 exact deployed version完成 signed-out `/test-tool` return-path、authenticated direct reload、exact eligible device、bounded event projection、sign-out/offline與 cache/privacy smoke，只有全部通過才保存 healthy record並交付 tester；任一失敗保存 sanitized failed evidence並執行 `npm run web:development:beta:rollback`產生 exact prior-version dry-run供 operator審閱，不自動 rollback。
