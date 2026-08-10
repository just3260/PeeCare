## Why

第三階段 Web MVP 需要部署到隔離的 Firebase Hosting，才能用真實 Auth/Firestore 與手機瀏覽器驗證。骨架固定 target isolation、build config、SPA routing 與 smoke flow。

## What Changes

- 建立 development Hosting target 與 fail-closed deploy preflight。
- 以 development Firebase config 建置，不打包 secrets 或 Emulator endpoints。
- 設定 SPA rewrites、immutable asset cache 與 non-cache index shell。
- 驗證登入、Owner 裝置總覽、歷史、統計與 sign-out。
- Build 使用 `getFirebaseServices()` 的 development adapter，禁止 loopback/Emulator 設定；Firestore/Auth 網路請求不得被 service worker runtime cache。
- Hosting smoke 固定覆蓋 `/sign-in`、`/`、`/history`、`/stats` 的 direct reload、session guard 與 Owner-only data。

## Capabilities

### New Capabilities

- `development-web-deployment`: 定義 Web MVP 的 development Firebase Hosting build、release 與 smoke verification 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `development-web-deployment`（新增）
- Affected code:
  - New:
    - `deploy/development/deploy-web.mjs`
    - `deploy/development/verify-web.mjs`
  - Modified:
    - `firebase.json`
    - `.firebaserc`
    - `vite.config.ts`
    - `package.json`
  - Removed: none
- Prerequisites: 第三階段五個 changes 與 `provision-development-firebase-environment`。
- Upstream shell contract: Browser bundle 不得包含 MQTT client/credentials；PWA shell 可離線顯示，但會員資料必須來自 Firebase 並受 Rules 保護。
