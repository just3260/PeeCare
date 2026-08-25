## ADDED Requirements

### Requirement: Shared-credential legacy bind publisher

The development environment SHALL permit the approved shared legacy MQTT identity to publish only QoS 0 non-retained device-bind messages to `peecare/device/1/bind` with an exact payload containing `device_id` and `pair_code`. This policy SHALL remain separate from the per-device canonical telemetry ACL and MUST NOT add bind permission to a per-device principal whose existing deny-all fallback excludes it.

The shared username, clientId, and payload device_id MUST NOT be treated as per-device cryptographic proof. The payload device_id SHALL use exactly twelve uppercase hexadecimal characters and pair_code SHALL use exactly eight ASCII digits.

#### Scenario: Publish the approved bind shape

- **WHEN** the shared development publisher sends QoS 0 retained false payload `{"device_id":"68E274BD2A58","pair_code":"12345678"}` to `peecare/device/1/bind`
- **THEN** the Broker accepts it for the dedicated Claim rule

#### Scenario: Preserve the canonical telemetry ACL

- **WHEN** principal `device-68E274BD2A58` is verified after Claim support is configured
- **THEN** it retains its existing QoS 1 urination and battery permissions and deny-all fallback
- **AND** receives no implicit wildcard or legacy bind permission

### Requirement: Bounded QoS 0 bind retry

The device integration contract SHALL publish the same bind topic and exact payload at 0, 5, and 10 seconds. It MUST NOT rotate Pair Code, device_id, QoS, or retained state between retries and SHALL NOT claim that any QoS 0 publish confirms ownership.

#### Scenario: Retry after no acknowledgement

- **WHEN** the device cannot observe Claim completion after its initial QoS 0 bind publish
- **THEN** its next two publishes preserve device_id `68E274BD2A58` and Pair Code `12345678`
