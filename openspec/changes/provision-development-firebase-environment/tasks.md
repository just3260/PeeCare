## 1. Safety inventory

- [ ] 1.1 建立先驗證 inventory 再允許 mutation 的 Approved development inventory 與 Development target isolation，驗證 incomplete/production targets 都在零 mutation 下失敗。
- [ ] 1.2 [P] 實作雲端 adapter 與 Emulator adapter 分離的 Explicit cloud Firebase adapter，驗證 missing/mismatched config fail closed。
- [ ] 1.3 實作在初始化前選定 local 或 development services 的 Pre-initialization environment isolation 與 Complete development Web configuration，以 spy 驗證 rejected mode/project/authDomain/loopback/emulator config 都不呼叫 SDK initialization 或 Emulator connectors。

## 2. Development services

- [ ] 2.1 實作 Development rules and index deployment，dry-run 後驗證 Owner read 與 non-owner denial。
- [ ] 2.2 實作 Seed 只建立可刪除測試資料的 Disposable development seed，驗證 marker-scoped create/cleanup 與 cloud smoke summary。
- [ ] 2.3 實作 Seed preserves ingestion state，對含 urination/battery projections 的 development fixture merge owner 後做完整 field diff。
- [ ] 2.4 實作 Deployed Auth and Firestore readiness，驗證 provider、authorized domain、indexes ready 與 Owner/non-owner/anonymous/write-denial probes，輸出 sanitized readiness summary。
