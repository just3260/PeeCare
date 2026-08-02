## Context

`scripts/test-tool.mjs` 提供 `scripts/test-tool.html` 作為本地測試工具介面。現有共用設定區塊與主要測試卡片位於同一個文件流，且所有請求 builder 直接以元素 ID 讀取設定值，因此調整介面時必須保留原有 DOM 欄位與事件綁定。

## Goals / Non-Goals

**Goals:**

- 讓主操作畫面優先呈現健康檢查、裝置建立與事件測試。
- 以右上角齒輪按鈕進入專用的共用設定畫面，並能返回主操作畫面。
- 切換畫面時保留既有欄位 DOM、輸入值、衍生 eventId 與送出行為。
- 讓齒輪與返回控制可由鍵盤操作，並具備可讀的輔助技術標籤。

**Non-Goals:**

- 不建立新的 HTTP route、後端 API 或獨立 HTML 檔案。
- 不將設定持久化至 localStorage、cookie 或伺服器。
- 不改變 request payload、欄位預設值、序號遞增或批次執行語意。

## Decisions

### 使用單一文件的頁內畫面切換

主操作畫面與共用設定畫面會保留在同一份 HTML DOM 中，透過 `hidden` 狀態切換可見畫面。這可保留輸入元素實例與既有 ID，避免重新渲染造成輸入值或事件監聽器遺失。相較新增 server route 或複製成另一份 HTML，此方式不需要修改 Node server，也不會製造跨頁狀態同步問題。

### 使用原生按鈕承載齒輪與返回操作

齒輪控制會使用原生 `button`、內嵌 SVG icon 與 `aria-label`，設定畫面則提供明確的返回按鈕。相較只使用可點擊圖示或文字字元，原生按鈕具備鍵盤、焦點與語意支援，SVG 也不增加外部 icon 套件依賴。

### 保留共用設定區塊及既有欄位識別碼

既有 `.shared` 內容會整體移入設定畫面，包括批次執行按鈕；欄位 ID 與 JavaScript builder 不改名。這能將「共用設定」完整收進齒輪入口，並降低行為回歸風險。

## Implementation Contract

- Behavior: 初次載入顯示主操作畫面；頁面標題列右上角顯示齒輪按鈕。啟動齒輪按鈕後，主操作內容隱藏且顯示標題為「共用設定」的設定畫面。啟動返回按鈕後回到主操作畫面。
- Accessibility: 齒輪與返回控制必須是原生按鈕；齒輪 icon 不單獨暴露給輔助技術，齒輪按鈕必須具備可讀的「開啟共用設定」名稱。畫面切換後焦點必須移至新畫面的主要導覽控制，避免鍵盤焦點停留在隱藏內容。
- State: 畫面切換不得重建共用設定欄位，使用者已輸入的值、checkbox/select 狀態與自動 eventId 狀態必須保留。既有 preview、send、run-all 與 sequence/eventId 更新行為不得改變。
- Failure modes: 此導覽為純本地同步操作，不新增網路失敗狀態；JavaScript 可用時不得出現同時顯示兩個畫面或兩個畫面皆隱藏的中間狀態。
- Acceptance criteria: 以 JavaScript DOM 測試驗證預設畫面、齒輪切換、返回切換、焦點移動與欄位值保留；執行既有專案測試／檢查命令確認 HTML 內嵌腳本仍可載入，並手動以瀏覽器確認右上角 icon 位置與深色模式可讀性。
- In scope: `scripts/test-tool.html` 的結構、樣式、頁內導覽腳本及其直接測試。
- Out of scope: `scripts/test-tool.mjs` 的 proxy 行為、API payload、設定持久化及多頁 server routing。

## Risks / Trade-offs

- [Risk] `hidden` 元素可能被既有 CSS 的 display 規則覆蓋 → 加入明確的 `[hidden] { display: none !important; }` 保證語意與視覺一致。
- [Risk] 將批次執行按鈕一併移入設定畫面後，主頁不再直接顯示該操作 → 依需求將整個「共用設定」區塊視為同一設定頁內容，避免拆分既有區塊造成額外範圍。
- [Risk] icon-only 控制不易理解 → 提供 tooltip/title、輔助技術名稱與清楚的 focus 樣式。
