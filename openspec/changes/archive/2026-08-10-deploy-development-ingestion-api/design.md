## Context

Cloud Run endpoint 公開接受 EMQX request；deployment 必須隔離 development resources 並維持 Secret rotation 與 least privilege。

## Goals / Non-Goals

**Goals:** immutable image、`petcare-c7483` / `asia-east1` development-only target、current/previous secrets、dedicated identity、health/request smoke。

**Non-Goals:** 不配置 EMQX、production、custom domain、SLO 或 autoscaling final tuning。

## Decisions

### 以 immutable image digest 部署

Build 產生 digest，manifest 與驗收記錄同一 digest，不部署 mutable latest tag。

### 以專用 service account 與 mounted secrets 執行

Runtime identity 只取得所需 Firestore 與指定 secret versions；secret 不寫入 image、manifest 或 logs。

### 部署前檢查 development resource gates

Preflight 將 Firebase foundation 的 `PEECARE_DEVELOPMENT_PROJECT_ID=petcare-c7483` 與 `PEECARE_DEVELOPMENT_FIRESTORE_REGION=asia-east1` 視為上游 inventory，並要求 Cloud Run service 為 `peecare-ingestion-development`。Manifest 固定 request-based billing、1 CPU、512 MiB、60 秒 timeout、concurrency 20、min instances 0 與 max instances 2。Apply 另要求 `PEECARE_DEVELOPMENT_BUDGET_RECORD` 使用 `billingAccounts/{billing-account-id}/budgets/{budget-id}` 完整 resource name，代表 operator 已核准且已存在的 budget；工具只驗證與記錄 resource name，不建立或修改 billing budget。任何 mismatch 或缺漏都必須發生在呼叫 `gcloud` 之前。

### Public ingress 仍由應用層 Bearer fail closed

EMQX 無法使用 Firebase member session，因此 Cloud Run HTTPS endpoint 允許 unauthenticated network invocation；這只代表請求可到達 container，不代表 webhook 通過授權。Cloud Run frontend 會攔截 exact `/healthz`，因此 live public health 使用 `GET /health` 回 `200 {"status":"ok"}`；container 仍保留既有 `/healthz` compatibility route。`POST /v1/emqx/events` 必須通過現有 current/previous Bearer。runtime 使用 `GOOGLE_CLOUD_PROJECT` 指向 approved development project，Secret Manager versions 注入 `EMQX_WEBHOOK_SECRET_CURRENT` 與 optional `EMQX_WEBHOOK_SECRET_PREVIOUS`，並明確拒絕任何 `FIRESTORE_EMULATOR_HOST`。

### Exact deployment manifest 與 sanitized command interface

`deploy/development/ingestion-service.yaml` 使用 JSON-compatible YAML，固定 `apiVersion`、project、region、service、runtime service account、resource limits、public ingress 與 exact runtime environment names。Secret values 永不出現在 manifest 或 command output；current 與 optional previous 只接受完整 Secret Manager version resource reference，並由 `PEECARE_INGESTION_SECRET_CURRENT_REF` / `PEECARE_INGESTION_SECRET_PREVIOUS_REF` 傳入。

`npm run ingestion:development:deploy -- --dry-run --image "$IMAGE_DIGEST_REFERENCE"` 輸出單行 sanitized JSON plan，且不得執行 mutation。`--apply` 在相同 preflight 通過後才執行 exact `gcloud` operations；`npm run ingestion:development:verify -- --revision "$CLOUD_RUN_REVISION"` 查驗 active revision 與 smoke 結果。部署與驗證 summary 只包含 project、region、service、revision、image digest、runtime identity、secret resource names、budget record reference 與 pass/fail 狀態，不包含 secret value 或 event payload。

### Live rollout 以 read-only prerequisite gate 起始

Live apply 前先保存 sanitized prerequisite result，確認 active `gcloud` principal、inventory project/region、Artifact Registry immutable digest、Cloud Billing budget resource、current/optional previous Secret Manager numeric versions 都能由 operator read-only 解析。Smoke fixture device `PC-DEV-0001` 必須在 `petcare-c7483` Firestore 中存在且 enabled，固定 urination/battery smoke event IDs 必須尚未存在；任一條件失敗時不得呼叫 IAM 或 Cloud Run mutation。Prerequisite evidence 只記錄 resource names、digest、version numbers 與 pass/fail，不記錄 access token、secret value、service-account key 或 device payload。

### 真實 revision 只在 durable smoke 後標記 healthy

