## ADDED Requirements

### Requirement: Single-page illustrated Wi-Fi guide

The Web app SHALL present a Wi-Fi connection guide as one vertically scrollable dialog containing six ordered, text-described steps with decorative visual markers. The guide SHALL NOT divide the steps into carousel pages and SHALL NOT rely on a visual marker as the only source of instruction.

#### Scenario: Review the complete connection sequence

- **WHEN** a member opens the Wi-Fi connection guide
- **THEN** the dialog shows, in order, instructions to enter device setup mode, connect the phone to the PeeCare temporary Wi-Fi, wait for the hardware setup page, select and authenticate to the target Wi-Fi, wait for the hardware to leave the temporary network, and restore the phone network before returning to the Web app
- **AND** all six steps are available in the same scrollable dialog

#### Scenario: Avoid unsupported hardware details

- **WHEN** the first-version guide renders
- **THEN** it does not claim a specific Wi-Fi frequency, temporary-network naming pattern, fallback setup URL, LED pattern, or connection duration

### Requirement: Automatic presentation for an empty device list

The home view SHALL automatically open the Wi-Fi connection guide when the authoritative member session is signed in, the device overview state becomes `empty`, and the current member has not viewed the guide in the current browser-tab session. The home view MUST NOT treat `loading`, `ready`, or `error` as an empty device list.

#### Scenario: First empty state in a tab session

- **GIVEN** member `member-001` is signed in and has not viewed the guide in the current browser-tab session
- **WHEN** the device overview state becomes `empty`
- **THEN** the guide opens automatically
- **AND** the tab session records `peecare:wifi-connection-guide:auto-shown:member-001` with value `1`

#### Scenario: Repeated empty state for the same member

- **GIVEN** the tab session contains `peecare:wifi-connection-guide:auto-shown:member-001` with value `1`
- **WHEN** member `member-001` returns to the home view and the device overview state is `empty`
- **THEN** the guide does not open automatically

#### Scenario: Empty state for another member

- **GIVEN** the tab session contains only `peecare:wifi-connection-guide:auto-shown:member-001` with value `1`
- **WHEN** signed-in member `member-002` reaches an `empty` device overview state
- **THEN** the guide opens automatically for `member-002`

#### Scenario: Device state is unresolved or failed

- **WHEN** the device overview state is `loading` or `error`
- **THEN** the guide does not open automatically
- **AND** no viewed marker is recorded for that state

#### Scenario: Session storage is unavailable

- **GIVEN** reading or writing browser session storage throws an error
- **WHEN** a signed-in member first reaches the `empty` device overview state during the current home-view lifetime
- **THEN** the guide opens automatically
- **AND** an in-memory marker prevents another automatic opening during that home-view lifetime

### Requirement: Persistent home-page help entry

The home page SHALL display a circular question-mark button in the header with the accessible name `開啟 Wi-Fi 連線說明`. The button SHALL open the guide regardless of whether the guide was previously opened automatically or manually. Shared headers on other pages SHALL NOT display this action unless those pages explicitly provide it.

#### Scenario: Reopen a previously viewed guide

- **GIVEN** the current member has already viewed and closed the guide
- **WHEN** the member activates the home-page question-mark button
- **THEN** the guide opens again

#### Scenario: Manual opening precedes device resolution

- **GIVEN** a signed-in member manually opens the guide while the device overview state is `loading`
- **WHEN** the member closes the guide and the device overview later becomes `empty`
- **THEN** the guide does not immediately open automatically for that member in the same tab session

### Requirement: Accessible modal interaction

The guide SHALL expose modal dialog semantics and a visible title, SHALL keep keyboard focus inside the open dialog, SHALL prevent background scrolling, and SHALL restore focus to the prior connected element after closing. The guide SHALL provide a close button and an `我知道了` action, and SHALL close in response to Escape or activation of the overlay outside the dialog content.

#### Scenario: Open with keyboard focus

- **WHEN** the guide opens
- **THEN** keyboard focus moves to the dialog close button
- **AND** Tab and Shift+Tab cycle only through controls inside the dialog

#### Scenario: Close with an explicit control

- **WHEN** the member activates either the close button or `我知道了`
- **THEN** the guide closes
- **AND** focus returns to the connected element that held focus before opening

#### Scenario: Close with Escape

- **WHEN** the open guide receives an Escape key event
- **THEN** the guide closes and restores focus

#### Scenario: Close through the overlay

- **WHEN** the member activates the overlay outside the dialog content
- **THEN** the guide closes
- **AND** activating content inside the dialog does not close it

#### Scenario: Unmount while open

- **WHEN** the guide component unmounts while the modal is open
- **THEN** the document body scrolling state is restored to its pre-open value

### Requirement: Responsive single-page presentation

The guide SHALL fit within the current viewport, SHALL provide an internal scrolling region for all six steps, and SHALL keep the title controls and acknowledgement action operable on narrow and wide screens. Narrow screens SHALL use a near-full-viewport surface with safe-area spacing, while wide screens SHALL use bounded width and height.

#### Scenario: View on a narrow mobile viewport

- **WHEN** the guide opens on a narrow viewport with content taller than the available height
- **THEN** the member can scroll the step content inside the dialog
- **AND** can reach and activate the close and acknowledgement controls without scrolling the background page

#### Scenario: View on a wide viewport

- **WHEN** the guide opens on a wide viewport
- **THEN** the dialog remains bounded within the viewport instead of expanding to the full page width
