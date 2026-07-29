## Why

目前底部導覽只由首頁掛載；切換到「歷史」或「統計」路由時，該元件會一併被卸載，使用者失去返回與切換頁面的方式。

歷史與統計頁目前也未使用首頁的頁首、內容間距與卡片容器，讓同一主要導覽內的畫面風格斷裂。

## What Changes

- 將已登入主要頁面的底部導覽提升至可在首頁、歷史與統計路由間持續顯示的應用程式殼層。
- 保留登入頁不顯示主要導覽，並維持既有固定底欄的內容避讓與可及性語意。
- 新增路由切換元件測試，確認從首頁前往歷史與統計時底部導覽仍存在且目前項目正確標示。
- 對齊歷史與統計頁的頁首、水平內容間距和 surface card 呈現，使它們沿用首頁的視覺語言。
- 對齊歷史與統計頁的標題、主要內容與輔助文字字級及色彩，僅使用首頁既有的 ink 與 muted 色彩 token。
- 將底部導覽的「裝置」與「通知」改為可點擊的主要路由，並為沒有內容的畫面提供明確空狀態。

## Capabilities

### New Capabilities

- `persistent-bottom-navigation`: 已登入主要路由間持續顯示可切換的底部導覽，並使用一致的主要頁面殼層呈現。

### Modified Capabilities

(none)

## Impact

- Affected code:
  - Modified: src/App.vue
  - Modified: src/views/HomeView.vue
  - Modified: src/views/HistoryView.vue
  - Modified: src/views/StatsView.vue
  - Added: src/views/DevicesView.vue
  - Added: src/views/NotificationsView.vue
  - Modified: src/components/BottomNavigation.vue
  - Modified: src/router/index.ts
  - Modified: src/App.spec.ts
  - Modified: src/components/BottomNavigation.spec.ts
  - Modified: src/views/HistoryView.spec.ts
  - Modified: src/views/StatsView.spec.ts
  - Added: src/views/DevicesView.spec.ts
  - Added: src/views/NotificationsView.spec.ts
