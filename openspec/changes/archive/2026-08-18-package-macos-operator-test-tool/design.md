## Context

`scripts/test-tool.mjs` currently serves `scripts/test-tool.html`, `scripts/machine.png`, and `scripts/dog.png` from adjacent files and listens only on `127.0.0.1`. Its `local` profile forwards only to loopback services; its `development-cloud` profile fixes the approved Web, Ingestion, and Member origins and reads the Ingestion credential from an operator-owned mode-0600 file. The browser never receives that credential.

Internal operators use both Apple Silicon and Intel Macs. They may install and authenticate the Google Cloud CLI, but should not need to install Node.js or copy four source assets. This change therefore preserves the existing proxy boundary while adding architecture-specific SEA staging artifacts, an identity-aware Secret Manager retrieval path, and a fail-closed verifier for release evidence produced outside this change.

The selected runtime floors are architecture-specific: macOS Sonoma 14.8.8 for arm64 and macOS Sonoma 14.6.0 for x64. Node.js 22 official binaries support both architectures below those application floors. The x64 exception extends the tool to the required native Intel environment, while the arm64 policy remains unchanged. Because the executable resolves a shared development credential, the lower x64 floor remains explicit release metadata. Actual native proof of that floor is deferred, so both staging artifacts remain qualification-pending and unreleasable at the end of this change.

## Goals / Non-Goals

**Goals:**

- Produce one self-contained arm64 executable and one self-contained x64 executable from pinned, checksum-verified Node.js 22 SEA inputs.
- Preserve all existing local and development-cloud UI, preview, health, device registry, event, naming, sequence, allowlist, redaction, and loopback behavior.
- Allow a development-cloud operator to use an authenticated personal gcloud session and an exact numeric Secret Manager version without creating a persistent ingestion secret file.
- Reject arm64 macOS versions below 14.8.8, x64 macOS versions below 14.6.0, architecture mismatch or translation, foreign project configuration, unauthenticated or service-account gcloud identity, nonnumeric secret versions, and unsafe inherited credential settings before listening.
- Add deterministic build metadata, SHA-256 checksums, privacy scans, stable failure codes, and a verifier for sanitized release records.
- Keep staging artifacts unreleasable unless a later workflow supplies complete Developer ID, notarization, Gatekeeper, privacy, and architecture-exact qualification evidence.

**Non-Goals:**

- Do not create a universal/fat Mach-O, Electron application, App Store package, Windows/Linux executable, automatic updater, background daemon, launch agent, or mobile app.
- Do not bundle gcloud, Google credentials, ingestion secret values, service-account keys, Firebase credentials, or tester identities.
- Do not grant IAM, create or rotate Secret Manager versions, authenticate gcloud, provision devices, or change the existing Cloud Run services.
- Do not expose a non-loopback listener, generic remote proxy, new HTTP route, or new browser credential channel.
- Do not replace the hosted authenticated `/test-tool` route for beta testers.
- Do not execute Developer ID signing, Apple notarization, native Apple Silicon or Intel qualification, live development-cloud smoke, checksum-index publication, or operator distribution in this change.
- Do not mark either staging artifact releasable; a later change must own external evidence generation and publication.

## Decisions

### Architecture-specific macOS runtime floors

The build manifest will place `minimumMacOS` inside each architecture entry: `14.8.8` for arm64 and `14.6.0` for x64. The SEA build will embed only the selected architecture and its matching floor in the runtime manifest. The launcher will resolve the host version with the fixed system executable `/usr/bin/sw_vers`, accept exactly two or three decimal numeric components, normalize a two-component value by appending a zero patch component, and compare it with the embedded architecture floor before configuration, gcloud, Secret Manager, or server work. Thus x64 `14.6` normalizes to `14.6.0` and is accepted, arm64 `14.8` normalizes to `14.8.0` and remains rejected, while `15.0` and `26.4` remain accepted for both architectures. One-component, four-component, empty, nonnumeric, missing, or nonzero `sw_vers` output fails closed.

The SEA Mach-O deployment target remains macOS 14 so the binary format matches both supported floors, while the application-level runtime gate enforces the embedded architecture policy. This separates link compatibility from the security policy and permits either architecture floor to be raised through a reviewed manifest change without redesigning the launcher.

Keeping one root-level floor was rejected because lowering it to 14.6.0 would unintentionally lower the arm64 policy, while keeping it at 14.8.8 would exclude the required Intel host. Selecting macOS 11 would match Node.js 22's technical minimum but would authorize a substantially older system to resolve a shared secret. Selecting macOS 15 would exclude Intel Macs without enabling required tool behavior.

### Two independently signed SEA artifacts

