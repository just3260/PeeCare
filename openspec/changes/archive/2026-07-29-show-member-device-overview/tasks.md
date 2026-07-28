## 1. Overview store

- [x] 1.1 以測試先行實作先載入清單再選取裝置的 Owned device selection，驗證 0/1/2 devices 與 stable selection。
- [x] 1.2 實作每次只監聽一台 selected device 的 Single selected-device listener，驗證 switch/sign-out 的 unsubscribe ordering。
- [x] 1.3 [P] 以測試先行實作以完整 projection tuple 驗證 Firestore snapshot 的 Validated latest projection tuples 與 Canonical battery projection values，使用完整、全缺漏、partial、非法 level/voltage fixtures 驗證 typed model。

## 2. 首頁呈現

- [x] 2.1 [P] 實作 Latest projection display，component tests 驗證 Firestore projection 更新反映在排尿、電量與 last reported cards。
- [x] 2.2 實作缺漏投影顯示 unknown 而非推算的 Explicit overview states，驗證 loading/empty/ready/missing/error 且執行 `npm run check`。
- [x] 2.3 實作 Asia Taipei overview time display，以 UTC 午夜邊界與不同 host `TZ` 的 formatter tests 驗證三種時間都使用 `Asia/Taipei` 且 model 保留原 epoch milliseconds。
