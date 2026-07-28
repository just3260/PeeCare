## Context

Events 永久保存於 selected device 子集合；Web 需要 bounded query 且 Firestore Rules 已限制 Owner。

## Goals / Non-Goals

**Goals:** urination-only、最新優先、limit 25、cursor pagination、切換 reset、完整列表 states。

**Non-Goals:** 不做跨裝置搜尋、匯出、live listener、任意篩選或 volume 圖表。

## Decisions

### 使用 effectiveAt 與 eventId 穩定排序

Query 以 `eventType == urination`、`effectiveAtMs desc`、`eventId desc` 排序，避免同毫秒頁面重複。

### 使用 document cursor 而非 offset

每頁最多 25 筆；load more 使用上一頁末筆 cursor，沒有末筆即停止。

### 切換裝置即丟棄舊頁面

selected device 改變時清空 items、cursor 與 error，避免合併兩台裝置資料。

### 以 query generation 拒絕 stale response

store 每次首次載入、device switch 或 retry 都遞增 generation。repository response 只有在 deviceId 與 generation 仍等於目前 request 時才能更新 items/cursor；已取消或較慢的舊 response 靜默丟棄。每筆 document 在加入列表前驗證 document ID 等於 eventId、deviceId 等於 selected device、eventType 為 urination、duration/time/sequence 為合法整數，且尿量欄位維持 null/pending calibration。

## Implementation Contract

**Behavior:** Owner 可逐頁瀏覽所選裝置排尿紀錄；順序穩定、頁面不重複、切換不殘留。

**Interface:** repository `loadUrinationPage(deviceId, cursor?)` 回傳 validated items、last document cursor 與 hasMore；store 暴露 generation、loading/empty/ready/error/end。時間顯示固定使用 `Asia/Taipei`，不改變 effectiveAtMs 排序。

**Failure modes:** permission/index/network failure 顯示 retryable error，已成功頁面保留但不虛構 next page。

**Acceptance criteria:** model/repository/store/view tests 覆蓋 0/1/26 records、tie、invalid record、load more、stale response、error、Asia/Taipei display 與 device switch。

**Scope boundaries:** in scope 是排尿歷史列表；out of scope 是 battery history、advanced filters、export 與 realtime。

## Risks / Trade-offs

- [Risk] composite query 需要 index → 將 index 納入 change 並用 Emulator query test 驗證。
- [Risk] 固定 25 不符合最終 UX → page size 封裝為 repository constant，日後可 refinement。

## Open Questions

最終時間範圍、filter 與匯出需求另行決定。
