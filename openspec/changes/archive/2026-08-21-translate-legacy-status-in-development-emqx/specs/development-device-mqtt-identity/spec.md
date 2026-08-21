## ADDED Requirements

### Requirement: ESP32-derived physical device identifier

A physical ESP32 device provisioned through the development device inventory SHALL use the board-derived identifier as its canonical `deviceId`. The identifier MUST preserve leading zeroes and MUST match `^[0-9A-F]{12}$`: exactly twelve uppercase hexadecimal characters without a colon, hyphen, whitespace, or other separator. The inventory `deviceId`, MQTT client ID, canonical Topic device segment, payload `deviceId`, Firestore `devices/{deviceId}` document ID, and the suffix of MQTT principal `device-{deviceId}` SHALL all use that same value.

This physical-device constraint SHALL NOT narrow the generic `device-event-contract` identifier grammar. Synthetic development devices SHALL remain permitted to use the `PC-DEV-######` namespace and SHALL be identified through their trusted `developmentTestTool` registry marker rather than by treating identifier shape as proof of origin. A value matching the ESP32 pattern SHALL qualify as physically registered only when the approved registry, per-device MQTT credential, principal, and publisher identity binding also match.

#### Scenario: Accept the current ESP32 identifier

- **WHEN** the physical development inventory declares deviceId `68E274BD2A58`, MQTT client ID `68E274BD2A58`, principal `device-68E274BD2A58`, canonical Topic device segment `68E274BD2A58`, payload deviceId `68E274BD2A58`, and registry path `devices/68E274BD2A58`
- **THEN** physical device identity validation SHALL accept the consistent identity

##### Example: Preserve a leading zero

- **GIVEN** an ESP32 board-derived identifier whose first hexadecimal digit is zero
- **WHEN** firmware formats the identifier for provisioning and publishing
- **THEN** it emits all twelve uppercase digits, such as `00E274BD2A58`, without dropping either leading zero

#### Scenario: Reject a malformed physical identifier

- **WHEN** a physical development inventory uses lowercase hexadecimal, fewer or more than twelve characters, a colon-separated MAC form, a hyphen, whitespace, or a non-hexadecimal character
- **THEN** validation SHALL return `invalid_device_id` before credential handoff or broker mutation

#### Scenario: Keep a synthetic test device distinct

- **WHEN** a registered Test Tool device uses `PC-DEV-000001` and carries the exact approved `developmentTestTool` marker
- **THEN** the Test Tool marker flow SHALL remain permitted to authorize it without classifying it as an ESP32 physical inventory identity

#### Scenario: Refuse format-only hardware trust

- **WHEN** an unregistered or incorrectly credentialed publisher claims a twelve-character uppercase hexadecimal deviceId
- **THEN** the system SHALL reject it through registry, credential, principal, or publisher-binding validation and SHALL NOT trust it solely because the identifier matches the ESP32 pattern
