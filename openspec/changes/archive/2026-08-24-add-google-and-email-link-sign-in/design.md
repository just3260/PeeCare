## Context

PeeCare Web 已有單一 Firebase app、`AuthProvider` adapter、`onAuthStateChanged` session store、protected route guard、safe return-route resolver 與 UID change teardown。登入頁目前只呼叫 `signInWithEmailAndPassword`，development beta release runner也以 hidden TTY 取得 Email／密碼，再用該 session 驗證 assigned device、protected views、Member API mutation與登出。

本 change 將產品入口改為 Firebase Web SDK原生的 Google popup與 Email Link。使用者要求只有 Firebase 可快速串接的方式才納入第一版，因此不新增自製 OAuth backend、Google Identity Services One Tap、Apple登入或密碼 UX。Email Link一次性 URL與tester Email都屬敏感登入材料；existing release evidence不得因此開始保存 PII或credential。

## Goals / Non-Goals

**Goals:**

- 以 Firebase `GoogleAuthProvider` popup及 Email Link提供正式註冊／登入入口，首次驗證自動建立 Firebase User。
- 保持 Firebase observer為唯一 session source of truth，以及現有三態、route guard、safe return path與protected-resource teardown。
- 讓Email Link可在同源跨分頁完成；pending state消失或使用者換裝置時，安全地要求重新輸入相同Email。
- 讓development readiness在Hosting upload前證明 `google.com`、Email Link config、單一Email identity與callback domain均符合契約。
- 讓beta release以一次性Email Link完成完整live tester journey，且不把Email、link、OOB code或token寫入任何artifact。

**Non-Goals:**

- 不支援Apple登入、Google Identity Services One Tap、Email／密碼UI、密碼重設、MFA或anonymous auth。
- 不實作provider linking、Firebase UID merge、device ownership migration或會員profile。
- 不新增custom auth backend、mail relay、mailbox API或自動讀取tester信箱。
- 不保存或分析Google OAuth access token，也不要求額外Google API scopes。
- 不刪除既有Firebase password credential；Email Link要求email auth保持enabled，第一版只移除產品內的密碼入口。

## Decisions

### Firebase 原生登入範圍限於 Google popup 與 Email Link

Google按鈕只建立`GoogleAuthProvider`並由直接click user gesture呼叫`signInWithPopup`，不載入Google Identity Services script、不顯示自動One Tap prompt，也不請求profile以外的額外scope。選擇popup而不是redirect，是為了維持既有`AuthProvider.signIn()`的單一Promise邊界，避免新增OAuth redirect bootstrap state；popup blocked、cancelled或provider failure均留在`/sign-in`並顯示不含raw Firebase detail的中性錯誤。

Email入口不區分註冊與登入。它使用`sendSignInLinkToEmail`寄送`handleCodeInApp: true`的link；callback以`isSignInWithEmailLink`先驗證，再呼叫`signInWithEmailLink`。選擇Firebase寄信而不是自建mail service，可避免新增mail credential、template delivery與token exchange責任。

### AuthProvider 擴充但 session observer 保持唯一權威

`AuthProvider`改為提供`signInWithGoogle()`、`sendEmailSignInLink(input)`、`completeEmailSignInLink(input)`與`signOut()`。Provider method只觸發或完成Firebase authentication，不直接寫入auth store。成功後仍由現有`onAuthStateChanged`發布`signed-in`，確保UID變更前先執行protected-resource teardown。

登入頁與Email Link callback view皆透過既有Vue injection取得同一provider；不得初始化第二個Firebase app或Auth observer。選擇擴充既有adapter而不是建立Google store與Email store，讓provider-specific SDK、error normalization與action-code settings維持單一深層邊界。

### Email Link callback 使用有期限 pending record 與重新輸入 fallback

Email Link request將trim後、長度1至254的Email與`resolveSafeReturnPath`產生的return path寫入同源`localStorage` versioned record：`{ version: 1, email, returnTo, requestedAtMs }`。Record key固定為`peecare:auth:pending-email-link:v1`，有效期30分鐘；讀取時遇到無效JSON、schema錯誤、非有限timestamp、未來timestamp或過期record必須清除並視為不存在。Email不得出現在action URL、query parameter、log或telemetry。

