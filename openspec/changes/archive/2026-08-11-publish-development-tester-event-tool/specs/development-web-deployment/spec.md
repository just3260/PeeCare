## ADDED Requirements

### Requirement: Verified Test Tool API origin handoff

A development Web build that includes the tester event tool SHALL require a healthy Test Tool API release record and SHALL inject its exact approved HTTPS origin through `VITE_TEST_TOOL_API_URL`. The build MUST reject a missing, loopback, HTTP, credential-bearing, path-bearing, wrong-project, unverified, or stale API origin before Hosting upload.

#### Scenario: Build with a healthy Test Tool API release

- **WHEN** the release record identifies a healthy immutable `peecare-test-tool-development` revision in `petcare-c7483` and provides its exact HTTPS origin
- **THEN** the Web build SHALL bind the protected test-tool adapter to that origin and SHALL contain no Emulator or loopback endpoint

#### Scenario: Reject an unverified API origin

- **WHEN** `VITE_TEST_TOOL_API_URL` is missing or does not match the healthy release record for the approved service and project
- **THEN** the Web deployment SHALL exit before build artifact upload

### Requirement: Protected development test-tool route

The development Web app SHALL expose `/test-tool` only as an authenticated route, SHALL use the existing Firebase authentication lifecycle, and SHALL load tester devices and submit events only through the configured Test Tool API adapter. The route SHALL NOT initialize another Firebase app, display an independent sign-in form, or expose generic proxy settings.

#### Scenario: Reload the tester tool as an authenticated member

- **WHEN** an authenticated development tester directly loads or reloads `/test-tool`
- **THEN** Firebase Hosting SHALL serve the application shell, the router SHALL preserve `/test-tool`, and the tool SHALL use the existing authenticated session

#### Scenario: Open the tester tool while signed out

- **WHEN** a signed-out visitor directly loads `/test-tool`
- **THEN** the route guard SHALL redirect to `/sign-in` without rendering tester devices, event forms, or prior tester results

#### Scenario: Exclude the tester tool from non-development configuration

- **WHEN** a Web build does not explicitly select the approved development environment and verified Test Tool API release
- **THEN** the build SHALL fail closed and SHALL NOT publish a functional tester tool route

### Requirement: Test-tool member data cache exclusion

The service worker SHALL NOT cache Test Tool API requests, responses, eligible-device data, event results, Firebase ID tokens, or tester form state. Signing out and reopening the app offline MUST NOT display any prior tester device, measurements, event identifier, or outcome.

#### Scenario: Sign out after submitting a test event

- **WHEN** a tester submits an event, signs out, goes offline, and reloads `/test-tool`
- **THEN** the shell SHALL route to sign-in and SHALL display no cached tester device, form values, event identifier, sequence, or result

#### Scenario: Inspect Cache Storage after tester use

- **WHEN** verification inspects all service-worker cache entries after device listing and event submission
- **THEN** no entry SHALL target the Test Tool API origin or contain tester device or event-result markers