The build produces exactly `peecare-test-tool-macos-arm64` and `peecare-test-tool-macos-x64`. It never uses `lipo` to merge them. Each output starts from the matching official Node.js 22 archive named in `scripts/test-tool-macos-build.json`; the manifest pins the exact Node version, archive URL, archive SHA-256, architecture-specific `minimumMacOS`, resource-injection package version/integrity, asset list, and output name. Both artifacts retain the same complete input manifest hash even though their embedded runtime manifests contain different floors.

The repository operator and server sources remain ESM. Before generating the SEA preparation blob, the build uses the exact esbuild version and integrity pinned in `package-lock.json` to bundle those sources into one deterministic CommonJS entry. This packaging-only format boundary is required because Node.js 22.23.2 loads a preparation-blob entry through its CommonJS execution path; injecting the ESM bundle directly fails before launcher preflight. The generated bundle may import only Node built-ins, must not contain a source map or filesystem-relative runtime dependency, and must preserve the same CLI, asset-provider, secret, and lifecycle behavior as source execution.

The build verifies every downloaded or supplied Node archive before extraction, rejects redirects to an unapproved host, validates the pinned bundler input, disables SEA snapshot and code cache, injects the bundled CommonJS entry and assets, and proves with Mach-O inspection that the output contains exactly one expected architecture. The injected Node binary and preparation blob must use the same exact Node version.

Node SEA is preferred over Electron because the tool already has a browser UI and uses only Node built-ins; Electron would duplicate browser/runtime lifecycle and substantially enlarge the signed surface. It is preferred over archived standalone packagers because SEA provides a Node-owned asset API and runtime boundary. The x64 SEA path remains a release-blocking spike because upstream SEA CI does not regularly qualify macOS x64 even though Node.js x64 itself is supported.

### Embedded assets preserve source execution

`loadAssets` will depend on one deep asset provider with two implementations:

- source mode reads the existing adjacent HTML and PNG files;
- SEA mode reads the three named assets through `node:sea` and validates that HTML is nonempty UTF-8 and images are nonempty byte arrays.

The HTTP server receives the resolved immutable assets and retains the exact current routes, content types, and cache behavior. The provider hides storage differences rather than creating wrappers around each asset. Deleting it would break both source-mode regression and self-contained SEA serving, which makes the seam substantive.

The build includes only the launcher bundle and the three declared assets. It rejects an unexpected asset key, absent declared asset, source map, environment file, credential-like filename, test fixture, or secret-like byte pattern.

### GcloudSecretProvider keeps secret in memory

The operator launcher owns a single credential provider for development-cloud mode. It invokes an absolute or explicitly resolved `gcloud` executable without a shell and exposes only these operations internally: inspect version, resolve exactly one active account, inspect the configured project, and access one exact numeric version of the fixed development ingestion secret in `petcare-c7483`.

The launcher rejects `GOOGLE_APPLICATION_CREDENTIALS`, Firebase Emulator variables, an absent or multiple active account result, an active service-account identity, a foreign or unset gcloud project, a nonnumeric or zero secret version, and any unexpected gcloud output shape. The secret version is a required non-secret CLI argument in development-cloud mode. The provider executes the fixed equivalent of a Secret Manager version access with captured stdout/stderr; it never uses the `latest` alias, a shell, user-selected secret name/project, or inherited output formatting.

The resolved value must be one visible-ASCII line from 1 through 512 bytes. It is placed in a private secret holder that exposes callback-scoped access only to the approved event request builder and supports explicit clear on startup failure, signal shutdown, server close, or normal exit. This permits multiple operator event submissions during one process without placing the value on a general configuration object. Raw gcloud stdout/stderr, active account, access token, and resolved secret are never returned to the browser or written to logs. Stable sanitized codes identify the failed stage.

The existing owner-only secret file provider remains available only when explicitly selected with `--secret-file`; development-cloud startup accepts exactly one of `--secret-version` or `--secret-file`. This preserves emergency/source compatibility without allowing ambiguous precedence. Local profile accepts neither and does not invoke gcloud.

Using macOS Keychain was rejected for the first release because it still requires a separate secret provisioning/rotation channel and creates architecture-independent but platform-specific storage migration work. Resolving a numeric version through each operator's gcloud identity preserves individual IAM revocation and Secret Manager auditability.

### Loopback launcher owns port and browser lifecycle

The executable CLI supports:

- `--profile local|development-cloud`, defaulting to `development-cloud`;
- exactly one of `--secret-version <positive integer>` or `--secret-file <absolute path>` for development-cloud;
- optional `--port <1..65535>`;
- optional `--no-open` for automated smoke only.

