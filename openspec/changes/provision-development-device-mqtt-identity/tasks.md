## 1. Inventory 與 handoff

- [ ] 1.1 實作 Device inventory 不保存 credential 的 Non-secret device inventory 與 Identity consistency，驗證 duplicate/mismatch 與 secret scan。
- [ ] 1.2 實作 Credential 以一次性人工 handoff 注入的 Unique device credential，驗證輸出只送 approved channel 且不落盤。
- [ ] 1.3 [P] 實作 Canonical publisher identity 與 Enabled registry alignment，驗證 `clientId == deviceId`、`username == device-{deviceId}`、Topic/payload/inventory/Firestore 四方一致且 registry enabled。

## 2. ACL 與 lifecycle

- [ ] 2.1 實作 ACL 僅允許發布自身 canonical telemetry topics 的 Own-topic publish ACL，執行 `events/urination`、`status/battery` positive 與 `events/battery`、跨裝置、legacy、commands negative tests。
- [ ] 2.2 實作 Credential lifecycle verification，完成 connect、rotate、revoke rehearsal 與 sanitized summary。
- [ ] 2.3 實作 Firmware identity 與 retry metadata 遵循主線契約的 Non-retained bounded QoS publishing 與 Stable firmware retry identity，以 retained/QoS manifest table 與斷線重送 fixture 驗證。
