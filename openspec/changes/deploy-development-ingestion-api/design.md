## Context

Cloud Run endpoint 公開接受 EMQX request；deployment 必須隔離 development resources 並維持 Secret rotation 與 least privilege。

## Goals / Non-Goals

**Goals:** immutable image、development-only target、current/previous secrets、dedicated identity、health/request smoke。

**Non-Goals:** 不配置 EMQX、production、custom domain、SLO 或 autoscaling final tuning。

## Decisions

### 以 immutable image digest 部署

Build 產生 digest，manifest 與驗收記錄同一 digest，不部署 mutable latest tag。

### 以專用 service account 與 mounted secrets 執行

Runtime identity 只取得所需 Firestore 與指定 secret versions；secret 不寫入 image、manifest 或 logs。

### 部署前檢查 development resource gates

Preflight 要求 approved project/region、min instances 0、已核准 max instances/budget，且 service name 帶 development marker。

### Public ingress 仍由應用層 Bearer fail closed

EMQX 無法使用 Firebase member session，因此 Cloud Run HTTPS endpoint 允許 unauthenticated network invocation；這只代表請求可到達 container，不代表 webhook 通過授權。`GET /healthz` 可公開回 `200 {"status":"ok"}`；`POST /v1/emqx/events` 必須通過現有 current/previous Bearer。runtime 使用 `GOOGLE_CLOUD_PROJECT` 指向 approved development project，Secret Manager versions 注入 `EMQX_WEBHOOK_SECRET_CURRENT` 與 optional `EMQX_WEBHOOK_SECRET_PREVIOUS`，並明確拒絕任何 `FIRESTORE_EMULATOR_HOST`。

## Implementation Contract

**Behavior:** approved revision 可回應 public health、拒絕缺漏／錯誤 auth、以 current 或 previous secret 驗證並寫入 development Firestore；Cloud Run IAM 不得被誤描述為 webhook 的 domain authentication。

**Interface:** deploy dry-run 顯示 project/region/service/image digest/IAM/secret refs；verify 產生 sanitized summary。

**Failure modes:** mutable image、target mismatch、missing secret/IAM/resource gate 時零部署。

**Acceptance criteria:** manifest tests、dry-run、public health、missing/wrong/current/previous Bearer、valid urination/battery fixture、Firestore project isolation、no-Emulator-env 與 rollback revision check 通過。

**Scope boundaries:** in scope 是 Cloud Run ingestion deployment；out of scope 是 EMQX action、Web Hosting 與 production。

## Risks / Trade-offs

- [Risk] public endpoint 遭濫用 → auth contract、max instance/budget gates 與最小 log payload。
- [Risk] secret rotation 中斷 → current/previous refs 同時掛載並以 smoke 驗證。

## Open Questions

Region、CPU/memory、timeout、concurrency、max instances 與 budget 是 apply 前 refinement gates。
