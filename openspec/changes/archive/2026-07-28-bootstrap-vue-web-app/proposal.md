## Why

目前 Web 原型是直接載入 CDN MQTT client 的單頁 HTML／JavaScript，缺少型別檢查、元件測試、可靠的 production build 與後續會員／多裝置頁面所需的路由基礎。先建立 Vue 3、TypeScript、Vite 的可安裝 PWA 應用殼，才能讓後續 Firebase、Authentication 與裝置資料功能在一致且可驗證的前端平台上實作。

## What Changes

- 以 npm 管理根目錄前端 workspace，建立 Vue 3、TypeScript、Vite、Vue Router 與 Vitest 的正式應用程式基礎。
- 使用 Vue Single-File Components、Composition API 與 script setup 組成應用殼、首頁空狀態及底部導覽。
- 將現有 PeeCare 色彩、標題、卡片與行動版導覽方向遷移為響應式元件，但不保留假尿量、假比較結果或未驗證的在線狀態。
- 使用 Vite PWA 整合產生 manifest 與 service worker，保留既有 192／512 圖示，讓 production build 的應用殼可安裝並可在離線重新載入。
- 建立 dev、build、type-check、test 與 check scripts；check 必須統一執行型別、單元測試與 production build。
- **BREAKING**：移除 public 目錄內舊版 index.html、app.js、style.css、sw.js 與手寫 manifest，正式前端不再從瀏覽器直接連線 MQTT，也不再載入 CDN MQTT client 或內嵌 Broker 憑證。

## Capabilities

### New Capabilities

- `vue-web-app-shell`: 提供可建置、可測試、可安裝且不直接連線 MQTT 的 Vue Web App 基礎殼與中性資料狀態。

### Modified Capabilities

（無）

## Impact

- Affected specs: vue-web-app-shell
- Affected code:
  - New:
    - package.json
    - package-lock.json
    - tsconfig.json
    - tsconfig.app.json
    - tsconfig.node.json
    - vite.config.ts
    - index.html
    - src/env.d.ts
    - src/main.ts
    - src/App.vue
    - src/router/index.ts
    - src/views/HomeView.vue
    - src/components/AppHeader.vue
    - src/components/BottomNavigation.vue
    - src/components/OverviewPlaceholder.vue
    - src/styles/main.css
    - src/App.spec.ts
    - src/views/HomeView.spec.ts
  - Modified:
    - .gitignore
  - Removed:
    - public/index.html
    - public/app.js
    - public/style.css
    - public/sw.js
    - public/manifest.webmanifest.json
- Affected systems: Firebase Hosting build input, browser PWA installation and cache behavior, and all later Vue feature changes.
