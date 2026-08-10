## Why

Web composition root 在啟動時要求 HTTPS Member API origin，裝置重新命名也依賴該 API，但目前只有 container 與本機測試，沒有可部署的 development Cloud Run contract。缺少這個服務時，Firebase Hosting release 無法完成完整 member journey。

## What Changes

- 建立 Member API immutable container build、development Cloud Run manifest、deploy preflight 與 release verification。
- 使用專用 runtime service account、最小 Firestore IAM 與 revoked-token lookup 所需的 read-only Firebase Auth Viewer，不保存 service-account key 或應用 secret。
- 允許公開 HTTPS network invocation，但每個 mutation 仍強制驗證 Firebase ID token、revocation 與 exact CORS origin。
- 將 verified Cloud Run origin 安全交付給 VITE_MEMBER_API_URL cloud build，禁止 loopback、Emulator 與非 HTTPS origin。
- 建立 health、unauthorized、Owner rename、non-owner denial、CORS、rollback 與 sanitized release record smoke checks。

## Capabilities

### New Capabilities

- development-member-api-deployment: 定義 Member API 在隔離 development project 的 Cloud Run build、identity、network authentication、Web origin handoff、smoke 與 rollback 契約。

### Modified Capabilities

(none)

## Impact

- Affected specs: development-member-api-deployment（新增）
- Affected code:
  - New:
    - deploy/development/member-service.yaml
    - deploy/development/deploy-member.mjs
    - deploy/development/verify-member.mjs
    - deploy/development/MEMBER_API_RUNBOOK.md
  - Modified:
    - services/member-api/Dockerfile
    - services/member-api/src/config.ts
    - src/platform/firebase/config.ts
    - package.json
  - Removed: none
- Prerequisites: provision-development-firebase-environment、restore-cloud-release-quality-baseline 與既有 member-device-naming／owned-device-access contracts。
