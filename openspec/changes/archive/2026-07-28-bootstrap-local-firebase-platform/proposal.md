## Why

後續 Authentication、裝置權限與 Firestore 資料 changes 需要一個可重現且不會誤觸雲端帳單或 production 資料的本機平台。目前專案沒有 Firebase CLI 設定、SDK adapter、Security Rules 基線或 Emulator 測試生命週期，因此每個後續 change 都可能自行建立不一致的環境。

## What Changes

- 在 bootstrap-vue-web-app 完成後加入 Firebase Web SDK、Firebase CLI 與 Security Rules 測試工具。
- 以固定的 demo-peecare 專案 ID 設定 Authentication、Cloud Firestore 與 Emulator Suite UI，所有 Emulator 僅綁定本機 loopback。
- 建立單一、lazy 的 Firebase client adapter；開發環境必須明確啟用 Emulator，設定缺漏、project ID 不一致或 Emulator 未啟用時 fail closed。
- 建立 deny-by-default Firestore Security Rules 與 unauthenticated／authenticated 均被拒絕的規則測試。
- 建立可重複執行的 Auth／Firestore Emulator 清除工具，並在重設失敗或偵測到非 demo 專案時停止。
- 提供 emulators:start、emulators:reset、test:firebase 與 check:all scripts，以及本機環境變數範例與操作說明。
- 不建立真實 Firebase project、不部署 Cloud Run／Hosting，也不建立會員、裝置或排尿 domain seed data。

## Capabilities

### New Capabilities

- `local-firebase-platform`: 提供隔離於雲端的 Firebase Auth／Firestore 本機開發、Web SDK 連線、安全規則測試與可重現重設能力。

### Modified Capabilities

（無）

## Impact

- Affected specs: local-firebase-platform
- Prerequisite change: bootstrap-vue-web-app
- Affected code:
  - New:
    - firebase.json
    - .firebaserc
    - firestore.rules
    - firestore.indexes.json
    - .env.example
    - src/platform/firebase/config.ts
    - src/platform/firebase/client.ts
    - src/platform/firebase/client.spec.ts
    - firebase/local/reset.mjs
    - firebase/local/firestore.rules.spec.ts
    - firebase/local/README.md
  - Modified:
    - package.json
    - package-lock.json
    - env.d.ts
    - .gitignore
  - Removed: none
- Affected systems: local Vue development, Firebase Authentication Emulator, Cloud Firestore Emulator, Emulator Suite UI, and CI-capable security-rule verification.
