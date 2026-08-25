## 1. Claim 核心與持久化

- [x] [P] 1.1 依「Pair Code uses HMAC and an active device lock」與「Eight-digit short-lived Pair Code」在 `services/member-api/src/claims/pair-code.ts` 實作 CSPRNG 八位數格式、leading zero、300000ms TTL、versioned HMAC-SHA-256 與 constant-time comparison；先由規格 examples 建立 failing unit tests，再以 `npm run check:member` 驗證 plaintext code／HMAC key不進 persistence或log。
- [x] [P] 1.2 依「Ownership completes in one Firestore transaction」、「One active Claim Session per device」、「Distinct-attempt limit and QoS 0 idempotency」、「Atomic first-owner assignment」及「Trusted first-owner Claim mutation」在 `services/member-api/src/firestore/device-claim-repository.ts` 實作 session／active lock schema、same-UID replacement、foreign-UID lock、lazy expiry、distinct wrong-code dedupe、第五次 failure、same-code terminal retry與 first-owner transaction；以 Firestore Emulator tests 驗證 concurrent create、same／foreign Owner及 device registry／projection／child preservation。
- [x] 1.3 依「Claim domain shares Member API deployment but isolates adapters」在 `services/member-api/src/claims/claim-service.ts` 組合 repository與Pair Code primitives，交付 Authenticated Claim Session creation、Owner-private Claim Session status及 domain outcome mapping，且 domain不依賴Fastify／Firebase／EMQX；以 injected clock、random、repository的service tests驗證201資料、404隱藏、claim_in_progress、already_owned、expired、failed、conflict與replaced。

## 2. Member API 雙入口與設定

- [x] [P] 2.1 依「Co-deployed isolated Claim domain」為 `POST /v1/device-claim-sessions` 與 `GET /v1/device-claim-sessions/:id` 建立route-scoped Firebase adapter、exact body／response、method／content-type／body-limit與canonical errors，維持既有device-name route不變；以 Fastify table tests驗證non-revoked token、foreign 404、額外欄位拒絕及Claim credential cross-use零 persistence。
- [x] [P] 2.2 依「EMQX bind transport remains legacy QoS 0」與「Isolated EMQX Claim ingress」在 `services/member-api/src/security/emqx-claim-auth.ts` 與Claim route實作exact body wrapper、獨立credential、topic／QoS 0／retained false／shared username／payload驗證及202／400／401／503 mapping；以Fastify table tests驗證ingestion credential與Firebase token拒絕、domain rejection不觸發HTTP retry、temporary failure可retry、輸出不含pair_code或完整payload。
- [x] 2.3 擴充 `services/member-api/src/config.ts`、`services/member-api/src/server.ts` 與composition root，讓兩個互斥authentication adapters共用單一Claim domain/repository並以 fail-closed config載入Claim webhook key、HMAC key version及shared username；以server/config tests驗證缺漏、空值、credential相等、無效key version都在listen或Firestore mutation前失敗。

## 3. Firestore 客戶端邊界

- [x] 3.1 依「Claim storage remains Admin-only」更新 `firestore.rules` 與Emulator fixtures，證明anonymous、Owner、non-owner對 `deviceClaimSessions`／`activeDeviceClaims` 的reads/writes全部permission-denied，同時既有Owner-only device reads與client write denial保持通過；以 `npm run test:firebase` 驗證。

## 4. Vue PWA Onboarding

- [x] [P] 4.1 依「PWA polls server-authoritative session state」與「Owner-private Claim Session status」建立 `src/features/device-claim/device-claim-api.ts`、store與sessionStorage adapter，交付Firebase ID token POST／GET、exact success parsing、僅保存version／sessionId／deviceId／expiresAtMs、有界polling及terminal state；以Vitest fake timers與storage failure tests驗證Pair Code／UID／token永不持久化。
- [x] [P] 4.2 依「QR deep link pre-binds an explicit physical device」與「Protected device selection from QR or manual input」新增protected `/connect` route及 `DeviceConnectView`，交付QR query、manual trim／uppercase、12碼validation、explicit confirmation、Google／Email Link safe returnTo與一次性Pair Code顯示；以router/view tests覆蓋規格boundary table、重複query與頁面reload重發流程。
- [x] 4.3 依「Server-authoritative onboarding recovery」、「Single-page illustrated Wi-Fi guide」與「Start device onboarding from the guide」整合Home empty state、九步guide與connect store；只有authenticated GET回claimed才重新載入owned devices並返回首頁，其他terminal states顯示中性restart，storage unavailable使用in-memory fallback；以Home／guide／store component tests驗證完整流程與accessibility。

## 5. MQTT 與 EMQX Development 路徑

- [x] [P] 5.1 依「Shared MQTT credential remains an MVP limitation」、「Shared-credential legacy bind publisher」、「Bounded QoS 0 bind retry」新增獨立legacy bind policy／fixture與驗證，固定 `peecare/device/1/bind`、QoS 0、retained false、exact device_id／pair_code及0／5／10秒相同重送，且不放寬既有per-device QoS 1 telemetry ACL；以device tooling tests與secret scan驗證。
- [x] [P] 5.2 依「Dedicated device-bind Claim forwarding」更新EMQX Serverless template／checklist／configuration model，交付第二個HTTPS connector、單一exact bind rule/action、獨立Claim body credential與Member API route，並驗證總量不超過2 connectors／4 rules；以 `deploy/development/configure-emqx-webhook.spec.ts` 的dry-run golden assertions驗證。
- [x] 5.3 依「Claim forwarding credential isolation」擴充development verifier，驗證Claim／ingestion secrets互斥、Firebase token不通過EMQX route、publisher metadata preservation、202 domain acknowledgement、401 credential failure與sanitized evidence，且Explicit shared-credential MVP boundary禁止宣稱hardware attestation；以verifier adapter tests及read-only dry-run驗證零secret／Pair Code／UID／完整payload輸出。

## 6. 部署與完整品質閘門

- [x] 6.1 依「Claim-specific runtime secrets and persistence access」與「Firestore IAM remains database-wide while logical scope is application-enforced」更新Member API service inventory、Secret Manager numeric version bindings、IAM preflight、immutable deployment與release verification，明載 `roles/datastore.user` 的database-wide capability與residual runtime compromise blast radius，並維持同一Cloud Run request-based `minInstances: 0`且不建立第三服務；以deploy／verify tests證明missing／equal／unapproved secrets、額外direct project role、任一未核准secret direct binding及空白／malformed inventory在mutation前失敗，且Claim session creation、credential cross-use、first ownerUid與duplicate terminal probes只產生核准的application-enforced logical mutations，不宣稱collection／field IAM isolation。
- [x] 6.2 更新development runbooks、QR URL與MVP信任文字，執行 `npm run check`、`npm run check:member`、`npm run test:firebase`、EMQX與Member API dry-runs及secret／PII scan，確認所有Implementation Contract acceptance criteria通過且rollback先停bind rule、不自動移除已成功ownerUid；最後執行 `spectra analyze add-device-claim-onboarding --json` 與 `spectra validate add-device-claim-onboarding`。
