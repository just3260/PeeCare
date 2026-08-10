## Why

各元件 smoke test 無法證明實機事件真正抵達會員 Web。最後需要一個可重複、可關聯 eventId 且不洩漏 credential 的 development end-to-end 驗收骨架。

## What Changes

- 建立實機測試 preflight，核對 device inventory、cloud revisions、EMQX action、test member 與 Web release。
- 定義人工觸發 urination/battery 與記錄 eventId 的 operator procedure。
- 自動關聯 Broker delivery、Cloud Run result、Firestore event/projection/dailyStats 與 Web 顯示。
- 建立 duplicate replay、ACL negative、失敗證據、cleanup 與 sanitized evidence bundle。
- Urination 驗收精確檢查 `201 stored`、immutable event、latest urination tuple 與 `Asia/Taipei` daily count +1；replay 檢查 `200 duplicate` 且零 writes。
- Battery 驗收精確檢查 `status/battery`、latest battery snapshot/voltage coherence，且不得建立或更新 daily urination aggregate。

## Capabilities

### New Capabilities

- `real-device-event-flow`: 定義 development 實機端到端事件驗收、跨系統關聯與證據保存骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `real-device-event-flow`（新增）
- Affected code:
  - New:
    - `verification/real-device/run.mjs`
    - `verification/real-device/evidence.schema.json`
    - `verification/real-device/README.md`
    - `verification/real-device/run.spec.ts`
  - Modified:
    - `package.json`
    - `vitest.config.ts`
  - Removed: none
- Prerequisites: 第四階段前五個 changes 及所有第二、第三階段 changes。
- Correlation keys: deviceId + eventId 為 domain identity，Cloud Run requestId 用於 sanitized HTTP/log correlation，但不得取代 eventId。
