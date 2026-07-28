## 1. Ownership 與 repository

- [x] 1.1 以測試資料建立以 device ownerUid 表達 MVP ownership 的 Single-owner device model，驗證一位 UID 可對應兩台裝置且每台只有一位 Owner。
- [x] 1.2 以測試先行實作 Constrained owned-device query，驗證 repository 永遠帶 `ownerUid == authenticatedUid` 並只回傳本人裝置。
- [x] 1.3 實作 Owner seed 只擴充既有 ingestion registry 的 Ingestion registry preservation，對已含 latest projections 的 fixture 執行 merge 後完整 diff，確認 ingestion 欄位不變。
- [x] 1.4 [P] 以測試先行實作 Owned device runtime model，驗證 document ID、deviceId、ownerUid、productModel、ingestionStatus，並對 mismatch 回傳 typed data-integrity error。

## 2. Security Rules

- [x] 2.1 實作 Owner-only device reads，透過 Emulator matrix 驗證 owner 成功、non-owner 與 anonymous 拒絕。
- [x] 2.2 實作子集合授權讀取 parent device 的 Owner-only child data reads，驗證 events 與 dailyStats 只允許 parent Owner。
- [x] 2.3 實作 Client 全面唯讀的 Client write denial，驗證 owner 也不能寫入任何 domain document，並執行 `npm run check:all`。
- [x] 2.4 實作 Malformed ownership denial，透過 Emulator table 驗證 missing/empty/non-string ownerUid 與 mismatched deviceId 均不可被 Web repository 或 Rules 視為有效 Owner 資料。
