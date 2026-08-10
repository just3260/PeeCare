## Context

一台實機需要唯一 identity，且 clientId、Topic、payload deviceId 必須一致。Credential 不能進 repository 或 Firestore。

## Goals / Non-Goals

**Goals:** one test device inventory、unique credential、own-topic publish ACL、firmware handoff、revoke/rotate。

**Non-Goals:** 不做量產燒錄、SoftAP、Claim、commands subscribe、certificate PKI 或 production fleet。

## Decisions

### Device inventory 不保存 credential

Inventory 只保存 deviceId、productModel、EMQX principal reference、Firestore registry status 與硬體標記。

### ACL 僅允許發布自身 canonical telemetry topics

Principal 可 publish `products/{productModel}/devices/{deviceId}/events/urination` 與 `products/{productModel}/devices/{deviceId}/status/battery`，不能 publish 他台、`events/battery`、legacy、commands，也不能任意 subscribe。

### Credential 以一次性人工 handoff 注入

Provision command 以 `crypto.randomBytes(32)` 產生 base64url password，只在明確指定 `--secret-output-tty` 且可預先開啟 `/dev/tty` 時執行 mutation。Secret 只寫入該已開啟的互動式 TTY 一次；stdout 與 stderr 僅輸出 fixed-shape sanitized JSON，CLI arguments、environment、inventory、firmware manifest、fixture 與 summary 都不得接受或保存 device password。若 TTY 在 mutation 前不可用，流程以 `unsafe_handoff` 結束且零 mutation；若 credential 建立後 handoff 寫入失敗，流程立刻刪除新 principal 並以 sanitized `handoff_failed_rolled_back` 結束。

### EMQX built-in database 與 strict TLS

Development 使用 global `password_based:built_in_database` authenticator，`user_id_type` 固定為 `username`，principal 固定為 `device-{deviceId}`。Provisioning 只呼叫 HTTPS `/api/v5/authentication/password_based%3Abuilt_in_database/users` 與 username-scoped `/api/v5/authorization/sources/built_in_database/rules/users/{username}`；management credential 只從 process environment 讀取，API key 必須具有 `access_control` scope。MQTT probe 與 firmware endpoint 必須是 `mqtts://`、port 8883 且 Node TLS `rejectUnauthorized` 永遠為 true；不得提供跳過 certificate verification 的 flag。

### Username-scoped deny-by-default ACL

每個 principal 的 authorization rules 依序只允許 QoS 1、retained false 的自身 `events/urination` 與 `status/battery` publish，最後以 `#` deny `all` 收尾。Verifier 使用 MQTT 5 連線與 QoS 1 PUBACK reason code 驗證兩個 positive topics；並驗證 `events/battery`、另一 deviceId、legacy、commands publish 與 commands subscribe 全部收到 not-authorized outcome 或由 Broker 中斷，不把 timeout 當成成功。

### Firmware identity 與 retry metadata 遵循主線契約

Firmware manifest 固定 `clientId` 為 deviceId、username 為 `device-{deviceId}`；Topic productModel/deviceId 必須等於 inventory，payload deviceId 必須等於 Topic deviceId。依主線 `device-event-contract`，productModel 是 Topic routing data，不重複放入 payload。Urination 與 battery publish 均固定 QoS 1、retained=false。裝置對同一未確認 event 的重送必須保留 eventId、eventType、deviceId、schemaVersion、sequence、recordedAtMs、firmwareVersion 與量測 payload；不得以新 eventId 偽裝 retry。`fixtures/retry-after-disconnect.json` 保存斷線前後兩次相同 canonical Topic 與 payload，驗證器逐欄比較，不只比較 eventId。

### Registry read-before-write

`--dry-run` 與所有 mutation modes 先驗證 inventory/schema、firmware template、EMQX authenticator/authorizer enabled 狀態，以及 approved Firestore project `petcare-c7483` 的 `devices/{deviceId}` document。Document ID、`deviceId`、`productModel`、`ingestionStatus: enabled` 任一不符即以 typed code 結束，且不呼叫 EMQX write API。

