## Why

development Firebase、Cloud Run 與 Hosting deployment tooling 已完成，但 live Hosting origin 目前仍回傳 404，且尚未以一個由 operator 建立的獨立帳號完成可重複、無憑證落盤的 beta smoke。需要一個明確 release change，把「可部署」收斂成「單一測試者可登入、可讀自己的資料、可安全回滾」的實際 development release。

## What Changes

- 以 approved development Firebase Web config 與已驗證 Member API origin 建立並發布 secret-free Hosting build，確認 live channel 根路徑及所有受保護 routes 不再回傳 404。
- 新增 beta release preflight，要求 exactly 1 個由 operator 事先建立的 Firebase Auth tester identity 與一個 owned development test device；本 change 不建立或保存帳號密碼。
- 透過 hidden interactive input 執行該 tester 的 sign-in、Owner views、exact owned-device visibility、Member API rename/clear、sign-out 與 protected-route reload smoke。
- 產生不含 email、UID、password、ID token 或 device payload 的 sanitized Hosting release record，記錄 exact build hash、Hosting version、rollback availability與各 smoke stage 結果。
- 提供 failed release containment 與 exact prior Hosting version rollback dry-run；首次 live release沒有 prior version時必須明確記錄 rollback unavailable並取得 operator bootstrap confirmation，任何 tester journey 或 route/cache verification 失敗都不得標記 release healthy。
- 保留 Emulator 作為 release quality gate，但 deployed bundle 與 live smoke 只允許 approved development cloud services。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `development-web-deployment`: 新增第一次 beta live release、exactly 1 個 operator-provisioned tester journey、credential-safe verification、live-origin availability 與 rollback readiness requirements；multi-tester 與 cross-tester matrix 延後至後續 change。

## Impact

- Affected specs: development-web-deployment
- Affected code:
  - New:
    - deploy/development/beta-tester-inventory.schema.json
    - deploy/development/beta-tester-inventory.example.json
    - deploy/development/release-web-beta.mjs
    - deploy/development/release-web-beta.spec.ts
    - deploy/development/BETA_RELEASE_RUNBOOK.md
  - Modified:
    - deploy/development/deploy-web.mjs
    - deploy/development/verify-web.mjs
    - package.json
    - .gitignore
  - Removed: none
