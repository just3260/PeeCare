# member-authentication Specification

## Purpose

TBD - created by archiving change 'establish-member-authentication'. Update Purpose after archive.

## Requirements

### Requirement: Authoritative authentication state

The Web app SHALL derive member session state from Firebase Authentication and SHALL expose exactly `loading`, `signed-out`, or `signed-in`. It SHALL NOT infer authentication from local storage or route state.

#### Scenario: Resolve an authenticated user
- **WHEN** the Firebase observer returns a user with UID `member-001`
- **THEN** the store enters signed-in state for `member-001`

#### Scenario: Resolve no user
- **WHEN** the Firebase observer returns null
- **THEN** the store enters signed-out state


<!-- @trace
source: establish-member-authentication
updated: 2026-07-29
code:
  - src/features/auth/auth-provider.ts
  - src/features/auth/auth-store.ts
  - src/features/auth/auth-store-key.ts
  - src/views/SignInView.vue
  - src/App.vue
  - src/features/auth/session.ts
  - vitest.config.ts
  - src/router/index.ts
  - src/features/auth/return-route.ts
  - vitest.firebase.config.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
tests:
  - src/views/SignInView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
-->

---
### Requirement: Protected member navigation

Protected routes SHALL wait for the initial authentication result and SHALL redirect signed-out users to `/sign-in` without rendering protected content.

#### Scenario: Block a signed-out visitor
- **WHEN** a signed-out visitor opens a protected route
- **THEN** the router displays the sign-in view and no protected device content


<!-- @trace
source: establish-member-authentication
updated: 2026-07-29
code:
  - src/features/auth/auth-provider.ts
  - src/features/auth/auth-store.ts
  - src/features/auth/auth-store-key.ts
  - src/views/SignInView.vue
  - src/App.vue
  - src/features/auth/session.ts
  - vitest.config.ts
  - src/router/index.ts
  - src/features/auth/return-route.ts
  - vitest.firebase.config.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
tests:
  - src/views/SignInView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
-->

---
### Requirement: Provider-neutral sign in

The sign-in view SHALL invoke an injected authentication provider and SHALL display a non-sensitive failure state when the provider rejects authentication.

#### Scenario: Complete local sign in
- **WHEN** the local provider authenticates a test member through the Auth Emulator
- **THEN** the app enters signed-in state and opens the protected shell

#### Scenario: Report sign-in failure
- **WHEN** the provider rejects authentication
- **THEN** the app remains signed out and does not expose credential details


<!-- @trace
source: establish-member-authentication
updated: 2026-07-29
code:
  - src/features/auth/auth-provider.ts
  - src/features/auth/auth-store.ts
  - src/features/auth/auth-store-key.ts
  - src/views/SignInView.vue
  - src/App.vue
  - src/features/auth/session.ts
  - vitest.config.ts
  - src/router/index.ts
  - src/features/auth/return-route.ts
  - vitest.firebase.config.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
tests:
  - src/views/SignInView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
-->

---
### Requirement: Session termination

The app SHALL terminate Firebase Authentication state on sign-out, stop registered protected-data subscriptions, and redirect to `/sign-in`. The sign-out control SHALL be presented in the account section of the settings page.

#### Scenario: Sign out a member

- **WHEN** a signed-in member selects sign out
- **THEN** the Firebase session ends, protected subscriptions stop, and protected routes become inaccessible

#### Scenario: Reach sign out from settings

- **WHEN** a signed-in member opens the settings page
- **THEN** the account section SHALL present a sign-out control that terminates the session when activated


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
### Requirement: Single authentication lifecycle

The app SHALL obtain Auth from the existing Firebase service adapter, SHALL start at most one authentication observer for the mounted application, and SHALL detach that observer when the auth store is disposed. It SHALL NOT initialize a second Firebase app.

#### Scenario: Mount and dispose the auth store
- **WHEN** the auth store is mounted, requested twice, and then disposed
- **THEN** one observer is active before disposal and zero observers remain afterward


<!-- @trace
source: establish-member-authentication
updated: 2026-07-29
code:
  - src/features/auth/auth-provider.ts
  - src/features/auth/auth-store.ts
  - src/features/auth/auth-store-key.ts
  - src/views/SignInView.vue
  - src/App.vue
  - src/features/auth/session.ts
  - vitest.config.ts
  - src/router/index.ts
  - src/features/auth/return-route.ts
  - vitest.firebase.config.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
tests:
  - src/views/SignInView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
-->

---
### Requirement: Protected resource teardown

The app SHALL dispose every registered protected listener and pending resource before publishing a signed-out state or a different signed-in UID.

#### Scenario: Change authenticated UID
- **WHEN** authentication changes from `member-001` to `member-002`
- **THEN** all resources registered by `member-001` are disposed before `member-002` protected content is rendered


<!-- @trace
source: establish-member-authentication
updated: 2026-07-29
code:
  - src/features/auth/auth-provider.ts
  - src/features/auth/auth-store.ts
  - src/features/auth/auth-store-key.ts
  - src/views/SignInView.vue
  - src/App.vue
  - src/features/auth/session.ts
  - vitest.config.ts
  - src/router/index.ts
  - src/features/auth/return-route.ts
  - vitest.firebase.config.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
tests:
  - src/views/SignInView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
-->

---
### Requirement: Safe post-sign-in return route

The app SHALL preserve only an allowlisted same-application absolute path as a post-sign-in destination. It MUST reject external URLs, protocol-relative URLs, backslash variants, and the sign-in route itself and SHALL fall back to `/`.

#### Scenario: Reject an external return target
- **WHEN** the sign-in route receives `returnTo=https://example.test/steal`
- **THEN** successful sign-in navigates to `/`

<!-- @trace
source: establish-member-authentication
updated: 2026-07-29
code:
  - src/features/auth/auth-provider.ts
  - src/features/auth/auth-store.ts
  - src/features/auth/auth-store-key.ts
  - src/views/SignInView.vue
  - src/App.vue
  - src/features/auth/session.ts
  - vitest.config.ts
  - src/router/index.ts
  - src/features/auth/return-route.ts
  - vitest.firebase.config.ts
  - src/features/auth/protected-resource-registry.ts
  - src/main.ts
tests:
  - src/views/SignInView.spec.ts
  - src/features/auth/auth-emulator.integration.spec.ts
  - src/features/auth/return-route.spec.ts
  - src/features/auth/protected-resource-registry.spec.ts
  - src/router/auth-guard.spec.ts
  - src/features/auth/auth-store.spec.ts
  - src/App.auth.spec.ts
-->