# vue-web-app-shell Specification

## Purpose

TBD - created by syncing change 'bootstrap-vue-web-app'. Update Purpose after archive.

## Requirements

### Requirement: Vue application build

The web application SHALL use Vue 3 Single-File Components, TypeScript, Vite, and npm. It SHALL expose `dev`, `build`, `type-check`, `test:unit`, and `check` package scripts. The `check` script MUST run type checking, unit tests, and a production build and MUST exit non-zero when any stage fails.

#### Scenario: Pass the complete quality gate

- **WHEN** an operator runs `npm run check` in a clean supported Node environment
- **THEN** TypeScript checking, unit tests, and the Vite production build SHALL complete successfully

#### Scenario: Fail on a type error

- **WHEN** the application contains a TypeScript error
- **THEN** `npm run check` SHALL exit non-zero before reporting success

#### Scenario: Produce a deployable build

- **WHEN** an operator runs `npm run build`
- **THEN** Vite SHALL create `dist/index.html` and referenced hashed application assets without requiring Firebase or MQTT credentials

---
### Requirement: Neutral PeeCare application shell

The root route SHALL render a PeeCare header, overview placeholder, and bottom navigation using Vue components. Before a device data source exists, the shell MUST identify that no device data is available and SHALL NOT present zero urine volume, comparison claims, Wi-Fi health, or online status as measured facts.

#### Scenario: Render the no-data state

- **WHEN** a visitor opens the root route without a configured data source
- **THEN** the shell SHALL display `尚無裝置資料`, `待校正`, and `尚未回報`

#### Scenario: Omit fabricated measurements

- **WHEN** the no-data shell is rendered
- **THEN** it SHALL NOT display `比昨天多 8 mL`, `Wi-Fi 正常`, `裝置在線`, or a fixed `14 mL` measurement

---
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


<!-- @trace
source: redesign-bottom-navigation
updated: 2026-07-29
code:
  - src/router/index.ts
  - docs/mqtt-interfaces-and-firestore-models.md
  - src/views/HistoryView.vue
  - src/views/SettingsView.vue
  - scripts/test-tool.html
  - src/components/BottomNavigation.vue
  - src/views/StatsView.vue
  - src/views/HomeView.vue
  - scripts/test-tool.mjs
  - src/views/NotificationsView.vue
  - src/App.vue
tests:
  - src/App.spec.ts
  - src/views/HistoryView.spec.ts
  - src/views/StatsView.spec.ts
  - src/router/index.spec.ts
  - src/views/HomeView.spec.ts
  - src/components/ShellAccessibility.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/views/NotificationsView.spec.ts
  - src/views/SettingsView.spec.ts
-->

---
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


<!-- @trace
source: redesign-bottom-navigation
updated: 2026-07-29
code:
  - src/router/index.ts
  - docs/mqtt-interfaces-and-firestore-models.md
  - src/views/HistoryView.vue
  - src/views/SettingsView.vue
  - scripts/test-tool.html
  - src/components/BottomNavigation.vue
  - src/views/StatsView.vue
  - src/views/HomeView.vue
  - scripts/test-tool.mjs
  - src/views/NotificationsView.vue
  - src/App.vue
tests:
  - src/App.spec.ts
  - src/views/HistoryView.spec.ts
  - src/views/StatsView.spec.ts
  - src/router/index.spec.ts
  - src/views/HomeView.spec.ts
  - src/components/ShellAccessibility.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/views/NotificationsView.spec.ts
  - src/views/SettingsView.spec.ts
-->

---
### Requirement: Installable offline application shell

The production build SHALL generate a Web App Manifest and service worker through the Vite PWA integration. The manifest MUST identify PeeCare, use `zh-TW`, start at `/`, use standalone display mode, and reference the existing 192px and 512px icons. The service worker SHALL precache the production application shell and SHALL use `/index.html` as the navigation fallback. Development and unit-test modes SHALL NOT register a service worker.

#### Scenario: Install the production application

- **WHEN** a supported browser loads the production build
- **THEN** the browser SHALL discover a valid manifest with PeeCare name, standalone display mode, and both required icons

#### Scenario: Reload the shell offline

- **WHEN** a visitor has successfully loaded the production application once and then reloads `/` without network connectivity
- **THEN** the service worker SHALL return the cached application shell

#### Scenario: Develop without service-worker cache

- **WHEN** the application runs through the Vite development server or Vitest
- **THEN** no PeeCare service worker SHALL be registered

#### Scenario: Continue without service-worker support

- **WHEN** a browser does not implement the Service Worker API
- **THEN** the online Vue application SHALL still mount and render the root shell

---
### Requirement: Browser MQTT removal

The Vue application source, HTML, and production bundle SHALL NOT load an MQTT client, open a `ws:` or `wss:` Broker connection, subscribe to an MQTT Topic, or contain the legacy Broker username or password. The migration SHALL remove the legacy static runtime files that performed browser MQTT access.

#### Scenario: Build without MQTT dependencies

- **WHEN** the production application is built
- **THEN** its dependency graph and generated HTML SHALL contain no MQTT package or MQTT CDN script

#### Scenario: Scan for legacy Broker access

- **WHEN** source files and `dist` are searched for `mqtt.min.js`, `wss://`, and the legacy Broker credential values
- **THEN** no match SHALL be found

---
### Requirement: Responsive and accessible shell

The application shell SHALL use semantic header, main, and navigation landmarks. It SHALL set the document language to `zh-TW`, provide an accessible PeeCare home label, preserve visible keyboard focus, and avoid horizontal page scrolling at viewport widths from 320px through 1024px.

#### Scenario: Render at a narrow viewport

- **WHEN** the shell is rendered at 320px viewport width
- **THEN** all header, overview, card, and navigation content SHALL remain within the page width without horizontal scrolling

#### Scenario: Render at a tablet viewport

- **WHEN** the shell is rendered at 1024px viewport width
- **THEN** the overview and cards SHALL remain inside the centered content container

#### Scenario: Navigate with a keyboard

- **WHEN** a keyboard user focuses an enabled navigation control
- **THEN** the control SHALL show a visible focus indicator and expose an accessible name