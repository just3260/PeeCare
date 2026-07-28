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

## 1. Service 骨架與共用介面

- [x] 1.1 建立 Cloud Run 相容的單一 Fastify service：`services/ingestion-api` 使用 Node.js 22、TypeScript，監聽 `0.0.0.0:$PORT` 並提供 `GET /healthz`，交付 Cloud Run compatible HTTP service；以 service 單元測試與容器 smoke test 驗證健康檢查為 `200`。
- [x] 1.2 [P] 讓裝置事件契約套件提供 ingestion service 可匯入的公開 exports 與型別宣告，且 root scripts 能獨立執行 ingestion type-check/test；以 `npm run check` 與 package import smoke test 驗證。

## 2. HTTP 與身分驗證邊界

- [x] 2.1 以測試先行實作使用 current previous Bearer secrets 的 Rotatable Bearer authentication，使用 timing-safe comparison、current/previous 任一有效且所有失敗一致回傳 `401 unauthorized`；以 current、previous、缺漏、錯誤與格式錯誤案例驗證。
- [x] 2.2 [P] 以測試先行實作先限制 HTTP 再驗證 Envelope 的 Bounded JSON request，僅接受 `POST /v1/emqx/events`、JSON object 與最多 64 KiB request body；以 method、content type、malformed JSON、array body 與超限案例驗證對應 `4xx`。
- [x] 2.3 以測試先行實作 Strict EMQX webhook envelope，拒絕未知欄位、`retained !== false`、非法 `qos` 或缺漏欄位；以合法 envelope 與每個欄位邊界案例驗證穩定錯誤碼。

## 3. 裝置事件驗證與正規化

- [x] 3.1 以測試先行實作重用裝置契約並正規化時間之前半段 Publisher and device event validation，要求 Topic device ID、`clientId`、payload `deviceId` 一致並驗證既有 urination/battery schema，`username` 僅保留供稽核；以跨欄位不一致、未知 topic/event type 與既有 fixtures 驗證。
- [x] 3.2 以測試先行完成重用裝置契約並正規化時間的 Normalized validated event，輸出 immutable normalized value、server `receivedAtMs` 與既有 mixed-time `effectiveAtMs/timeSource`，而 `brokerReceivedAtMs` 僅供稽核；以可信、過舊、未來與缺漏 `recordedAtMs` 的固定時鐘測試驗證。

## 4. 持久化交界與安全錯誤

- [x] 4.1 以測試先行實作單一 EventSink 控制成功回應的 Durable sink acknowledgement boundary，route 僅在 sink 回報 `stored`/`duplicate` 後分別回傳 `201`/`200`，預設 unavailable sink 與暫時性失敗回傳 `503`；以 fake sink route tests 驗證沒有 sink 不會誤報成功。
- [x] 4.2 [P] 以測試先行實作使用穩定 errors 與敏感資料 redaction 的 Safe structured errors and logs，所有錯誤遵循固定 JSON shape 且 log 不包含 bearer secret、完整 payload 或敏感 header；以錯誤 snapshot 與 log capture/redaction 測試驗證。

## 5. 整合驗證

- [x] 5.1 驗證完整 ingestion 邊界能從合法 EMQX request 產生 normalized event 並由 fake sink 回覆，所有非法請求皆無 sink side effect；執行 `npm run check`、ingestion integration tests、container smoke test 與 secret source scan，確認上述所有 Requirements 與 design decisions 均被覆蓋。
