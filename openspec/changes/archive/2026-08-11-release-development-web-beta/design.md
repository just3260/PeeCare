## Context

development Firebase project `petcare-c7483`、Firestore、Ingestion API 與 Member API 已存在，兩個 Cloud Run health endpoints 可達，Web cloud build dry-run 也已能產生 approved development bundle；但 Firebase Hosting live origin 目前回傳 404。既有 `development-web-deployment` 規格定義 build、upload 與 smoke contract，尚未把一個由 operator 建立的 tester identity、實際 live channel availability、credential-safe browser isolation 與可重複 rollback evidence 組成單一 release operation。

Tester 帳號與密碼由 operator 在 Firebase Auth 建立及保管。repository 只能保存不含 PII 的 tester alias、預期 owned device ID 與 marker；email、UID、password、ID token、refresh token 及完整 Firestore payload 均不得進入檔案、command arguments、stdout、stderr 或 release record。

## Goals / Non-Goals

**Goals:**

- 將 approved development Web build 實際發布到 Firebase Hosting live channel，並證明根路徑與受保護 routes 可達。
- 對 exactly 1 個 tester identity 驗證登入、assigned Owner 資料、Member API mutation、登出與 route guard。
- 驗證 live UI 與 owned-device query 只呈現該 tester 的 assigned device，並保留 Emulator non-owner denial作為 release gate。
- 只保存 tester alias 與 pass/fail stage，不保存 tester PII、credential 或 domain payload。
- 在 live smoke 失敗時保留 failed evidence，且能精確產生 prior Hosting version rollback dry-run。

**Non-Goals:**

- 不建立、寄送、重設或保存 tester 帳號密碼。
- 不建立 tester device registry、事件 fixture 或雲端 test-tool。
- 不建立第二位 tester，也不在本 change 執行 multi-tester 或 cross-tester denial matrix；該覆蓋延後至後續 change。
- 不部署 production、custom domain、App Check、Hosting CSP 或持續 observability。
- 不移除 Emulator integration；Emulator 仍是 mutation-free release quality gate。
- 不自動執行 rollback traffic mutation。

## Decisions

### Live release begins with exact cloud inventory

`release-web-beta` 在任何 build 或 upload 前驗證 exact project、Hosting site/target、Firebase Web app ID、Auth domain、Member API HTTPS origin、Cloud Run healthy revision、Firestore region及 exactly 1 筆 beta tester inventory。Inventory 只含 opaque `alias`、`deviceId` 與固定 development marker；schema 接受 `PC-DEV-000001` 形式的 marked development device，拒絕 email、UID、password、token、secret-like keys、0 或 2 筆以上資料與非 development device ID。

選擇 versioned schema 加 local inventory，而不是把身份放入環境變數清單，讓結構與 device assignment 可測試，同時由 `.gitignore` 排除實際 local inventory。若 cloud prerequisite、live service或 inventory 任一項不符，dry-run 回傳 typed failure 且 upload command count 為零。

### Tester credentials enter only through hidden interactive session

Verify 階段對唯一 inventory alias 在 TTY 隱藏提示中取得 tester email 與 password；兩者只存在單一 process memory，換取 Firebase ID token 後立即清除可變 reference。Credential 不得由 command argument、committed env、JSON input、release record或 log 傳入。非 TTY、取消輸入、登入失敗或 signed-in UID 不擁有指定 device 時，該 tester stage 失敗且不執行後續 mutation。

替代方案是建立 3–4 組 smoke accounts並執行 cross-tester matrix；operator已決定本 change只建立一位 user，因此 multi-tester coverage延後且不作為本次 healthy release條件。

### Beta verification uses per-tester isolated journeys

唯一 tester 使用新的 browser context，依序完成 sign-in、assigned owned-device overview、history、stats、Member API rename/clear round trip、direct protected-route reload 與 sign-out。Rename 使用 marker name並在同一 journey清除，verification比對原始 device registry fields未被改動。Live verification要求 owned-device query與UI只包含 assigned device；Emulator release gate繼續驗證 non-owner access denied。本 change不建立 foreign live tester或執行 cross-tester matrix。

該 context 在 tester journey 完成或失敗後關閉並清除 Auth persistence、Cache Storage、IndexedDB 與 service worker controlled state，避免 beta credential或member state殘留。

### Healthy release requires exact Hosting version and explicit rollback evidence

Apply 先執行既有 release gate與 cloud build dry-run，再檢查 live channel history。若已有 release，必須解析 exact prior version；若目前沒有任何 release，preflight必須要求 exact `APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK` confirmation，並將本次標記為 bootstrap release。Upload 後解析 exact live Hosting version；只有 live origin availability、SPA/cache、唯一 tester journey、exact owned-device visibility、member-data cache exclusion與protected-route reload全部通過，才輸出 `status: healthy` record。

Sanitized record只包含 project、site、build hash、Hosting version、`rollbackAvailable`、nullable `rollbackVersion`、verified timestamp、tester aliases與 stage status。Bootstrap healthy record必須是 `rollbackAvailable: false`與 `rollbackVersion: null`；後續 healthy release必須是 `rollbackAvailable: true`與 exact prior version。任何 smoke 失敗輸出 `status: failed` evidence，但不得產生 healthy record。Rollback mode只在 prior version存在時輸出 reviewed command與target summary，不自行 mutation。

