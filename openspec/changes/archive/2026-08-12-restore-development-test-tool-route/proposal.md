## Problem

目前 development Web App 直接開啟 `/test-tool` 會被未知路由 fallback 導回首頁，而不是保留受保護的測試工具路由；這表示 live Firebase Hosting bundle 尚未包含或尚未啟用已實作的 development tester route。

## Root Cause

Repository 已具備 `/test-tool` route 與 Test Tool API 整合，但 route 只會存在於 production mode、明確選擇 approved development Firebase environment，且帶有 verified Test Tool API origin 的 Web build。現行 live Hosting version 未能證明同時滿足這些 build inputs 與 post-deploy direct-reload contract，因此 browser 將 `/test-tool` 視為 unsupported path 並 fallback 至 `/`。

實際恢復作業另揭露 bootstrap cycle：Web upload gate需要 current healthy Test Tool API release record，但 route尚未部署前，既有 browser-only smoke無法取得 protected route所需的 owner／foreign authorization evidence。不得以 provisional record或放寬 upload gate繞過此循環。

## Proposed Solution

- 先以既有 release gate 與 read-only cloud checks 確認 approved project、Hosting site、Test Tool API healthy immutable revision、exact HTTPS API origin及 rollback target。
- 以一次性、fail-closed operator harness為尚未存在 route的 bootstrap例外：只解析既有 device owner與既有 foreign Firebase Auth user，短效 custom／ID tokens只存於記憶體，不建立、重設、更新、刪除或輸出任何 identity／credential。
- 以 verified Test Tool API healthy release record 注入 development Web build，明確確認產物包含 `/test-tool` route且不含 Emulator、loopback endpoint或 secret。
- 將 inspected Web build重新發布至 approved development Firebase Hosting live channel。
- 發布後分別驗證 signed-out direct reload導向 `/sign-in?returnTo=/test-tool`，以及 authenticated tester direct reload保留 `/test-tool`並只載入其 eligible devices。
- 驗證 sign-out/offline後不顯示先前 tester device、表單或 event result，並保存 sanitized healthy／failed release evidence及 exact rollback dry-run。

## Non-Goals

- 不新增或重新設計 Test Tool UI、Test Tool API或事件格式。
- 不建立、重設、更新或刪除 tester帳號，不保存或輸出密碼、token、identity或裝置 ownership；一次性 operator harness只使用既有帳號與短效記憶體 token。
- 不建立 provisional healthy record、不省略任何 Test Tool API smoke check，也不在 healthy API evidence之前 upload Hosting artifact。
- 不部署 production、不加入公開匿名工具、不變更 Firestore security policy。
- 不自動執行 rollback；只產生並審閱 exact prior Hosting version的 rollback dry-run。

## Success Criteria

- `npm run check:release` 通過且 production dependency audit與 lockfile保持可重現。
- 一次性 operator harness在既有 owner／foreign user、exact API revision／digest、11項 smoke checks及 evidence privacy全部成立時才產生 sanitized healthy API record；任一前置條件缺漏皆 fail closed且不異動 Firebase Auth。
- Web build preflight證明 route已啟用、`VITE_TEST_TOOL_API_URL`符合同一 approved healthy Test Tool API release record，且 artifact secret/Emulator scan通過。
- Live signed-out direct load `/test-tool`導向 sign-in並保留 exact return path，不再導回首頁。
- Live authenticated direct load及reload `/test-tool`停留在該 route，成功載入 exactly assigned eligible device並可完成一筆 bounded test event。
- Hosting release record只在 route、authentication、API、projection、cache/privacy及 rollback checks全部通過後標記 healthy；任何失敗只保存 sanitized failed evidence。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `development-web-deployment`: Strengthen the release contract so a Hosting version cannot be marked healthy unless the inspected bundle and live origin both prove that `/test-tool` is registered and preserves the expected signed-out and authenticated routes.

## Impact

- Affected specs: `development-web-deployment`, `development-tester-event-tool`（驗證既有契約，無 requirement delta）
- Affected code:
  - Modified: `deploy/development/deploy-test-tool.mjs`, `deploy/development/deploy-test-tool.spec.ts`, `deploy/development/test-tool-service.json`, `deploy/development/release-web-beta.mjs`, `deploy/development/release-web-beta.spec.ts`, `deploy/development/verify-web.mjs`, `deploy/development/verify-web.spec.ts`, `services/test-tool-api/src/config.ts`, `services/test-tool-api/src/security/mounted-ingestion-secret.ts`, related focused tests, `deploy/development/TEST_TOOL_RUNBOOK.md`, `deploy/development/BETA_RELEASE_RUNBOOK.md`
  - New: one-time operator verification harness及其 focused tests
  - Removed: none
- Affected external systems: approved development Test Tool API inventory、Firebase Hosting live channel、Firebase Auth tester session與 sanitized release evidence。
