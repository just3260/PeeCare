# Development EMQX Webhook Runbook

本 runbook 僅適用於 PeeCare development 的 EMQX Cloud Serverless
deployment。輸出與驗收紀錄只能包含 sanitized summary；禁止記錄 resolved
webhook secret、EMQX API secret、事件 payload 或 Firestore document data。

## Platform boundary and prerequisites

- Serverless Deployment API 的 Message Publish 只用於診斷，不是 canonical E2E
  verifier；connector、rule 與 action 必須在 Dashboard 建立與核對，不嘗試 API
  mutation。
- Cloud Run service 為 `peecare-ingestion-development`，project
  `petcare-c7483`，region `asia-east1`。
- Firestore 查詢使用 development project 的 Application Default Credentials。
- Secret Manager 實際名稱為 `peecare-emqx-webhook-current`，只能引用 numeric
  version，不能使用 `latest`。
- Cloud Run deployed secret references：current:
  `projects/348528459946/secrets/peecare-emqx-webhook-current/versions/1`；
  previous: not deployed。

設定 non-secret inventory：

```sh
export PEECARE_DEVICE_MQTT_URL='mqtts://d1f775fd.ala.asia-southeast1.emqxsl.com:8883'
export PEECARE_DEVELOPMENT_PROJECT_ID='petcare-c7483'
export PEECARE_DEVELOPMENT_FIRESTORE_REGION='asia-east1'
export PEECARE_DEVELOPMENT_INGESTION_ORIGIN='https://<cloud-run-host>'
export PEECARE_EMQX_CONNECTOR_NAME='c-d1f775fd-ae8109'
export PEECARE_EMQX_ACTION_NAME='a-d1f775fd-1a0b6a'
export PEECARE_INGESTION_SECRET_CURRENT_REF='projects/348528459946/secrets/peecare-emqx-webhook-current/versions/1'
```

`PEECARE_INGESTION_SECRET_PREVIOUS_REF` 只有在 Cloud Run 已實際掛載不同的
numeric previous version 時才設定。單一 current version 不會阻止 delivery
驗證，但 rotation 只會回報 `previous_secret_not_deployed`，不得標成 verified。

## Generate and review the Dashboard checklist

```sh
npm run emqx:development:checklist
```

此命令只做本地 template、identity、target 與 numeric reference 驗證，輸出
sanitized expected-value checklist；不讀 secret 值、不連線 EMQX，也不寫入任何
connector、rule 或 action。逐欄位操作請使用
[emqx-serverless-console-checklist.md](./emqx-serverless-console-checklist.md)。

Dashboard 必須核對：

- connector origin 使用 HTTPS、TLS enabled；`TLS Verify`: `disabled` 是
  development Serverless 沒有 CA-bundle 欄位的明確例外，不等同 peer
  verification。
- connector policy 僅約束 pool size `2`、HTTP pipelining `1`、connect timeout
  `10s`、health-check interval `15s`。
- rule 只含 canonical urination 與 battery topic，各 rule 只有一個 action。
- action `POST /v1/emqx/events`，content type `application/json`，body reference
  shape 為
  `{"webhookAuthorization":"Bearer {{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}","event":${.}}`。
- custom headers are not persisted by this Serverless console，因此 action 不可依賴
  custom header。resolved credential 不可放進 URL。

儲存後重新開啟 action，只核對 redacted shape；不得複製 resolved body 到 log、
工單或聊天室。

`{{PEECARE_EMQX_WEBHOOK_SECRET_CURRENT}}` 只是在文件與 sanitized output 中使用的
redaction token，EMQX 不會解析它。操作者必須在受控 shell 中臨時讀取上方精確
numeric secret version，只把 resolved 值代入 Dashboard Action Body 的 Bearer token
位置。不要回顯 secret、不要把完整 resolved body 寫入檔案或 shell history；完成後只
以重新開啟 editor 的 redacted view 核對 two-field shape。

## Connector health surface decision record

- 2026-08-18（Asia/Taipei）：原 ingestion root 回 404，Dashboard connectivity
  test 失敗且 `New` disabled，因此選定 branch B。
- 第一輪只增加 `GET /` 後仍失敗；sanitized Cloud Run metadata 證明 Dashboard
  實際送出 empty JSON `POST /` 並收到 500。
- ingestion 隨後讓精確 `GET /` 與 empty JSON `POST /` 回 static health 200；
  `PUT`、`PATCH`、`DELETE`、`HEAD` 仍為 404，root POST 不觸發 sink。
- connectivity test 通過後建立 connector、rule 與 action。TLS Verify disabled 的
  Serverless 例外已在 checklist 與 acceptance record 明確記錄。

## Branch B deployment and Serverless acceptance record

