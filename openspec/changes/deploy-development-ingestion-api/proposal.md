## Why

可信 ingestion service 需要部署到隔離的 development Cloud Run，才能由 EMQX 與實機呼叫。骨架先固定安全部署、Secret rotation、最小 IAM 與 smoke checks。

## What Changes

- 建立 container build、artifact identity 與 Cloud Run development deployment manifest。
- 以 Secret Manager 掛載 current/previous webhook secrets。
- 建立專用 service account 與最小 Firestore/secret 權限。
- region、resource limits、max instances 與 budget 由 apply 前 refinement 核准。
- Cloud Run 允許公開 HTTPS ingress 供 EMQX 呼叫，但 `/v1/emqx/events` 仍由應用層 Bearer 驗證；`/healthz` 不要求 Bearer。
- runtime 明確設定 `GOOGLE_CLOUD_PROJECT`、`EMQX_WEBHOOK_SECRET_CURRENT`、optional `EMQX_WEBHOOK_SECRET_PREVIOUS`，且禁止 `FIRESTORE_EMULATOR_HOST`。

## Capabilities

### New Capabilities

- `development-ingestion-deployment`: 定義 ingestion API 的 development Cloud Run build、security configuration 與 smoke verification 骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `development-ingestion-deployment`（新增）
- Affected code:
  - New:
    - `deploy/development/ingestion-service.yaml`
    - `deploy/development/deploy-ingestion.mjs`
    - `deploy/development/verify-ingestion.mjs`
  - Modified:
    - `services/ingestion-api/Dockerfile`
    - `package.json`
  - Removed: none
- Prerequisites: 第二階段四個 changes 與 `provision-development-firebase-environment`。
- Upstream HTTP contract: `GET /healthz`、`POST /v1/emqx/events`、64 KiB JSON body、current/previous timing-safe Bearer、Firestore commit 後才回 `201`/`200`。
