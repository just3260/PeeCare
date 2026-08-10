## Why

實機不能沿用前端暴露的共用 MQTT credential。Development integration 需要一台可撤銷、只可發布自身 Topic 的獨立裝置身分，並與 Firestore device registry 一致。

## What Changes

- 建立 development device inventory 與唯一 Device ID/productModel 對應。
- 為單一測試實機建立獨立 MQTT credential 與最小 publish ACL。
- 建立不含 secret 的 firmware configuration manifest 與人工注入 runbook。
- 提供 credential revoke/rotate 與 negative ACL verification。
- 固定 `clientId == deviceId`、`username == device-{deviceId}`，並讓 firmware Topic/payload 與既有 device-event-contract 完全一致。
- Urination 發布到 `.../events/urination`，battery 發布到 `.../status/battery`；兩者 retained 必須為 false，payload retry 必須保留 eventId。
- Development Broker 使用 EMQX global password-based built-in database authenticator 與 username-scoped built-in database authorization；管理 API 僅接受 HTTPS 與 access-control scoped API key。
- Firmware 僅連線至 runtime 提供、憑證驗證不可關閉的 `mqtts://...:8883` endpoint；telemetry 固定 QoS 1，讓 ACL probe 可依 MQTT 5 PUBACK 判定成功或拒絕。
- Device password 只在明確核准的互動式 TTY 顯示一次；stdout、stderr、CLI arguments、environment、JSON summary 與 project files 均不得包含 secret。

## Capabilities

### New Capabilities

- `development-device-mqtt-identity`: 定義測試實機的唯一身分、credential handling、Topic ACL 與撤銷驗證骨架。

### Modified Capabilities

(none)

## Impact

- Affected specs: `development-device-mqtt-identity`（新增）
- Affected code:
  - New:
    - `devices/development/device-inventory.schema.json`
    - `devices/development/device-inventory.json`
    - `devices/development/firmware-config.template.json`
    - `devices/development/acl-policy.json`
    - `devices/development/fixtures/retry-after-disconnect.json`
    - `devices/development/provision-device.mjs`
    - `devices/development/verify-device-acl.mjs`
    - `devices/development/*.spec.ts`
    - `devices/development/README.md`
  - Modified:
    - `package.json`（新增不含 secret 的 development device 驗證 commands；不新增 Browser MQTT dependency）
  - Removed: none
- Prerequisites: `device-event-contract`、`provision-development-firebase-environment` 與 development EMQX access。
- Registry prerequisite: `devices/{deviceId}` 必須由 Admin 流程預建為相同 `deviceId`、`productModel`、`ingestionStatus: enabled`，Owner 欄位不參與 MQTT authentication。
- Runtime inputs: EMQX HTTPS management API URL、具 `access_control` scope 的 API key/secret、strict-TLS MQTTS URL 與 Google Application Default Credentials；值只由 operator process 提供，不寫入 inventory 或 manifest。