Without `--port`, the launcher first attempts 5055 and, only for an address-in-use result, retries once with an operating-system-assigned loopback port. It derives the final URL from the bound server address rather than the requested value. Any non-loopback address, repeated bind failure, or non-TCP server address fails closed.

After the server is listening, the launcher invokes `/usr/bin/open` without a shell and passes only the derived loopback URL. A browser-open failure produces a sanitized warning and prints the safe loopback URL while leaving the server running. Startup messages expose only status, profile, version, architecture, and loopback URL. SIGINT, SIGTERM, server error, and normal shutdown close the listener and clear the secret holder.

The launcher validates native hardware architecture against its validated embedded build manifest and refuses an x64 artifact translated on Apple Silicon. This prevents future release evidence from treating Rosetta execution as native Intel qualification.

### Release gate binds signing notarization and real-architecture qualification

Build outputs are staging artifacts only. The build removes the upstream Node signature after checksum verification and resource injection, then applies only the staging signature required for local SEA inspection. A separate protected release workflow may later apply Developer ID Application signing, Hardened Runtime, a secure timestamp, and Apple notarization. This change neither accepts signing/notary credentials nor submits artifacts to Apple services.

The release verifier checks the signed executable hash, architecture, architecture-specific minimum OS manifest, embedded asset inventory, absence of secrets and environment files, Developer ID signature, Hardened Runtime, notarization acceptance, and Gatekeeper execution assessment. It emits one sanitized JSON record per architecture containing schema version, application version, architecture, the matching minimum macOS version, Node version, input manifest hash, executable SHA-256, signature team identifier, notarization submission identifier, qualification host architecture/version, verification time, and named check statuses. It rejects a record whose `minimumMacOS` differs from its architecture entry. It contains no local paths, account names, credentials, tokens, secret versions, secret values, device data, or event payloads.

The verifier retains strict evidence rules for a future release workflow: arm64 evidence must identify native Apple Silicon on macOS 14.8.8 or later, while x64 evidence must identify native Intel on macOS 14.6.x. It rejects Rosetta, emulation, incomplete named checks, newer-only Intel evidence, and mismatched architecture/floor records. Generating those records and executing quarantine, live gcloud, event, signing, notarization, Gatekeeper, and native-host checks are explicitly deferred.

## Implementation Contract

**Behavior:** The repository produces deterministic arm64 and x64 staging executables with embedded architecture-specific floors. When exercised in source or SEA smoke tests, the launcher validates its embedded floor and cloud prerequisites before binding, retrieves the credential only into memory, serves the unchanged tool on loopback, opens the default browser, and clears credential state on shutdown. Local mode performs no gcloud or Secret Manager operation. Neither staging executable is presented as signed, notarized, qualified, published, or operator-ready by this change.

The runtime version preflight accepts only two- or three-component decimal `sw_vers` output. It normalizes a missing patch component to zero solely for comparison; it selects no floor dynamically and trusts only the architecture/floor pair embedded from the validated build manifest.

**Interface / data shape:**

- Root package scripts provide `test-tool:macos:build`, `test-tool:macos:verify`, and `test-tool:macos:release`.
- Build accepts exactly one `--arch arm64|x64` or `--all`; release verification consumes externally produced signed artifacts and sanitized records but performs no signing, notarization, native qualification, or publication itself.
- The executable CLI is the profile/secret/port/no-open interface defined above; unknown, duplicate, conflicting, or positional arguments fail with `invalid_arguments`.
- Stable startup failures include `unsupported_macos`, `architecture_mismatch`, `gcloud_unavailable`, `gcloud_unsupported`, `gcloud_not_authenticated`, `gcloud_identity_invalid`, `project_mismatch`, `secret_version_invalid`, `secret_access_denied`, `secret_value_invalid`, and `port_bind_failed`. `browser_open_failed` is the only nonfatal launcher warning.
- Terminal JSON events contain only `status`, `code`, `profile`, `architecture`, `minimumMacOS`, and optional loopback `url`; fields not applicable to an event are omitted.
- The build manifest stores `minimumMacOS` in each exact `arm64` and `x64` architecture entry; the embedded runtime manifest and release record retain the scalar `minimumMacOS` for their single architecture. Unknown keys, missing floors, root-level fallback floors, duplicate architecture records, mutable Node inputs, unpinned injection tooling, and non-SHA-256 digests fail validation.

**Failure modes:** Every OS, architecture, argument, inherited-environment, gcloud identity/project, and secret prerequisite failure occurs before listen and browser open. Secret retrieval or parsing failure clears captured buffers and emits only a stable code. A port conflict may use one OS-assigned fallback; a second failure is fatal. Browser open failure leaves the already-safe loopback server available. Build checksum, asset scan, signing, notarization, Gatekeeper, or native qualification failure produces no releasable record for that architecture, and failure of either architecture blocks the paired release.

