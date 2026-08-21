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

## Opt-in paired development-only compatibility routes

此 development-only compatibility route 只供 Arduino 韌體改發 canonical topic 前的
短期 smoke test。Paired topology 預設停用，實際 Dashboard 拓撲必須是 **一個 Connected
HTTP Server connector、兩條 enabled legacy rules、兩個 Available HTTP actions**：Urination
與 Battery 各有一條精確匹配 `peecare/device/1/status` 的 rule，且各 rule 恰綁定自己的
event-specific action。兩個 actions 共用同一 connector；不得以單一 rule 綁兩個 actions，
也不得把 legacy filter 加到 canonical rule。啟用前必須確認：

- `align-emqx-webhook-with-serverless` 已 archive，canonical connector/action 與兩個
  canonical deliveries 已驗收；
- `devices/68E274BD2A58` 的 deviceId、productModel `pc-mini` 與
  ingestionStatus `enabled` 完全相符；
- approved legacy client ID、username 與兩個獨立 compatibility action names 已由操作者
  核准，且不把 MQTT password 放進 environment、argv、文件或 log；
- 操作者接受 `pumpSecondsToday is cumulative test data`、
  `daily stats will be modified`、`retries create distinct events`，以及 Battery events
  會污染 battery history 與 latest battery projection 四項限制。

`68E274BD2A58` 是目前核准實機的 ESP32-derived identity；實體 inventory 僅接受保留
前導零的 12 碼大寫十六進位值。格式本身不是信任證明，仍須同時核對 registry、
`device-68E274BD2A58` credential/principal 與 approved source publisher binding。
`PC-DEV-######` 保留給合成 Test Tool 裝置，且只由精確 `developmentTestTool` registry
marker 授權；不得將它當作 compatibility 固定 target，也不得用實體 ID 格式取代 marker。

設定 checklist 時明確選擇模式：

```sh
export PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE='enabled'
export PEECARE_EMQX_COMPATIBILITY_ACTION_NAME='<dashboard-assigned-compatibility-action-name>'
export PEECARE_EMQX_BATTERY_COMPATIBILITY_ACTION_NAME='<dashboard-assigned-battery-compatibility-action-name>'
export PEECARE_APPROVED_LEGACY_MQTT_CLIENT_ID='<approved-client-id>'
export PEECARE_APPROVED_LEGACY_MQTT_USERNAME='<approved-username>'
npm run emqx:development:checklist
```

canonical-only 模式省略 `PEECARE_EMQX_LEGACY_COMPATIBILITY_MODE`，或設為
`disabled`。任何其他拼字都必須 fail closed。Checklist 只證明 template 與輸入安全；
不會修改 EMQX。Dashboard 中先建立 disabled 的 Urination action/rule 與 Battery
action/rule，四者共用既有 HTTPS connector。Checklist 只有在一 connector／兩 rules／
兩 actions 完整、每條 rule 恰綁一個 action 時才是 enable-ready。

### Dashboard SQL Test

在啟用 rule 前，以 Dashboard SQL Test 逐列執行，且紀錄只能保存 result count 與
sanitized fixed-field assertion：

| Case | Input boundary | Expected result |
|---|---|---|
| positive | exact topic、approved identity、`online: true`、`pumpSecondsToday: 10.4` | exactly one result；`pumpDurationMs: 10400` |
| lower boundary | `pumpSecondsToday: 0` | exactly one result |
| upper boundary | `pumpSecondsToday: 4294967.295` | exactly one result |
| overflow | `pumpSecondsToday: 4294967.296` | zero results |
| offline | `online: false` | zero results |
| publisher mismatch | client ID 或 username 不符 | zero results |
| invalid payload | 非 object、缺值、字串、負值或 non-finite pump seconds | zero results |

Battery rule 另以同一 exact topic 執行下列 SQL Test。它先建立 decoded payload alias，
再以 `CASE` 將非數字 `batteryV` 投影為 `-1` sentinel；`WHERE` 排除 sentinel。此 route
刻意不以 `online`、`pumpSecondsToday`、source client ID/username 或 retain 作 SQL
predicate，publish authorization 仍由既有 development broker ACL 負責。

