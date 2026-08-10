# Development EMQX Webhook Runbook

本 runbook 僅適用於 PeeCare development 的 EMQX rule/action。執行結果只應包含 sanitized summary；禁止把 webhook secret、裝置密碼或事件 payload 貼進指令、檔案、log、工單或聊天室。

## 前置條件

- EMQX Management URL 必須是無帳密的 `https://` origin。
- MQTT URL 必須是無帳密的 `mqtts://` URL，固定使用 port `8883` 並驗證 TLS 憑證。
- EMQX API key 使用最小權限，僅授予 rule/action 管理、metrics 讀取與 publish 所需權限；不要使用 Dashboard 帳密。
- `gcloud` 已登入且只能讀取指定的 numeric Secret Manager versions。
- Cloud Run development revision 已部署，且 probe device 已存在並啟用 ingestion。
- 裝置密碼只在 verifier 的 hidden TTY prompt 輸入，不可放進環境變數。

設定非 secret 的 inventory 與 secret reference；reference 必須指向明確 numeric version，不能使用 `latest`：

```sh
export PEECARE_EMQX_API_URL='https://<emqx-management-host>'
export PEECARE_EMQX_API_KEY='<scoped-api-key>'
export PEECARE_EMQX_API_SECRET='<scoped-api-secret>'
export PEECARE_DEVELOPMENT_INGESTION_ORIGIN='https://<cloud-run-host>'
export PEECARE_DEVICE_MQTT_URL='mqtts://<mqtt-host>:8883'
export PEECARE_DEVELOPMENT_DEVICE_ID='PC-000001'
export PEECARE_DEVELOPMENT_PRODUCT_MODEL='pc-mini'
export PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF='projects/petcare-c7483/secrets/emqx-webhook-current/versions/<previous-number>'
export PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF='projects/petcare-c7483/secrets/emqx-webhook-current/versions/<current-number>'
export PEECARE_INGESTION_SECRET_CURRENT_REF="$PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF"
```

## 初次設定或 policy 更新

先執行 dry-run。它會讀取 live `/api-spec.json`，確認核准的 resource options 都存在；任何 target、secret reference、topic filter、delivery policy 或 API schema 不相容都必須在零 mutation 下失敗。

```sh
npm run emqx:development:dry-run
npm run emqx:development:apply
npm run emqx:development:verify
```

核准的固定值為：async、2 workers、每 worker 10 inflight、每 worker 8MB buffer、30s request TTL、15s health check，且不設定獨立 `retry_interval`。Verifier 會在 hidden TTY prompt 要求裝置密碼，依序確認 previous-secret urination、current-secret battery、legacy non-delivery、retained rejection 與 array payload boundary；summary 不包含 secret reference、resolved secret 或 payload。

## Secret rotation

按以下順序執行，任何一步失敗都停止，不可移除舊 secret：

1. 部署 Cloud Run，讓 Cloud Run 同時接受 current 與 previous；先確認 health 與雙 secret acceptance。
2. 保留舊 numeric version 作為 `PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF`，將新 numeric version 設為 `PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF`。
3. 執行 `npm run emqx:development:dry-run`，確認 sanitized plan 只變更預期 action。
4. 執行 `npm run emqx:development:apply`，將 EMQX Action 切換到新 current。
5. 執行 `npm run emqx:development:verify`；必須回報 previous/current 均 verified、urination 與 battery 各一筆成功、legacy 零 delivery、dropped 與 lateReply delta 均為零。
6. 觀察 warning/critical thresholds 且確認沒有新增異常後，才可從 Cloud Run 移除 previous。

### Rotation rollback

若新 current probe 失敗，Cloud Run 仍須維持雙 secret acceptance。先保存失敗的新 reference，再對調 verifier 的 current／previous；apply 與 verifier 的 current 必須同時指回舊 numeric version，避免 verifier 結束時又恢復成失敗的新版本：

```sh
failed_current_ref="$PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF"
rollback_current_ref="$PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF"
export PEECARE_EMQX_WEBHOOK_SECRET_PREVIOUS_REF="$failed_current_ref"
export PEECARE_EMQX_WEBHOOK_SECRET_CURRENT_REF="$rollback_current_ref"
export PEECARE_INGESTION_SECRET_CURRENT_REF="$rollback_current_ref"
npm run emqx:development:dry-run
npm run emqx:development:apply
npm run emqx:development:verify
```

只有 sanitized summary 恢復 healthy 後才結束 rollback；不要刪除或停用仍在使用的 numeric secret version。

## 告警基準

- Warning：`retried > 0` 或 `queuing > 0` 持續 60 秒。
- Critical：5 分鐘內 `failed >= 3`，或任何 `dropped > 0`、`late_reply > 0`。
- Rotation 與 retained rejection rehearsal 應以 probe 前後 counter delta 判斷，不以既有累積 counter 當成新 failure。

若 verifier 失敗，只會在 stderr 輸出安全的 error code。用 EMQX action metrics、Cloud Run structured logs 與 Secret Manager audit logs 排查，但不可輸出 Authorization header 或 request body。
