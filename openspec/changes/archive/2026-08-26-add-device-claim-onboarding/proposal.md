## Why

現有 PeeCare Web 已能登入、引導 Wi-Fi 設定並讀取本人裝置，但帳號與實機的 ownership 仍只能靠管理 seed 建立。現在需要一條可由會員掃描裝置、取得短效 Pair Code，並由裝置經既有 EMQX bind 訊息安全完成首次綁定的端到端流程。

## What Changes

- 新增受 Firebase Authentication 保護的裝置綁定頁，支援機身／包裝 QR deep link、12 碼實機序號手動輸入、登入後返回原綁定頁及掃描結果確認。
- 在既有 Member API Cloud Run 內新增獨立 Claim domain module，提供建立／查詢 Claim Session 的會員 API，以及使用獨立 webhook credential 的 EMQX Claim API。
- 建立 8 位數 Pair Code、5 分鐘 TTL、5 次錯誤上限、每台裝置單一 pending session、HMAC 儲存、狀態輪詢與 QoS 0 冪等重送契約。
- 讓 EMQX 將 `peecare/device/1/bind` 的 QoS 0、非 retained 訊息與 publisher metadata 轉送到 Claim route；payload 固定為 `device_id` 與 `pair_code`。
- 以 Admin Firestore transaction 在未綁定裝置上首次寫入 `ownerUid`，相同會員重送視為成功、不同 Owner 絕不覆蓋，且保留 registry、projection、custom name 與子集合資料。
- 擴充 development Member API 的 IAM、Secret Manager、部署與驗證邊界：接受 `roles/datastore.user` 為 database-wide IAM，將 collection／field／first-owner 範圍明確定義為 application-enforced logical scope，並以 exact direct IAM binding audit、repository transaction 與 release probes 驗證；同時更新裝置 ACL、EMQX rule/action 檢查表及 PWA Wi-Fi 引導。
- 明確接受第一版共用 MQTT credential 無法提供 per-device cryptographic proof 的限制，將 per-device credential／factory setup secret 留作 production hardening gate。

## Capabilities

### New Capabilities

- `device-claim-onboarding`: 定義 QR deep link、Claim Session、Pair Code、EMQX bind 驗證、ownership transaction、狀態輪詢與失敗恢復的端到端行為。

### Modified Capabilities

- `wifi-connection-guide`: 將既有純說明流程接到掃描序號、產生 Pair Code、返回 Web App 等實際 onboarding 步驟。
- `owned-device-access`: 新增可信 Claim backend 首次設定 `ownerUid` 的唯一 mutation 路徑，同時維持 Web client 全面唯讀及單一 Owner。
- `development-device-mqtt-identity`: 允許既有共用 development publisher 以 QoS 0、非 retained 發布固定 bind topic，並記錄其 MVP 信任限制。
- `development-emqx-webhook`: 新增 bind rule/action、獨立 Claim webhook credential、publisher metadata preservation 與 sanitized verification。
- `development-member-api-deployment`: 在同一 Cloud Run 部署 Claim routes、固定 database-wide Firestore IAM 與 application-enforced logical scope、驗證 direct IAM／secret bindings，且隔離 Firebase token 與 EMQX credential。

## Impact

- Affected specs: `device-claim-onboarding`（新增）、`wifi-connection-guide`、`owned-device-access`、`development-device-mqtt-identity`、`development-emqx-webhook`、`development-member-api-deployment`
- Affected code:
  - New: `src/features/device-claim/device-claim-api.ts`, `src/features/device-claim/device-claim-store.ts`, `src/views/DeviceConnectView.vue`, `services/member-api/src/claims/pair-code.ts`, `services/member-api/src/claims/claim-service.ts`, `services/member-api/src/firestore/device-claim-repository.ts`, `services/member-api/src/security/emqx-claim-auth.ts`
  - Modified: `src/router/index.ts`, `src/views/HomeView.vue`, `src/components/WifiConnectionGuideDialog.vue`, `src/main.ts`, `services/member-api/src/app.ts`, `services/member-api/src/config.ts`, `services/member-api/src/server.ts`, `services/member-api/src/http/errors.ts`, `deploy/development/member-service.yaml`, `deploy/development/deploy-member.mjs`, `deploy/development/verify-member.mjs`, `devices/development/acl-policy.json`, `devices/development/device-configuration.mjs`, `deploy/development/emqx-webhook.template.json`, `deploy/development/configure-emqx-webhook.mjs`, `deploy/development/verify-emqx-webhook.mjs`, `firestore.indexes.json`, `.env.example`, `package.json`
  - Removed: none
