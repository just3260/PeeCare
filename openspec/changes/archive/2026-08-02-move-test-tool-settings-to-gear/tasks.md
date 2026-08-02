## 1. 導覽行為測試

- [x] 1.1 依 TDD 先新增 `scripts/test-tool.spec.ts` 的失敗 DOM 測試，涵蓋「Settings entry is available from the main tool view」、「Shared settings use a dedicated in-document view」與「Navigation preserves shared setting state and testing behavior」：驗證預設主畫面、齒輪／返回切換、可存取名稱、焦點移動、欄位值保留及既有 request builder 使用編輯後設定；以 `npm run test:unit -- scripts/test-tool.spec.ts` 確認測試會因尚未具備新 UI 而失敗。

## 2. 共用設定頁面

- [x] 2.1 在 `scripts/test-tool.html` 實作「使用單一文件的頁內畫面切換」與「保留共用設定區塊及既有欄位識別碼」：初始只顯示主測試畫面，齒輪開啟含全部既有欄位與 run-all 的「共用設定」畫面，返回後所有設定及 request builder 行為不變；以 `npm run test:unit -- scripts/test-tool.spec.ts` 驗證畫面、狀態與請求行為全部通過。
- [x] 2.2 在 `scripts/test-tool.html` 完成「使用原生按鈕承載齒輪與返回操作」：右上角顯示內嵌 SVG 齒輪、按鈕具備「開啟共用設定」可存取名稱與可見 focus 樣式，切換後焦點落在新畫面的導覽控制且深色模式可辨識；以 `npm run test:unit -- scripts/test-tool.spec.ts` 及瀏覽器手動檢查桌面／窄螢幕佈局驗證。

## 3. 完整驗證

- [x] 3.1 執行 `npm run test:unit -- scripts/test-tool.spec.ts` 與 `npm run check`，並以瀏覽器手動確認主畫面右上角齒輪、設定頁返回、欄位值 round trip、preview/send/run-all 與 sequence/eventId 行為，確保 Implementation Contract 的接受條件全部成立且未改動 `scripts/test-tool.mjs` proxy 或 API payload。
