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

## 1. Firestore 基礎與測試資料

- [x] 1.1 實作使用 Firestore server SDK 與 Emulator 相同程式路徑，讓 service 在雲端使用 Application Default Credentials、在本機使用 `FIRESTORE_EMULATOR_HOST`，且缺漏或非法設定會 fail fast；以 config unit tests、Emulator connection smoke test 與 service type-check 驗證。
- [x] 1.2 [P] 建立 deterministic `devices/{deviceId}` fixtures 與 reset/seed helper，提供 enabled、disabled、product mismatch 三種狀態且不建立 Owner/Claim 流程；以重複 seed 後文件內容相同的 Emulator integration test 驗證。

## 2. Identity 與資料形狀

- [x] 2.1 以測試先行實作使用 stable JSON SHA-256 建立 canonical identity 的 Canonical event identity，遞迴排序 object keys、保留 array order，並只 hash `{ topic, clientId, payload }`；以 golden vectors 驗證 key order 與 transport audit 差異不變 hash，而 Topic、clientId 或 payload 改變會改變 hash。
- [x] 2.2 [P] 以測試先行實作保存原始排尿量測與 pending calibration 的 Urination event record shape，建立完整 immutable record 並固定 `estimatedUrineMl: null`、`estimationStatus: pending_calibration`；以含／不含 `recordedAtMs` 的 record builder tests 驗證原始 durations、時間與 transport 欄位。

## 3. Transactional sink

- [x] 3.1 以測試先行實作先以裝置登錄資料建立 ingestion gate 的 Registered device ingestion gate，transaction 內檢查存在、path/deviceId、enabled 與 productModel；以 enabled、unknown、disabled、mismatch Emulator cases 驗證拒絕時零 event writes。
- [x] 3.2 實作在單一 transaction 內分類並寫入不可變事件的 Transactional immutable urination persistence，所有 reads 在 writes 前完成，首次事件原子建立 event 與 projection；以成功 commit 與 injected abort integration tests 驗證不會留下部分資料。
- [x] 3.3 以測試先行完成 Idempotent duplicate handling 與 Event ID conflict detection：相同 hash 回傳 `duplicate` 且零 writes，不同 hash 回傳 `event_id_conflict` 並保留原資料；以 sequential duplicate、changed payload 與 concurrent first-delivery tests 驗證一個 `stored` 加一個 `duplicate`。
- [x] 3.4 以測試先行實作以排序 tuple 維護最新排尿投影的 Monotonic latest urination projection，新事件以 `(effectiveAtMs, receivedAtMs, eventId)` 決定是否更新，`lastReportedAtMs` 只取最大值；以 newer、late、equal-time tie 與不同處理順序案例驗證結果一致。

## 4. HTTP 整合與驗收

- [x] 4.1 實作將 domain outcomes 映射為穩定 HTTP 結果的 Stable persistence outcomes，把 `stored`/`duplicate`/conflict/device gates/unavailable 映射為 `201`/`200`/`409`/`422|403`/`503` 並 sanitise SDK errors；以 route table tests 與 captured response/log assertions 驗證。
- [x] 4.2 驗證完整流程從合法 EMQX urination request 到 Firestore immutable event，重送、衝突、late event 與 transient failure 均符合契約且不建立 dailyStats 或 battery projection；執行 ingestion unit/integration tests、Firestore Emulator suite 與 `npm run check`。
