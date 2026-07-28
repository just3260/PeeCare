## Why

Web MVP 需要可靠的會員 session 邊界，後續裝置授權不能只依畫面狀態或任意 UID。先建立 Firebase Authentication 骨架，讓 provider 細節日後可補充而不改動 route 與資料存取介面。

## What Changes

- 建立 auth state store、登入頁、登出動作與 protected route guard。
- 本機使用 Authentication Emulator 驗證 signed-in／signed-out／loading 狀態。
- 將登入 provider 封裝在 adapter；本 change 不決定 production provider 組合。
- 清除 session 後立即停止 protected data flow 並返回登入頁。
- 只透過既有 `getLocalFirebaseServices()` 取得 Auth，集中管理 observer 的啟動、首次解析與 teardown。
- 對登入前的站內目的 route 使用 allowlisted relative path，拒絕外部或 protocol-relative redirect。

## Capabilities

### New Capabilities

- `member-authentication`: 定義 Web MVP 的 Firebase Auth session、登入入口、登出與 protected navigation 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `member-authentication`（新增）
- Affected code:
  - New（實作）:
    - `src/features/auth/session.ts`（session 型別：`SessionUser`、`AuthState`）
    - `src/features/auth/auth-store.ts`
    - `src/features/auth/auth-store-key.ts`（store 的 injection key，獨立模組避免 import cycle）
    - `src/features/auth/auth-provider.ts`
    - `src/features/auth/protected-resource-registry.ts`
    - `src/features/auth/return-route.ts`（safe post-sign-in return route resolver）
    - `src/views/SignInView.vue`
  - New（測試）:
    - `src/features/auth/auth-store.spec.ts`
    - `src/features/auth/protected-resource-registry.spec.ts`
    - `src/features/auth/return-route.spec.ts`
    - `src/features/auth/auth-emulator.integration.spec.ts`（Auth Emulator 整合：登入／UID 切換／登出）
    - `src/router/auth-guard.spec.ts`
    - `src/views/SignInView.spec.ts`
    - `src/App.auth.spec.ts`
  - Modified:
    - `src/router/index.ts`（新增 `/sign-in` route、protected meta 與 `registerAuthGuard`）
    - `src/App.vue`（注入 auth store／provider，驅動 lifecycle 與登出）
    - `src/main.ts`（composition root：建立 store／provider、註冊 guard、`app.provide` 注入）
    - `vitest.config.ts`（快速 gate 排除 `src/**/*.integration.spec.ts`）
    - `vitest.firebase.config.ts`（補 `@` alias 並納入 auth 整合測試）
  - Removed: none
- Prerequisites: `bootstrap-local-firebase-platform` 與 `vue-web-app-shell`。
- Upstream contracts: local Firebase 固定使用 `demo-peecare`、Auth Emulator `127.0.0.1:9099`，且 Firebase adapter 在 production mode fail closed。
