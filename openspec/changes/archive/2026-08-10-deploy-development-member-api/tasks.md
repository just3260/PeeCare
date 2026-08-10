## 1. Build 與 runtime identity

- [x] 1.1 實作「Immutable digest與專用 runtime identity」中的 Immutable development Member API revision：建立digest-only image/manifest與mutable-tag rejection，並以manifest unit tests及deploy dry-run驗證exact project/region/service/revision/digest。
- [x] 1.2 實作 Dedicated Member API runtime identity：使用專用service account、Application Default Credentials、approved Firestore IAM與revoked-token lookup所需的read-only Firebase Auth Viewer，拒絕service-account key、Emulator host及ingestion secret；以plan snapshot、runtime config tests與key-material scan驗證。
- [x] 1.3 建立development resource preflight，對project、region、service、min/max instances、timeout、concurrency、budget與image digest缺漏採零mutation；以wrong-target/resource table tests與Cloud Run dry-run驗證。

## 2. Network authorization 與 Web handoff

- [x] 2.1 實作「Public network invocation搭配雙層 member authorization」與 Public transport with member authorization：公開health/network、mutation強制revoked-aware ID token與Owner check、CORS限exact origin；以public health、missing/wrong/revoked token、Owner/non-owner及CORS integration tests驗證零未授權Firestore call。
- [x] 2.2 實作「Verified Member API origin交付 Web build」與 Verified Member API origin handoff：verification僅在全部smoke成功後輸出HTTPS origin，Web preflight拒絕HTTP/loopback/path/query/fragment/project mismatch與無healthy record；以config table tests及build dry-run驗證。
- [x] 2.3 讓Member API runtime exact environment只接受NODE_ENV=production、GOOGLE_CLOUD_PROJECT、PEECARE_WEB_ORIGIN與PORT，且錯誤config在listen/Firestore前失敗；以services/member-api config/server tests驗證。

## 3. Release 與 rollback

- [x] 3.1 實作「Release record支援精確 rollback」與 Member API smoke and rollback：建立sanitized release record、同service prior healthy revision解析與traffic rollback dry-run；以record schema、secret scan、failed-smoke及missing-prior-revision tests驗證。
- [x] 3.2 執行Cloud smoke，驗證public health、CORS preflight、401 zero-write、Owner rename/clear、non-owner denial、Firestore project isolation與verified VITE_MEMBER_API_URL journey，並以完整Member API tests及development verification summary確認release healthy。
