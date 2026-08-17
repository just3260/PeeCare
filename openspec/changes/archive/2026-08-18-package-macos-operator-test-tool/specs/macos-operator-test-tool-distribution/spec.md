## ADDED Requirements

### Requirement: Architecture-specific self-contained macOS artifacts

The distribution SHALL produce exactly one arm64 Mach-O executable named `peecare-test-tool-macos-arm64` and exactly one x64 Mach-O executable named `peecare-test-tool-macos-x64`. Each executable MUST contain the operator launcher, the test-tool server, `test-tool.html`, `machine.png`, and `dog.png` without requiring adjacent application assets or an installed Node.js runtime. The distribution MUST NOT produce or publish a universal Mach-O.

#### Scenario: Run without Node or adjacent assets

- **WHEN** an operator launches the native artifact on a clean qualified Mac with Node.js absent and no adjacent HTML or PNG files
- **THEN** the executable SHALL serve the existing HTML and image routes with byte-identical assets and SHALL expose the existing test-tool behavior on loopback

#### Scenario: Reject a universal or wrong-architecture artifact

- **WHEN** build verification inspects an artifact containing more than one Mach-O architecture or an architecture that differs from its declared artifact name
- **THEN** verification SHALL fail before signing and SHALL produce no release record

### Requirement: Secure macOS runtime floor and native execution

The launcher SHALL require macOS 14.8.8 or later for arm64 and macOS 14.6.0 or later for x64. The build manifest MUST pin `minimumMacOS` inside each architecture entry, and each SEA artifact MUST embed only its selected architecture and matching floor. The launcher SHALL validate the native hardware architecture and compare the system version with that embedded floor before any gcloud, Secret Manager, listener, or browser operation. It SHALL accept exactly two or three decimal numeric components from `/usr/bin/sw_vers -productVersion`, SHALL normalize a two-component value by appending a zero patch component for comparison, and MUST reject every other shape as `unsupported_macos`. An x64 artifact running through translation on Apple Silicon MUST be rejected.

#### Scenario: Enforce the macOS patch boundary

- **WHEN** the system version is evaluated during launcher preflight
- **THEN** the launcher SHALL apply the following boundary results before invoking gcloud or binding a port

##### Example: macOS version boundary table

| Artifact architecture | System version | Expected result |
| --- | --- | --- |
| arm64 | `14.8.7` | `unsupported_macos` |
| arm64 | `14.8.8` | accepted |
| arm64 | `14.8.9` | accepted |
| arm64 | `14.8` | `unsupported_macos` after normalization to `14.8.0` |
| x64 | `14.5.9` | `unsupported_macos` |
| x64 | `14.6` | accepted after normalization to `14.6.0` |
| x64 | `14.6.0` | accepted |
| x64 | `14.6.1` | accepted |
| either | `15.0` | accepted after normalization to `15.0.0` |
| either | `15.0.0` | accepted |
| either | `26.4` | accepted after normalization to `26.4.0` |
| either | one-component, four-component, nonnumeric, empty, unavailable, or nonzero command result | `unsupported_macos` |

#### Scenario: Reject translated x64 execution

- **WHEN** `peecare-test-tool-macos-x64` is started through Rosetta on Apple Silicon
- **THEN** the launcher SHALL exit with `architecture_mismatch` before resolving an identity, reading a secret, or listening

### Requirement: Deterministic pinned SEA build

The build SHALL use a manifest that pins the exact Node.js 22.23.2 version, approved Node archive URL and SHA-256 for each architecture, architecture-specific `minimumMacOS` values of `14.8.8` for arm64 and `14.6.0` for x64, CommonJS bundler version and package-lock integrity, resource-injection package version and integrity, asset inventory, and output name. The manifest MUST NOT define a root-level fallback minimum. Repository application sources SHALL remain ESM, while the build MUST produce one deterministic CommonJS SEA entry compatible with the Node.js 22.23.2 preparation-blob execution path. The generated entry MUST use only Node built-ins, MUST NOT require adjacent JavaScript modules or source maps at runtime, and MUST preserve source-mode CLI, asset, credential, and lifecycle behavior. The build MUST disable SEA snapshot and code cache and MUST reject mutable, foreign, unverified, or inconsistent inputs before resource injection.

#### Scenario: Build from verified inputs

- **WHEN** the build receives a matching official Node archive whose SHA-256 equals the architecture manifest and all three declared assets pass privacy scanning
- **THEN** it SHALL produce the declared single-architecture staging executable and a sanitized manifest hash

#### Scenario: Bundle ESM sources for the pinned Node SEA loader

- **WHEN** the build prepares the operator and server ESM sources for Node.js 22.23.2 SEA injection
- **THEN** it SHALL use the package-lock-pinned bundler to produce one CommonJS entry with no source map or filesystem-relative runtime dependency, and the injected executable SHALL launch without adjacent JavaScript modules