Callback route固定為`/auth/email-link`且不要求既有session。Action URL只攜帶已重新allowlist的`returnTo`；callback完成前再次呼叫safe resolver。相同browser可由localStorage取得Email；若storage unavailable、record不存在或已過期，畫面要求使用者重新輸入收到link的同一Email。成功後立即清除record並導向safe return path；任何失敗保持signed-out、清除已消耗或無效record並提供重新寄送入口。

選擇localStorage而非sessionStorage，是因為mail client通常會在同源新分頁開啟link；30分鐘TTL與成功／失敗清除限制PII駐留。選擇重新輸入fallback而不是將Email放入URL，可避免session injection並支援跨裝置完成。

### Development readiness 驗證 provider 與 Email Link configuration

Development inventory把federated provider期望值固定為`google.com`，並新增Email sign-in config期望。Readiness adapter讀取Identity Toolkit project config及default supported IDP config，只有下列條件全部成立才通過：

- `google.com` enabled為true；
- `signIn.email.enabled`為true；
- `signIn.email.passwordRequired`為false；
- `signIn.allowDuplicateEmails`為false；
- `petcare-c7483.web.app`與Firebase action handler使用的domain都在authorized domains；
- Firebase client `authDomain`屬於approved development project且callback URL origin與Hosting target一致。

任一條件不符回傳stable sanitized failure並在build或Hosting upload前停止。`passwordRequired: false`允許Email Link，但Firebase backend仍可能接受既有password credential；本change只保證Web UI與release workflow不取得或提交密碼。

### Beta live journey 以 hidden Email Link 取代 password

Beta runner保留exactly one opaque alias及assigned device inventory，但hidden TTY改為依序取得tester Email與tester mailbox收到的一次性Email Link。Runner先在fresh browser context的Hosted登入頁提交Email，使同源pending record存在，再提示operator從信箱貼上link。Link不得echo，且輸入只保存在mutable in-memory reference。

Runner只接受HTTPS、approved Firebase action／Hosting domain、`mode=signIn`與non-empty OOB code的link；驗證前不得在error、stdout、stderr、trace、screenshot、HAR或release record展開URL。瀏覽器完成callback並確認signed-in UID只擁有inventory-assigned device後，繼續既有overview、history、stats、Member API rename／clear、protected-route reload及sign-out journey。無TTY、Email或link格式錯誤、callback失敗、UID mismatch或teardown失敗皆不得輸出healthy record；finally path清空Email、link及token references並關閉context。

完整live protected journey使用Email Link，因為它不需要runner保存第三方OAuth credential。Google path以provider readiness、hosted Google control存在與provider adapter tests作為release gate；healthy evidence不得宣稱已完成外部Google account的live E2E。這項限制避免把Google帳號、MFA或第三方頁面自動化納入第一版。

### Provider linking 與 Apple 明確排除

Firebase保持one-account-per-email configuration，但UI不呼叫`linkWithPopup`、`linkWithCredential`、`unlink`或任何UID merge流程。Firebase回報account collision時，UI只顯示「請使用原本的登入方式」類型的中性指引，不揭露已存在provider。裝置ownership仍只認`request.auth.uid`；第一版不承諾不同Email identity或Apple private relay對應到同一會員。

Apple按鈕、`OAuthProvider('apple.com')`、Service ID、Team ID、Key ID與private key均不進入code、config inventory或release tasks。未來只有在具備Apple Developer Program資格且另立change後才重新評估。

## Implementation Contract

**Behavior:** `/sign-in`顯示Google按鈕、Email欄位與寄送link動作，不顯示password或Apple控制項。Google popup成功或Email Link callback成功後，Firebase observer發布既有`signed-in` state並導向allowlisted return path。送信成功一律顯示不透露帳號是否既存的確認狀態；popup、send或callback失敗只顯示sanitized user-facing error。`/auth/email-link`可由signed-out visitor直接載入，且在callback完成前不得render protected content。

**Interface / data shape:**

