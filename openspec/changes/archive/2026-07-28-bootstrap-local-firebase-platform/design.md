## Context

此 change 依賴 bootstrap-vue-web-app 已建立的 npm、Vite、TypeScript 與 Vitest 基線。後續 Email／密碼登入、Owner Membership、Firestore Security Rules 與 Web 資料讀取都需要 Auth 和 Firestore，但第一階段已決定 local-first，不讓真實 Firebase project 或外部部署阻擋功能開發。

Firebase Emulator Suite 可以使用帶 demo- 前綴且沒有真實資源的 project ID。Web SDK、CLI、Security Rules 測試與 reset 工具若使用不同 project ID，會產生跨服務不一致；若開發 app 未連到 Emulator，則可能意外嘗試存取雲端。本設計因此把 isolation 與 fail-closed 行為視為核心契約，而不是僅提供啟動指令。

## Goals / Non-Goals

**Goals:**

- 以固定 demo-peecare project ID 啟動 Auth、Firestore 與 Emulator UI。
- 只在 loopback 暴露 Emulator ports，避免區域網路上的其他裝置存取。
- 提供單一 local Firebase client adapter，集中環境驗證、SDK 初始化與 Emulator 連線。
- 以 deny-by-default Firestore Rules 作為未定義 domain schema 前的安全基線。
- 讓 Auth／Firestore 狀態可在測試與手動開發間確定性清空。
- 提供可在本機及 CI 執行的 Emulator 整合測試與完整品質命令。

**Non-Goals:**

- 不建立、選取或部署任何真實 Firebase／Google Cloud project。
- 不設定 Firebase Hosting、Cloud Functions、Cloud Run、Storage、Realtime Database 或 Pub/Sub。
- 不實作註冊、登入、密碼重設或其他 Authentication UI。
- 不定義 users、devices、deviceMemberships、events 或 dailyStats schema 與存取規則。
- 不建立會員／裝置 seed data；各 domain change 在資料模型確定後擴充 seed。
- 不提供 production Firebase adapter、API keys、service account 或 secrets。

## Decisions

### 固定 demo project 並限制 loopback

.firebaserc 將 default project 設為 demo-peecare，所有 package scripts 同時顯式傳入 --project demo-peecare，避免使用開發者全域 Firebase selection。firebase.json 啟用 auth 127.0.0.1:9099、firestore 127.0.0.1:8085、UI 127.0.0.1:4000，並保持 singleProjectMode=true。

選擇 demo project 而不使用真實開發 project，能保證未被 Emulator 覆蓋的產品請求失敗，而不是落到 live resource。綁定 127.0.0.1 而不是 0.0.0.0，避免未加密的 Auth Emulator 流量暴露到區域網路。

Firestore Emulator 固定使用 8085 而非 Firebase 預設的 8080，因為開發機常見的本機 Apache／其他工具會佔用 8080。固定 port 的用意是各機器使用一致 endpoints；一旦 8085 也被占用，仍以非零狀態失敗而不自動改 port。

### 使用 fail-closed lazy client adapter

src/platform/firebase/config.ts 解析明確的 Vite 環境設定，要求 VITE_FIREBASE_USE_EMULATORS=true、VITE_FIREBASE_PROJECT_ID=demo-peecare，Auth／Firestore hosts 為 127.0.0.1 且 ports 分別為 9099／8085。缺少、格式錯誤、非 demo project、非 loopback host 或 production mode 均拋出具穩定 code 的 LocalFirebaseConfigurationError，且不得先呼叫 initializeApp。

src/platform/firebase/client.ts 輸出 getLocalFirebaseServices，第一次呼叫時初始化 Firebase app、Auth 與 Firestore 並連接 Emulator，後續呼叫回傳同一組 instance。此 adapter 隱藏重複初始化與 connectAuthEmulator／connectFirestoreEmulator 順序；刪除它會讓後續功能失去安全的本機 SDK 入口，因此不是只轉送呼叫的薄 wrapper。

不在 src/main.ts 自動初始化 Firebase。尚未使用資料功能時，Vue app shell 應能在沒有 .env.local 或 Emulator 的情況下 build 和 render；後續 Authentication change 才在需要服務的邊界呼叫 adapter。

### 採 deny-by-default Firestore Rules

firestore.rules 使用 rules_version = '2'，在所有 document path 上拒絕 read 與 write。規則測試分別使用 unauthenticatedContext 與 authenticatedContext 驗證任意 get、create、update、delete 都得到 permission-denied。

不先建立 public health document 或臨時 allow 規則。Admin／rules-disabled 的測試初始化能力只用於未來 domain fixture setup，不視為用戶端授權。後續 authorize-owned-device-access change 必須以完整 delta 規格取代對應 rules 行為。

### 以官方 Emulator API 確定性重設狀態

firebase/local/reset.mjs 僅在 project ID 等於 demo-peecare 且 Auth／Firestore endpoints 都是 loopback 時執行。它對 Auth Emulator accounts endpoint 與 Firestore Emulator documents endpoint 發送 DELETE，等待兩者成功後輸出 reset 摘要；連線失敗、非 2xx、非 demo project 或非 loopback endpoint 均以非零狀態碼結束。

Security Rules 測試使用 initializeTestEnvironment、clearFirestore 與 cleanup 控制每個 suite 的 Firestore 狀態。Auth account 清除由 reset script 負責，因為 rules-unit-testing 不管理 Auth Emulator account storage。

