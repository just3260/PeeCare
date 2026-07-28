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

The application SHALL use Vue Router with HTML5 history. It SHALL register the root route and SHALL redirect unsupported paths to the root route. Navigation entries for history, devices, and notifications MUST remain non-interactive and expose `aria-disabled="true"` until their capabilities are implemented.

#### Scenario: Open the root route

- **WHEN** a visitor navigates to `/`
- **THEN** Vue Router SHALL render the home application shell

#### Scenario: Recover from an unsupported route

- **WHEN** a visitor navigates to `/unknown-path`
- **THEN** Vue Router SHALL redirect to `/` and render the home application shell

#### Scenario: Expose disabled future navigation

- **WHEN** assistive technology inspects the history, devices, and notifications navigation entries
- **THEN** each entry SHALL expose `aria-disabled="true"` and SHALL NOT change the current route when activated

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
