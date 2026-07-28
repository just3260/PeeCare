## Context

Owner repository 可列出會員裝置；第二階段會在 device document 維護 latest projections。首頁只讀 Firestore，不連 MQTT。

## Goals / Non-Goals

**Goals:** 多裝置 selector、單一 selected device、latest cards、完整 UI states、listener cleanup。

**Non-Goals:** 不做歷史、圖表、重新命名、控制命令、online 推導或 Claim。

## Decisions

### 先載入清單再選取裝置

清單穩定排序；若尚無選取則選第一台，空清單顯示明確 empty state。

### 每次只監聽一台 selected device

切換或登出先 unsubscribe 舊 listener，再訂閱新 document，避免重複讀取與跨裝置畫面混合。

### 缺漏投影顯示 unknown 而非推算

不存在的 latest urination、battery 或 lastReported 欄位顯示尚無資料，不從 event history 或時間推導。

### 以完整 projection tuple 驗證 Firestore snapshot

Urination projection 必須同時具有 eventId、atMs、receivedAtMs；battery projection 必須同時具有 eventId、level、atMs、receivedAtMs，level 只接受 0/25/50/75/100，voltage 可省略。整組完全缺漏代表尚無資料；只缺一部分、型別錯誤或負 epoch 代表 data-integrity error，不把 partial snapshot 顯示為 ready。時間格式化固定使用 `Asia/Taipei` 與 `zh-TW`。

## Implementation Contract

**Behavior:** 會員看到本人裝置並切換；首頁即時更新選取裝置 latest values；空資料與錯誤可辨識。

**Interface:** store 暴露 devices、selectedDeviceId、validated overview、loading/empty/missing/error 與 `selectDevice(deviceId)`；component 不直接呼叫 Firestore。overview model 使用第二階段確切 projection 欄位，時間 formatter 固定 `Asia/Taipei`。

**Failure modes:** listener 失敗顯示 retryable read error 且不顯示上一台資料。

**Acceptance criteria:** model/store/component tests 覆蓋 0/1/2 devices、完整／缺漏／partial projection、switch、update、Asia/Taipei timestamp、error 與 cleanup。

**Scope boundaries:** in scope 是 latest overview；out of scope 是 history、stats、mutation 與 presence。

## Risks / Trade-offs

- [Risk] 即時 listener 增加 reads → 僅維持一台 selected device listener。
- [Risk] 缺漏欄位造成 UI 歧義 → 使用 explicit unknown states，不用 0 代替。

## Open Questions

正式文案與卡片視覺在 UI refinement change 決定。
