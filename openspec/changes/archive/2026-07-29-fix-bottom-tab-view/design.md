## Context

`BottomNavigation` 目前只由 `HomeView` 渲染。Vue Router 在前往 `/history` 或 `/stats` 時會卸載首頁，因此固定定位的底部導覽也消失。三個頁面同屬已登入會員的主要導覽範圍，登入頁則不屬於此範圍。首頁已有 `AppHeader`、20px 水平內容間距和圓角 surface card；歷史與統計頁未完整使用這些視覺結構。

## Goals / Non-Goals

**Goals:**

- 在 `/`、`/history` 與 `/stats` 間切換時，持續顯示同一組底部主要導覽。
- 讓目前路由在導覽中維持正確的 active 語意。
- 讓 `/sign-in` 不顯示主要導覽。
- 讓歷史與統計頁使用與首頁一致的頁首、內容間距與 surface card。
- 讓歷史與統計頁的字級與文字顏色沿用首頁既有的文字層級。
- 讓底部導覽的「裝置」與「通知」可前往受保護的主要路由，並在沒有對應資料時顯示指定空狀態。

**Non-Goals:**

- 不改變既有資料查詢、授權守衛或圖表資料。
- 不建立通知資料讀取、通知偏好設定或裝置綁定流程。

## Decisions

### Elevate bottom navigation into the authenticated application shell

由 `App` 在目前路由不是登入頁時渲染 `BottomNavigation`，而各內容頁只渲染自己的主要內容。這讓 router-view 的內容替換不會卸載導覽；相較於在歷史與統計頁各自重複加入元件，可避免日後項目與樣式不同步。

### Preserve the existing bottom-safe content spacing

`App` 已為固定底欄保留內容下方間距，保留該殼層責任，確保歷史與統計清單不會被固定導覽遮住。

### Apply the home visual shell to history and stats

`HistoryView` 與 `StatsView` 使用既有 `AppHeader`，其主要內容維持首頁的 20px 水平內距；各頁的訊息、列表或圖表置於白色、20px 圓角的 surface card。這會重用既有設計 token，而非在個別頁面重新發明顏色或間距。

### Reuse home typography tokens for history and stats

歷史與統計將主要標題使用首頁頁首的 18px ink 層級，資料主值使用 18px ink，輔助訊息、列表細節、表格與按鈕使用首頁已有的 13px 或 14px muted／ink 層級。樣式只引用 `--color-ink` 與 `--color-muted`，不新增顏色 token 或硬編碼文字顏色。

### Route the remaining primary navigation entries

`BottomNavigation` 將「裝置」與「通知」改為現有項目同樣的 `RouterLink`，分別指向 `/devices` 與 `/notifications`，並依 route name 套用 active 樣式。兩條路由皆標記 `requiresAuth`，所以沿用既有守衛，不會讓未登入者進入。`DevicesView` 讀取既有 device overview store：載入時顯示載入提示、讀取失敗時顯示錯誤、裝置清單為空時顯示「尚無綁定裝置」，有裝置時顯示已綁定的裝置 ID。`NotificationsView` 在尚未建立通知資料來源的範圍內顯示「尚無通知紀錄」。兩頁都使用既有頁首、20px inset 與 surface card。

## Implementation Contract

**Behavior:** 已登入使用者可從底部導覽點選「首頁」、「歷史」、「統計」、「裝置」或「通知」；每個目的頁內容與底部導覽同時可見，且目前項目正確標示。裝置清單為空時，裝置頁顯示「尚無綁定裝置」；通知頁在沒有通知資料時顯示「尚無通知紀錄」。登入頁不顯示底部主要導覽。

**Interface / data shape:** `BottomNavigation` 提供 `/`、`/history`、`/stats`、`/devices`、`/notifications` 的 `RouterLink` 介面。`DevicesView` 只使用現有 `DeviceOverviewStore` 的 `devices` 與 `state`；不新增或修改 Firestore 資料形狀。應用程式殼層依受保護 route 判斷是否顯示元件。

**Failure modes:** route guard 將未登入使用者導向登入頁時，不得短暫或持續顯示受保護的主要導覽。

**Acceptance criteria:** 元件測試驗證五個受保護主要路由的殼層都具有底部導覽並正確標示 active 項目，且「裝置」和「通知」不是 aria-disabled；裝置頁空清單顯示「尚無綁定裝置」，通知頁空狀態顯示「尚無通知紀錄」；`/sign-in` 不渲染主要導覽。執行 `npm run check:all` 成功。

**Scope boundaries:** 僅處理底部導覽項目、兩個受保護頁面、其空狀態與測試；不調整既有資料狀態、視覺設計 token、登入流程、資料權限、裝置綁定或通知的後端資料模型。

## Risks / Trade-offs

- [Risk] 登入頁也顯示主要導覽造成不應存在的受保護導覽 → Mitigation：以登入 route name 明確排除，並以測試鎖定。
- [Risk] 內容被固定欄遮住 → Mitigation：保留殼層既有的底部內容間距。
- [Risk] 個別頁面新增樣式漂移 → Mitigation：僅使用首頁既有的 token 與 card 尺寸。
- [Risk] 文字層級再度分散 → Mitigation：以具名 class 對應首頁既有的 13px、14px、18px 層級，並以元件測試鎖定。
