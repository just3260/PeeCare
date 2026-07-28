## Why

local Emulator 通過後仍需要隔離的 development Firebase project 驗證真實 Auth、Firestore Rules 與 indexes。此骨架先建立 fail-closed inventory 與部署邊界，不選定不可逆 region 或 billing 設定。

## What Changes

- 定義 development project inventory、環境 allowlist 與 production adapter preflight。
- 建立 Auth、Firestore、Rules、indexes 的 development deployment/check 流程。
- 建立最小測試會員與 Owner 裝置 seed 的 Admin-only runner。
- 將 project ID、region、billing 與 Auth provider 列為 apply 前 refinement gates。
- 新增 cloud Firebase config/client adapter，與既有 `demo-peecare` Emulator adapter 共用相同 service interface，但在 SDK initialization 前完成 environment isolation。
- Development seed 必須以 merge 加入 `ownerUid`，保留第二階段 ingestion registry 與 latest projection 欄位。

## Capabilities

### New Capabilities

- `development-firebase-environment`: 定義隔離 development Firebase project 的安全設定、部署與 smoke verification 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `development-firebase-environment`（新增）
- Affected code:
  - New:
    - `firebase/development/environment.ts`
    - `firebase/development/preflight.mjs`
    - `firebase/development/seed.mjs`
    - `firebase/development/README.md`
    - `src/platform/firebase/cloud-config.ts`
    - `src/platform/firebase/cloud-client.ts`
    - `src/platform/firebase/services.ts`
  - Modified:
    - `.firebaserc`
    - `package.json`
    - `.gitignore`
  - Removed: none
- Prerequisites: `bootstrap-local-firebase-platform` 與第三階段 Auth/Owner changes。
- Upstream local contract: `demo-peecare`、Auth `127.0.0.1:9099`、Firestore `127.0.0.1:8085`；cloud mode 絕不可呼叫 Emulator connectors。
