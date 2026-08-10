## 1. Safety inventory

- [x] 1.1 建立先驗證 inventory 再允許 mutation 的 Approved development inventory 與 Development target isolation；以 `firebase/development/preflight.spec.ts` 驗證 incomplete、demo、production 與 non-allowlisted targets 都 non-zero 且 mutation spy 為零，並以 `npm run firebase:development:preflight -- --dry-run` 檢查 sanitized plan。
- [x] 1.2 在 `src/platform/firebase/config.ts` 實作雲端 adapter 與 Emulator adapter 分離的 Explicit cloud Firebase adapter，要求 `VITE_FIREBASE_ENVIRONMENT=development` 與完整 projectId/apiKey/authDomain/appId；以 `src/platform/firebase/config.spec.ts` 驗證 missing discriminator/config、project mismatch、mismatched authDomain、loopback 與 Emulator settings fail closed。
- [x] 1.3 在 `src/platform/firebase/client.ts` 實作在初始化前選定 local 或 development services 的 Pre-initialization environment isolation 與 Complete development Web configuration；以 `src/platform/firebase/client.spec.ts` spies 驗證 rejected mode/project/authDomain/loopback/emulator config 都不呼叫 `initializeApp`、service factories 或 Emulator connectors，valid development config 則初始化一次且不連 Emulator。

## 2. Development services

- [x] 2.1 實作 Development rules and index deployment，`npm run firebase:development:deploy -- --dry-run` 必須只列出 approved project 的 Rules/index mutation；`--apply` 必須以 Firebase CLI 成功部署 `firestore.rules` 與 `firestore.indexes.json`，任一步失敗皆 non-zero。Owner/non-owner deployed authorization probes 由具備 seed identities 的 task 2.4 驗收。
- [x] 2.2 實作 Seed 只建立可刪除測試資料的 Disposable development seed；以 `firebase/development/seed.spec.ts` 驗證 marker-scoped create/verify/cleanup 不觸碰 unmarked documents，並由 cloud smoke command 輸出 sanitized create/cleanup summary。
- [x] 2.3 實作 Seed preserves ingestion state；在 `firebase/development/seed.spec.ts` 對含 urination/battery projections 的 fixture merge owner 後做完整 field diff，只允許新增或更新 `ownerUid` 與 development marker fields。
- [x] 2.4 實作 Deployed Auth and Firestore readiness；`npm run firebase:development:verify` 驗證 approved provider、authorized domain、required indexes ready 與 Owner/non-owner/anonymous/write-denial probes，失敗時 non-zero 且只輸出 sanitized readiness summary。
