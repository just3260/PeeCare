## 1. Build 與安全部署

- [x] 1.1 實作以 immutable image digest 部署的 Immutable development revision：dry-run/apply 只接受符合 `^asia-east1-docker\.pkg\.dev/petcare-c7483/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$` 的 reference 並記錄相同 digest；以 manifest/deploy tests 驗證 mutable tag 在任何 `gcloud` call 前被拒絕。
- [x] 1.2 [P] 實作「以專用 service account 與 mounted secrets 執行」的 Least-privilege runtime identity，以 Secret Manager version refs 掛載 rotation secrets，plan 僅包含 dedicated identity、Firestore/secret IAM 與 resource names；以 plan snapshot 與 secret-value scan 驗證 output 不含 secret value 或 service-account key material。
- [x] 1.3 實作部署前檢查 development resource gates 的 Development resource gates：固定 `petcare-c7483`、`asia-east1`、`peecare-ingestion-development`、1 CPU、512 MiB、60 秒、concurrency 20、min 0、max 2，並要求完整 Cloud Billing budget resource name；以 mismatch/缺漏 table tests 驗證全部零 mutation。
- [x] 1.4 實作 Public ingress 仍由應用層 Bearer fail closed 的 Public network ingress with application authentication，驗證 public health 與 missing/wrong/current/previous Bearer，並確認 401 零 Firestore call。
- [x] 1.5 [P] 實作「Exact deployment manifest 與 sanitized command interface」及 Exact production runtime environment manifest checks，驗證 runtime 只有 `NODE_ENV=production`、`GOOGLE_CLOUD_PROJECT=petcare-c7483`、current/optional previous secret refs 與 platform `PORT`，current/previous refs 必須不同且 `FIRESTORE_EMULATOR_HOST` 被拒絕。

## 2. 驗收與 rollback

- [x] 2.1 實作 Cloud smoke verification，驗證 health、401、authenticated Firestore fixture 與 sanitized output。
- [x] 2.2 實作「Revision record 與精確 rollback」及 Revision rollback，驗證同 project/region/service 的 prior healthy immutable revision 可精確解析；以 missing/wrong-service target tests 與 rollback dry-run 驗證失敗零 traffic mutation。
- [x] 2.3 實作 Durable event smoke outcomes，以 urination/battery first delivery 與 replay 驗證 `201`/`200`、immutable events、latest projections、urination-only daily count 與 duplicate 零 writes。

## 3. 真實 development rollout

- [x] 3.1 執行「Live rollout 以 read-only prerequisite gate 起始」的 Live rollout prerequisite validation：以 authenticated `gcloud` principal read-only 確認 `petcare-c7483` / `asia-east1`、immutable Artifact Registry digest、可解析的 Cloud Billing budget resource、enabled current/optional previous numeric secret versions，以及 Firestore 中 enabled `PC-DEV-0001` 且兩個固定 smoke event IDs 尚未存在；以 sanitized prerequisite result 與 mutation-command count `0` 驗證任一缺漏都在 IAM/Cloud Run mutation 前停止。
- [x] 3.2 使用 3.1 核准的同一組 image digest、budget resource 與 secret version refs 執行完整 `npm run check` 及 `npm run ingestion:development:deploy -- --dry-run --image "$IMAGE_DIGEST_REFERENCE"`；以 exit code `0`、單行 sanitized JSON plan、exact project/region/service/resources/runtime identity 與無 secret value／credential／payload 的 output scan 驗證 live apply 輸入未漂移。
- [x] 3.3 執行「真實 revision 只在 durable smoke 後標記 healthy」的 Verified live development rollout apply：使用 3.2 完全相同的輸入執行 `npm run ingestion:development:deploy -- --apply --image "$IMAGE_DIGEST_REFERENCE"`，再以 read-only Cloud Run service/revision inspection 取得 exact revision；驗證該 revision 承載 100% traffic，image digest 與 dry-run 相同，runtime identity 為 `peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com`，resource limits 與 runtime environment 符合 manifest。
- [x] 3.4 對 3.3 的 exact revision 執行 `npm run ingestion:development:verify -- --revision "$CLOUD_RUN_REVISION"`，完成 Verified live development rollout 的 health `200`、unauthenticated `401`、urination `201/200`、battery `201/200`、Firestore immutable events/latest projections、urination count `+1` 與 duplicate writes `0`；以 sanitized healthy release record 驗證 revision/digest 與 Cloud Run inspection 完全相同且不含 secret 或 payload。
- [x] 3.5 驗證「失敗 rollout 不得留下虛假的 healthy 狀態」的 Failed live rollout containment：若有 prior healthy revision，使用 release record 執行 rollback dry-run、核對 exact target/digest 並保存 reviewed command，只有實際 failure 才由 operator 明確執行且以 read-only inspection 確認 prior revision 回到 100% traffic；若無 prior revision，記錄 rollback unavailable 並確認 workflow 不建立 failed revision 的 healthy record、不啟動 EMQX integration，最後以 sanitized rollout/rollback evidence review 完成驗收。
