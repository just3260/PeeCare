## MODIFIED Requirements

### Requirement: Extensible client-side navigation

The application SHALL use Vue Router with HTML5 history. It SHALL register routes for home (`/`), history (`/history`), stats (`/stats`), notifications (`/notifications`), and settings (`/settings`), and SHALL redirect unsupported paths to the root route. It SHALL redirect the legacy `/devices` path to `/settings` so device management remains reachable. The bottom navigation SHALL present exactly five interactive entries in the fixed order history, stats, home, notifications, settings, with home occupying the centre position rendered as a visually enlarged control. Each navigation entry SHALL render both an icon and a text label and SHALL expose an accessible name. The application SHALL NOT render a standalone `/devices` navigation entry. The navigation entry matching the active route SHALL expose `aria-current="page"`, and all other entries SHALL NOT.

#### Scenario: Open the root route

- **WHEN** a visitor navigates to `/`
- **THEN** Vue Router SHALL render the home application shell

#### Scenario: Recover from an unsupported route

- **WHEN** a visitor navigates to `/unknown-path`
- **THEN** Vue Router SHALL redirect to `/` and render the home application shell

#### Scenario: Render the five-entry navigation order

- **WHEN** the application shell renders the bottom navigation
- **THEN** it SHALL present five interactive entries in the order history, stats, home, notifications, settings, with the home entry in the centre position rendered as an enlarged control, and each entry SHALL show an icon and a text label

#### Scenario: Mark the active navigation entry

- **WHEN** a visitor is viewing the `/stats` route
- **THEN** the stats navigation entry SHALL expose `aria-current="page"` and the other four entries SHALL NOT expose `aria-current`

#### Scenario: Redirect the legacy devices path

- **WHEN** a visitor navigates to `/devices`
- **THEN** Vue Router SHALL redirect to `/settings`

## ADDED Requirements

### Requirement: Settings hub

The `/settings` route SHALL render a settings page composed of grouped sections: device management, account, notification preferences, and about. The device management section SHALL present the signed-in member's owned devices using the existing owned-device overview data source, preserving the loading, error, empty, and populated states previously rendered by the devices view. The account section SHALL display the signed-in member's email and SHALL present a sign-out control. The notification preferences and about sections SHALL present only placeholder or read-only informational content and SHALL NOT claim unimplemented behaviour as active. When the home overview has no devices, the shell SHALL provide guidance directing the member to the settings device management section.

#### Scenario: List owned devices in settings

- **WHEN** a signed-in member with owned devices opens `/settings`
- **THEN** the device management section SHALL list the member's owned devices

#### Scenario: Show the empty device state in settings

- **WHEN** a signed-in member with no owned devices opens `/settings`
- **THEN** the device management section SHALL display the no-device empty state rather than a fabricated device

#### Scenario: Present account email and sign-out control

- **WHEN** a signed-in member opens `/settings`
- **THEN** the account section SHALL display the member's email and SHALL present a sign-out control

#### Scenario: Guide an empty home to settings

- **WHEN** the home overview renders its no-device empty state
- **THEN** it SHALL present guidance directing the member to the settings device management section
