## Context

Member API 已有 Node.js 22 Fastify runtime、Firebase ID token revocation check、Owner-scoped Firestore repository、exact CORS logic、health endpoint與 non-root container。Web composition root在 mount前要求 VITE_MEMBER_API_URL。現有 development deployment artifacts只涵蓋 Ingestion API，因此 Member API需要獨立 Cloud Run lifecycle。

## Goals / Non-Goals

**Goals:**

- 以 immutable digest部署 Member API 到 approved development project/region。
- 使用 dedicated runtime identity與最小 Firestore IAM，不使用 service-account key。
- 公開 network invocation仍由 Firebase ID token、revocation、Owner check與 exact CORS保護。
- 產生可供 Web cloud build使用的 verified HTTPS origin。
- 建立 smoke、release record與精確 rollback。

**Non-Goals:**

- 不新增 Member API endpoint、Device Claim、App Check enforcement或 production deployment。
- 不把 Firestore Rules當成 Admin SDK授權邊界。
- 不建立 custom domain、minimum instance大於零或長期 credential。

## Decisions

### Immutable digest與專用 runtime identity

build產生 image digest，manifest只接受 digest reference；Cloud Run service使用獨立 Member API service account，僅取得 development Firestore所需角色與 revoked-aware ID token verification 必需的 read-only Firebase Auth Viewer。選擇 Application Default Credentials而非 JSON key，符合現有 server初始化方式並避免 secret distribution。

### Public network invocation搭配雙層 member authorization

Cloud Run IAM允許瀏覽器到達 HTTPS endpoint；應用層先驗證 revoked-aware Firebase ID token，再由 repository以 member UID驗證 device owner。CORS只回應 approved Hosting origin。替代的 IAM-authenticated invocation不適用一般 browser Firebase session。

### Verified Member API origin交付 Web build

deploy verification只在 health、CORS、401、Owner rename與 non-owner denial全部通過後輸出 exact HTTPS origin。Web deploy preflight僅接受該 release record中的 origin作為 VITE_MEMBER_API_URL，拒絕 loopback、HTTP、path、query、fragment與不同 project service。

### Release record支援精確 rollback

release summary記錄 project、region、service、revision、image digest、runtime service account、verified origin與 smoke result。rollback只能選擇同一 service中前一個 healthy immutable revision，不以 mutable tag重建。

## Implementation Contract

**Behavior:** approved deployment可公開回應 health；沒有/錯誤/revoked ID token的 mutation回401，non-owner回404，Owner可更新或清除 customName。成功驗證後 Web使用 HTTPS Member API origin且可完成 rename journey。

**Interface:** deploy-member dry-run/execute與 verify-member commands；member-service manifest；sanitized JSON release record。runtime identity只授予 `roles/datastore.user` 與 `roles/firebaseauth.viewer`；runtime exact environment為 NODE_ENV=production、GOOGLE_CLOUD_PROJECT、PEECARE_WEB_ORIGIN與平台提供PORT，禁止 Emulator hosts與 ingestion secrets。

**Failure modes:** target/region/service account/image digest/resource limit/CORS origin不符時零 deployment；smoke失敗不輸出 healthy origin；rollback target缺失時 non-zero且不改 traffic。

**Acceptance criteria:** manifest/preflight tests、container smoke、public health、preflight CORS、missing/wrong/revoked token、Owner/non-owner rename、Firestore project isolation、release record與 rollback dry-run全部通過。

**Scope boundaries:** in scope是 development Member API build、Cloud Run、IAM、origin handoff與 verification；out of scope是 domain endpoint改造、App Check、production、custom domain與 onboarding。

## Risks / Trade-offs

- [Risk] Public invocation遭垃圾流量 → 保留8 KiB body limit、ID token verification、max instances與後續 App Check/observability changes。
- [Risk] Datastore IAM無法限制到單一 collection → dedicated service account只授予 development project必要資料角色，並以 repository Owner check與稽核補強。
- [Risk] Web與API release失配 → origin只從verified release record交付且納入Web smoke。
