## Why

實機不能沿用前端暴露的共用 MQTT credential。Development integration 需要一台可撤銷、只可發布自身 Topic 的獨立裝置身分，並與 Firestore device registry 一致。

## What Changes

- 建立 development device inventory 與唯一 Device ID/productModel 對應。
- 為單一測試實機建立獨立 MQTT credential 與最小 publish ACL。
- 建立不含 secret 的 firmware configuration manifest 與人工注入 runbook。
- 提供 credential revoke/rotate 與 negative ACL verification。
- 固定 `clientId == deviceId`、`username == device-{deviceId}`，並讓 firmware Topic/payload 與既有 device-event-contract 完全一致。
- Urination 發布到 `.../events/urination`，battery 發布到 `.../status/battery`；兩者 retained 必須為 false，payload retry 必須保留 eventId。

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
    - `devices/development/firmware-config.template.json`
    - `devices/development/provision-device.mjs`
    - `devices/development/verify-device-acl.mjs`
    - `devices/development/README.md`
  - Modified: none
  - Removed: none
- Prerequisites: `device-event-contract`、`provision-development-firebase-environment` 與 development EMQX access。
- Registry prerequisite: `devices/{deviceId}` 必須由 Admin 流程預建為相同 `deviceId`、`productModel`、`ingestionStatus: enabled`，Owner 欄位不參與 MQTT authentication。