#### Scenario: Reject input drift

- **WHEN** a Node archive hash, Node version, resource-injection integrity, asset key, output architecture, architecture-specific minimum macOS value, or embedded architecture/floor pair differs from the pinned manifest
- **THEN** the build SHALL exit non-zero before signing and SHALL NOT reuse a previously staged executable

### Requirement: Personal gcloud identity and in-memory secret acquisition

In `development-cloud` profile, the executable SHALL support an exact positive numeric Secret Manager version through an operator-installed gcloud CLI. It MUST invoke gcloud without a shell, require exactly one active personal identity and configured project `petcare-c7483`, reject service-account identity and inherited key-file or Emulator configuration, access only the fixed development Ingestion secret and requested numeric version, and keep the resolved value only in process memory.

#### Scenario: Resolve an approved numeric version

- **WHEN** an authorized personal operator starts development-cloud mode with `--secret-version 7`, exactly one active gcloud identity, and project `petcare-c7483`
- **THEN** the provider SHALL request version `7` of the fixed development Ingestion secret, inject its validated value only into the approved event request, and clear the value during shutdown

#### Scenario: Reject unsafe identity or target

- **WHEN** gcloud is absent, unauthenticated, has multiple active identities, uses a service-account identity, has an unset or foreign project, or the process inherits a service-account key or Firebase Emulator variable
- **THEN** startup SHALL emit the applicable sanitized stable code and SHALL perform zero Secret Manager access, listener bind, and browser open operations

#### Scenario: Reject nonnumeric secret selection

- **WHEN** development-cloud mode receives a missing, zero, negative, nonnumeric, or `latest` secret version
- **THEN** startup SHALL fail with `secret_version_invalid` before invoking Secret Manager or listening

### Requirement: Exclusive credential provider selection

Development-cloud startup SHALL accept exactly one credential source: `--secret-version <positive integer>` for the gcloud provider or `--secret-file <absolute path>` for the existing owner-only file provider. Local profile MUST reject both credential options and MUST perform no gcloud operation.

#### Scenario: Use the explicit file fallback

- **WHEN** an operator starts development-cloud mode with one valid owner-only secret file and no secret-version argument
- **THEN** the launcher SHALL preserve the existing file validation and approved event injection behavior without invoking gcloud

#### Scenario: Reject ambiguous or irrelevant credential input

- **WHEN** development-cloud mode receives both credential options or neither option, or local mode receives either option
- **THEN** the launcher SHALL fail with `invalid_arguments` before reading a file, invoking gcloud, or listening

### Requirement: Safe loopback and browser lifecycle

The executable SHALL listen only on `127.0.0.1`. Without an explicit port it SHALL try port `5055`, retry exactly once with an operating-system-assigned loopback port only after an address-in-use result, derive the final URL from the bound address, and invoke `/usr/bin/open` without a shell after listening. Shutdown and all startup failures MUST clear credential state and close every listener.

#### Scenario: Fall back from the default port

- **WHEN** port `5055` is already in use and no explicit port was supplied
- **THEN** the launcher SHALL bind one operating-system-assigned loopback port, print only the resulting safe loopback URL, and open that URL

#### Scenario: Continue after browser-open failure

- **WHEN** the loopback server is listening and `/usr/bin/open` fails
- **THEN** the launcher SHALL emit `browser_open_failed`, print the safe loopback URL, keep the server available, and disclose no credential or identity data

#### Scenario: Clear state during termination

- **WHEN** the process receives SIGINT or SIGTERM or the server closes normally
- **THEN** it SHALL close the listener, clear the secret holder, and exit without creating a residual secret file or background process

### Requirement: Signed notarized and privacy-safe release evidence

The release verifier SHALL require each release executable to have a valid Developer ID Application signature, Hardened Runtime, secure timestamp, accepted Apple notarization, Gatekeeper execution assessment, SHA-256 checksum, and secret-free architecture qualification record. Unsigned, ad-hoc-signed, unnotarized, privacy-positive, or failed-assessment artifacts MUST NOT be releasable. This change SHALL implement validation only and MUST NOT perform live signing, notarization, native qualification, record generation from live checks, checksum publication, or artifact distribution.

#### Scenario: Produce a sanitized architecture record

- **WHEN** one native artifact passes build inspection, signing, notarization, Gatekeeper, privacy scan, and native-host smoke
- **THEN** verification SHALL emit a record containing only schema version, application version, architecture, the minimum macOS value matching that architecture's build-manifest entry, Node version, input manifest hash, executable SHA-256, signature team identifier, notarization submission identifier, qualification host architecture/version, verification time, and named check statuses

#### Scenario: Block a partial paired release

- **WHEN** either arm64 or x64 lacks a native healthy qualification record with the same source and build-manifest hash
- **THEN** the paired release SHALL fail and SHALL publish neither executable as a complete operator-tool release
