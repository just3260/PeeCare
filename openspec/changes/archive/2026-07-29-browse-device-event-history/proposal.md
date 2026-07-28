## Why

會員需要檢視所選裝置的排尿歷史，但不能每次掃描永久保存的全部 events。此骨架建立有界、可分頁且受 Owner rules 保護的查詢與列表。

## What Changes

- 查詢所選裝置的 urination events，依 effective time 新到舊排列。
- 每頁固定最多 25 筆並使用 Firestore cursor pagination，不使用 offset。
- 顯示時間、raw durations 與 pending-calibration 尿量狀態。
- 提供 loading、empty、error、load-more 與 device-switch reset。
- 使用第二階段 immutable urination record 的確切欄位做 runtime validation；非法 document 以 data-integrity error 呈現。
- 每次 device/query generation 只接受自己的 response，較慢的舊請求不得覆蓋新裝置頁面。

## Capabilities

### New Capabilities

- `device-event-history`: 定義 Owner 裝置的有界排尿歷史查詢、cursor pagination 與列表狀態。

### Modified Capabilities

(none)

## Impact

- Affected specs: `device-event-history`（新增）
- Affected code:
  - New:
    - `src/features/history/device-event-history-repository.ts`
    - `src/features/history/urination-history-model.ts`
    - `src/features/history/device-event-history-store.ts`
    - `src/views/HistoryView.vue`
    - `src/features/history/device-event-history.spec.ts`
  - Modified:
    - `src/router/index.ts`
    - `firestore.indexes.json`
  - Removed: none
- Prerequisites: `authorize-owned-device-access`、`show-member-device-overview`、`persist-urination-events-idempotently`。
- Upstream records: query path `devices/{deviceId}/events`，只讀 `eventType: urination`，排序鍵為 `effectiveAtMs` 與 `eventId`；`estimatedUrineMl` 固定為 null 且 `estimationStatus: pending_calibration`。
