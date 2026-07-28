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

## 1. Typed record 與 dispatch

- [x] 1.1 [P] 以測試先行實作原樣保存五段電量與可省略電壓的 Battery event record shape，record 只含 common fields、`batteryLevelPercent` 與存在時的 `batteryVoltageMv`；以五種 level、含／不含 voltage 與禁止 urination fields 的 builder tests 驗證。
- [x] 1.2 實作以 eventType dispatch 共用 persistence invariants 的 Shared battery persistence invariants，讓 `FirestoreEventSink` exhaustive dispatch battery/urination 並共用 device gate、canonical identity、transaction 與 outcomes；以 exhaustive switch compile check、fake builder dispatch tests 與 urination regression tests 驗證。

## 2. Battery transaction 與 projection

- [x] 2.1 實作在共用 events collection 保存 battery record與 Device-wide event ID conflict，首次 battery 建立 immutable document，相同 hash 零 writes，不同 hash 即使跨 event type 也保留原 document；以 Emulator first、duplicate、battery-to-urination conflict cases 驗證。
- [x] 2.2 以測試先行實作以相同排序 tuple 維護 latest battery 的 Monotonic latest battery projection，僅較大 `(effectiveAtMs, receivedAtMs, eventId)` 更新整組欄位，late event 只更新 `lastReportedAtMs` 的 max；以 newer、late、equal-time tie 與反向處理順序驗證。
- [x] 2.3 以測試先行實作較新事件缺少電壓時清除 stale projection 的 Coherent latest voltage projection，latest 有 voltage 時 set、latest 無 voltage 時 delete、late event 不改動；以 present-to-present、present-to-absent 與 late-with-voltage Emulator cases 驗證。
- [x] 2.4 [P] 鎖定 Battery ingestion 不代表裝置在線的 Battery events do not establish presence，battery transaction 不建立或更新任何 presence/heartbeat 欄位；以完整 device document diff assertion 驗證只允許 history、latest battery 與 `lastReportedAtMs` 改變。

## 3. HTTP 與整合驗收

- [x] 3.1 實作 Stable battery HTTP outcomes，讓 battery stored/duplicate/conflict/device rejection/transient failure 分別回傳既定 `201`/`200`/`409`/`422|403`/`503` 與安全 error shape；以 route outcome table、response snapshot 與 sanitized log tests 驗證。
- [x] 3.2 驗證合法 EMQX battery request 能走完整 durable path，含／不含 voltage、重送、late event、cross-type conflict 均符合契約且 urination 行為不變；執行 ingestion unit/integration tests、Firestore Emulator suite 與 `npm run check`。
