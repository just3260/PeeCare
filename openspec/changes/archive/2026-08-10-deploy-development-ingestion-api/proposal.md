## Why

可信 ingestion service 需要部署到隔離的 development Cloud Run，才能由 EMQX 與實機呼叫。骨架先固定安全部署、Secret rotation、最小 IAM 與 smoke checks；只有部署工具與測試通過仍不足以證明真實 development revision 已上線，因此本 change 也涵蓋具備核准輸入後的 live rollout 與雲端驗收證據。

## What Changes

- 建立 container build、artifact identity 與 Cloud Run development deployment manifest。
- 以 Secret Manager 掛載 current/previous webhook secrets。
- 建立專用 service account 與最小 Firestore/secret 權限。
- 固定已核准的 `petcare-c7483` / `asia-east1` development target、scale-to-zero runtime limits（1 CPU、512 MiB、60 秒 timeout、concurrency 20、max instances 2），並要求 operator 提供已核准 budget record reference 才能 apply。
- Cloud Run 允許公開 HTTPS ingress 供 EMQX 呼叫，但 `/v1/emqx/events` 仍由應用層 Bearer 驗證；Cloud Run 可轉送的 `/health` 不要求 Bearer，container 仍保留既有 `/healthz` compatibility route。
- runtime 明確設定 `GOOGLE_CLOUD_PROJECT`、`EMQX_WEBHOOK_SECRET_CURRENT`、optional `EMQX_WEBHOOK_SECRET_PREVIOUS`，且禁止 `FIRESTORE_EMULATOR_HOST`。
- 在任何 live mutation 前，以 read-only checks 確認 operator 身分、approved project/region、immutable Artifact Registry digest、Cloud Billing budget、Secret Manager numeric versions 與 smoke fixture device 均存在且可用。
- 對真實 `petcare-c7483` 執行 sanitized deploy dry-run、Cloud Run apply 與 exact revision smoke verification；只有 health、401、authenticated Firestore durable outcomes 全數通過才保存 healthy release evidence。
- Live rollout 失敗時不得產生 healthy release record；若存在 prior healthy revision，先產生並審閱 exact rollback dry-run，再由 operator 明確執行該 traffic command。

## Capabilities

### New Capabilities

- `development-ingestion-deployment`: 定義 ingestion API 的 development Cloud Run build、security configuration 與 smoke verification 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `development-ingestion-deployment`（新增）
- Affected external systems: Artifact Registry、Cloud Run、IAM、Secret Manager、Cloud Billing budget inventory 與 development Firestore（live rollout 只限 `petcare-c7483` / `asia-east1`）。
- Affected code:
  - New:
    - `deploy/development/ingestion-service.yaml`
    - `deploy/development/deploy-ingestion.mjs`
    - `deploy/development/verify-ingestion.mjs`
  - Modified:
    - `services/ingestion-api/Dockerfile`
    - `package.json`
  - Removed: none
- Prerequisites: 第二階段四個 changes；已歸檔的 `provision-development-firebase-environment` 提供 approved project `petcare-c7483`、Firestore-compatible region `asia-east1` 與 `PEECARE_DEVELOPMENT_*` inventory boundary。
- Upstream HTTP contract: Cloud Run public `GET /health`、container compatibility `GET /healthz`、`POST /v1/emqx/events`、64 KiB JSON body、current/previous timing-safe Bearer、Firestore commit 後才回 `201`/`200`。
