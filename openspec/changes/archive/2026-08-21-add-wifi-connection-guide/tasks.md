## 1. 先建立可驗證的行為契約

- [x] [P] 1.1 在 `src/components/WifiConnectionGuideDialog.spec.ts` 建立失敗測試，鎖定 `Single-page illustrated Wi-Fi guide`、`Accessible modal interaction`、`Responsive single-page presentation`，以及設計決策 `Single-page guide dialog owns content and accessibility`、`Component interfaces and state`、`Accessibility and responsive behavior`；測試須具體驗證六步順序、單一捲動頁、dialog 語意、四種關閉方式、正反向焦點圈限、焦點還原與 body overflow cleanup，並以 `npm run test:unit -- src/components/WifiConnectionGuideDialog.spec.ts` 確認測試在元件尚未完成時因預期契約而失敗。
- [x] [P] 1.2 在 `src/views/HomeView.spec.ts` 建立失敗測試，鎖定 `Automatic presentation for an empty device list`、`Persistent home-page help entry`，以及設計契約 `Observable behavior`、`Failure modes and acceptance criteria`；測試須涵蓋 signed-in + empty 自動開啟、loading/ready/error 不開啟、同 UID session 去重、不同 UID 隔離、手動先開啟、儲存失敗 fallback、首頁問號重複開啟與其他 Header 使用者無按鈕，並以 `npm run test:unit -- src/views/HomeView.spec.ts` 確認測試因缺少功能而失敗。

## 2. 實作單頁說明與首頁整合

- [x] [P] 2.1 依 `App header exposes a home-only actions slot` 修改 `src/components/AppHeader.vue`，提供可選 `actions` slot 且未提供內容時維持既有品牌版面，使首頁能放置操作而設定頁不會自動出現問號；以 `npm run test:unit -- src/views/HomeView.spec.ts src/components/ShellAccessibility.spec.ts` 驗證 Header 入口範圍與既有殼層無回歸。
- [x] 2.2 依 `Hardware-independent copy stays centralized` 在 `src/components/WifiConnectionGuideDialog.vue` 建立六步圖文與單頁 responsive 版面，使用內嵌裝飾圖形、窄螢幕安全區、寬螢幕尺寸上限、可捲動內容及固定可操作 Header/Footer，且不寫入未確認硬體常數；以元件測試中的內容順序、禁用硬體常數與版面 class/assertion 驗證。
- [x] 2.3 完成 `WifiConnectionGuideDialog` 的受控 `open`/`close` 介面、Teleport overlay、dialog accessible name、初始焦點、Tab/Shift+Tab 圈限、Escape/overlay/關閉按鈕/「我知道了」關閉、焦點還原與 body scroll cleanup，使 `Single-page guide dialog owns content and accessibility` 契約可觀察；以 `npm run test:unit -- src/components/WifiConnectionGuideDialog.spec.ts` 全數通過驗證。
- [x] 2.4 依 `Home view owns automatic presentation and session deduplication` 修改 `src/views/HomeView.vue`，在 signed-in + empty 時以 `peecare:wifi-connection-guide:auto-shown:<uid>`=`1` 去重、自動或手動開啟時標記、sessionStorage 例外時使用元件生命週期內記憶體 fallback，並透過 Header action 呈現 accessible name 為「開啟 Wi-Fi 連線說明」的圓形問號；以 `npm run test:unit -- src/views/HomeView.spec.ts` 驗證所有狀態轉換與手動重開情境。

## 3. 完整驗證與範圍稽核

- [x] 3.1 依 `Scope boundaries` 確認變更只包含 Vue 前端說明、首頁觸發、分頁 session 去重與測試，沒有新增 Wi-Fi credential、裝置綁定、後端/Firebase schema 或外部內容依賴；先執行 `npm run test:unit -- src/components/WifiConnectionGuideDialog.spec.ts src/views/HomeView.spec.ts src/components/ShellAccessibility.spec.ts`，再以 `npm run check` 驗證型別、全部單元測試、production build 與三個服務品質門檻均通過。