Operator 先保存 deploy dry-run，再以同一組 immutable image、budget 與 secret refs 執行 `--apply`。Apply 後以 read-only Cloud Run inspection 解析 exact revision，並確認該 revision 正在承載 100% traffic、image digest 與 dry-run 相同、runtime identity 與 manifest 相同；接著執行 health、unauthenticated 401、urination/battery first delivery 與 duplicate replay。只有全部檢查通過才保存 sanitized healthy release record，且 release record 的 revision 與 digest 必須與 Cloud Run inspection 完全相同。

### 失敗 rollout 不得留下虛假的 healthy 狀態

Apply 或 smoke 任一步失敗都保存 sanitized failure result，但不得產生 healthy release record，也不得開始 EMQX integration。若 deployment 前存在同 service 的 prior healthy immutable revision，operator 必須先執行 rollback dry-run、核對 exact target 與 digest，再明確執行輸出的 `gcloud run services update-traffic` command；執行後以 read-only service inspection 確認 100% traffic 已回到 prior revision。若不存在 prior healthy revision，workflow 停止並要求修復或明確的人工處置，不猜測 rollback target。

### Revision record 與精確 rollback

每次 healthy verification 產生 sanitized release record，記錄 active revision 與在部署前解析到的 prior healthy immutable revision。Rollback dry-run 只接受同 project、region、service 且在 release history 中標記 healthy 的 exact revision；不得以 image tag 重建，也不得在 target 不存在時改 traffic。

## Implementation Contract

**Behavior:** approved revision 可回應 public health、拒絕缺漏／錯誤 auth、以 current 或 previous secret 驗證並寫入 development Firestore；Cloud Run IAM 不得被誤描述為 webhook 的 domain authentication。Change 的 live rollout 只有在真實 prerequisite、Cloud Run apply 與 durable smoke 全數通過後才算完成。

**Interface:** JSON-compatible `ingestion-service.yaml`；`ingestion:development:deploy` 的 `--dry-run` / `--apply` 與 digest-only `--image`；`ingestion:development:verify` 的 exact `--revision` 及 rollback dry-run；read-only prerequisite/inspection commands 與上述 commands 的 sanitized JSON output 共同形成 rollout evidence。輸出顯示 project/region/service/image digest/IAM/secret refs/budget record reference 並保持 sanitized。

**Failure modes:** mutable image、target mismatch、missing/different-format secret refs、相同 current/previous refs、unresolvable image/budget/secret/device prerequisite 或 missing IAM/resource/budget gate 時零部署；apply、inspection、smoke 或 prior revision resolution 失敗時不得將 release 標記 healthy。Rollback target 未通過 dry-run 與 operator review 時不得改 traffic。

**Acceptance criteria:** manifest tests 與完整 `npm run check` 通過；真實 prerequisite result、deploy dry-run、Cloud Run apply、exact revision inspection、public health、missing/current Bearer、valid urination/battery fixture、Firestore project isolation、no-Emulator-env 與 release record 全部通過且 sanitized；若觸發 rollback，另需確認 prior revision 承載 100% traffic。

**Scope boundaries:** in scope 是 `petcare-c7483` / `asia-east1` 的真實 Cloud Run ingestion rollout、驗收與必要 rollback；out of scope 是建立或修改 billing budget、建立 secret values、EMQX action、實機 end-to-end flow、Web Hosting 與 production。

## Risks / Trade-offs

- [Risk] public endpoint 遭濫用 → auth contract、max instance/budget gates 與最小 log payload。
- [Risk] secret rotation 中斷 → current/previous refs 同時掛載並以 smoke 驗證。

## Migration Plan

1. 以 digest-only image 與完整 inventory 執行 deploy dry-run，保存 sanitized plan。
2. 建立或核對 dedicated runtime service account、Firestore role 與 named secret access，再 apply Cloud Run revision。
3. 對 exact revision 執行 health、authorization 與 durable Firestore smoke；全部通過才產生 healthy release record。
4. 若 smoke 失敗，使用 deployment 前記錄的 prior healthy revision 執行 rollback dry-run，確認 target 後才切回 traffic。
5. 以 read-only Cloud Run inspection 確認最終 100% traffic revision；只有 healthy path 才保存 release record 並完成 change，failure path 則保存 sanitized failure/rollback evidence。

## Open Questions

無。Live apply 仍要求 operator 提供已存在且已核准的 immutable image digest、`PEECARE_DEVELOPMENT_BUDGET_RECORD`、Secret Manager version references 與可執行 development mutation 的 authenticated `gcloud` principal；本 change 不建立 billing budget 或 secret values。
