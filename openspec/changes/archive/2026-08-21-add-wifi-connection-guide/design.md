## Context

首頁目前由 `HomeView` 在會員登入後載入 `DeviceOverviewStore`，並以 `loading`、`empty`、`ready`、`error` 區分裝置資料狀態；`AppHeader` 則是首頁與設定頁共用的純展示元件。這次變更新增首次 Wi-Fi 設定的圖文入口，但不新增裝置綁定、硬體控制、後端 API 或 Firebase 資料。

第一版硬體流程已確認為：手機連接 PeeCare 發出的臨時 Wi-Fi、在硬體開啟的設定頁填入目標 Wi-Fi、硬體斷開臨時網路後改連目標 Wi-Fi。Wi-Fi 頻段、臨時網路名稱、備用設定網址、LED 模式與等待秒數尚未成為產品契約，因此第一版文案不宣稱這些具體值。

## Goals / Non-Goals

**Goals:**

- 提供一個單頁、可捲動、行動裝置優先的「Wi-Fi 連線說明」modal。
- 以六個有視覺標記的步驟呈現已確認的 Wi-Fi 設定流程。
- 在已登入且裝置資料確定為空時，每個會員、每個瀏覽器分頁工作階段自動顯示一次。
- 在首頁 Header 提供隨時可重新開啟說明的問號按鈕。
- 提供完整的鍵盤、焦點、螢幕閱讀器與窄螢幕捲動行為。

**Non-Goals:**

- 不在 modal 中收集 Wi-Fi 帳號或密碼，也不直接設定硬體。
- 不實作 QR Code、序號、綁定碼或任何 Web App 裝置綁定流程。
- 不新增後端 API、Firebase 欄位、跨裝置同步或帳號層級的已讀紀錄。
- 不宣稱尚未確認的 Wi-Fi 頻段、SSID 格式、設定網址、LED 模式或等待秒數。
- 不建立輪播式或多頁式教學。

## Decisions

### Single-page guide dialog owns content and accessibility

新增 `WifiConnectionGuideDialog` 作為受控元件，以 `open: boolean` prop 決定顯示，並在任何關閉方式發生時送出 `close` event。元件集中持有標題、六個步驟、視覺標記、modal overlay、內部捲動、背景捲動鎖定、焦點圈限與焦點還原，避免首頁重複實作 modal 細節。

六個步驟依序為：進入硬體設定模式、手機連接 PeeCare 臨時 Wi-Fi、等待硬體設定頁開啟、選擇目標 Wi-Fi 並輸入密碼、等待硬體斷開臨時網路並切換、手機恢復一般網路後返回 Web App。每個步驟使用內嵌且不依賴遠端資源的圖示或圖形；圖示為裝飾性內容，完整意思仍由文字提供。

替代方案是將每個步驟做成輪播頁。輪播能減少單次資訊量，但會讓使用者在手機 Wi-Fi 設定與說明之間切換時更難快速回看，因此不採用。

### Home view owns automatic presentation and session deduplication

`HomeView` 已經擁有登入狀態與裝置概覽狀態，應由它監看「會員為 signed-in 且裝置狀態為 empty」的交集。符合條件時，以會員 UID 組成 `peecare:wifi-connection-guide:auto-shown:<uid>` 的 `sessionStorage` key；key 不存在時先寫入再開啟 modal，確保同一分頁工作階段內的重新渲染、路由往返與重複 empty 通知不會再次自動顯示。

手動按下問號也會將同一 key 標記為已顯示，避免使用者在裝置載入完成前主動閱讀後又立即收到自動 popup。若 `sessionStorage` 存取失敗，首頁以記憶體內的會員 UID 集合維持當次元件生命週期的去重；手動入口與 modal 本身仍可使用。此 key 只表示教學是否顯示，絕不參與登入或裝置所有權判斷。

替代方案是把狀態放在 `DeviceOverviewStore`。該 store 的責任是裝置清單、選擇與即時資料，加入 UI 已讀狀態會污染領域邊界，因此不採用。帳號層級持久化也會新增資料模型與跨裝置同步需求，超出本次範圍。

### App header exposes a home-only actions slot

`AppHeader` 新增具名 `actions` slot，並只在有內容時呈現右側操作區。`HomeView` 透過此 slot 放入圓形問號按鈕；設定頁不提供 slot，因此不顯示問號。這保留 Header 的通用性，也避免在 `App.vue` 建立全域 dialog state。

替代方案是讓 `AppHeader` 直接接受 `showHelp` prop 並送出 help event，但這會讓共用品牌 Header 知道 Wi-Fi 功能，未來新增其他 Header 操作時還會持續增加專用 props，因此不採用。

