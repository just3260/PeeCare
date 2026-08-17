## MODIFIED Requirements

### Requirement: Local server-side development secret boundary

In `development-cloud` profile, the local test-tool server SHALL receive the Ingestion credential from exactly one validated operator credential provider: an authenticated personal gcloud session accessing an exact positive numeric version of the fixed development Ingestion secret in project `petcare-c7483`, or the existing configured operator-only secret file. The gcloud provider MUST invoke gcloud without a shell, MUST reject service-account identity, foreign or unset project, inherited service-account key or Emulator configuration, nonnumeric version, and unexpected output before listening, and MUST keep the resolved credential only in process memory. The file provider MUST preserve the existing owner-only file validation. The server SHALL inject the credential only for the approved Ingestion event operation. The secret MUST NOT appear in the executable, HTML, sanitized configuration response, DOM, browser request, localStorage, curl preview, proxy response, command arguments, environment, filesystem output, standard output, standard error, or structured test-tool log. Missing, invalid, ambiguous, inaccessible, empty, or malformed credential input and invalid cloud origins MUST fail before the server starts listening.

#### Scenario: Inject a gcloud-resolved credential server-side

- **WHEN** an authorized personal operator starts development-cloud mode with one exact numeric secret version and the browser submits an approved development event without an Authorization header
- **THEN** the server SHALL add the in-memory credential to the single approved upstream request, return a response containing no credential material, and clear the credential when the server closes

#### Scenario: Preserve the owner-only file provider

- **WHEN** development-cloud mode starts with one valid owner-only secret file and no gcloud secret-version option
- **THEN** the server SHALL preserve the existing file validation and approved event injection behavior without invoking gcloud

#### Scenario: Reject an unsafe gcloud boundary before listening

- **WHEN** gcloud is unavailable or unauthenticated, the active identity is absent, multiple, or a service account, the project is not `petcare-c7483`, the secret version is not a positive integer, Secret Manager access fails, or the resolved value is invalid
- **THEN** startup SHALL exit non-zero before binding the loopback port, SHALL clear captured credential buffers, and SHALL NOT print raw gcloud output, identity data, invalid values, or secret material

#### Scenario: Reject ambiguous credential providers before listening

- **WHEN** development-cloud mode receives both a secret-version option and a secret-file option or receives neither
- **THEN** startup SHALL fail with `invalid_arguments` before invoking gcloud, reading a secret file, binding the loopback port, or opening the browser

#### Scenario: Preserve local profile isolation

- **WHEN** local profile starts without credential options
- **THEN** it SHALL preserve the existing loopback Emulator workflow and SHALL perform no gcloud or Secret Manager operation
