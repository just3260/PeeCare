## Context

目前 npm run check:all 在 unit stage 即失敗，因此後續 build、service checks 與 Emulator tests 不會由同一 command 完整執行。獨立執行的 cloud integration tests 通過，但 Web production tree 有一個 high advisory，ingestion tree 有一個 high 與六個 moderate advisories。此 change 同時跨越 root Web、Member API、Ingestion API 與 lockfiles，需保留一個可交接的 release baseline。

## Goals / Non-Goals

**Goals:**

- 讓單一 release command 在 clean checkout 穩定執行三個 workspace 的 type-check、tests、build、Emulator integration 與 production audits。
- production dependency audit 對 moderate、high、critical findings 採 fail closed。
- 修復本機測試工具回歸時保留 device update-mask 不覆寫 customName 的既有意圖。

**Non-Goals:**

- 不新增 cloud resources、deployment workflow 或產品功能。
- 不以 ignore list、audit exception、強制 major upgrade或移除測試來製造綠燈。
- 不處理 low/info advisory，也不在此 change 建立持續 CI。

## Decisions

### 單一 release baseline command 覆蓋三個 workspaces

新增 check:release，依序執行既有 check:all，再執行 root、Member API、Ingestion API 的 production audit runner。選擇單一 orchestration command 而不是要求 operator 記憶多個 commands，因為 release 結論必須有一致 exit code。快速開發用 check 保持原意。

### Dependency remediation 不使用 audit suppression

以 direct dependency upgrade、compatible transitive resolution 與 lockfile refresh 消除 moderate 以上 findings。audit runner 解析三份 JSON results，僅在三者都沒有 moderate/high/critical 時成功；registry failure、invalid JSON 或缺少 lockfile一律失敗。替代方案是 advisory allowlist，但目前 findings 數量小且有 fix path，allowlist 會把風險永久化。

### 本機測試工具修復維持 update-mask 行為

修復 toggle/render synchronization 或 DOM fixture，使 curl-device 在展開完成後穩定呈現 deviceId 與 ownerUid updateMask，並持續排除 customName。不得刪除斷言或把非同步行為改成固定 sleep；測試以可觀測 render completion 同步。

## Implementation Contract

**Behavior:** clean checkout 安裝三個 lockfiles 後執行 check:release，所有 type-check、unit、build、service、Firebase Emulator integration 與 production audit 完成後才回傳 0。任何 stage 或任何 moderate 以上 advisory 使 command non-zero。

**Interface:** package script check:release；audit runner輸出每個 workspace 的 info/low/moderate/high/critical counts 與最終 pass/fail，不輸出 registry token、完整環境或 dependency source URL。

**Failure modes:** registry 不可用、lockfile drift、audit endpoint error、test failure或 build failure都要指出 workspace/stage 並 non-zero；不得靜默略過。

**Acceptance criteria:** 本機測試工具目標 test 連續執行三次通過；check:all 通過；check:release 通過；對 synthetic moderate advisory fixture 與 registry failure fixture均驗證 non-zero；npm ci 後 git diff 不產生 lockfile drift。

**Scope boundaries:** in scope 是現有 source/test regression、production dependencies 與 release baseline command；out of scope 是 CI、cloud deployment、low advisory policy與 bundle optimization。

## Risks / Trade-offs

- [Risk] Major Firestore dependency upgrade造成 ingestion behavior差異 → 先以 integration tests與 Emulator transaction/concurrency suites驗證，再更新 lockfile。
- [Risk] 網路 audit造成 release gate短暫失敗 → 明確 fail closed並回報 registry failure，不把未知狀態當安全。
- [Risk] 三個 workspace install順序造成 lockfile不一致 → 固定 npm ci順序並以 clean-tree assertion驗證。

