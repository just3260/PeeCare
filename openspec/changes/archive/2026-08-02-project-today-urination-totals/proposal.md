## Why

首頁的「今日次數」與「今日尿量」目前是寫死的 `N/A` 佔位字串。後端其實已經有這兩個數值——`devices/{deviceId}/dailyStats/{dayKey}` 內的 `urinationCount` 與 `estimatedUrineTotalMl`——但首頁的資料來源是 `devices/{deviceId}` registry 文件的即時 snapshot，該文件上沒有任何今日彙總欄位，所以畫面無從取得。

同時，上一次的尿量彙總變更（commit cb82b89）只改了 ingestion 端實作與其測試，沒有同步前端驗證器與 spec：`src/features/stats/daily-stats-model.ts` 仍要求 `volumeStatus: 'pending_calibration'` 與四個恆為 null 的容積欄位，而 ingestion 端寫出的文件已經沒有 `volumeStatus`、且 `estimatedUrineTotalMl` 是實際數字。任何在該 commit 之後產生的每日文件，統計頁解析時都會丟出 `invalid_volume_status` 資料完整性錯誤而顯示錯誤狀態。單元測試沒有攔到，因為測試 fixture 也還是舊 shape。

## What Changes

- ingestion 端在每筆排尿事件的同一個 transaction 內，除了遞增 dailyStats，另外把當日彙總鏡射到 `devices/{deviceId}` registry 文件上的三個新欄位：`todayDate`、`todayUrinationCount`、`todayEstimatedUrineTotalMl`。首頁因此能從既有的單一 device snapshot 取得今日數字並即時更新，不需要額外的 Firestore 讀取或第二個 listener。
- 遲到事件不得讓投影倒退：僅當事件的 Asia/Taipei 日界不早於現有 `todayDate` 時才覆寫投影，屬於更早日期的事件只遞增 dailyStats。
- 前端 device overview model 新增 today 投影的驗證與過期判定：三欄位完全缺席視為未知（`null`）；`todayDate` 不等於瀏覽端 Asia/Taipei 當日時，代表今天尚無事件，視為 0 次、0 mL；部分或格式錯誤的組合視為資料完整性錯誤。
- 首頁 hero 與即時卡片改用該投影顯示今日次數與今日尿量，未知時維持 `N/A`。
- **BREAKING**（僅限前端讀取契約）修正 `src/features/stats/daily-stats-model.ts`：移除 `volumeStatus` 與 `estimatedUrineAverageMl`／`estimatedUrineMinMl`／`estimatedUrineMaxMl` 三個欄位的檢查，改為要求 `estimatedUrineTotalMl` 是非負有限數，與 ingestion 端實際寫出的文件一致。
- 同步三份已與實作脫節的 spec 敘述，以及 `docs/mqtt-interfaces-and-firestore-models.md` 的 dailyStats 欄位表與備註。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `daily-urination-counts`: 每日文件 shape 由「pending_calibration + 四個 null 容積欄位」改為「實際加總的 `estimatedUrineTotalMl`」；完整性守衛同步調整；新增 registry 今日投影的寫入規則與遲到事件不倒退規則
- `member-device-overview`: 新增今日彙總投影的驗證規則與顯示規則（含跨日過期判定）
- `daily-urination-visualization`: 每日文件驗證契約由「pending 容積」改為「非負有限數總量」，並移除禁止顯示數值容積的限制

## Impact

- Affected specs: `daily-urination-counts`、`member-device-overview`、`daily-urination-visualization`
- Affected code:
  - New:
    - services/ingestion-api/src/aggregation/today-urination-projection.ts
    - services/ingestion-api/test/today-urination-projection.test.ts
  - Modified:
    - services/ingestion-api/src/firestore/firestore-event-sink.ts
    - services/ingestion-api/test/firestore-event-sink.integration.test.ts
    - services/ingestion-api/test/end-to-end-ingestion.integration.test.ts
    - src/features/devices/device-overview-model.ts
    - src/features/devices/device-overview-model.spec.ts
    - src/components/HomeOverviewHero.vue
    - src/components/HomeInstantCards.vue
    - src/views/HomeView.spec.ts
    - src/features/stats/daily-stats-model.ts
    - src/features/stats/daily-stats.spec.ts
    - docs/mqtt-interfaces-and-firestore-models.md
  - Removed: (none)
