## 1. Vue 建置基線

- [x] 1.1 以測試先行建立 Vue application build 與「使用官方 Vue Vite TypeScript 基線」：先加入無法 mount App 的失敗測試，再建立 npm lockfile、Vue 3／TypeScript／Vite／Vue Test Utils／Vitest 設定及 src/main.ts，使最小 App mount 測試、npm run type-check 與 npm run build 通過。
- [x] 1.2 建立「以統一 check command 形成品質閘門」，讓 dev、build、type-check、test:unit、check scripts 的失敗狀態可傳遞；驗證方式為執行 npm run check 成功，再暫時引入一個 TypeScript 型別錯誤確認 check 回傳非零狀態後還原測試變更。

## 2. 應用殼與導航

- [x] 2.1 以測試先行實作 Neutral PeeCare application shell 與「只建立應用殼與首頁中性狀態」，讓 AppHeader、OverviewPlaceholder、HomeView 顯示 PeeCare、尚無裝置資料、待校正及尚未回報，且不顯示四項假資料文案；驗證方式為先建立 HomeView.spec.ts 的正反斷言，再完成元件使 npm run test:unit 通過。
- [x] 2.2 [P] 以測試先行實作 Extensible client-side navigation 與「以 Vue Router 建立可擴充導航邊界」，註冊 /、catch-all redirect 與不可互動的歷史／裝置／通知項目；驗證方式為建立 memory-history route 測試，確認 /unknown-path 回到 / 且三個項目具有 aria-disabled=true。
- [x] 2.3 [P] 實作 Responsive and accessible shell 的語意 landmarks、zh-TW document language、可見 focus 與 320–1024px 響應式樣式；驗證方式為元件測試確認 header／main／nav 與 accessible name，並以 320px、1024px production preview 人工檢查無水平捲動及內容容器溢出。

## 3. PWA 與舊 runtime 移除

- [x] 3.1 以測試先行實作 Installable offline application shell 與「由 Vite PWA 產生 manifest 與 service worker」，配置 generateSW、autoUpdate、/index.html navigation fallback、zh-TW manifest 及兩個既有圖示；驗證方式為先加入 build artifact 檢查，再執行 npm run build 確認 manifest、service worker registration、hashed precache 與圖示引用存在，且 Vitest／dev 不註冊 service worker。
- [x] 3.2 實作 Browser MQTT removal 與「移除舊版 MQTT 瀏覽器路徑」，刪除五個舊 public runtime 檔並確保根 index.html 只有 Vue module 入口且不載入外部字型；驗證方式為建置後搜尋 source 與 dist，確認 mqtt.min.js、wss:// 與舊 Broker credential 值均無匹配，且 public/icons 兩個圖示仍存在。
- [x] 3.3 驗證 service worker 的離線應用殼行為：先以 production preview 成功載入 /，再切換瀏覽器離線並重新整理；完成條件為 PeeCare header 與首頁中性狀態仍可見，且不支援 Service Worker API 的測試分支仍能 mount Vue app。

## 4. 最終整合驗收

- [x] 4.1 執行 npm run check 並依 vue-web-app-shell spec 逐項驗收 root route、unknown route redirect、中性資料、disabled navigation、PWA build 與 MQTT absence；完成條件為所有自動檢查通過，320px／1024px 與離線人工結果記錄在 change apply 輸出，且沒有新增 Firebase、Pinia、E2E 或真實資料 adapter。
