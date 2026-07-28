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

Provision command 只回傳 secret 一次到受控 operator channel；repository manifest 使用 reference，runbook 必須包含 rotate/revoke verification。

### Firmware identity 與 retry metadata 遵循主線契約

Firmware manifest 固定 `clientId` 為 deviceId、username 為 `device-{deviceId}`，Topic productModel/deviceId 必須等於 payload。Urination 與 battery publish 均使用 retained=false；QoS 值需由 apply 前 policy 選定但只能是 0/1/2。裝置對同一未確認 event 的重送必須保留 eventId、eventType、deviceId、productModel、schemaVersion、sequence、recordedAtMs 與量測 payload；不得以新 eventId 偽裝 retry。

## Implementation Contract

**Behavior:** 測試實機可連線並發布自己的 urination event 與 battery status；跨裝置與非 canonical telemetry topics 被 Broker 拒絕；撤銷後不能連線。

**Interface:** validated inventory/firmware template 使用 exact canonical topics、`clientId == deviceId`、`username == device-{deviceId}`、retained=false 與 stable retry identity；secret value 永不落盤到 project。

**Failure modes:** duplicate ID、registry mismatch、ACL 未核准或 secret output target 不安全時零 provision mutation。

**Acceptance criteria:** inventory/firmware schema、registry consistency、urination/battery positive publish、events-battery/cross-device/legacy/commands negative ACL、retained false、stable retry、revoke、rotate 與 secret scan 通過。

**Scope boundaries:** in scope 是單一 development device identity；out of scope 是 Claim、Wi-Fi provisioning、production PKI 與 commands。

## Risks / Trade-offs

- [Risk] 人工 handoff 洩漏 secret → 一次顯示、受控管道、rotation/revoke rehearsal。
- [Risk] password identity 不等於最終商品安全 → credential mechanism 是 apply 前 refinement gate，可替換但 ACL contract 不變。

## Open Questions

MQTTS mechanism、credential type、firmware secure storage 與 QoS 是 apply 前 refinement gates。
