## ADDED Requirements

### Requirement: Resolved device display name

Every device label in the member overview, home, history, statistics, and shared device selector SHALL use one common resolver. The resolver SHALL return a valid non-empty `customName` when present and SHALL otherwise return the immutable `deviceId`. A device document with no `customName` SHALL remain readable and SHALL display its `deviceId`.

#### Scenario: Display a custom name across device surfaces

- **WHEN** owned device `PC-000001` contains `customName: 主浴室`
- **THEN** home, history, statistics, and every shared device-selector option label that device as `主浴室`

#### Scenario: Fall back to the serial identifier

- **WHEN** owned device `PC-000001` has no `customName`
- **THEN** every device-label surface displays `PC-000001`

#### Scenario: Keep selection identity independent from the label

- **WHEN** selected device `PC-000001` changes its display name from `浴室` to `主浴室`
- **THEN** `selectedDeviceId` remains `PC-000001` and no device switch occurs

### Requirement: Canonical shared-name synchronization

The overview store SHALL expose one asynchronous rename operation backed by the Member API adapter. It SHALL update the matching owned-device entry from the canonical success response only after the API succeeds, SHALL preserve stable device ordering and selection, and SHALL expose the updated immutable shared state to every consuming view. A validation, authentication, authorization, or persistence failure SHALL leave committed device state unchanged.

#### Scenario: Synchronize a successful rename

- **WHEN** the Member API returns `{"deviceId":"PC-000001","customName":"主浴室","displayName":"主浴室"}`
- **THEN** the store updates only `PC-000001`, preserves its list position and selection, and every mounted consumer displays `主浴室`

#### Scenario: Synchronize a successful clear

- **WHEN** the Member API returns `{"deviceId":"PC-000001","customName":null,"displayName":"PC-000001"}`
- **THEN** the store clears only that device custom name and every mounted consumer falls back to `PC-000001`

#### Scenario: Preserve committed state after failure

- **WHEN** a rename request fails before a canonical success response
- **THEN** the store retains the prior device list, custom name, stable order, and selected device
