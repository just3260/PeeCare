## Why

目前內部 operator 必須安裝相容的 Node.js，並自行準備本機測試工具的多個資產與 secret file，才能操作既有 development-cloud bridge。為降低受控內部測試的環境門檻，同時保留個人 Google Cloud IAM、稽核與撤權能力，需要提供不內嵌 credential 的 macOS 單一執行檔。

## What Changes

- 新增 Apple Silicon arm64 與 Intel x64 兩個架構專用、各自為單一檔案的 macOS operator test tool；不建立 universal binary。
- 將既有 ESM operator／server source 以版本鎖定的 bundler 產生 Node.js 22.23.2 相容的 CommonJS SEA entry，並將既有 HTML 與 PNG 資產嵌入 Single Executable Application；repository source 維持 ESM，且保留現有 local UI、request preview、health、device registry、urination、battery、custom-name、sequence 與 development-cloud allowlist 行為。
- 將最低 runtime 改為架構別政策：Apple Silicon arm64 維持 macOS Sonoma 14.8.8，Intel x64 支援 macOS Sonoma 14.6.0；啟動時依 validated build manifest 中所選架構的 floor 拒絕更舊版本或錯誤 CPU 架構。
- 接受 `/usr/bin/sw_vers -productVersion` 回傳的二段或三段純數字版本；二段版本補零為 patch component 後再與架構別 floor 比較，避免 `14.6` 或較新的 macOS（例如 `26.4`）被誤判。
- 要求 operator 已安裝並登入 gcloud CLI；launcher 只接受核准的 user identity、project petcare-c7483 與 numeric Secret Manager version，將 resolved ingestion secret只保留於 process memory。
- 維持 server 只監聽 127.0.0.1，安全選擇可用 port，並以 macOS 預設瀏覽器開啟頁面；啟動、失敗與關閉流程不得把 secret 寫入 executable、arguments、environment、filesystem、DOM、response 或 logs。
- 建立可重現的 arm64／x64 build manifest、checksum、privacy scan、release evidence verifier 與 operator runbook；此 change 只交付 staging artifacts 與 fail-closed release gate，不執行 Developer ID signing、notarization、架構真機 qualification 或正式發布。

## Capabilities

### New Capabilities

- `macos-operator-test-tool-distribution`: 定義 arm64 macOS 14.8.8+ 與 x64 macOS 14.6.0+ 的雙架構單檔 build、operator 啟動、gcloud credential retrieval，以及對外部簽章、公證與 qualification evidence 採 fail-closed 的發布驗證契約。

### Modified Capabilities

- `development-tester-event-tool`: 將 development-cloud operator secret boundary擴充為已驗證的 in-memory gcloud provider，同時保留既有 owner-only secret file provider 作為明確選用的 fallback。

## Impact

- Affected specs: macos-operator-test-tool-distribution（新增）、development-tester-event-tool（修改）
- Affected code:
  - New:
    - scripts/test-tool-operator.mjs
    - scripts/test-tool-macos-build.mjs
    - scripts/test-tool-macos-verify.mjs
    - scripts/test-tool-macos-build.json
    - scripts/test-tool-operator-entry.mjs
    - scripts/test-tool-operator.spec.ts
    - scripts/test-tool-macos-build.spec.ts
    - scripts/TEST_TOOL_MACOS_RUNBOOK.md
  - Modified:
    - scripts/test-tool.mjs
    - scripts/test-tool-server.spec.ts
    - scripts/check-release.mjs
    - scripts/check-release.spec.ts
    - package.json
    - package-lock.json
    - .gitignore
  - Removed: none
- Affected external systems: Google Cloud CLI user authentication 與 Secret Manager per-secret IAM／audit。Apple Developer ID、Apple notary service 與 native qualification hosts 僅是 verifier 接受的未來 evidence 來源，此 change 不呼叫或操作它們。
- Dependencies: pinned Node.js 22.23.2 SEA runtime inputs、pinned esbuild CommonJS bundling、pinned resource injection tooling、macOS codesign／Gatekeeper inspection tools，以及 operator-installed gcloud CLI。
