## 1. 持續顯示主要導覽

- [x] 1.1 以測試先行定義 Persistent main-route bottom navigation 與 No main navigation on sign-in：`App` route tests 必須先證明 `/history`、`/stats` 缺少殼層底部導覽，且 `/sign-in` 不顯示；以目標 Vitest 測試失敗驗證紅燈。
- [x] 1.2 實作 Elevate bottom navigation into the authenticated application shell 並 Preserve the existing bottom-safe content spacing，讓 `/`、`/history`、`/stats` 顯示固定底部導覽並保留 active 語意、`/sign-in` 不顯示；以 `src/App.spec.ts`、`src/components/BottomNavigation.spec.ts` 與 `npm run check:all` 驗證。

## 2. 對齊主要頁面視覺

- [x] 2.1 以測試先行定義 Consistent main-route presentation：`HistoryView` 與 `StatsView` 測試必須先要求 application header 與 surface card，並以目標 Vitest 測試失敗驗證紅燈。
- [x] 2.2 實作 Apply the home visual shell to history and stats，使 `/history`、`/stats` 使用首頁的頁首、20px 內容間距與 surface card，且不改變所有既有資料狀態；以 `src/views/HistoryView.spec.ts`、`src/views/StatsView.spec.ts` 與 `npm run check:all` 驗證。

## 3. 對齊主要頁面文字層級

- [x] 3.1 以測試先行定義 Consistent main-route presentation 的文字契約：`HistoryView` 與 `StatsView` tests 必須要求主要文字、輔助文字與按鈕的具名 typography class，並以目標 Vitest 測試失敗驗證紅燈。
- [x] 3.2 實作 Reuse home typography tokens for history and stats：讓歷史與統計使用 18px ink 主文字及 13px／14px ink 或 muted 輔助文字，且不新增文字色彩 token；以 `src/views/HistoryView.spec.ts`、`src/views/StatsView.spec.ts` 與 `npm run check:all` 驗證。

## 4. 啟用裝置與通知導覽

- [x] 4.1 以測試先行定義可用的裝置與通知導覽：`BottomNavigation` 與 `App` 測試必須要求 `/devices`、`/notifications` 為可點擊且 active 的受保護主要路由，並確認它們沒有 `aria-disabled`；以目標 Vitest 測試失敗驗證紅燈。
- [x] 4.2 實作 Route the remaining primary navigation entries：將「裝置」與「通知」設為 RouterLink 與受保護路由，讓兩頁在應用程式殼層內保留底部導覽及正確 active 語意；以 `src/components/BottomNavigation.spec.ts`、`src/App.spec.ts` 與 `src/router/index.spec.ts` 驗證。
- [x] 4.3 以測試先行定義 Empty devices and notifications states：`DevicesView` 在既有裝置 store 無裝置時必須顯示「尚無綁定裝置」，`NotificationsView` 在無通知資料時必須顯示「尚無通知紀錄」；以目標 Vitest 測試失敗驗證紅燈。
- [x] 4.4 實作裝置與通知頁的既有頁首、surface card 和空狀態，且裝置頁只讀取既有裝置 store、不新增通知資料來源或綁定流程；以 `src/views/DevicesView.spec.ts`、`src/views/NotificationsView.spec.ts` 與 `npm run check:all` 驗證。
