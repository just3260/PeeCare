<!--
Each task description MUST state:
- the behavior or contract being delivered (what is observably true when the
  task is complete), and
- the verification target that proves completion (test, CLI invocation,
  analyzer check, manual assertion, or content review).

File paths are supporting context for locating the work, never the task
itself. "Edit file X" is not a valid task — it is missing both behavior and
verification.
-->

## 1. 日期與 daily record 純函式

- [x] 1.1 以測試先行實作使用固定 Asia Taipei calendar day key 的 Fixed Asia Taipei day key，`toAsiaTaipeiDayKey` 只依 `effectiveAtMs` 與 IANA timezone 產生 `yyyy-MM-dd`；以 UTC 午夜前後、不同 host `TZ` 與非法 epoch cases 驗證 deterministic output。
- [x] 1.2 [P] 以測試先行實作保存 pending calibration daily shape 的 Pending calibration daily record shape，新 document count 為 1、四個 estimated volume fields 為 null 且 `volumeStatus` 固定；以完整 object equality 與禁止 duration-to-volume derivation assertions 驗證。
- [x] 1.3 以測試先行實作以 max 規則維護 daily metadata 的 Monotonic daily metadata，increment builder 對 `lastEventAtMs`/`updatedAtMs` 取 max 且安全增加 count；以 in-order、late effective time、later receive time 與 maximum-safe-integer cases 驗證。
- [x] 1.4 [P] 以測試先行實作對既有 daily document 採 fail closed integrity guard 的 Daily document integrity guard，檢查 date、timezone、safe count、status 與四個 null fields；以逐欄 corruption table 驗證每個非法 document 都回報 `aggregation_integrity_error`。

## 2. Firestore 原子計數

- [x] 2.1 實作將 event 與 daily counter 放在同一 transaction 的 Atomic event and daily count commit，對新 urination 在任何 write 前讀 daily document並原子 commit event、projection、aggregate；以 first-event success 與 injected write/commit abort Emulator tests 驗證沒有部分狀態。
- [x] 2.2 實作只對首次保存的 urination 計一次的 Exactly-once eligible urination counting，duplicate、conflict、device rejection 與 battery 均零 aggregate reads/writes；以 operation spy 加上 duplicate、conflict、四種 rejection/battery cases 驗證 daily document byte-for-byte 不變。
- [x] 2.3 以測試先行實作以 transaction retry 序列化 concurrent increments 的 Concurrent unique event counting，兩個 unique events 最終 count 為 2，而同 event concurrent delivery 最終 count 為 1；以 Firestore Emulator parallel integration tests 驗證 event 數量與 counter 一致。
- [x] 2.4 實作 Late event day attribution，依 effective day 選 daily path 並套用 metadata max 規則；以 Asia/Taipei 跨午夜 late event 驗證只增加前一日 document、收到當日不變。

## 3. Failure mapping 與完整驗收

- [x] 3.1 實作 Stable aggregation failure outcomes，daily integrity/day-key invariant 回覆 sanitized `500 aggregation_integrity_error`，transient Firestore failure 維持 `503 persistence_unavailable` 且零 partial writes；以 route response/log snapshots 與 corrupt document integration test 驗證。
- [x] 3.2 驗證完整 EMQX-to-Firestore 流程在 first、second unique、duplicate、conflict、battery、late、concurrent 與 transaction failure cases 都符合 daily contract，且既有 urination/battery event tests 不退化；執行全部 ingestion unit/integration tests、Firestore Emulator suite 與 `npm run check`。
