## Why

本地測試工具目前將大量「共用設定」欄位直接放在主操作頁頂端，讓健康檢查、建立裝置與事件測試等主要操作被推到畫面下方。將設定收進明確的齒輪入口，可讓主頁更聚焦，同時保留原有測試參數調整能力。

## What Changes

- 在測試工具頁面右上角新增可辨識且可鍵盤操作的齒輪設定按鈕。
- 將現有「共用設定」從主操作頁移至獨立的頁內設定畫面。
- 按下齒輪後顯示共用設定畫面，並提供返回主操作頁的方式。
- 在畫面切換期間保留所有設定欄位的值與既有請求建立、預覽及送出行為。

## Capabilities

### New Capabilities

- `local-test-tool-settings-navigation`: 定義本地測試工具在主操作頁與共用設定頁之間的導覽與狀態保留行為。

### Modified Capabilities

(none)

## Impact

- Affected specs: local-test-tool-settings-navigation
- Affected code:
  - Modified: scripts/test-tool.html
  - Modified: vitest.config.ts
  - New: scripts/test-tool.spec.ts
  - Removed: none
- APIs、後端 proxy 與套件依賴不變。