- `AuthProvider.signInWithGoogle(): Promise<void>`。
- `AuthProvider.sendEmailSignInLink({ email, returnTo }): Promise<void>`。
- `AuthProvider.completeEmailSignInLink({ email, href }): Promise<void>`。
- `AuthProvider.signOut(): Promise<void>`。
- Pending record為exact `{ version: 1, email: string, returnTo: string, requestedAtMs: number }`，key為`peecare:auth:pending-email-link:v1`，TTL為1,800,000 milliseconds。
- Public routes為`/sign-in`與`/auth/email-link`；所有member routes維持`requiresAuth: true`。
- Readiness結果新增Google provider、email enabled、password optional、duplicate-email denial及authorized callback-domain checks；結果只能包含check name與pass/fail，不得包含client secret、Email或provider token。
- Beta interactive input為exactly one Email及one Email Link；password、credential file、credential JSON、environment credential與CLI credential argument全部拒絕。

**Failure modes:** Invalid Email在呼叫Firebase前失敗。Storage unavailable不阻擋寄信，但callback要求重新輸入Email。Invalid、expired、already-used或wrong-Email link保持signed-out並允許重新寄送。Popup blocked/cancelled、provider collision與Firebase raw error映射成有限的neutral UI states。Readiness不符回`auth_provider_not_ready`、`email_link_not_ready`或`authorized_domain_not_ready`並阻止deploy。Beta input缺失回`credential_input_unavailable`，link格式不符回`email_link_invalid`，Firebase拒絕callback回`tester_authentication_failed`；所有錯誤文字通過Email、OOB code、token與URL secret scan。

**Acceptance criteria:** Unit tests覆蓋Google popup SDK呼叫與neutral errors、Email validation、30分鐘TTL前後、future timestamp、invalid storage、same-browser completion、cross-device重新輸入、safe return path、invalid／expired link與record cleanup。Router tests證明callback public且protected content不會提前render。Auth Emulator integration取得其out-of-band Email Link並完成new-user、existing-user與sign-out流程。Development readiness table tests覆蓋每個expected config mismatch。Beta runner tests以fake TTY與fake browser驗證Email/link不echo、不持久化、success journey、invalid link、missing TTY、UID mismatch及finally cleanup。最後執行`npm run check`、`npm run test:firebase`、`npm run check:release`與beta dry-run；只有local gates通過不得宣稱live Firebase provider或mail delivery已驗證。

**Scope boundaries:** In scope為Web auth UI／adapter／callback、local Emulator coverage、development Firebase readiness及beta release Email Link migration。Out of scope為Apple、One Tap、password UX、provider linking、account merge、ownership migration、custom mail infrastructure、production environment及自動操作tester mailbox。

## Risks / Trade-offs

- [Risk] Popup在部分mobile browser被阻擋 → 只從direct user click呼叫，顯示可重試錯誤；若實際裝置證據顯示不可接受，另立redirect refinement，不在本change混用兩套flow。
- [Risk] Email以localStorage短暫保存PII → 使用versioned exact record、30分鐘TTL、invalid／success／failure cleanup，且Email永不進入URL或evidence；storage不可用時退回重新輸入。
- [Risk] Email Link在其他裝置開啟 → callback要求重新輸入相同Email，不建立server-side pending session。
- [Risk] Google未執行automated live external-account E2E → release gate驗證provider config、hosted control與adapter behavior，並明確不宣稱external Google E2E；Email Link承擔完整live session journey。
- [Risk] 同一人選用不同identity可能取得不同UID → 維持one-account-per-email並顯示原登入方式指引，但不做自動merge；ownership migration留給獨立change。
- [Risk] Hosting rollback回到舊password UI → Email config的`passwordRequired: false`仍允許既有password sign-in，先前Hosting version可運作；rollback不需要回復Auth provider config。

## Migration Plan

1. 先更新development inventory、readiness adapter與tests，確認Google enabled、Email enabled／password optional、duplicate Email denied及callback domains authorized；不符時不得部署。
2. 實作provider adapter、pending record、Google／Email Link UI與public callback，並用Auth Emulator out-of-band link完成integration gate。
3. 將beta runner與runbook由hidden Email／password改為hidden Email／one-time link，完成secret scan與fake-browser tests。
4. 執行完整local release gates與beta dry-run，確認password input已被拒絕且沒有Email或link進入artifacts。
5. 部署development Hosting後，以operator mailbox完成single-tester Email Link journey；全部通過才保存healthy release record。
6. 若live smoke失敗，使用既有exact Hosting version rollback流程；Firebase provider config保持向前與向後相容，不自動mutation或刪除user credential。

## Open Questions

無。Apple資格、provider linking與Google redirect均已明確延後至後續change。
