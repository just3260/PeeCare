## 1. Session 與登入骨架

- [x] 1.1 以測試先行實作以 Firebase observer 作為 session source of truth 的 Authoritative authentication state，驗證 loading、signed-out、signed-in 三態與 observer cleanup。
- [x] 1.2 [P] 以測試先行實作以 provider adapter 隔離登入方式的 Provider-neutral sign in，驗證 Auth Emulator 成功與 sanitized failure 畫面。
- [x] 1.3 以測試先行實作 Single authentication lifecycle，強制使用 `getLocalFirebaseServices()` singleton 並驗證重複 mount 只有一個 observer、dispose 後為零。

## 2. Navigation 與登出

- [x] 2.1 以測試先行實作 Protected route 等待初始 session 的 Protected member navigation，驗證未解析與 signed-out 都不渲染 protected content。
- [x] 2.2 實作 Session termination，登出時停止 subscriptions 並導回 `/sign-in`；以 router/store integration test 與 `npm run check:all` 驗證。
- [x] 2.3 實作統一管理 protected resource teardown 的 Protected resource teardown 與 Safe post-sign-in return route，驗證 UID 切換先 dispose 舊資源，並以 external/protocol-relative/backslash/sign-in route table 確認只導向安全站內 path。
