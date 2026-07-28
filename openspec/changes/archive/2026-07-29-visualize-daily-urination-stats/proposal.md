## Why

Web MVP 需要以每日彙總呈現趨勢，避免為圖表掃描全部原始事件。此骨架先提供排尿次數序列與 accessible fallback，volume 校準後再擴充。

## What Changes

- 查詢 selected device 最近 14 個 `Asia/Taipei` calendar days 的 dailyStats。
- 補齊缺日為 count 0，保留原始 document 是否存在的資訊。
- 顯示每日排尿次數圖表與等價資料表。
- volumeStatus 為 pending calibration 時不繪製尿量數值。
- 在 gap filling 前驗證第二階段 daily document 的完整 shape、固定時區、日期與 monotonic metadata；corrupt document 不得被當成缺日。
- selected device 缺漏時不執行 Firestore query，並以 query generation 防止 stale series 覆蓋。

## Capabilities

### New Capabilities

- `daily-urination-visualization`: 定義有界 dailyStats 查詢、連續日期序列與 accessible count visualization 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `daily-urination-visualization`（新增）
- Affected code:
  - New:
    - `src/features/stats/daily-stats-repository.ts`
    - `src/features/stats/daily-series.ts`
    - `src/features/stats/daily-stats-model.ts`
    - `src/components/DailyUrinationChart.vue`
    - `src/views/StatsView.vue`
    - `src/features/stats/daily-stats.spec.ts`
  - Modified:
    - `src/router/index.ts`
  - Removed: none
- Prerequisites: `authorize-owned-device-access`、`show-member-device-overview`、`aggregate-daily-urination-counts`。
- Upstream records: daily document 固定 `timeZone: Asia/Taipei`、safe integer `urinationCount`、`volumeStatus: pending_calibration`、四個 null volume fields、`lastEventAtMs` 與 `updatedAtMs`。
