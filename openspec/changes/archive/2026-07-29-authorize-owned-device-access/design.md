## Context

MVP 已確認一位會員可擁有多台裝置、每台裝置只有一位 Owner。server SDK ingestion 繞過 client rules，因此 client authorization 必須獨立測試。

## Goals / Non-Goals

**Goals:** Owner-only read、所有 client writes 拒絕、可查詢本人裝置、Emulator fixtures。

**Non-Goals:** 不做分享、轉移、解除綁定、Claim、管理員角色或多 Owner。

## Decisions

### 以 device ownerUid 表達 MVP ownership

`devices/{deviceId}.ownerUid` 是唯一 Owner source；會員裝置查詢必須帶 `where ownerUid == auth.uid`。

### 子集合授權讀取 parent device

Rules 對 events 與 dailyStats 讀取 parent device 的 ownerUid；未登入或非 Owner 一律拒絕。

### Client 全面唯讀

Web client 不得 create/update/delete device、event、dailyStats 或 ownerUid；fixtures 與管理操作只走 Admin context。

### Owner seed 只擴充既有 ingestion registry

Admin fixture 以 merge 更新 `devices/{deviceId}.ownerUid`，不得重建或覆蓋 `deviceId`、`productModel`、`ingestionStatus`、latest urination/battery projections 或 `lastReportedAtMs`。`ownerUid` 必須是非空 Firebase UID string；缺漏、空字串或非字串都視為無授權。Web repository 在回傳前驗證 document ID、`deviceId` 與 ownerUid 一致性。

## Implementation Contract

**Behavior:** UID 可列出並讀取自己的多台裝置與子資料，不能讀他人資料；所有 client writes 被拒絕。

**Interface:** repository 提供 `listOwnedDevices(authenticatedUid)` 與指定 device 子集合 references；document 至少包含與 document ID 相同的 `deviceId`、非空 `ownerUid`、`productModel`、`ingestionStatus`。list query 必須包含 `where('ownerUid', '==', authenticatedUid)`。

**Failure modes:** 缺少 ownerUid、query 未限制 UID、Auth 缺失均得到 permission-denied。

**Acceptance criteria:** Rules Emulator matrix 覆蓋 owner/non-owner/anonymous、malformed ownerUid 與 read/write；repository query、runtime model validation 與 merge seed preservation tests 通過。

**Scope boundaries:** in scope 是單一 Owner read access；out of scope 是 membership roles 與所有 ownership mutation。

## Risks / Trade-offs

- [Risk] parent rule lookup增加讀取成本 → 先以 Emulator 鎖定正確性，之後依實際成本 refinement。
- [Risk] ownerUid 不支援分享 → 未來以獨立 membership change 遷移，不在 MVP 骨架提前加入。

## Open Questions

分享、轉移與解除綁定的資料模型另立 change 決定。
