## 1. 修復與 dependency baseline

- [x] 1.1 以測試先行完成「本機測試工具修復維持 update-mask 行為」與 Stable test-tool device update mask：讓 curl preview 在 observable render completion 後包含 deviceId/ownerUid 並排除 customName；以 scripts/test-tool.spec.ts focused test 連續執行三次驗證。
- [x] 1.2 [P] 實作 Production dependency audit threshold runner，解析 root、services/member-api、services/ingestion-api 的 production audit JSON，對 moderate/high/critical、registry error與invalid JSON fail closed；以 scripts/audit-production-dependencies.mjs table fixtures驗證每個severity與failure path。
- [x] 1.3 依「Dependency remediation 不使用 audit suppression」升級或鎖定Web與Ingestion dependencies，使三個production trees沒有moderate以上findings且不含ignore/allowlist；以三個npm audit --omit=dev --omit=optional與既有service tests驗證。

## 2. 完整 release gate

- [x] 2.1 實作「單一 release baseline command 覆蓋三個 workspaces」與 Complete cloud release quality gate，新增check:release依序執行check:all與三workspace audit並回報failed workspace/stage；以package-script orchestration tests及故意失敗stage fixture驗證exit propagation。
- [x] 2.2 實作 Deterministic workspace lockfiles，固定三個npm ci順序並在release gate後確認package manifests/lockfiles無變更；以clean checkout install、check:release及git diff assertion驗證。
- [x] 2.3 執行完整regression與release驗收：npm run check:release、focused update-mask三連跑、container/service builds與Firebase Emulator suite全部通過，並人工審閱sanitized summary不含registry credential或dependency source URL。