### Hardware-independent copy stays centralized

第一版只呈現已確認且不依賴硬體常數的文字。步驟文案與視覺內容集中在 `WifiConnectionGuideDialog`，日後確認頻段、SSID、網址、LED 或等待時間時，可直接更新該元件及其測試，不改變開啟規則與元件介面。

不建立遠端 CMS 或設定檔；第一版內容量固定且僅供 Web App 使用，引入動態內容來源會增加載入失敗、版本同步與內容驗證成本。

## Implementation Contract

### Observable behavior

- 首頁 Header 右側顯示一顆圓形問號按鈕，accessible name 為「開啟 Wi-Fi 連線說明」。其他既有頁面不因共用 Header 而自動出現該按鈕。
- 已登入會員的裝置概覽第一次進入 `empty` 且該 UID 在目前分頁工作階段尚未看過說明時，首頁自動開啟 modal。`loading`、`ready` 與 `error` 均不觸發。
- 自動開啟或手動開啟後，同一 UID 在同一分頁工作階段內不再因 `empty` 自動開啟；問號按鈕永遠可以手動開啟。
- modal 在同一個可捲動頁面中顯示全部六個步驟，不提供上一頁、下一頁或分頁指示器。
- 使用者可以透過右上關閉按鈕、底部「我知道了」、Escape 或點擊 overlay 關閉。點擊 modal 內容不關閉。

### Component interfaces and state

- `WifiConnectionGuideDialog` 接受 `open: boolean`，送出無 payload 的 `close` event。
- `AppHeader` 提供可選的 `actions` slot；沒有 slot 內容時維持目前版面。
- `HomeView` 擁有 dialog 開關狀態、監看登入與裝置狀態，並管理 `peecare:wifi-connection-guide:auto-shown:<uid>` session key。
- session key 的值固定為字串 `1`。儲存失敗時不顯示錯誤訊息，改用元件生命週期內的記憶體去重。

### Accessibility and responsive behavior

- 開啟時焦點移到 modal 的關閉按鈕，Tab 與 Shift+Tab 留在 modal 內；關閉時若原觸發元素仍存在，焦點回到該元素。
- modal 具有 dialog 語意、`aria-modal="true"`、由可見標題提供 accessible name，且背景內容不可被鍵盤操作。
- modal 開啟時鎖定背景頁面捲動，關閉或元件卸載時恢復原狀。
- 窄螢幕 modal 接近完整 viewport 並保留安全區；寬螢幕限制內容寬度與高度。六個步驟在 modal 內捲動，標題與「我知道了」維持可操作。
- 所有圖示均不作為唯一資訊來源；裝飾圖示不進入 accessibility tree。

### Failure modes and acceptance criteria

- 裝置載入失敗維持既有錯誤畫面，不以 Wi-Fi 說明取代，也不寫入已顯示 key。
- 無法讀寫 `sessionStorage` 時不阻止 modal 顯示或手動開啟。
- `WifiConnectionGuideDialog.spec.ts` 驗證六步內容、所有關閉方式、dialog 語意、焦點圈限、焦點還原與背景捲動恢復。
- `HomeView.spec.ts` 驗證 empty 自動開啟一次、非 empty 狀態不開啟、同一 UID 去重、不同 UID 分開計算、儲存失敗 fallback，以及問號可重複手動開啟。
- 完整品質門檻以 `npm run check` 通過為準。

### Scope boundaries

本次實作範圍只包含 Vue 前端元件、首頁整合、分頁工作階段去重與單元測試。硬體設定頁、Wi-Fi credential 傳輸、裝置註冊與帳號綁定、後端服務、Firebase schema、分析事件及客服流程均不在範圍內。

## Risks / Trade-offs

- [Risk] `sessionStorage` 是分頁限定，關閉分頁後再次進入仍可能自動顯示 → 這符合「每個分頁工作階段一次」的產品決策；若未來需要帳號層級已讀狀態，另立資料契約。
- [Risk] 硬體細節尚未定案，文字可能不足以排除特定機型問題 → 第一版只使用已確認流程，不填入推測值，並將內容集中以利後續更新。
- [Risk] 自行處理 focus trap 容易遺漏動態焦點元素 → 元件內只保留明確的互動控制，並以正向與反向 Tab 單元測試覆蓋邊界。
- [Risk] body scroll lock 在元件異常卸載時可能殘留 → 關閉 watcher 與 unmount cleanup 都恢復先前的 overflow 值。
