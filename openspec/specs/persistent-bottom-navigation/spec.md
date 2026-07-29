# persistent-bottom-navigation Specification

## Purpose

TBD - created by archiving change 'fix-bottom-tab-view'. Update Purpose after archive.

## Requirements

### Requirement: Persistent main-route bottom navigation
The application SHALL render the bottom navigation while the authenticated main-route content is shown at `/`, `/history`, `/stats`, `/devices`, or `/notifications`. Route transitions among those paths SHALL NOT remove the navigation, and the navigation SHALL expose the active route using the existing active-item styling and accessibility semantics.

#### Scenario: Navigate from home to history
- **WHEN** a signed-in member activates the History navigation item from `/`
- **THEN** `/history` content and the bottom navigation are both rendered, with History identified as active

#### Scenario: Navigate from home to stats
- **WHEN** a signed-in member activates the Stats navigation item from `/`
- **THEN** `/stats` content and the bottom navigation are both rendered, with Stats identified as active

#### Scenario: Navigate to devices or notifications
- **WHEN** a signed-in member activates the Devices or Notifications navigation item
- **THEN** the corresponding protected route and bottom navigation are rendered, the selected item is active, and neither item has `aria-disabled="true"`


<!-- @trace
source: fix-bottom-tab-view
updated: 2026-07-29
code:
  - scripts/test-tool.html
  - scripts/test-tool.mjs
  - src/components/BottomNavigation.vue
  - src/router/index.ts
  - src/views/NotificationsView.vue
  - src/views/HomeView.vue
  - src/views/HistoryView.vue
  - src/views/StatsView.vue
  - docs/mqtt-interfaces-and-firestore-models.md
  - src/views/SettingsView.vue
  - src/App.vue
tests:
  - src/router/index.spec.ts
  - src/views/HomeView.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.spec.ts
  - src/views/SettingsView.spec.ts
  - src/components/ShellAccessibility.spec.ts
  - src/views/StatsView.spec.ts
  - src/views/HistoryView.spec.ts
  - src/views/NotificationsView.spec.ts
-->

---
### Requirement: Empty devices and notifications states
The application SHALL show a clear empty state on the Devices and Notifications routes. When the signed-in member owns no devices, `/devices` SHALL render `尚無綁定裝置`. When no notification records are available, `/notifications` SHALL render `尚無通知紀錄`.

#### Scenario: Render empty devices
- **WHEN** `/devices` renders with an empty owned-device collection
- **THEN** the page displays `尚無綁定裝置`

#### Scenario: Render empty notifications
- **WHEN** `/notifications` renders without notification records
- **THEN** the page displays `尚無通知紀錄`


<!-- @trace
source: fix-bottom-tab-view
updated: 2026-07-29
code:
  - scripts/test-tool.html
  - scripts/test-tool.mjs
  - src/components/BottomNavigation.vue
  - src/router/index.ts
  - src/views/NotificationsView.vue
  - src/views/HomeView.vue
  - src/views/HistoryView.vue
  - src/views/StatsView.vue
  - docs/mqtt-interfaces-and-firestore-models.md
  - src/views/SettingsView.vue
  - src/App.vue
tests:
  - src/router/index.spec.ts
  - src/views/HomeView.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.spec.ts
  - src/views/SettingsView.spec.ts
  - src/components/ShellAccessibility.spec.ts
  - src/views/StatsView.spec.ts
  - src/views/HistoryView.spec.ts
  - src/views/NotificationsView.spec.ts
-->

---
### Requirement: No main navigation on sign-in
The application SHALL NOT render the authenticated main-route bottom navigation on `/sign-in`.

#### Scenario: Render sign-in route
- **WHEN** the router renders `/sign-in`
- **THEN** the sign-in content is rendered without the bottom navigation


<!-- @trace
source: fix-bottom-tab-view
updated: 2026-07-29
code:
  - scripts/test-tool.html
  - scripts/test-tool.mjs
  - src/components/BottomNavigation.vue
  - src/router/index.ts
  - src/views/NotificationsView.vue
  - src/views/HomeView.vue
  - src/views/HistoryView.vue
  - src/views/StatsView.vue
  - docs/mqtt-interfaces-and-firestore-models.md
  - src/views/SettingsView.vue
  - src/App.vue
tests:
  - src/router/index.spec.ts
  - src/views/HomeView.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.spec.ts
  - src/views/SettingsView.spec.ts
  - src/components/ShellAccessibility.spec.ts
  - src/views/StatsView.spec.ts
  - src/views/HistoryView.spec.ts
  - src/views/NotificationsView.spec.ts
-->

---
### Requirement: Consistent main-route presentation
The History and Stats routes SHALL render the same application header, 20px horizontal content inset, and white 20px-radius surface card treatment used by the Home route. Their primary titles and data SHALL use the Home route's 18px ink hierarchy, and their notices, detail text, tables, and buttons SHALL use the Home route's 13px or 14px ink or muted hierarchy. The presentation SHALL preserve each route's existing loading, empty, error, list, chart, and table states.

#### Scenario: Render history presentation
- **WHEN** the router renders `/history` in any history state
- **THEN** the page renders the application header and its state content within the main-route inset and surface card

#### Scenario: Render aligned text hierarchy
- **WHEN** the router renders `/history` or `/stats`
- **THEN** primary text uses the ink hierarchy and secondary text, notices, tables, and buttons use the existing ink or muted hierarchy without introducing a new text color

#### Scenario: Render stats presentation
- **WHEN** the router renders `/stats` in any stats state
- **THEN** the page renders the application header and its state content within the main-route inset and surface card

<!-- @trace
source: fix-bottom-tab-view
updated: 2026-07-29
code:
  - scripts/test-tool.html
  - scripts/test-tool.mjs
  - src/components/BottomNavigation.vue
  - src/router/index.ts
  - src/views/NotificationsView.vue
  - src/views/HomeView.vue
  - src/views/HistoryView.vue
  - src/views/StatsView.vue
  - docs/mqtt-interfaces-and-firestore-models.md
  - src/views/SettingsView.vue
  - src/App.vue
tests:
  - src/router/index.spec.ts
  - src/views/HomeView.spec.ts
  - src/components/BottomNavigation.spec.ts
  - src/App.spec.ts
  - src/views/SettingsView.spec.ts
  - src/components/ShellAccessibility.spec.ts
  - src/views/StatsView.spec.ts
  - src/views/HistoryView.spec.ts
  - src/views/NotificationsView.spec.ts
-->