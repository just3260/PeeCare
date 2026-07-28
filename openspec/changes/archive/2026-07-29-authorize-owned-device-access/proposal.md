## Why

登入本身不等於資料授權；Web MVP 必須由 Firestore Rules 保證會員只能讀取自己擁有的裝置、事件與每日統計。先固定單一 Owner 骨架，分享與轉移日後另行擴充。

## What Changes

- 在 device document 使用 `ownerUid` 表達單一 Owner，一位 UID 可出現在多台裝置。
- 建立只讀 repository queries 與必要 Firestore indexes。
- Security Rules 允許 Owner 讀取 device、events、dailyStats，拒絕其他會員與所有 client writes。
- fixtures 由測試／管理流程預建 Owner 關聯，不提供 Claim UI/API。
- Owner fixture 只在現有 registry document 增加 `ownerUid`，必須保留 `deviceId`、`productModel`、`ingestionStatus` 與第二階段 latest projection 欄位。
- Web repository 對 Firestore document 執行 runtime shape validation；缺漏或格式錯誤的 ownership 資料不得降級成可讀。

## Capabilities

### New Capabilities

- `owned-device-access`: 定義單一 Owner 資料模型、Owner-only Firestore reads 與 client write denial。

### Modified Capabilities

(none)

## Impact

- Affected specs: `owned-device-access`（新增）
- Affected code:
  - New:
    - `src/features/devices/owned-device-repository.ts`
    - `src/features/devices/owned-device-model.ts`
    - `src/features/devices/owned-device-repository.spec.ts`
    - `firebase/local/fixtures/members-and-devices.ts`
  - Modified:
    - `firestore.rules`
    - `firestore.indexes.json`
    - `firebase/local/firestore.rules.spec.ts`
  - Removed: none
- Prerequisites: `establish-member-authentication`、`bootstrap-local-firebase-platform` 與第二階段 persistence changes。
- Upstream contracts: ingestion registry 使用 `devices/{deviceId}`；server SDK writes 繞過 client Rules，Web client 仍維持全部唯讀。
