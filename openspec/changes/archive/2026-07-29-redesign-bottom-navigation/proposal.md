## Why

目前底部導覽有五個並排的純文字分頁（首頁、歷史、統計、裝置、通知），視覺上缺乏層級，使用者不容易一眼辨識主入口。同時 App 沒有「設定」頁，也沒有任何登出入口；「裝置」獨立佔一個分頁但內容僅是一份唯讀清單。將導覽重新整合，能凸顯首頁主入口、收攏裝置管理與帳號操作，並為未來的通知與偏好設定預留位置。

## What Changes

- 底部導覽重整為五個分頁，順序為：歷史、統計、**首頁（置中且放大，凸起圓鈕）**、通知、設定。
- 每個分頁改為「圖示 + 文字」，圖示使用內嵌 SVG（不新增 icon 套件），並補上 `aria-label` 與 `aria-current="page"`。
- 移除獨立的「裝置」分頁；`/devices` 路由與 `DevicesView` 的裝置清單內容併入新的設定頁。
- 新增「設定」分頁與 `/settings` 路由、`SettingsView.vue`，內容以分組列表呈現：裝置管理、帳號（顯示登入 email 與登出鈕）、通知偏好（佔位）、關於（版本資訊）。
- 在設定頁的帳號區塊提供「登出」控制項，觸發既有的工作階段終止行為（沿用現有 auth-store 邏輯，不改變登出的資料行為）。
- 首頁「尚無裝置」空狀態新增引導，指向設定頁的裝置管理。

## Non-Goals

- 不改變裝置清單的資料來源、擁有權模型或載入邏輯（`member-device-overview`、`owned-device-access` 契約不變），僅調整其在 UI 的呈現位置。
- 不改變登出的底層行為（Firebase 工作階段終止、訂閱停止、導向 `/sign-in`），僅新增觸發登出的 UI 入口。
- 不實作通知偏好的實際開關邏輯與後端串接，設定頁的「通知偏好」與「關於」僅為佔位／唯讀資訊。
- 不新增裝置綁定／解除綁定功能；設定頁的裝置管理沿用現有唯讀清單。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `vue-web-app-shell`: 導覽由「首頁 + 三個 aria-disabled 佔位項」改為五個可用分頁、首頁置中放大、圖示加文字，並新增 `/settings` 路由與設定頁分組內容（含併入的裝置清單）。
- `member-authentication`: 新增「登出控制項於設定頁帳號區塊呈現」的情境，明確既有工作階段終止行為的 UI 觸發位置。

## Impact

- Affected specs:
  - `openspec/specs/vue-web-app-shell/spec.md`
  - `openspec/specs/member-authentication/spec.md`
- Affected code:
  - New:
    - `src/views/SettingsView.vue`
    - `src/views/SettingsView.spec.ts`
  - Modified:
    - `src/components/BottomNavigation.vue`
    - `src/components/BottomNavigation.spec.ts`
    - `src/router/index.ts`
    - `src/router/index.spec.ts`
    - `src/views/HomeView.vue`
  - Removed:
    - `src/views/DevicesView.vue`
    - `src/views/DevicesView.spec.ts`
