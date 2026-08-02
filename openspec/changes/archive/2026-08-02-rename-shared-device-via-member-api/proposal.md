## Why

目前 Web App 只能顯示硬體裝置序號，會員無法使用符合生活情境的名稱辨識裝置；同時，現行 Firestore Security Rules 刻意維持 Web Client 完全唯讀，因此不能由瀏覽器直接更新裝置文件。需要一個可信的會員寫入邊界，在保留既有唯讀安全模型的前提下提供整台裝置共用的自訂名稱。

## What Changes

- 新增獨立部署的 Member API Cloud Run service，提供會員修改或移除裝置自訂名稱的 HTTP endpoint。
- Member API 驗證 Firebase ID Token，僅以 token 中的 UID 判定會員身分，並在寫入前確認該 UID 等於裝置的 `ownerUid`。
- 在 `devices/{deviceId}` 保存 optional `customName`；名稱屬於整台裝置而非個別會員偏好，裝置轉移時預設保留。
- Firestore Web Client writes 繼續全部拒絕；Member API 透過受信任的 Admin SDK 執行受限更新。
- 設定頁的裝置管理提供進入編輯、確認儲存、取消、儲存中與錯誤狀態，並在自訂名稱下方持續顯示不可修改的裝置序號。
- 所有 Web App 裝置顯示面統一使用 `customName`，未設定或移除時 fallback 至 `deviceId`；API 成功後由共用 device store 同步全站畫面。
- 新服務採 request-based billing、最低執行個體數 0，並與 Firestore 部署在相同或相容 Region。

## Capabilities

### New Capabilities

- `member-device-naming`: 定義 Member API 的 Firebase 身分驗證、owner 授權、名稱驗證、Firestore 更新、錯誤契約與設定頁編輯流程。

### Modified Capabilities

- `member-device-overview`: 裝置清單與全站裝置選擇介面改為顯示統一解析的自訂名稱，並在名稱成功更新後同步共用狀態。

## Impact

- Affected specs: `member-device-naming`, `member-device-overview`
- Affected systems: 新增獨立 Member API Cloud Run service；Firebase Authentication token verification；Cloud Firestore device registry；PeeCare Web App device management UI
- Affected code:
  - New:
    - `services/member-api/package.json`
    - `services/member-api/package-lock.json`
    - `services/member-api/tsconfig.json`
    - `services/member-api/vitest.config.ts`
    - `services/member-api/Dockerfile`
    - `services/member-api/src/app.ts`
    - `services/member-api/src/server.ts`
    - `services/member-api/src/config.ts`
    - `services/member-api/src/http/errors.ts`
    - `services/member-api/src/security/firebase-id-token-verifier.ts`
    - `services/member-api/src/devices/custom-name.ts`
    - `services/member-api/src/devices/device-name-service.ts`
    - `services/member-api/src/firestore/firestore-client.ts`
    - `services/member-api/src/firestore/device-name-repository.ts`
    - `services/member-api/test/app.test.ts`
    - `services/member-api/test/config.test.ts`
    - `services/member-api/test/custom-name.test.ts`
    - `services/member-api/test/firebase-id-token-verifier.test.ts`
    - `services/member-api/test/device-name-firestore.integration.test.ts`
    - `src/features/devices/member-device-api.ts`
    - `src/features/devices/member-device-api.spec.ts`
    - `src/features/devices/device-display-name.ts`
    - `src/features/devices/device-display-name.spec.ts`
  - Modified:
    - `package.json`
    - `env.d.ts`
    - `src/main.ts`
    - `src/platform/firebase/config.ts`
    - `src/platform/firebase/config.spec.ts`
    - `src/features/devices/owned-device-model.ts`
    - `src/features/devices/device-overview-store.ts`
    - `src/components/DeviceSelector.vue`
    - `src/views/SettingsView.vue`
    - `firebase/local/fixtures/members-and-devices.ts`
    - `firebase/local/firestore.rules.spec.ts`
    - `src/features/devices/owned-device-model.spec.ts`
    - `src/features/devices/device-overview-store.spec.ts`
    - `src/components/DeviceSelector.spec.ts`
    - `src/views/SettingsView.spec.ts`
  - Removed: none
