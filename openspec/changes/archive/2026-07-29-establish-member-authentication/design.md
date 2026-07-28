## Context

Vue shell 與 local Firebase adapter 已存在；目前缺少 Auth lifecycle 與 protected navigation。此骨架先固定 session contract，production 登入 provider、Email 驗證及密碼重設由後續 refinement 決定。

## Goals / Non-Goals

**Goals:** 建立 loading、signed-out、signed-in 三態；提供登入 adapter、登出與 route guard；可用 Auth Emulator 驗證。

**Non-Goals:** 不決定 production provider、不建立會員 profile/角色、不實作 Claim、MFA、密碼重設或管理後台。

## Decisions

### 以 Firebase observer 作為 session source of truth

Auth store 只接受 Firebase `onAuthStateChanged` 結果，不從 localStorage 或 route 推測登入狀態。

### 以 provider adapter 隔離登入方式

UI 呼叫 `signIn()` interface；local implementation 使用 Emulator 可測試帳號。production provider 在 deployment refinement 中注入。

### Protected route 等待初始 session

router 在 observer 首次回報前顯示 loading boundary；signed-out 導向 `/sign-in`，sign-out 清除 feature subscriptions 後導回登入頁。

### 統一管理 protected resource teardown

Auth store 啟動 observer 時建立單一 lifecycle；所有需要登入的 Firestore listener 或 pending request 透過 `protected-resource-registry` 登記 disposer。UID 改變、sign-out 或 store dispose 時先逐一執行並清空 registry，避免上一位會員的資料在新 session 短暫可見。登入完成後只接受站內 absolute path 作為 return route；`https://`、`//host`、反斜線或登入頁自身均回到 `/`。

## Implementation Contract

**Behavior:** 未登入只能進入登入頁；登入後可進入 protected shell；登出後立即失去 protected navigation。

**Interface:** auth state 為 `loading | signed-out | signed-in`，signed-in 只暴露 Firebase UID 與必要 display identity；provider adapter 提供 `signIn`、`signOut`；resource registry 提供 `register(disposer)` 與 `disposeAll()`。Auth instance 必須來自既有 `getLocalFirebaseServices()`，不得另行初始化 Firebase app。store 與 provider 由 composition root（`src/main.ts`）建立並透過 Vue provide 注入，guard 於同處註冊；測試改注入 fake，因此 App/router 單元測試不依賴 Firebase。

**Failure modes:** Auth Emulator 不可達或登入失敗時留在登入頁並顯示非敏感錯誤；不得假裝已登入。

**Acceptance criteria:** store、route guard、safe return route、resource teardown 與 SignInView tests 通過，Auth Emulator integration 覆蓋登入、UID 切換與登出。

**Scope boundaries:** in scope 是 Web session 骨架；out of scope 是 provider 選擇、會員資料、Firestore 授權與 Claim。

## Risks / Trade-offs

- [Risk] provider 尚未選定 → adapter 保持 provider-neutral，production 部署前另行 refinement。
- [Risk] session loading 造成短暫空白 → 使用明確 loading view 並測試不洩漏 protected content。

## Open Questions

Production provider、Email 驗證、密碼重設與帳號刪除政策在雲端部署前另行決定。
