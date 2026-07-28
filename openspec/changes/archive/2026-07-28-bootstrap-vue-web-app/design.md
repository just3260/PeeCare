## Context

目前 public/index.html、public/app.js、public/style.css 與 public/sw.js 共同形成無 build step 的 PWA 原型。它直接從 CDN 載入 MQTT client、在瀏覽器保存 Broker 共用憑證，並將 wet、count、urineToday 映射到單一首頁。手寫 service worker 仍快取不存在的 manifest.json，且無法正確追蹤未來 Vite hashed assets。

目標前端已確認為 Vue 3、TypeScript 與 Vite，後續還會加入 Firebase Emulator、Authentication、多裝置切換、歷史與統計。本 change 必須提供穩定的應用殼與品質閘門，但不能提前實作尚未建立契約的資料功能。

## Goals / Non-Goals

**Goals:**

- 建立官方 Vue 3、Vite、TypeScript SFC 架構與 npm 開發流程。
- 將 PeeCare 現有視覺方向轉成可測試、響應式的 Vue 應用殼。
- 建立最小 Vue Router 邊界，讓後續頁面能以獨立 change 擴充。
- 產生與 production hashed assets 一致的 PWA manifest 與 service worker。
- 從正式前端移除 MQTT CDN、Broker URL、共用帳密與假資料語義。
- 讓單一 check 命令驗證型別、元件行為與 production build。

**Non-Goals:**

- 不安裝或初始化 Firebase SDK，不連接 Firebase Emulator。
- 不實作登入、會員、裝置清單、裝置切換、歷史、圖表或通知。
- 不實作 MQTT、Firestore 或其他即時資料 adapter。
- 不加入 Pinia；目前應用殼沒有跨頁共享業務狀態。
- 不建立完整設計系統、E2E 測試或 production Hosting 部署。
- 不在本 change 執行外部 EMQX 憑證輪替；只移除瀏覽器內的憑證副本。

## Decisions

### 使用官方 Vue Vite TypeScript 基線

根目錄使用 npm lockfile，採 Vue 3 Single-File Components、Composition API 與 script setup。Vite 負責 dev server 與 production bundle，vue-tsc 獨立執行嚴格型別檢查，Vitest 與 Vue Test Utils 負責元件測試。Node engine 依官方 Vue scaffold 的現行基線設為 ^20.19.0 或 >=22.12.0。

不沿用 CDN Vue 或純 JavaScript，因為後續資料與權限功能需要靜態型別與可重構的 module graph。不加入 JSX、Pinia、E2E runner 或 Prettier，避免 bootstrap 同時決定無立即需求的工具。

### 只建立應用殼與首頁中性狀態

App.vue 僅組合全域 app shell 與 router view。首頁由 AppHeader、OverviewPlaceholder 與 BottomNavigation 組成，保留 PeeCare 品牌色、首頁總覽、卡片與行動導覽的視覺語彙。

沒有資料來源時，數值顯示 em dash 或「待校正」，狀態顯示「尚無裝置資料」，時間顯示「尚未回報」。不得把 0 mL、Wi-Fi 正常、裝置在線、比昨天多 8 mL 或固定 14 mL 當成真實資訊。這些中性狀態是後續資料 change 的插入點，不建立暫時 mock store。

### 以 Vue Router 建立可擴充導航邊界

Vue Router 使用 HTML5 history。Bootstrap 僅註冊首頁路由 / 與 catch-all redirect；底部導覽中尚未實作的歷史、裝置與通知項目以 disabled／aria-disabled 呈現，不建立空白功能頁。

這個邊界讓 Authentication 與歷史 changes 能新增 route record，而不需要重寫 App.vue。Firebase Hosting 的 SPA rewrite 由後續 local Firebase／deployment changes 配置；Vite dev server 與 PWA navigate fallback 在本 change 支援直接重新載入首頁。

### 由 Vite PWA 產生 manifest 與 service worker

vite-plugin-pwa 使用 generateSW，從 public/icons 取用 192 與 512 圖示，manifest 的 start_url 設為 /、display 設為 standalone，語系設為 zh-TW，theme/background colors 延續現有設計。Workbox precache production build 的 hashed shell assets，navigation fallback 指向 /index.html。

更新模式採 autoUpdate。此 bootstrap 尚無未儲存表單或長時間工作，背景啟用新版 service worker 的風險低；未來加入資料編輯流程時再評估提示式更新。開發模式不啟用 service worker，避免快取干擾 HMR 與單元測試。

### 移除舊版 MQTT 瀏覽器路徑

根目錄 index.html 只保留 app mount point、必要 metadata 與 src/main.ts module 入口，不載入 MQTT CDN 或 Google Fonts CDN。字型改用系統繁中文字型 stack，避免應用殼依賴第三方網路資源。

