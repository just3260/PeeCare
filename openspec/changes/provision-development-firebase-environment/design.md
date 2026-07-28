## Context

Development cloud introduces billing and immutable Firestore location choices. Skeleton must fail before mutation until inventory is approved.

## Goals / Non-Goals

**Goals:** explicit inventory, allowlisted project, production Firebase adapter, rules/index deploy, smoke seed.

**Non-Goals:** 不建立 production、Hosting release、Cloud Run、backup/PITR 或正式會員資料。

## Decisions

### 先驗證 inventory 再允許 mutation

Preflight 要求 development project ID、region、billing owner、Auth provider 與 operator confirmation 都已記錄，且 project 不等於 demo 或 production allowlist。

### 雲端 adapter 與 Emulator adapter 分離

Build 只能從顯式 environment 選擇 development adapter；缺漏設定不得 fallback 到任何 project。

### Seed 只建立可刪除測試資料

Admin runner 只建立帶 development marker 的測試會員、Owner device 與 minimal aggregate，並提供相同 marker 的清除檢查。

### 在初始化前選定 local 或 development services

`src/platform/firebase/services.ts` 是 Web features 的單一入口。它先解析 explicit environment discriminator，再委派既有 local adapter 或新的 development adapter；兩者回傳相同 `{ app, auth, firestore }` interface。development config 要求 projectId、apiKey、authDomain、appId 均存在且 projectId 等於 approved inventory，並禁止 `demo-peecare`、loopback host、`VITE_FIREBASE_USE_EMULATORS=true`。任何驗證失敗都必須發生在 `initializeApp`、`connectAuthEmulator` 或 `connectFirestoreEmulator` 前。

## Implementation Contract

**Behavior:** approved inventory 才能部署 Rules/indexes 與建立 smoke data；錯誤 target 在任何 mutation 前終止。

**Interface:** inventory 與 preflight command 輸出 project、region、services 與 dry-run plan，不輸出 secrets。Web 使用 `getFirebaseServices()`；local mode 延續 `getLocalFirebaseServices()`，development mode 使用 approved client config 且不連 Emulator。

**Failure modes:** project mismatch、未核准 region/billing/provider、production target 或 credentials 缺失皆 non-zero exit。

**Acceptance criteria:** dry-run、negative target tests、local/development adapter isolation、Rules/index deploy check、authorized domain/Auth provider check、merge seed preservation 與 Auth/Firestore smoke test 通過。

**Scope boundaries:** in scope 是 development Firebase foundation；out of scope 是 Hosting、Cloud Run、production 與資料 migration。

## Risks / Trade-offs

- [Risk] Firestore region 不可逆 → apply 前必須 refinement 並人工確認 inventory。
- [Risk] 真實雲端產生成本 → development project 隔離、budget gate 與可清理 seed。

## Open Questions

Project ID、region、billing owner與 Auth provider 是 apply 前必填 refinement gates。
