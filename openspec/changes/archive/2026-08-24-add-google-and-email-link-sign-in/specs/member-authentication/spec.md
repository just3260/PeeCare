## ADDED Requirements

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
