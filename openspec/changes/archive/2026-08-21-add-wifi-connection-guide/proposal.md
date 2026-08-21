## Why

尚未綁定裝置的會員目前只會看到「尚無裝置」與前往設定的提示，缺少首次使用時將 PeeCare 連上 Wi-Fi 的操作指引。需要在不等待硬體細節與裝置綁定流程定案的前提下，先提供一個可重複開啟、容易閱讀的圖文說明入口。

## What Changes

- 新增「Wi-Fi 連線說明」單頁 modal，以六個圖文步驟說明手機連接硬體臨時 Wi-Fi、填寫目標 Wi-Fi，以及硬體切換網路後返回 Web App 的流程。
- 當已登入會員的裝置資料確定為空時，在每個瀏覽器分頁工作階段自動顯示一次；載入中或載入失敗時不顯示。
- 在首頁右上角提供固定的圓形問號按鈕，讓會員隨時手動重新開啟說明。
- 提供關閉按鈕與「我知道了」操作，並支援 modal 所需的鍵盤、焦點與螢幕閱讀器行為。
- 將硬體規格相關文案集中在說明元件中，方便日後在不改變互動契約的情況下更新 Wi-Fi 頻段、臨時網路名稱、設定網址、LED 狀態與等待時間。

## Capabilities

### New Capabilities

- `wifi-connection-guide`: 定義 Wi-Fi 圖文說明內容、首頁入口、無裝置時的自動顯示規則，以及可存取的 modal 互動。

### Modified Capabilities

(none)

## Impact

- Affected specs: `wifi-connection-guide`
- Affected code:
  - New:
    - `src/components/WifiConnectionGuideDialog.vue`
    - `src/components/WifiConnectionGuideDialog.spec.ts`
  - Modified:
    - `src/components/AppHeader.vue`
    - `src/views/HomeView.vue`
    - `src/views/HomeView.spec.ts`
  - Removed: (none)
