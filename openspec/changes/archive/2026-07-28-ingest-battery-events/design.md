## Context

`device-event-contract` 已定義 battery payload 只接受 `batteryLevelPercent` 為 0、25、50、75、100，並允許省略整數 `batteryVoltageMv`。`persist-urination-events-idempotently` 建立 Firestore device gate、canonical hash、transaction 分類與 stable outcomes；本 change 擴充該 sink，而不另建第二個 HTTP endpoint 或 persistence stack。

## Goals / Non-Goals

**Goals:**

- 將已驗證 battery event 以與 urination 相同的 durable/idempotent 保證寫入同一事件 collection。
- 保存事件當下的離散電量與可省略電壓，維護 deterministic latest battery projection。
- 確保 late event、duplicate 或 conflict 不會倒退或混合 latest battery 欄位。

**Non-Goals:**

- 不新增 battery 專用 webhook endpoint、collection 或認證機制。
- 不推算電池健康度、剩餘時間、充電狀態或連續百分比。
- 不以 battery event 推導 online/offline、heartbeat 或告警。
- 不建立 daily battery aggregate、資料保留政策或通知流程。

## Decisions

### 以 eventType dispatch 共用 persistence invariants

`FirestoreEventSink` 在通用 device gate 與 identity classification 後，依 `eventType` 呼叫 typed record/projection builder。battery 與 urination 共用 canonical hash、immutable event path、duplicate/conflict outcomes 與 transaction boundary，避免兩套實作產生不同冪等語意。未知 eventType 在 validation 層已拒絕，sink 仍以 exhaustive switch 防止遺漏。

### 在共用 events collection 保存 battery record

battery document 使用 `devices/{deviceId}/events/{eventId}`，以 `eventType: battery` 與 typed fields 區分，不建立 battery 子 collection。這保留單一裝置事件時間線與 eventId namespace，也讓 conflict 可跨 event type 偵測。

### 原樣保存五段電量與可省略電壓

record 保存 validated `batteryLevelPercent`，只有 payload 提供時才寫 `batteryVoltageMv`；不將缺漏值改成 null，也不插值為連續百分比。common contract/time/transport/canonical fields 與 urination record 一致，但 battery record 不包含排尿 duration、estimated volume 或 calibration fields。

### 以相同排序 tuple 維護 latest battery

只有新 battery event 的 `(effectiveAtMs, receivedAtMs, eventId)` lexicographically 大於 current battery projection tuple 時，才一起更新 `latestBatteryEventId`、`latestBatteryLevelPercent`、`latestBatteryAtMs`、`latestBatteryReceivedAtMs`、`latestBatteryFirmwareVersion` 與 voltage projection。較舊事件仍寫入 history；`lastReportedAtMs` 對每個新事件取 max。

### 較新事件缺少電壓時清除 stale projection

latest projection 必須代表同一個 event snapshot。若成為 latest 的 battery event 未提供 `batteryVoltageMv`，transaction 使用 Firestore field deletion 移除 `latestBatteryVoltageMv`；若 event 未成為 latest，則不得改動目前電壓。相較於保留上一筆電壓，此規則避免 UI 將不同時間的 level 與 voltage 誤認為同一量測。

### Battery ingestion 不代表裝置在線

battery event 只更新 event history、latest battery projection 與 `lastReportedAtMs`。不寫 `isOnline`、`lastHeartbeatAtMs` 或 offline deadline，因為事件頻率與連線協定尚未定義，避免從偶發資料建立錯誤 presence 語意。

## Implementation Contract

**Behavior:** eligible battery first delivery 回覆 `201` 並保存一筆 immutable event；identical redelivery 回覆 `200` 且零 writes；eventId conflict 回覆 `409`。較新的 battery 更新完整 latest snapshot，late battery 只進 history；urination 行為不變。

**Interfaces and data shape:**

- Battery event document 延續 common fields，另含 `eventType: "battery"`、`batteryLevelPercent: 0 | 25 | 50 | 75 | 100`，以及只在 payload 出現時保存的 `batteryVoltageMv: integer`。
- Device projection 使用 `latestBatteryEventId`、`latestBatteryLevelPercent`、`latestBatteryAtMs`、`latestBatteryReceivedAtMs`、`latestBatteryFirmwareVersion`，以及與最新 event 同步存在或移除的 `latestBatteryVoltageMv`。
- `lastReportedAtMs` 仍是已保存新事件 receivedAtMs 的單調最大值；duplicate、conflict 與 rejected event 不更新它。

**Failure modes:** device gate、conflict、Firestore transient failure 與 safe HTTP response 完全沿用 persistence prerequisite；battery builder 若收到 validation contract 之外的 level 或 voltage，視為 internal invariant violation，零 writes 且由 sanitized `500 internal_error` 處理。

**Acceptance criteria:** unit tests 覆蓋 typed record、exhaustive dispatch 與 voltage field deletion；Emulator integration tests 覆蓋 first delivery、duplicate、cross-type conflict、newer/late/tie projection、voltage present-to-absent 轉換及 urination regression；`npm run check` 通過。

**Scope boundaries:** in scope 是 battery event record、shared sink dispatch、latest battery projection 與既有 outcomes；out of scope 是 contract schema 變更、daily aggregates、presence、alerts、Claim/Owner 與前端顯示。

## Risks / Trade-offs

- [Risk] 共用 transaction 分支增加 regression surface → 保留 urination integration suite，並以 exhaustive eventType tests 鎖定 dispatch。
- [Risk] 刪除 voltage 欄位被誤解為感測器故障 → event history 保留每筆 voltage 是否存在，projection 僅表示最新 snapshot。
- [Risk] 同一 eventId 跨 event type 使用造成 conflict → 保持 device-wide eventId namespace，明確回覆 `event_id_conflict`，不另行覆蓋。

## Migration Plan

1. 在 Firestore Emulator 對既有 urination suite 加入 battery cases。
2. 部署支援 battery 的 service；既有 device documents 不需 schema migration。
3. 送出含與不含 voltage 的測試事件，確認 event history 與 latest projection。
4. rollback 至上一版時既有 battery documents 保留；舊 service 不會更新 battery projection，也不做資料刪除。

## Open Questions

None for this change；battery 告警、presence 與健康度模型延後至事件頻率與產品需求確定後再提案。
