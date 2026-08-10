## Context

Development cloud introduces billing and immutable Firestore location choices. Skeleton must fail before mutation until inventory is approved. 現有 Web Firebase platform 已分成 `src/platform/firebase/config.ts` 的純設定解析與 `src/platform/firebase/client.ts` 的 SDK 初始化；refresh 後沿用此分層，不建立已不存在的 `services.ts` 或平行 cloud adapter。

## Goals / Non-Goals

**Goals:** explicit inventory, allowlisted project, production Firebase adapter, rules/index deploy, smoke seed.

**Non-Goals:** 不建立 production、Hosting release、Cloud Run、backup/PITR 或正式會員資料。

## Decisions

### 先驗證 inventory 再允許 mutation

Preflight 要求 development project ID、region、billing owner、Auth provider 與 operator confirmation 都已記錄，且 project 不得為 demo target、不得出現在 production denylist，並且必須出現在 development allowlist。

### 雲端 adapter 與 Emulator adapter 分離

`src/platform/firebase/config.ts` 先解析 `VITE_FIREBASE_ENVIRONMENT=local|development`。local 僅允許 `demo-peecare` 與固定 loopback Emulators；development 必須完整解析 approved project 的 projectId、apiKey、authDomain、appId，缺漏或矛盾設定不得 fallback 到 local、production 或任何其他 project。

### Seed 只建立可刪除測試資料

Admin runner 只建立帶 development marker 的測試會員、Owner device 與 minimal aggregate，並提供相同 marker 的清除檢查。

### 在初始化前選定 local 或 development services

`src/platform/firebase/client.ts` 的 `getFirebaseServices()` 是 Web features 的單一入口，`getLocalFirebaseServices()` 則保留為 local integration tests 與 reset flows 的相容入口。兩者都先委派 `config.ts` 完成驗證，再回傳相同 `{ app, auth, firestore }` interface。development config 要求 projectId、apiKey、authDomain、appId 均存在且 projectId 等於 approved inventory，authDomain 僅能是 `<projectId>.firebaseapp.com` 或 `<projectId>.web.app`，並禁止 `demo-peecare`、loopback host、任何 Emulator endpoint 與 `VITE_FIREBASE_USE_EMULATORS`。任何驗證失敗都必須發生在 `initializeApp`、`getAuth`、`getFirestore`、`connectAuthEmulator` 或 `connectFirestoreEmulator` 前。

## Implementation Contract

**Behavior:** approved inventory 才能部署 Rules/indexes 與建立 smoke data；錯誤 target 在任何 mutation 前終止。

**Interface:** `firebase/development/environment.ts` 暴露經驗證的 inventory shape `{ projectId, firestoreRegion, billingOwner, authProvider, operatorConfirmation }`。`npm run firebase:development:preflight -- --dry-run` 輸出 project、region、services 與 mutation plan，不輸出 API key、credential 或 token。Web 以 `VITE_FIREBASE_ENVIRONMENT` 顯式選擇 `local` 或 `development`；`getFirebaseServices()` 回傳 `{ app, auth, firestore }`，local mode 延續 `getLocalFirebaseServices()`，development mode 使用 projectId、apiKey、authDomain、appId 且不連 Emulator。

**Failure modes:** inventory 或 Web config 缺漏、未知 environment discriminator、project/authDomain mismatch、未核准 region/billing/provider、demo/production target、loopback/Emulator setting 或 Admin credentials 缺失皆在 SDK initialization 或 cloud mutation 前失敗；CLI 以 non-zero exit 結束並只輸出 sanitized error code/context。

**Acceptance criteria:** `npm run test:unit -- firebase/development src/platform/firebase` 通過；preflight dry-run 與 negative target tests 證明零 mutation；client spies 證明 rejected development config 零 SDK call；Rules/index deploy check、authorized domain/Auth provider check、marker cleanup、merge seed field diff 與 Auth/Firestore smoke probes 全部通過。

**Scope boundaries:** in scope 是 development Firebase foundation；out of scope 是 Hosting、Cloud Run、production 與資料 migration。

## Risks / Trade-offs

- [Risk] Firestore region 不可逆 → apply 前必須 refinement 並人工確認 inventory。
- [Risk] 真實雲端產生成本 → development project 隔離、budget gate 與可清理 seed。

## Open Questions

實際 development project ID、Firestore region、billing owner、Auth provider、authorized domain 與 operator confirmation 必須由 operator 在任何 cloud mutation 前提供並核准。Artifacts 不填入推測值；apply 可先完成 fail-closed tooling 與本地測試，但 deployment、seed 與 readiness commands 在這些 gates 缺漏時必須停止。
