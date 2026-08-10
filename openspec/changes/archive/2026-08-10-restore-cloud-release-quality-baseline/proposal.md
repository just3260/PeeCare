## Why

目前完整 cloud release gate 因本機測試工具回歸而失敗，且 Web 與 ingestion production dependency trees 仍有 high／moderate advisories。任何 development cloud change 在此基線未恢復前都無法得到可信的可發布結論。

## What Changes

- 修復本機測試工具的 Firestore update-mask 顯示與測試同步問題，讓完整品質閘門穩定通過。
- 升級或鎖定 Web 與 ingestion production dependencies，消除 production audit 的 moderate、high 與 critical findings。
- 將三個 npm workspace 的 production audit 納入單一 release-baseline command，並保留 lockfile 可重現性。
- 以完整 unit、build、service 與 Firebase Emulator gates 驗證 dependency remediation 沒有行為退化。

## Capabilities

### New Capabilities

- cloud-release-quality-baseline: 定義 development cloud work 開始前必須通過的完整測試、建置、production dependency audit 與 lockfile 可重現性契約。

### Modified Capabilities

(none)

## Impact

- Affected specs: cloud-release-quality-baseline（新增）
- Affected code:
  - New:
    - scripts/audit-production-dependencies.mjs
  - Modified:
    - scripts/test-tool.mjs
    - scripts/test-tool.spec.ts
    - package.json
    - package-lock.json
    - services/ingestion-api/package.json
    - services/ingestion-api/package-lock.json
    - services/member-api/package.json
    - services/member-api/package-lock.json
  - Removed: none
- Dependencies: npm production dependency graphs and the existing Firebase Emulator quality gate.

