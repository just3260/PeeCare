## 1. Runner 與 preflight

- [ ] 1.1 實作驗收前凍結所有 development revisions 的 Frozen development preflight，驗證 component drift 會在 physical trigger 前停止。
- [ ] 1.2 [P] 實作 Evidence bundle 只保存必要 metadata 的 Sanitized evidence bundle，透過 schema、secret 與 PII tests 驗證 allowlist。

## 2. 實機流程

- [ ] 2.1 實作以 eventId 關聯完整資料路徑的 Event ID end-to-end correlation，驗證 urination 的 broker、Cloud Run、event、projection、daily count 與 Web。
- [ ] 2.2 實作 Real battery flow，驗證 immutable battery event、latest projection 與 Web overview。
- [ ] 2.3 實作 Duplicate and ACL verification，驗證 replay 不增 event/count 且 unauthorized publish 被拒絕。
- [ ] 2.4 實作 Explicit cleanup and failure result，驗證 timeout/mismatch 仍保存 failed evidence 並只清理 marker-scoped data。
- [ ] 2.5 實作分別驗證 urination 與 battery 的不同 side effects：以 Exact urination side effects 驗證 `201`、event、latest tuple、daily +1 與 replay `200`/zero-write；以 Exact battery side effects 驗證 `status/battery`、coherent snapshot 與 daily byte-for-byte unchanged。
- [ ] 2.6 [P] 實作 Owner-visible and non-owner-denied Web result，使用兩個 Auth test members 驗證 overview/history/stats 的 Owner 可見與 non-owner permission denial。
- [ ] 2.7 實作 Domain and request correlation separation，驗證 replay 的不同 requestId 仍對應同一 deviceId/eventId 與唯一 stored event，且 evidence 不含 canonical payload。