### 可回復 lifecycle

`--apply` 建立 non-superuser credential 與 exact ACL；ACL write 失敗會刪除剛建立的 credential。`--rotate` 替換同一 username 的 password，並要求新 password 可連線、舊 password 不可連線；`--revoke` 刪除 credential，並要求後續連線被拒絕。每個 mode 的 stdout summary 只包含 mode、deviceId、principal、status 與已執行的 verification names。

## Implementation Contract

**Behavior:** `node devices/development/provision-device.mjs --dry-run` 只做 read-only preflight；`--apply --secret-output-tty` 建立一個 non-superuser device credential 與 own-topic ACL，並只在 TTY 顯示 password 一次；`--rotate --secret-output-tty` 替換 password；`--revoke` 移除 credential。測試實機可透過 strict-TLS MQTTS 連線並以 QoS 1、retained=false 發布自己的 urination event 與 battery status；跨裝置與非 canonical telemetry topics 被 Broker 拒絕；撤銷後不能連線。

**Interface:** `device-inventory.json` 每筆包含 `hardwareLabel`、`deviceId`、`productModel`、`mqttPrincipal`、`firestore.projectId`、`firestore.documentPath` 與 `firestore.ingestionStatus`；不得含 password、token、key、secret 或 credential value 欄位。`firmware-config.template.json` 使用 exact canonical topics、`clientId == deviceId`、`username == device-{deviceId}`、QoS 1、retained=false、strict TLS 與 stable retry identity。Runtime management inputs 為 `PEECARE_EMQX_API_URL`、`PEECARE_EMQX_API_KEY`、`PEECARE_EMQX_API_SECRET`、`PEECARE_DEVICE_MQTT_URL` 與 Application Default Credentials。Device password 不得由 CLI argument 或 environment 傳入；ACL/lifecycle verifier 以無回顯 TTY prompt 讀取。

**Failure modes:** duplicate ID、principal mismatch、firmware identity mismatch、registry mismatch、disabled authenticator/authorizer、non-HTTPS management URL、non-MQTTS endpoint、非 8883 port、TLS bypass、ACL 未核准或 secret output target 不安全時零 provision mutation。Partial mutation 必須執行明確 rollback；network timeout、unexpected status、MQTT timeout 與 ambiguous PUBACK 都是失敗，不能視為通過。

**Acceptance criteria:** `npx vitest run devices/development`、`npm run device:development:dry-run`、inventory/firmware schema、registry consistency、urination/battery positive MQTT 5 publish、events-battery/cross-device/legacy/commands publish 與 commands subscribe negative ACL、QoS 1、retained false、stable retry、revoke、rotate 與 repository/output secret scan 全部通過。Live mutation 與 lifecycle rehearsal 需要 operator 明確執行，不在 unit test 階段自動發生。

**Scope boundaries:** in scope 是單一 development device identity；out of scope 是 Claim、Wi-Fi provisioning、production PKI 與 commands。

## Risks / Trade-offs

- [Risk] 人工 handoff 洩漏 secret → 一次顯示、受控管道、rotation/revoke rehearsal。
- [Risk] password identity 不等於最終商品安全 → 此 change 只限 development 單機；production fleet 仍需獨立 PKI 設計。
- [Risk] 單一 username 的 password rotation 無重疊 credential window → runbook 先停止 device publisher，rotate 後立即注入與驗證；失敗即 revoke 並重新 provision，不保留未知有效的舊 password。
- [Risk] EMQX API minor version 差異造成 response shape 改變 → adapter 僅接受已列出的 2xx status 與必要欄位，其他 shape fail closed；endpoint 固定 `/api/v5`。
- [Risk] 新增 MQTT client package 會破壞 Browser MQTT removal → verifier 使用 Node `node:tls` 與最小 MQTT 5 probe，不修改 Web dependency graph 或 Browser bundle。