**Acceptance criteria:**

- Unit tests cover version comparison boundaries, argument exclusivity, gcloud spawn arguments, no-shell execution, active-user/project validation, service-account and inherited-key rejection, secret validation/clearing, stable error redaction, port fallback, browser fallback, and signal cleanup.
- Runtime version tests cover arm64 `14.8` and `14.8.7` rejection with `14.8.8` acceptance; x64 `14.5.9` rejection with `14.6` and `14.6.0` acceptance; both architectures accept `15.0`, `15.0.0`, and `26.4` and reject one-component, four-component, and nonnumeric input before gcloud or listen.
- Existing `scripts/test-tool.spec.ts` and `scripts/test-tool-server.spec.ts` pass unchanged behavior assertions in source mode; SEA fixture tests serve byte-identical HTML and image assets without adjacent files.
- Build tests reject wrong hashes, mutable or foreign inputs, unpinned bundler inputs, ESM syntax remaining in the generated CommonJS SEA entry, filesystem-relative runtime dependencies, source maps, snapshots/code cache, unexpected assets, wrong/sliced/universal architecture, unsigned output, privacy findings, and inconsistent manifest/release records.
- `npm run check:release` includes packaging source tests, build-manifest validation, production dependency audit, and secret scan without requiring signing identities or live cloud mutation.
- Verifier fixture tests prove that missing, ad-hoc, unnotarized, privacy-positive, nonnative, incomplete, mismatched-floor, or single-architecture evidence cannot become a paired release.
- `npm run check:release` is the terminal acceptance gate for this change; it passes without signing identities, Apple service access, live cloud mutation, or native qualification hosts.

**Scope boundaries:** In scope are the two qualification-pending macOS staging artifacts, source/SEA asset abstraction, operator launcher, gcloud Secret Manager provider, external file fallback, loopback/browser lifecycle, deterministic build, fail-closed release-evidence validation, tests, and runbook. Out of scope are Developer ID signing, Apple notarization, Gatekeeper acceptance execution, native-host qualification, live development-cloud smoke, healthy record generation, paired checksum publication, operator distribution, other operating systems, universal binary, GUI shell, bundled gcloud, IAM mutation, secret rotation, cloud service changes, beta tester distribution, updater, installer, and App Store delivery.

## Risks / Trade-offs

- [Risk] Node.js 22.23.2 preparation blobs execute through CommonJS while repository source is ESM → Pin esbuild, generate one packaging-only CommonJS entry, prohibit source maps and filesystem-relative runtime dependencies, and prove source/SEA behavior parity with tests and native launch smoke.
- [Risk] Node SEA macOS x64 lacks regular upstream SEA CI coverage → End this change with x64 marked qualification-pending; a later change must provide native Intel 14.6.x evidence before release.
- [Risk] Allowing x64 on 14.6.0 could expose a shared development credential from an older Sonoma patch level than arm64 → Keep the exception architecture-specific in immutable metadata and make the verifier reject release evidence without native Intel 14.6.x qualification.
- [Risk] Capturing gcloud stdout places the shared secret in process memory → Use no shell, bounded captured buffers, a callback-scoped secret holder available only to approved event operations, explicit cleanup paths, redacted errors, and tests that scan all outputs.
- [Risk] A compromised operator identity can still access the shared development secret → Keep IAM at the exact secret, require personal identities, retain audit logs, and use existing rotation/revocation operations outside this executable.
- [Risk] Automatic browser launch can fail under managed desktop policy → Keep the bound loopback server running, emit only its safe URL, and treat the warning as nonfatal.
- [Risk] Two artifacts double release evidence → Require one paired release index that references exactly one healthy arm64 and one healthy x64 record with the same source/build manifest hash.

## Migration Plan

1. Add the asset and secret-provider seams while retaining current source-mode and owner-only file behavior.
2. Implement the macOS launcher and deterministic arm64/x64 staging builds; pass unit, source regression, build inspection, and privacy tests.
3. Implement the fail-closed release verifier and operator runbook; complete this change when `npm run check:release` passes with both artifacts still qualification-pending.
4. Preserve the existing Node source command. A separate future change may perform Developer ID signing, notarization, native qualification, healthy record generation, paired checksum publication, and operator handoff.

## Open Questions

There are no unresolved implementation decisions for this change. Signing/notary credentials, native qualification hosts, approved live-smoke inputs, healthy release records, and publication decisions belong to a separate future change.
