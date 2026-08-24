## Why

PeeCare Web 目前只有 Email／密碼登入表單，而 production authentication provider、無密碼登入與對應 release verification 尚未完成。第一版需要採用 Firebase Web SDK 可直接串接的 Google provider 與 Email Link，提供不保存密碼且可沿用既有 Firebase UID 授權邊界的正式登入入口。

## What Changes

- 以「使用 Google 繼續」與「寄送 Email 登入連結」取代現有 Email／密碼登入表單；首次成功驗證由 Firebase 建立 User，既有 User 直接恢復 session。
- Google 登入使用 Firebase `GoogleAuthProvider` 的 popup 流程；Email Link 使用 Firebase `sendSignInLinkToEmail`、`isSignInWithEmailLink` 與 `signInWithEmailLink`，並新增公開 callback route。
- Email Link request 只在同源瀏覽器儲存有期限的 pending Email 與 allowlisted return path；Email 不進入 URL，跨裝置或 pending state 不存在時要求重新輸入相同 Email。
- 保留既有 Firebase auth observer、三態 session、protected route guard、UID 切換 teardown 與單一 Firebase app lifecycle。
- Development Firebase readiness 必須確認 `google.com` 已啟用、Email auth 已啟用且 `passwordRequired: false`、duplicate Email accounts 未開放，以及 Hosting／callback domain 已授權。
- Beta release verification 改以 hidden interactive TTY 取得 tester Email 與一次性 Email Link，完成既有 assigned-device journey；一次性 link 視同 credential，只能存在於 process memory，不得進入 arguments、environment、logs、browser artifacts 或 release records。
- **BREAKING**：移除 Web UI 的 Email／密碼登入與 beta verifier 的 Email／密碼 credential input contract。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `member-authentication`: 將正式登入方式改為 Firebase Google popup 與無密碼 Email Link，並定義 callback、pending state、錯誤及 return-route 行為。
- `development-firebase-environment`: 將 readiness contract 改為驗證 Google provider、Email Link configuration 與 authorized callback domain。
- `development-web-deployment`: 將 beta authentication 與 live journey 從密碼 credential 改為一次性 Email Link，並維持 credential-safe evidence。

## Impact

- Affected specs: `member-authentication`, `development-firebase-environment`, `development-web-deployment`
- Affected code:
  - New:
    - `src/features/auth/auth-provider.spec.ts`
    - `src/features/auth/email-link-flow.ts`
    - `src/features/auth/email-link-flow.spec.ts`
    - `src/views/EmailLinkSignInView.vue`
    - `src/views/EmailLinkSignInView.spec.ts`
  - Modified:
    - `src/features/auth/auth-provider.ts`
    - `src/features/auth/auth-emulator.integration.spec.ts`
    - `src/views/SignInView.vue`
    - `src/views/SignInView.spec.ts`
    - `src/router/index.ts`
    - `src/router/index.spec.ts`
    - `src/router/auth-guard.spec.ts`
    - `firebase/development/environment.mjs`
    - `firebase/development/environment.d.mts`
    - `firebase/development/preflight.mjs`
    - `firebase/development/preflight.d.mts`
    - `firebase/development/preflight.spec.ts`
    - `firebase/development/readiness-admin-adapter.mjs`
    - `firebase/development/readiness.mjs`
    - `firebase/development/readiness.d.mts`
    - `firebase/development/readiness.spec.ts`
    - `firebase/development/README.md`
    - `deploy/development/release-web-beta.mjs`
    - `deploy/development/release-web-beta.spec.ts`
    - `deploy/development/beta-tester-inventory.schema.json`
    - `deploy/development/beta-tester-inventory.example.json`
    - `deploy/development/BETA_RELEASE_RUNBOOK.md`
  - Removed: none
- External systems: Firebase Authentication provider configuration, Identity Toolkit project configuration, Firebase Hosting authorized domains, operator-accessible beta tester mailbox