public/index.html、public/app.js、public/style.css、public/sw.js 與 public/manifest.webmanifest.json 全部移除，避免 Vite public copy 與根 index.html 衝突。原型中的 Broker URL、username、password、localStorage pet name 與 MQTT message handler 不移植。已暴露憑證仍必須在雲端整合前由 EMQX 管理者輪替。

### 以統一 check command 形成品質閘門

package.json 提供 dev、build、type-check、test:unit 與 check。check 依序執行 type-check、Vitest run 與 Vite production build；任一步驟失敗即回傳非零狀態碼。build 只負責 Vite bundle，避免 check 重複執行 vue-tsc。

元件測試使用 jsdom，至少驗證 App mount、PeeCare 品牌標題、中性空狀態、首頁 route、disabled navigation 與 absence of MQTT script／憑證字串。production build 驗證 dist 具有 index.html、web manifest、service worker registration 及 PWA 圖示引用。

## Implementation Contract

**Observable behavior**

- npm run dev 啟動 Vue 應用，/ 顯示 PeeCare header、首頁中性資料卡與底部導覽。
- 尚無資料時不顯示裝置在線、Wi-Fi 正常、比較結果或虛構尿量。
- 尚未實作的底部導覽不可導航，且輔助技術能辨識 disabled 狀態。
- npm run build 產生可部署的 dist；production app 可安裝，曾成功載入後可在離線狀態重新開啟應用殼。
- 前端 bundle、HTML 與 source 不包含 mqtt CDN、wss Broker URL、舊 username 或舊 password。

**Interface and structure**

- src/main.ts 建立 Vue app、註冊 router 並載入 src/styles/main.css。
- src/router/index.ts 輸出 router，包含 / 與 catch-all redirect。
- App.vue 輸出 app shell；HomeView.vue 組合 AppHeader、OverviewPlaceholder、BottomNavigation。
- OverviewPlaceholder 不接受業務資料 props；後續 overview change 會用正式 view model 取代。
- Vite PWA 設定在 vite.config.ts，圖示沿用 public/icons/icon-192.png 與 public/icons/icon-512.png。

**Failure modes**

- 不支援 route 導向首頁，不呈現空白頁。
- service worker 在 development 與 test mode 不註冊。
- 缺少 PWA 圖示、TypeScript 錯誤、單元測試失敗或 production build 失敗時，npm run check 必須以非零狀態碼結束。
- 瀏覽器不支援 service worker 時，Web App 仍能在線載入，不阻擋 Vue mount。

**Acceptance criteria**

- npm run check 全部通過。
- HomeView 元件測試能查到「尚無裝置資料」、「待校正」與「尚未回報」。
- 元件測試確認歷史、裝置與通知導覽具有 aria-disabled=true。
- 搜尋 production source 與 dist 不會找到 mqtt.min.js、wss://、舊 MQTT username 或舊 MQTT password。
- production preview 成功載入後切換離線並重新整理，仍顯示應用殼。
- 320px 寬度沒有水平捲動，且 1024px 寬度的卡片不超出內容容器。

**Scope boundaries**

實作僅限 Vue／Vite／TypeScript／Router／Vitest／PWA app shell、原型樣式遷移與舊靜態 runtime 移除。不加入 Firebase、MQTT、真實裝置資料、登入或部署設定。

## Risks / Trade-offs

- [Risk] 移除舊版 public runtime 後，原型 MQTT 即時畫面不再可用 → 以 git 歷史保留參考，正式資料流由後續 Cloud Run／Firestore changes 取代。
- [Risk] autoUpdate 在未來表單流程可能造成重新載入 → 本階段沒有可遺失輸入；資料編輯功能加入時重新評估更新 UX。
- [Risk] 先加入 Vue Router 增加少量依賴與設定 → 後續登入、歷史與裝置頁確定需要 route boundary，現在建立可避免重構 root mount。
- [Risk] 系統字型在不同平台略有差異 → 優先確保離線與隱私，透過尺寸、行高與 fallback stack 維持排版穩定。
- [Risk] app shell 的 placeholder 可能被誤認為正式 dashboard → 使用明確中性文案，且不提供假數值或假狀態。

## Migration Plan

1. 以測試固定應用殼的中性狀態與導航可及性。
2. 建立 Vue scaffold、router、元件與全域樣式。
3. 啟用 Vite PWA production generation，驗證 installability 與離線 shell。
4. 移除舊 public runtime 與 MQTT CDN／憑證來源。
5. 執行 npm run check 並以 production preview 進行 320px、1024px 與離線人工驗收。

若 migration 未通過品質閘門，回復本 change 的檔案集合即可恢復舊原型；不得同時保留兩個 index.html runtime，避免部署輸出不確定。
