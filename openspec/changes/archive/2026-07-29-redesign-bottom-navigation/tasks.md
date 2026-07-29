## 1. 設定頁與裝置管理

- [x] 1.1 實作 `Settings hub` 需求：建立 `src/views/SettingsView.vue`，以分組區塊呈現「裝置管理／帳號／通知偏好／關於」四段；裝置管理區沿用 `DEVICE_OVERVIEW_STORE_KEY` 資料源，完整保留 loading／error／empty／populated 四種狀態與既有 `data-test` 標記（`devices-loading`、`devices-error`、`devices-empty`、`devices-list`）。驗證：新增 `src/views/SettingsView.spec.ts`，斷言四種狀態各自渲染正確節點。
- [x] 1.2 實作 `Session termination` 需求的 UI 入口：在 `SettingsView.vue` 帳號區塊顯示登入 email，並提供登出控制項，點擊時呼叫既有 auth-store 的登出行為（沿用現有工作階段終止邏輯，不新增登出資料流程）。驗證：`SettingsView.spec.ts` 斷言 email 顯示、且點擊登出鈕會觸發注入的 auth-store 登出方法。
- [x] 1.3 在 `SettingsView.vue` 的通知偏好與關於區塊僅呈現佔位或唯讀資訊（如版本字串），不宣稱任何未實作行為為啟用中。驗證：`SettingsView.spec.ts` 斷言此二區塊為靜態內容、無互動性開關被標為啟用。

## 2. 路由調整

- [x] 2.1 於 `src/router/index.ts` 新增 `name: 'settings'`、`path: '/settings'` 指向 `SettingsView.vue` 的受保護路由（`meta.requiresAuth: true`），並新增 `/devices` → `/settings` 的重導。驗證：`src/router/index.spec.ts` 斷言 `/settings` 解析到 settings 路由、且 `/devices` 重導至 `/settings`。
- [x] 2.2 自 `src/router/index.ts` 移除 `DevicesView` 的 import 與其 `/devices` 路由定義（改由 2.1 的重導取代）。驗證：`npm run type-check` 通過且 `router/index.spec.ts` 中不再存在名為 `devices` 的具元件路由。

## 3. 底部導覽重構

- [x] 3.1 [P] 實作 `Extensible client-side navigation` 需求：改寫 `src/components/BottomNavigation.vue`，呈現五個「圖示 + 文字」分頁，順序為歷史、統計、首頁、通知、設定，首頁置於中央並以放大的凸起圓鈕樣式呈現；圖示以內嵌 SVG 實作，不新增 icon 相依套件。驗證：`src/components/BottomNavigation.spec.ts` 斷言渲染五個連結且順序與目標路由（`/history`、`/stats`、`/`、`/notifications`、`/settings`）正確。
- [x] 3.2 [P] 於 `BottomNavigation.vue` 為每個分頁補上 `aria-label`，並讓對應當前路由的分頁輸出 `aria-current="page"`、其餘不輸出。驗證：`BottomNavigation.spec.ts` 斷言在 `/stats` 路由下僅統計分頁具 `aria-current="page"`，且每個分頁皆有可存取名稱。
- [x] 3.3 [P] 移除 `BottomNavigation.vue` 中舊的「裝置」分頁項目。驗證：`BottomNavigation.spec.ts` 斷言不存在指向 `/devices` 的導覽連結。

## 4. 首頁空狀態引導

- [x] 4.1 [P] 於 `src/views/HomeView.vue` 的「尚無裝置」空狀態新增指向設定頁裝置管理的引導連結。驗證：`src/views/HomeView.spec.ts` 斷言空狀態下渲染出導向 `/settings` 的引導元素。

## 5. 移除舊裝置頁

- [x] 5.1 刪除 `src/views/DevicesView.vue` 與 `src/views/DevicesView.spec.ts`（其行為已由 `SettingsView` 裝置管理區塊承接）。驗證：檔案不存在，且 `grep -r "DevicesView" src` 無殘留引用。

## 6. 品質閘

- [x] 6.1 執行 `npm run check`（type-check + 單元測試 + build）全數通過，並執行 `spectra validate redesign-bottom-navigation` 通過。驗證：兩道指令皆以 0 結束碼完成。