## Implementation Contract

**Behavior:** Operator 可對 approved development target執行 beta release dry-run、apply/verify與rollback dry-run。成功後 `https://petcare-c7483.web.app/` 與受保護 routes回傳 Hosting shell；exactly 1 位 operator-provisioned tester可登入並只看到 assigned device data。任何 prerequisite或 journey失敗時 release保持 failed，且不會將 credentials或 PII寫入 artifacts。

**Interface / data shape:**

- Root scripts提供 `web:development:beta:dry-run`、`web:development:beta:release` 與 `web:development:beta:rollback`。
- `release-web-beta.mjs` 接受 exactly one mode：`--dry-run`、`--apply` 或 `--rollback-dry-run`。
- Local tester inventory符合 JSON schema：`environment: "development"`、固定 `marker`、`testers` 為 exactly 1 筆 `{ alias, deviceId }`，device ID符合 `^PC-DEV-[0-9]{6}$`；actual local file不得被 Git追蹤。
- Healthy record包含 `status`、`projectId`、`hostingSite`、`buildHash`、`hostingVersion`、`rollbackAvailable`、nullable `rollbackVersion`、`verifiedAt`、`testerStages` 與 `checks`，不得包含 email、UID、credentials、tokens、customName或 event payload。
- Failure至少提供 `inventory_invalid`、`cloud_prerequisite_failed`、`credential_input_unavailable`、`tester_authentication_failed`、`tester_device_mismatch`、`unexpected_owned_device`、`hosting_unavailable`、`smoke_failed`、`rollback_unavailable` 等穩定 code。

**Failure modes:** Dry-run failure時零 Hosting upload。沒有 prior version且缺少 exact bootstrap confirmation時零 upload並回 `first_release_confirmation_required`。Apply upload後 smoke失敗時保留 exact failed version與 nullable prior version，不自動 rollback。Hidden input、browser context teardown或 record secret scan失敗時 non-zero。無 prior healthy version時 rollback dry-run回傳 `rollback_unavailable`，不得猜測 target。

**Acceptance criteria:** Inventory schema table tests覆蓋 0/1/2 tester boundaries、`PC-DEV-000001`、PII/secret keys；CLI tests覆蓋 wrong project/site/origin、non-TTY、no-prior missing/valid bootstrap confirmation與 upload short-circuit；browser tests覆蓋唯一 tester完整 journey、exact assigned-device visibility、Emulator non-owner denial gate與 context teardown；live verification確認 root及 `/history`、`/stats`、`/sign-in`均非 404，release record通過 secret/PII scan，bootstrap record明確無 rollback，後續 rollback dry-run解析 exact prior version。最後執行 `npm run check:release` 與 beta release dry-run。

**Scope boundaries:** In scope是 development Hosting live release orchestration、operator-provided tester verification、sanitized evidence與 rollback dry-run。Out of scope是 tester account/device creation、test event generation service、security-policy changes、production deployment與 automatic rollback。

## Risks / Trade-offs

- [Risk] 單一 tester無法提供 live cross-tester matrix證據 → 本 change明確限制為 single-tester beta，保留 Emulator non-owner denial gate，並將 multi-tester coverage延後至後續 change。
- [Risk] Tester rename smoke可能改變共用 device state → 使用 marker name並在同一 transaction journey清除；任一步失敗記錄 cleanup required且不得 healthy。
- [Risk] Hosting upload成功但 smoke失敗會短暫暴露 failed version → 有 prior version時保留 exact rollback dry-run；首次 bootstrap沒有 rollback時要求事前 explicit confirmation並在 failure summary標記立即修復 required，不假裝可回復。
- [Risk] Browser state在 release後殘留 credential或member data → 唯一 tester仍使用全新 context並驗證 storage/cache teardown。
- [Risk] 唯一 tester或assigned device尚未建立會阻擋 release → dry-run要求 exactly 1 筆完整 mapping，不允許空 inventory。

## Migration Plan

1. 建立 non-PII tester inventory schema、example與 gitignored local inventory。
2. 實作 beta release preflight、hidden credential input、browser journeys、sanitized record與 rollback resolver。
3. Operator在 Firebase Auth及 Firestore外部完成 exactly 1 位 tester account與 `PC-DEV-000001` device mapping。
4. 執行 release gate與 beta dry-run，確認零 mutation及所有 cloud prerequisites。
5. Apply Hosting release後執行 single-tester journey、exact assigned-device visibility與既有 Emulator non-owner denial gate；全部通過才保存 healthy record。
6. 若 smoke失敗且 prior version存在，先執行 exact rollback dry-run供 operator review；由 operator明確執行既有 Firebase Hosting rollback，再重跑 live availability verification。Bootstrap first release沒有 prior version時，failed summary明確回報 rollback unavailable並停止 tester handoff，operator必須部署修正版後重新驗證。

## Open Questions

此 change沒有未決產品決策。實際 tester email/password及 local inventory path由 operator在執行時提供，不進入 artifacts。
