## 1. Daily data series

- [x] 1.1 以測試先行實作以 Asia Taipei 產生最近十四日範圍的 Bounded fourteen-day query，驗證 local date boundary 與 ascending result。
- [x] 1.2 實作缺少 daily document 補為零次的 Continuous daily count series 與 Pending volume exclusion，驗證 14 points、synthetic flag 與不顯示 null volume。
- [x] 1.3 [P] 以測試先行實作先驗證 daily document 再補 gap 的 Validated daily aggregate documents，逐欄驗證 date/timeZone/count/status/null volumes/metadata，並確認 corrupt document 不會變成 synthetic zero。

## 2. Stats view

- [x] 2.1 [P] 實作圖表與資料表使用同一 series 的 Accessible count visualization，驗證 chart/table dates 與 counts 完全一致。
- [x] 2.2 實作 Device-scoped stats state，驗證 switch 清除舊 series、loading/error states，並執行 `npm run check:all`。
- [x] 2.3 實作 All-zero fourteen-day series 與 Stale stats response isolation，驗證無 daily documents 仍輸出 14 個 zero points，且 A 慢於 B 的 response 不改寫 B series。