不提交 Emulator export snapshot，避免不透明產物與 schema 漂移。Domain changes 將以可讀程式建立測試資料。

### 分離快速與 Emulator 品質閘門

既有 npm run check 保持不需 Java 或常駐 Emulator的快速 type／unit／build gate。新增：

- npm run emulators:start：前景啟動 Auth、Firestore、UI。
- npm run emulators:reset：清空正在運作的 demo Emulators。
- npm run test:firebase：以 firebase emulators:exec 啟動 Auth／Firestore、執行 adapter 與 rules tests，結束後關閉。
- npm run check:all：先執行 check，再執行 test:firebase。

這樣一般 UI 迭代仍快速，CI 或交付驗收使用 check:all 覆蓋完整 local platform。Emulator 啟動先決條件為 bootstrap-vue-web-app 支援的 Node 版本與 Java 11 以上。

## Implementation Contract

**Observable behavior**

- npm run emulators:start 後，Auth、Firestore 與 UI 只在指定 loopback ports 接受連線，CLI 顯示 project demo-peecare。
- 在有效 local env 下呼叫 getLocalFirebaseServices，回傳已連到 Auth／Firestore Emulators 的 singleton services。
- 在 production mode、未明確啟用 Emulator、project ID 不符或 host 非 loopback 時，adapter 在建立 Firebase app 前失敗。
- Firestore 用戶端無論有無 mock Auth token，都不能讀寫任意 document。
- npm run emulators:reset 成功後，Auth accounts 與 Firestore documents 均為空。
- npm run check:all 能從乾淨狀態啟動 Emulators、執行測試並正常關閉。

**Interface and configuration**

- 固定 project ID：demo-peecare。
- 固定 endpoints：Auth 127.0.0.1:9099、Firestore 127.0.0.1:8085、UI 127.0.0.1:4000。
- getLocalFirebaseServices 回傳 app、auth、firestore。
- LocalFirebaseConfigurationError 至少具有 missing_config、emulator_disabled、project_mismatch、non_loopback_host、production_mode 五種 code。
- .env.example 提供所有 VITE_FIREBASE_* 名稱與不具秘密性的 demo values；.env.local 必須被 gitignore。

**Failure modes**

- Emulator port 已被占用時，Firebase CLI 以非零狀態碼結束，不自動改用其他 port。
- reset 找不到兩個 Emulator 時，列出失敗 endpoint 並以非零狀態碼結束。
- Security Rules 測試無法連線、rules 無法編譯或任一拒絕斷言失敗時，test:firebase 以非零狀態碼結束。
- Web client adapter 不對 configuration errors 降級到 production SDK connection。

**Acceptance criteria**

- npm run check 通過且不需要啟動 Emulator。
- npm run test:firebase 通過，終端輸出 Auth 與 Firestore Emulator 啟停資訊及測試摘要。
- npm run check:all 從無既有 Emulator process 的狀態完整通過。
- unauthenticated 與 authenticated clients 的 get／create／update／delete 規則測試全部收到 permission-denied。
- 連續兩次呼叫 getLocalFirebaseServices 回傳相同 app、auth、firestore instance。
- 將 project ID 改為 peecare-production 或 host 改為 0.0.0.0 時，client test 確認 initializeApp 未被呼叫。
- reset 前建立 Auth account 與 Firestore document，執行 reset 後透過 Emulator APIs 確認兩者皆不存在。

**Scope boundaries**

本 change 僅處理 local Auth／Firestore Emulator configuration、Web SDK local adapter、deny-all rules、reset 與測試工具。不包含 domain schema、授權放行、Authentication UX、Firebase Hosting 或任何雲端資源。

## Risks / Trade-offs

- [Risk] deny-all rules 讓功能 change 在新增精確規則前無法顯示資料 → 這是刻意的 fail-closed 基線；每個 domain change 必須攜帶對應 rules 與測試。
- [Risk] 固定 ports 可能與本機其他服務衝突 → 明確失敗並要求開發者釋放 port，避免不同機器使用不同 endpoints。
- [Risk] demo project 與 production Firebase config 有差異 → deployment change 另建 production adapter path 與環境驗證，不讓本機 bootstrap 暗中支援 live resources。
- [Risk] Java 先決條件增加 setup 成本 → README 提供版本檢查與一條 test:firebase 命令，CI 使用相同入口。
- [Risk] reset 是破壞性操作 → 僅允許 demo-peecare 與 loopback endpoints，任何其他目標直接拒絕。
- [Risk] local adapter 未在 app mount 時初始化，無法立即從 UI 看出 Emulator 狀態 → 本 change 以 client integration test 驗證；Authentication change 再提供使用者可見連線流程。

## Migration Plan

1. 先加入 Firebase CLI config、demo env example 與 deny-all rules。
2. 以失敗測試固定 invalid config、singleton 及 rules denial 行為。
3. 實作 local client adapter、reset 工具與 Emulator package scripts。
4. 執行 npm run check，確認 Vue app shell 仍不依賴 Firebase。
5. 執行 npm run test:firebase 與 npm run check:all，驗證完整啟停、重設與拒絕規則。
6. 後續 Authentication 與 device access changes 只透過 getLocalFirebaseServices 取得本機 SDK，並在各自範圍擴充 rules 與 fixture。

回滾時移除本 change 新增的 Firebase 設定、adapter 與 scripts，Vue app shell 仍可獨立 build；不得留下允許讀寫的暫時 rules。
