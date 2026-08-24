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
### Requirement: Firebase-native production sign-in methods

The Web sign-in view SHALL expose exactly a Google provider control and an Email Link request form. It MUST NOT expose an Email password field, password registration, password reset, Apple sign-in, Google One Tap, anonymous sign-in, provider linking, or account merge controls. A first successful Google or Email Link authentication SHALL create a Firebase User through the Firebase Web SDK, and an existing Firebase User SHALL resume the UID returned by Firebase Authentication.

#### Scenario: Render the first-release sign-in surface

- **WHEN** a signed-out visitor opens `/sign-in`
- **THEN** the view displays `使用 Google 繼續`, one Email field, and one Email Link send control
- **AND** the view displays no password or Apple control

#### Scenario: Avoid unsupported identity flows

- **WHEN** a visitor inspects or activates every sign-in control
- **THEN** the application invokes neither Google Identity Services One Tap nor an Apple, password, anonymous, linking, or merge operation

### Requirement: Google popup sign in

The authentication provider SHALL create a Firebase `GoogleAuthProvider` without additional OAuth scopes and SHALL call `signInWithPopup` on the existing Firebase Auth instance only from direct activation of the Google control. Successful popup authentication SHALL publish session state only through the existing Firebase observer. Popup cancellation, blocking, provider collision, and provider rejection MUST keep the visitor signed out and MUST expose a neutral failure message without a raw Firebase error, provider token, Email address, or existing-provider name.

#### Scenario: Complete Google popup sign in

- **WHEN** a visitor directly activates the Google control and Firebase popup authentication succeeds for UID `member-001`
- **THEN** the existing auth observer publishes `signed-in` for `member-001`
- **AND** the visitor reaches the allowlisted post-sign-in route

#### Scenario: Handle a blocked popup

- **WHEN** the browser blocks the Google popup
- **THEN** the visitor remains on `/sign-in` with a retryable neutral error
- **AND** no raw provider error or identity detail is rendered

#### Scenario: Handle a provider collision

- **WHEN** Firebase rejects Google authentication because the identity belongs to another sign-in method
- **THEN** the view instructs the visitor to use the original sign-in method without naming that method or merging Firebase Users

### Requirement: Passwordless Email Link request

The Email Link form SHALL trim the submitted Email, SHALL reject an empty value or a value longer than 254 characters before calling Firebase, and SHALL call `sendSignInLinkToEmail` with `handleCodeInApp: true`. The action URL SHALL target `/auth/email-link`, SHALL contain only an allowlisted same-application `returnTo`, and MUST NOT contain the Email address. A successful request SHALL show the same confirmation for new and existing identities. Provider errors SHALL be mapped to a neutral send-failure state without exposing account existence or raw Firebase details.

#### Scenario: Send a valid Email Link

- **WHEN** a visitor submits ` member@example.test ` while requesting return path `/stats`
- **THEN** Firebase receives `member@example.test` and an action URL whose callback path is `/auth/email-link` and whose safe return path is `/stats`
- **AND** the action URL contains no Email address

#### Scenario: Reject an invalid Email before Firebase

- **WHEN** a visitor submits an empty Email or a value longer than 254 characters
- **THEN** the view reports invalid input and makes zero Firebase Email Link requests

#### Scenario: Preserve account privacy after sending

- **WHEN** Firebase accepts an Email Link request for either a new or existing identity
- **THEN** the view renders the same link-sent confirmation without identifying whether an account exists

### Requirement: Bounded pending Email Link state

After Firebase accepts an Email Link request, the application SHALL store at most one same-origin record under `peecare:auth:pending-email-link:v1` with exact shape `{ version: 1, email, returnTo, requestedAtMs }`. The record SHALL remain valid only while its age is less than 1,800,000 milliseconds. Reading invalid JSON, an unexpected property, an invalid Email, an unsafe return path, a non-finite timestamp, a future timestamp, or an expired record MUST clear the record and return no pending identity. Storage unavailability MUST NOT prevent link delivery and SHALL force Email re-entry during callback.

#### Scenario: Resolve pending state boundaries

- **WHEN** the application reads a version 1 pending record at a controlled current time
- **THEN** it applies the following results

##### Example: Pending record age table

| Record age | Expected result |
| --- | --- |
| 0 milliseconds | accepted |
| 1,799,999 milliseconds | accepted |
| 1,800,000 milliseconds | cleared as expired |
| future timestamp | cleared as invalid |

#### Scenario: Continue when storage is unavailable

- **WHEN** Firebase sends the link but same-origin storage throws during record creation
- **THEN** the view still renders the link-sent confirmation
- **AND** the callback later requests the matching Email again

### Requirement: Public Email Link callback completion

The router SHALL expose `/auth/email-link` without `requiresAuth`. The callback view MUST call `isSignInWithEmailLink` before completion and MUST call `signInWithEmailLink` only with the matching pending or re-entered Email and the current link URL. It SHALL never infer signed-in state from the pending record. Protected content MUST remain hidden until the Firebase observer reports a signed-in User. Successful completion SHALL clear pending state and navigate through the existing safe return-route resolver. Invalid, expired, consumed, or wrong-Email links SHALL clear unsafe or consumed state, keep the visitor signed out, and present a neutral retry path back to `/sign-in`.

#### Scenario: Complete on the requesting browser

- **WHEN** `/auth/email-link` receives a valid Firebase Email Link and a matching unexpired pending record for return path `/history`
- **THEN** the provider completes Firebase authentication, clears the pending record, and navigates to `/history` after the observer reports signed-in

#### Scenario: Complete on another device

- **WHEN** `/auth/email-link` receives a valid Firebase Email Link without pending state
- **THEN** the callback asks the visitor to re-enter the destination Email
- **AND** it completes authentication only when Firebase accepts that Email with the current link

#### Scenario: Reject a non-Email-Link URL

- **WHEN** a signed-out visitor opens `/auth/email-link` with a URL that Firebase does not identify as an Email Link
- **THEN** the application makes zero completion calls, renders no protected content, and offers a return to `/sign-in`

### Requirement: First-release identity boundary

The Web application SHALL keep Firebase `request.auth.uid` as the sole member identity and SHALL NOT automatically link, unlink, merge, or migrate identities or device ownership. Development authentication configuration MUST disallow duplicate Email accounts. When Firebase cannot reconcile a Google or Email Link identity with an existing Firebase User, the application SHALL stop with a neutral original-method instruction rather than mutating either User.

#### Scenario: Preserve an existing owner UID

- **WHEN** Firebase completes Google or Email Link authentication as UID `member-001`
- **THEN** every protected repository and API continues to authorize only as `member-001`
- **AND** the application performs no ownership migration

#### Scenario: Refuse automatic account merge

- **WHEN** Firebase reports that a credential is already associated with another Firebase User
- **THEN** the application leaves both Users unchanged and instructs the visitor to use the original sign-in method

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
