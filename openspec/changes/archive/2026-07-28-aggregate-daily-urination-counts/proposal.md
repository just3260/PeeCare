## Why

首頁與後續照護功能需要可信的每日排尿次數，但 MQTT 重送、late event 與時區邊界會讓事後掃描或非交易式 counter 產生重複或歸錯日期。此 change 將首次保存事件與 `Asia/Taipei` 日計數綁在同一 Firestore transaction。

## What Changes

- 依 normalized `effectiveAtMs` 與固定 `Asia/Taipei` 產生 `yyyy-MM-dd` daily key，不使用 host timezone 或 received date。
- 在首次保存 urination event 的同一 Firestore transaction 建立或遞增 `devices/{deviceId}/dailyStats/{yyyy-MM-dd}`。
- duplicate、eventId conflict、device rejection、battery event 與失敗 transaction 都不改變排尿計數。
- 以 transaction retry 保證 concurrent unique urination events 各計一次，late event 歸入其 effective day。
- 尿量統計欄位固定為 null 並標示 `pending_calibration`，在公式建立前只提供可信 count。

## Capabilities

### New Capabilities

- `daily-urination-counts`: 定義 Asia/Taipei 日界線、排尿事件原子計數、冪等與 concurrent/late-event 行為，以及尚未校準的 volume 統計形狀。

### Modified Capabilities

(none)

## Impact

- Affected specs: `daily-urination-counts`（新增）
- Affected code:
  - New:
    - `services/ingestion-api/src/aggregation/asia-taipei-day-key.ts`
    - `services/ingestion-api/src/aggregation/daily-urination-record.ts`
    - `services/ingestion-api/test/daily-urination-counts.test.ts`
  - Modified:
    - `services/ingestion-api/src/firestore/firestore-event-sink.ts`
    - `services/ingestion-api/test/urination-event-persistence.test.ts`
    - `services/ingestion-api/test/battery-event-ingestion.test.ts`
  - Removed: none
- Data model: 新增 `devices/{deviceId}/dailyStats/{yyyy-MM-dd}` documents。
- Prerequisites: `persist-urination-events-idempotently`；建議在 `ingest-battery-events` 後套用以直接執行 battery non-count regression。
