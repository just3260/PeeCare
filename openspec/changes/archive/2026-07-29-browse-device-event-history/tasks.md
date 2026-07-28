## 1. Query 與 pagination

- [x] 1.1 以測試先行實作使用 effectiveAt 與 eventId 穩定排序的 Bounded urination history query 與 Stable newest-first ordering，驗證 filter、limit 25 與同毫秒順序。
- [x] 1.2 實作使用 document cursor 而非 offset 的 Cursor pagination，驗證 30 筆資料分兩頁且無重複。
- [x] 1.3 [P] 以測試先行實作 Validated immutable urination records，驗證 document ID/deviceId/eventType、sequence、times、durations 與 null/pending volume contract，非法文件回傳 typed data-integrity error。

## 2. Store 與 view

- [x] 2.1 實作切換裝置即丟棄舊頁面的 Device-scoped history state，驗證 device switch 清除 items/cursor/error。
- [x] 2.2 [P] 實作 Explicit history states，component tests 覆蓋 loading/empty/ready/end/error 與 raw pending-calibration display，並執行 `npm run check:all`。
- [x] 2.3 實作以 query generation 拒絕 stale response 的 Stale history response isolation，以 A 慢於 B、retry 慢於新版兩種 deferred-promise tests 驗證舊 response 零 state mutation。
- [x] 2.4 [P] 實作 Asia Taipei history time display，以 UTC 邊界與不同 host `TZ` 驗證可見日期固定且 pagination 仍使用原 effectiveAtMs。
