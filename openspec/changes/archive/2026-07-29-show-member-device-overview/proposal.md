## Why

Web MVP 首頁需要讓會員在自己擁有的多台裝置間切換，並看到後端投影的最新排尿與電量，不再直接訂閱 MQTT。

## What Changes

- 顯示 Owner 裝置清單與明確選取狀態。
- 對選取裝置建立單一 Firestore listener，顯示 latest urination、battery 與 last reported 資訊。
- 提供 loading、empty、missing-data 與 read-error 骨架。
- 切換裝置或登出時解除舊 listener。
- 對 device projection 執行 runtime validation，精確讀取第二階段欄位並拒絕互相矛盾的 partial tuple。
- 所有時間以固定 `Asia/Taipei` 顯示，同時保留 epoch milliseconds 供排序與測試。

## Capabilities

### New Capabilities

- `member-device-overview`: 定義多裝置選取、最新狀態讀取與首頁狀態骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `member-device-overview`（新增）
- Affected code:
  - New:
    - `src/features/devices/device-overview-store.ts`
    - `src/features/devices/device-overview-model.ts`
    - `src/components/DeviceSelector.vue`
    - `src/components/DeviceStatusCards.vue`
    - `src/features/devices/device-overview-store.spec.ts`
  - Modified:
    - `src/views/HomeView.vue`
  - Removed: none
- Prerequisites: `authorize-owned-device-access` 與第二階段 latest projections。
- Upstream fields: `latestUrinationEventId`、`latestUrinationAtMs`、`latestUrinationReceivedAtMs`、`latestBatteryEventId`、`latestBatteryLevelPercent`、`latestBatteryAtMs`、`latestBatteryReceivedAtMs`、optional `latestBatteryVoltageMv`、`lastReportedAtMs`。
