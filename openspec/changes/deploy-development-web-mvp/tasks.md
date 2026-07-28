## 1. Build 與 Hosting

- [ ] 1.1 實作 Build 僅接受 approved development config 的 Development-only Hosting target 與 Secret-free cloud build，驗證錯誤 target/Emulator/secret 零 upload。
- [ ] 1.2 實作 HTML shell 與 hashed assets 使用不同 cache 的 SPA and cache behavior，驗證 direct route reload 與 headers。
- [ ] 1.3 [P] 實作 Development cloud service selection 與 No browser MQTT capability，檢查 build discriminator/project、零 Emulator endpoints，並掃描 MQTT imports/Broker URL/credential。
- [ ] 1.4 實作 Service worker 不快取 Firebase member data 的 Member data cache exclusion，以 Cache Storage inspection 與 sign-out/offline test 驗證 shell 可用但前一會員資料不可見。

## 2. Release 驗收

- [ ] 2.1 實作 Release 後執行 member smoke journey 的 Development member smoke journey，於 mobile viewport 驗證五個 member flows。
- [ ] 2.2 實作 Hosting release record，驗證 build hash、Hosting/rollback versions 與 sanitized output。
- [ ] 2.3 實作 Protected route reload matrix，分別以 Owner 與 signed-out browser direct load `/`、`/history`、`/stats`、`/sign-in`，驗證 route restore/guard 與零 protected content leak。
