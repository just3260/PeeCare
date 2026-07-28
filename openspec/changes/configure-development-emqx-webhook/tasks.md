## 1. Rule 與 action

- [ ] 1.1 實作 Rule 選取 canonical urination 與 battery telemetry topics 的 Exact development topic filter，驗證 `events/urination`、`status/battery` match，且 `events/battery`、legacy、commands、其他 status 不 match。
- [ ] 1.2 實作 Action 產生固定 webhook envelope 的 Contract webhook envelope，使用 golden request probe 驗證欄位。
- [ ] 1.3 [P] 實作 Referenced Bearer secret 與 Approved retry policy，驗證 literal secret scan 與未核准 policy 零 mutation。
- [ ] 1.4 以測試先行實作 Transport metadata preservation 與 Decoded object payload boundary，覆蓋 qos 0/1/2、retained true passthrough、clientId/username 分離、broker timestamp、object 與 array payload。

## 2. 驗收與 rotation

- [ ] 2.1 實作 Secret rotation 採 current then previous window 的 Webhook delivery verification，驗證兩類 event、legacy non-delivery 與 rotation rehearsal。
