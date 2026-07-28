## Context

Final verification crosses physical device、EMQX、Cloud Run、Firestore、Auth/Rules 與 Hosting。eventId 是跨系統 correlation key；secrets 與完整 payload 不得進 evidence。

## Goals / Non-Goals

**Goals:** immutable preflight snapshot、operator trigger、event correlation、duplicate/ACL checks、Web observation、sanitized evidence。

**Non-Goals:** 不自動控制馬達、不校準尿量、不測 OTA/SoftAP/Claim、不宣告 production readiness。

## Decisions

### 驗收前凍結所有 development revisions

Preflight 記錄 device inventory version、EMQX rule/action、Cloud Run digest、Firestore project 與 Hosting version；任一漂移即停止。

### 以 eventId 關聯完整資料路徑

Operator 從裝置診斷輸出取得 eventId，runner 輪詢 sanitized system statuses，確認單一 event、projection、daily count 與 Web view。

### Evidence bundle 只保存必要 metadata

Bundle 保存 revisions、eventId、timestamps、status codes、document paths/hash 與 assertions，不保存 credential、Auth token、完整 payload 或會員識別資料。

### 分別驗證 urination 與 battery 的不同 side effects

Urination run 記錄觸發前 daily count，要求 first delivery HTTP 201、`devices/{deviceId}/events/{eventId}` 一筆、latest urination tuple 指向該 event，effective day 的 `urinationCount` 恰加一；相同 canonical replay 要求 HTTP 200 且 event/projection/daily document byte-for-byte 不變。Battery run 使用 canonical `status/battery`，要求 first delivery 201、latest battery level/optional voltage 來自同一 event，並確認所有 dailyStats documents byte-for-byte 不變。Web 只能以 test Owner session 觀察，non-owner probe 必須 permission-denied。

## Implementation Contract

**Behavior:** 一次實機 urination 與 battery trigger 都可在核准 observation window 內出現在正確 Firestore/Web；duplicate 不重計；negative ACL 被拒絕。

**Interface:** runner 接受 approved inventory references、deviceId、eventId 與 observation window，輸出符合 schema 的 pass/fail evidence bundle；bundle 可包含 Cloud Run requestId 與 canonicalHash，但不得包含 canonical payload。

**Failure modes:** revision drift、timeout、multiple documents、projection/count mismatch、secret scan failure 均標記 failed 並保留 sanitized diagnostics。

**Acceptance criteria:** dry-run fixture、urination 201/daily+1、urination replay 200/zero-write、battery 201/no-daily-write、ACL negative、Owner/non-owner Web observation、cleanup 與 evidence schema validation 通過。

**Scope boundaries:** in scope 是 development E2E proof；out of scope 是性能/SLO、量產、尿量準確度與 production certification。

## Risks / Trade-offs

- [Risk] 人工 trigger 不穩定 → 明確 operator checkpoints 與 eventId capture，失敗可重跑但不覆蓋 evidence。
- [Risk] evidence 洩漏敏感資訊 → allowlisted schema 與 final secret/PII scan。

## Open Questions

實機 trigger procedure、diagnostic transport、observation window 與 evidence retention 是 apply 前 refinement gates。
