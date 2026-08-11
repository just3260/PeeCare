## Why

現有 `scripts/test-tool.mjs` 只監聽 loopback、只轉送到 Emulator，並要求瀏覽器持有 EMQX webhook secret；直接允許遠端 URL、上雲或打包都會讓共享 secret 暴露，且其 Firestore Emulator REST 操作無法通過 live Security Rules。Firebase Hosting 已可使用後，第一階段需要先讓 operator 從本機工具安全呼叫既有 development Firebase／Cloud Run 環境並在 Hosting Web App 觀察結果；後續才提供 3–4 位 beta tester 登入後自行產生受限 development 事件的雲端工具。

## What Changes

- 第一階段保留 `scripts/test-tool.mjs` 的 loopback UI，新增明確的 `local`／`development-cloud` profile；cloud profile 只允許固定 development Ingestion／Member API health 路徑與事件路徑，不成為任意遠端 proxy。
- Cloud profile 由本機 Node process 從 operator-only secret file 注入 webhook Authorization，瀏覽器設定、curl 預覽、response、log 與 localStorage 均不得取得 secret；live Firestore device create/update及 custom-name直讀在此 profile停用。
- Cloud profile只對 operator預先建立的 development test device送事件，並提供固定 `https://petcare-c7483.web.app`入口，讓 operator在 Hosting Web App登入後驗證首頁、歷史與統計投影；工具本身第一階段不部署。
- 在 PeeCare Web App新增 authenticated `/test-tool` route，沿用既有 Firebase Auth session與 owned-device UX，不另存 tester credential。
- 建立獨立 `peecare-test-tool-development` Cloud Run service；瀏覽器只送 Firebase ID token與 typed measurement request，server驗證 token、device owner、development marker及 enabled status。
- Test Tool API從 approved device registry取得 product model，server產生 canonical topic、event ID、sequence、timestamps與 EMQX envelope，再使用 Secret Manager掛載的 ingestion credential呼叫既有 development Ingestion API；secret永不進入 browser bundle、desktop executable、request body或 response。
- 移除雲端工具的任意 URL/method/header proxy與 live Firestore device create/update；tester只能對 operator預先建立且標記為 test-tool-enabled的自有裝置送出排尿或電量事件。
- 加入 server-side per-tester/per-device rate limits、每日 quota、exact-origin CORS、8 KiB body limit、stable error codes、sanitized logging與 disable switch。
- 提供 immutable Cloud Run image deployment、live verification、rollback dry-run、Web config handoff及 event-to-Web smoke。
- 保留 `scripts/test-tool.mjs` 作為本機 Emulator/operator工具；不建立或散發內含 secret的桌面執行檔。

## Capabilities

### New Capabilities

- `development-tester-event-tool`: 定義 authenticated beta tester雲端事件模擬 UI/API、owner/marker授權、server-side canonical event生成、rate limit、secret boundary與 development deployment verification。

### Modified Capabilities

- `development-web-deployment`: 新增 protected test-tool route的 development-only build config、direct reload與 member-data cache exclusion requirements。

## Impact

- Affected specs: development-tester-event-tool、development-web-deployment
- Affected code:
  - New:
    - scripts/test-tool.development.env.example
    - scripts/test-tool-server.spec.ts
    - services/test-tool-api/package.json
    - services/test-tool-api/package-lock.json
    - services/test-tool-api/tsconfig.json
    - services/test-tool-api/vitest.config.ts
    - services/test-tool-api/Dockerfile
    - services/test-tool-api/src/server.ts
    - services/test-tool-api/src/app.ts
    - services/test-tool-api/src/config.ts
    - services/test-tool-api/src/security/firebase-id-token-verifier.ts
    - services/test-tool-api/src/devices/test-device-repository.ts
    - services/test-tool-api/src/events/test-event-service.ts
    - services/test-tool-api/src/events/test-event-request.ts
    - services/test-tool-api/src/events/usage-repository.ts
    - services/test-tool-api/src/ingestion/ingestion-client.ts
    - services/test-tool-api/test/app.test.ts
    - services/test-tool-api/test/test-event-service.test.ts
    - services/test-tool-api/test/test-event-firestore.integration.test.ts
    - services/test-tool-api/cloudbuild.json
    - src/features/test-tool/test-tool-api.ts
    - src/features/test-tool/test-tool-api.spec.ts
    - src/views/TestToolView.vue
    - src/views/TestToolView.spec.ts
    - deploy/development/test-tool-service.yaml
    - deploy/development/deploy-test-tool.mjs
    - deploy/development/deploy-test-tool.spec.ts
    - deploy/development/verify-test-tool.mjs
    - deploy/development/verify-test-tool.spec.ts
    - deploy/development/TEST_TOOL_RUNBOOK.md
  - Modified:
    - scripts/test-tool.mjs
    - scripts/test-tool.html
    - scripts/test-tool.spec.ts
    - src/router/index.ts
    - src/platform/firebase/config.ts
    - src/env.d.ts
    - src/main.ts
    - firebase.json
    - firestore.rules
    - package.json
    - scripts/test-firebase.mjs
    - deploy/development/deploy-web.mjs
    - deploy/development/verify-web.mjs
  - Removed: none