- Observation completed: 2026-08-18 02:04 CST (Asia/Taipei).
- Immutable revision `peecare-ingestion-development-00010-mkq`，image digest
  `sha256:1f5f58b7e01516e8248139d328e66e41ab39334aad88cc72b1a1748067fd06ee`，
  100% traffic；Cloud Build runtime validator smoke 與 ingestion verifier 均通過。
- Connector `c-d1f775fd-ae8109` 使用 HTTPS/TLS enabled，17 秒後仍為
  Connected；action `a-d1f775fd-1a0b6a` 仍為 Available。
- Rule `r-d1f775fd-aa7f47` enabled，僅含 canonical urination 與 battery topic。
- Action body 儲存後重新開啟，確認固定 two-field reference shape 持久化，沒有
  custom header。
- 唯一 canonical urination probe 在 publish 前 Firestore count `0`，一次 QoS 1、
  non-retained publish 後 count `1`。紀錄不含 event ID、payload 或 document data。

## Repeatable end-to-end verification

```sh
npm run emqx:development:verify
```

Verifier 從 `devices/development/device-inventory.json` 讀取既有 development device
identity，建立 strict-TLS MQTT 5 connection，再配合 Firestore document lookup
依序驗證：

1. canonical urination 落地恰一份文件；
2. canonical battery 落地恰一份文件；
3. legacy publish attempt 被 ACL 拒絕，或在 bounded observation window 內沒有文件。

執行時會透過 hidden interactive TTY 要求既有 device password。密碼只停留在記憶體，
不可透過 environment、argv、檔案、stdout/stderr 或 shell history 傳遞。此流程不建立、
輪替或變更 device credential/ACL；若密碼不可得，回報 precondition unmet。

Summary 只列三項 delivery 結果與 rotation precondition，不含 device password、API
secret、secret reference、event ID 或 payload。單一 current secret 時 delivery 仍可
healthy，但 rotation 不可宣稱 verified。

legacy non-delivery 只證明事件沒有落庫，不直接證明是 ACL、broker rule 或 ingestion
哪一層排除；ingestion 本身也會拒絕 unsupported topic。要驗證 verifier 的 rule-drift 偵錯能力，
依下方故障演練暫時移除 battery canonical filter，不要加入 legacy filter。

### Synthetic publisher limitation record

- 2026-08-18：以 Serverless Message Publish API 執行兩次 canonical probe；第二次亦
  嘗試通用 EMQX schema 的 deprecated `clientid`。兩次 API publish 都被 broker 接受、
  action 命中，但 Cloud Run 均回 sanitized HTTP 422 且 Firestore 無文件。
- 同一時間唯讀確認 probe device document 存在、deviceId/productModel 正確且
  ingestionStatus enabled，排除 unknown/disabled inventory 前置條件。
- 原因是 Serverless publish request shape 不提供可靠的 MQTT publisher identity，無法
  滿足 ingestion publisher binding。不得改用 payload deviceId 取代 rule 的 clientid，
  也不得把 synthetic publish 記為 canonical E2E 成功。

### Rule-drift rehearsal

1. 先保存目前 rule SQL，確認它精確包含 urination 與 battery 兩個 canonical filters。
2. 在 Dashboard 暫時移除 battery canonical filter，其他設定不變。
3. 執行 verifier；它必須以非零狀態結束，且只回報 sanitized
   `canonical_delivery_failed`。
4. 立即還原精確的兩個 canonical filters。
5. 重新執行 verifier；urination、battery 與 legacy 三項必須全數通過。

此演練同樣需要 hidden interactive TTY device password；沒有此 credential 時不得修改
rule，也不得宣稱演練完成。

故障注入與還原結果只記錄時間、sanitized exit/result 與已還原狀態，不記錄 probe
payload、event ID、credential 或 Firestore document data。

## Observability and incident response

Serverless 不提供 action delivery counters；broker-side queue depth and drops are not observable。
這是已接受的能力損失，不建立推測性的 broker threshold。異常偵測改用
Cloud Run structured logs 與可重複執行的 end-to-end probe。

Verifier 失敗時只輸出安全 error code。依序檢查：Dashboard connector/action 狀態、
rule topic filters、Cloud Run structured logs、Firestore 權限與 Secret Manager audit
logs。不得輸出 resolved request body、API credential 或 event payload。

## Rotation and rollback

Rotation rehearsal 的前置條件是 Cloud Run 同時掛載不同的 numeric current 與
previous versions。先部署並驗證雙 reference，再臨時解析新的 numeric current
version 並只在 Dashboard 更新 fixed body 的 Bearer 值，最後重新執行 end-to-end
verifier。現況 previous: not deployed，
所以只能回報 precondition unmet。

若 delivery 異常，立即在 Dashboard 停用 rule 以停止轉發；這不影響 ingestion
service 或既有 Firestore 資料。恢復上一個已驗證 action body reference 後，重新
核對 checklist 並執行 verifier。不要刪除仍被 Cloud Run 或 Dashboard 使用的
numeric secret version。
