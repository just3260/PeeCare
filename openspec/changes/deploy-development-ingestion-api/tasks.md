## 1. Build 與安全部署

- [ ] 1.1 實作以 immutable image digest 部署的 Immutable development revision，驗證 mutable tag 被拒絕且 digest 被記錄。
- [ ] 1.2 [P] 實作以專用 service account 與 mounted secrets 執行的 Least-privilege runtime identity，驗證 plan 不含 secret value。
- [ ] 1.3 實作部署前檢查 development resource gates 的 Development resource gates，驗證 mismatch/未核准 limits 都零 mutation。
- [ ] 1.4 實作 Public ingress 仍由應用層 Bearer fail closed 的 Public network ingress with application authentication，驗證 public health 與 missing/wrong/current/previous Bearer，並確認 401 零 Firestore call。
- [ ] 1.5 [P] 實作 Exact production runtime environment manifest checks，驗證 exact env names、development project、different secret refs 且 `FIRESTORE_EMULATOR_HOST` 被拒絕。

## 2. 驗收與 rollback

- [ ] 2.1 實作 Cloud smoke verification，驗證 health、401、authenticated Firestore fixture 與 sanitized output。
- [ ] 2.2 實作 Revision rollback，驗證 prior healthy revision 可精確解析並完成 rollback dry-run。
- [ ] 2.3 實作 Durable event smoke outcomes，以 urination/battery first delivery 與 replay 驗證 `201`/`200`、immutable events、latest projections、urination-only daily count 與 duplicate 零 writes。