| Battery case | `batteryV` | Expected result |
|---|---:|---|
| lower boundary | `0` | one result；`0 mV`、`0%` |
| below first tier | `6.9` | one result；`6900 mV`、`0%` |
| tier 1 | `7.0` | one result；`7000 mV`、`25%` |
| live example | `7.74` | one result；`7740 mV`、`50%` |
| tier 2 | `7.5` | one result；`7500 mV`、`50%` |
| tier 3 | `8.0` | one result；`8000 mV`、`75%` |
| tier 4 | `8.5` | one result；`8500 mV`、`100%` |
| upper boundary | `20` | one result；`20000 mV`、`100%` |
| invalid | missing、string、negative 或 `20.001` | zero results；no expression error |

Dashboard SQL Test 表單無法提供 `flags.retain`，因此 Urination 測試時暫時只從測試草稿省略
`flags.retain = false`；不得把省略後的 Urination SQL 儲存成 rule。實際儲存的 Urination
runtime SQL 必須保留 retained filter，並用真實 MQTT retained publish 驗證零 delivery。
Battery rule 依已驗收 contract 不加入 retain predicate。Urination SQL 必須先建立
`json_decode(payload) AS legacyPayload`，再以 `CASE` 防護 duration arithmetic；缺值或字串等
輸入應為 zero results，不得出現 `select_and_transform_error`。

Urination 正例還要核對固定 target、`compat:68E274BD2A58:` UUID prefix、sequence `1`、
broker timestamps、flush `0`；Battery 正例核對 `compatbattery:68E274BD2A58:` prefix、
固定 username `Peecare`、rounded millivolts 與 tier。兩個 action outer objects 都只能有
`webhookAuthorization` 與 `event`；任何負例有 result 時都不得啟用。測試紀錄不可含
resolved credential 或完整 legacy payload。

### Paired shape observation, human attestation, and rollback

設定已知的 expected pump seconds、battery volts 與 QoS 後啟動 compatibility verifier。
Operator 應由 approved Arduino publisher 外部發出一筆 non-retained online status，並在驗收紀錄中
人工佐證觸發來源；不得用 Serverless Message Publish API 或 canonical probe 取代這份人工佐證：

```sh
export PEECARE_EXPECTED_LEGACY_PUMP_SECONDS_TODAY='10.4'
export PEECARE_EXPECTED_LEGACY_BATTERY_V='7.74'
export PEECARE_EXPECTED_LEGACY_QOS='0'
npm run emqx:development:verify:compatibility
```

Verifier 應在開始時間後找到恰一筆 `compat:68E274BD2A58:` Urination event 與恰一筆
`compatbattery:68E274BD2A58:` Battery event；順序不保證。成功結果是
`paired_shape_observed`，並明示 `human_attestation_required`。這只證明 Firestore shape、
cardinality、共同 broker timestamp 與 declared values 相符，不能證明 source provenance；
持有 webhook credential 的 synthetic publisher 可能產生相同 shape。任一類型零筆、多筆、
registry 不符或欄位不符都算失敗。

完整 rollback 邊界是**停用兩條 rules**。先停用 Battery rule，再停用 Urination rule；
若只停用其中一條，狀態是 `degraded partial disable`，不能宣稱 rollback 完成。歷史單一路徑
指令 `disable the compatibility rule first` 在 paired topology 中表示逐條停用，但必須兩條
都完成。確認新 legacy status 不再新增 `compat:` 與 `compatbattery:` 兩種 prefix 後，依序
remove the compatibility action, then the rule：先移除兩個 actions，再移除兩條 rules。
保留 shared connector 與 ingestion service。此流程 does not automatically delete Firestore data；
既有 Urination event history/daily aggregates、Battery history/latest projection 都保留，
任何清理都需另案核准。

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
npm run emqx:development:verify:canonical
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
