## MODIFIED Requirements

### Requirement: Single-page illustrated Wi-Fi guide

The Web app SHALL present a Wi-Fi connection and device-claim guide as one vertically scrollable dialog containing nine ordered, text-described steps with decorative visual markers. The guide SHALL NOT divide the steps into carousel pages and SHALL NOT rely on a visual marker as the only source of instruction.

#### Scenario: Review the complete onboarding sequence

- **WHEN** a member opens the Wi-Fi connection guide
- **THEN** the dialog shows, in order, instructions to scan the device QR or enter its identifier, sign in and confirm the identifier, create the Pair Code, enter device setup mode, connect the phone to the PeeCare temporary Wi-Fi, enter target Wi-Fi credentials and the Pair Code on the hardware setup page, wait for the hardware to leave the temporary network, restore the phone network and return to the Web app, and wait for server-authoritative Claim completion
- **AND** all nine steps are available in the same scrollable dialog

#### Scenario: Avoid unsupported hardware details and trust claims

- **WHEN** the first Claim-capable guide renders
- **THEN** it does not claim a specific Wi-Fi frequency, temporary-network naming pattern, fallback setup URL, LED pattern, connection duration, per-device MQTT identity, or cryptographically verified physical possession

## ADDED Requirements

### Requirement: Start device onboarding from the guide

The guide and the signed-in empty-device state SHALL provide a `設定新裝置` action that opens the protected `/connect` route. The route SHALL support both a QR-provided deviceId and manual entry without storing Wi-Fi credentials or Pair Code in the guide component.

#### Scenario: Start with manual entry

- **WHEN** a signed-in member activates `設定新裝置` without a scanned deviceId
- **THEN** the connect view opens its manual device identifier form
