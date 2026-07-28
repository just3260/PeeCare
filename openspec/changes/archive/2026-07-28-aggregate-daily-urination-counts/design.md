## Context

排尿事件已有 normalized `effectiveAtMs`，其 mixed-time 規則會在可信 device time 與 server receive time 之間選擇；日統計必須使用該結果，而不是重新判斷 `recordedAtMs`。`persist-urination-events-idempotently` 已在 Firestore transaction 中分類 first delivery、duplicate 與 conflict，因此可在事件首次 commit 時同步更新 counter，避免 EMQX 重送造成重複計數。

產品時區已固定為 `Asia/Taipei`。目前沒有尿量校準公式，日資料只能承諾 count，不能用 flush/pump duration 推導 volume。

## Goals / Non-Goals

**Goals:**

- 依 `effectiveAtMs` 在 `Asia/Taipei` 的 local calendar date 將每個新排尿事件精確計一次。
- 讓 event、device projection 與 dailyStats 在同一 Firestore transaction 原子 commit。
- 在 concurrent unique events、duplicate、late event 與午夜邊界下維持 deterministic count。
- 提供穩定 daily document shape，明確標示尿量尚未校準。

**Non-Goals:**

- 不依會員 locale、瀏覽器或 service host timezone 改變日期。
- 不計算尿量 total/average/min/max，不將 durations 當成 volume。
- 不計數 battery、rejected、conflict 或 duplicate events。
- 不實作 historical backfill、rebuild job、跨時區切換或 scheduled aggregation。

## Decisions

### 使用固定 Asia Taipei calendar day key

純函式以 `Intl.DateTimeFormat` 的 `timeZone: Asia/Taipei`、Gregorian calendar、Latin digits 與 `formatToParts` 從 `effectiveAtMs` 產生嚴格 `yyyy-MM-dd`。不使用 `Date` local getters、host `TZ`、receivedAtMs 或手寫固定 offset；IANA timezone 可正確表達產品契約並避免 runtime 環境差異。

### 將 event 與 daily counter 放在同一 transaction

對新 urination，既有 transaction 在 writes 前額外讀 `devices/{deviceId}/dailyStats/{dayKey}`，然後原子 create event、更新 device projection、set dailyStats。任一 write 或 commit 失敗都不留下事件或計數的部分狀態。相較於 Cloud Function trigger 或事後 batch，此設計讓 webhook acknowledgement 直接代表 durable event 與 count 都成功。

### 只對首次保存的 urination 計一次

只有 event document 不存在且 eventType 為 `urination` 時才讀寫 dailyStats。duplicate、conflict、device gate rejection 與 `battery` 分支均在 daily aggregation 前返回或跳過，確保 canonical redelivery 不影響 count。

### 以 transaction retry 序列化 concurrent increments

不使用 blind increment。transaction 讀取目前 daily document、驗證 invariants、計算 `urinationCount + 1`；Firestore 對同 document concurrency 自動 retry，使每個 unique committed event 恰增加一次。這也讓 daily metadata 與 count 由同一 snapshot 計算。

### 保存 pending calibration daily shape

`devices/{deviceId}/dailyStats/{yyyy-MM-dd}` 固定包含 `date`、`timeZone: Asia/Taipei`、non-negative integer `urinationCount`、`volumeStatus: pending_calibration`，以及 `estimatedUrineTotalMl`、`estimatedUrineAverageMl`、`estimatedUrineMinMl`、`estimatedUrineMaxMl` 四個 null 欄位。保留明確 null shape，讓讀取端能區分尚未校準與數值 0。

### 以 max 規則維護 daily metadata

`lastEventAtMs` 是該日已計數事件 `effectiveAtMs` 的最大值；`updatedAtMs` 是其 `receivedAtMs` 的最大值。late event 仍增加正確日期的 count，但不倒退 metadata。dayKey 由 effectiveAtMs 決定，因此跨日 late delivery 不會寫到收到當日。

### 對既有 daily document 採 fail closed integrity guard

若 daily document 存在，其 `date`、`timeZone`、count、volume status 與 null volume fields 必須符合 schema；不合法時 transaction 回傳 `aggregation_integrity_error`、零 writes，route 使用 sanitized `500`。相較於靜默修補，fail closed 可避免在未知資料上繼續累加並隱藏 corruption。

## Implementation Contract

**Behavior:** eligible new urination event 在 event 保存同時，將其 Asia/Taipei effective day count 加一並回覆 `201`。同一事件重送回覆 `200` 且 count 不變；unique concurrent events 各加一；late event 寫入 effective day；battery 不建立或更新 dailyStats。

**Interfaces and data shape:**

- `toAsiaTaipeiDayKey(effectiveAtMs)` 對 finite integer epoch milliseconds 回傳 `yyyy-MM-dd`，非法輸入視為 internal invariant violation。
- Daily path 是 `devices/{deviceId}/dailyStats/{dayKey}`。
- Daily document 恰包含 `date: dayKey`、`timeZone: "Asia/Taipei"`、`urinationCount`、`volumeStatus: "pending_calibration"`、四個 null estimated volume fields、`lastEventAtMs`、`updatedAtMs`。
- 新 document count 從 1 開始；既有 valid document count 加 1；timestamps 使用 max 規則。

**Failure modes:** timezone conversion invariant、daily document integrity 或 integer overflow failure 皆使 transaction abort、零 event/count writes，並回覆 sanitized `500 aggregation_integrity_error`。Firestore transient failure 沿用 `503 persistence_unavailable`。duplicate、conflict 與 rejected event 不讀寫 aggregate。

**Acceptance criteria:** pure unit tests 覆蓋 Asia/Taipei 午夜前後與 host timezone independence；Emulator tests 覆蓋 first/second unique event、duplicate、conflict、battery、late cross-day、two concurrent events、corrupt document 與 injected abort；所有既有 ingestion tests 與 `npm run check` 通過。

**Scope boundaries:** in scope 是 new urination 的 daily count、fixed timezone key、pending volume shape 與 atomic transaction；out of scope 是 volume formula、rebuild/backfill、query API、UI、retention 與其他 event aggregates。

## Risks / Trade-offs

- [Risk] 熱門 device/day document 造成 transaction contention → MVP 流量以單裝置低頻排尿事件為主，使用 SDK retry；達到實際 contention 指標後再評估 sharded counter。
- [Risk] IANA timezone formatting受 runtime ICU 影響 → Node.js 22 image 固定 runtime，並以 UTC 邊界 golden tests 驗證輸出。
- [Risk] 同 transaction 增加一次 read/write 與 latency → 以原子正確性優先，Emulator/production metrics 觀測 transaction retry 與 latency。
- [Risk] fail closed 會阻擋該裝置新事件 → 回覆明確 sanitized error 並保留原資料，讓管理修復流程可針對 corruption 處理。

## Migration Plan

1. 在 Emulator 以空 dailyStats 與 seeded valid/corrupt documents 執行完整 suite。
2. 部署後送出單一 test urination，確認 event 與 daily document 同時存在且 count 為 1。
3. 重送同 event 並送出第二個 unique event，確認 count 分別維持 1、再變 2。
4. rollback 至前一 service 版本時不刪除 dailyStats；rollback 期間新事件不會補計，若需要歷史回補必須另提 change。

## Open Questions

None for this change；volume calibration 與 historical rebuild 必須在資料公式及營運需求確認後另行設計。
