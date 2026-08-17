# PeeCare macOS Operator Test Tool Runbook

This runbook is for authorized internal operators and release engineers. The tool supports native Apple Silicon (`arm64`) on macOS 14.8.8 or later and native Intel (`x64`) on macOS 14.6.0 or later. These architecture-specific floors are signed build-manifest policy; there is no shared fallback floor. It does not bundle Node.js as an external dependency, gcloud, Google credentials, or the development Ingestion secret.

## Release-engineer handoff

1. From a clean checkout, install the lockfile exactly and run the offline/source quality gate:

   ```sh
   npm ci
   npm run check:release
   ```

   This gate validates the pinned build manifest, CommonJS/SEA and operator tests, production dependency audit, asset inventory, and packaging privacy scan. It does not invoke `codesign`, Apple notary services, gcloud, Secret Manager, or any cloud mutation.

2. Build architecture-specific staging outputs on the protected build host. The staging and release directories must be absent before starting; stale output is rejected.

   ```sh
   npm run test-tool:macos:build -- --all
   ```

3. In the protected signing facility, sign each thin Mach-O independently with Developer ID Application, Hardened Runtime, and secure timestamp. Submit each exact signed executable to Apple notarization, staple the accepted ticket, run native qualification on the matching Mac, and place the signed executable plus its sanitized `release-record.json` under:

   - `artifacts/test-tool-macos/release/arm64/`
   - `artifacts/test-tool-macos/release/x64/`

   Signing/notary credentials stay in the protected Keychain/notary profile. Never pass them in command arguments, repository files, logs, or the release record.

4. Verify the complete pair, then run the final release gate:

   ```sh
   npm run test-tool:macos:verify
   npm run test-tool:macos:release
   ```

   Both commands fail unless exactly one native healthy arm64 record and one native healthy x64 record bind the same input manifest hash. Rosetta evidence cannot qualify x64.

5. Generate and publish the checksum index beside both executables. Verify the published copy before handoff:

   ```sh
   shasum -a 256 peecare-test-tool-macos-arm64 peecare-test-tool-macos-x64 > SHA256SUMS
   shasum -a 256 -c SHA256SUMS
   ```

## Operator prerequisites

Confirm the host and choose the matching artifact:

```sh
/usr/bin/sw_vers -productVersion
uname -m
```

- `arm64` → `peecare-test-tool-macos-arm64`
- `x86_64` on a native Intel Mac → `peecare-test-tool-macos-x64`
- Do not use the x64 artifact through Rosetta. There is no universal executable.
- Reject an arm64 host below macOS 14.8.8 or an x64 host below macOS 14.6.0; each executable enforces only its embedded architecture/floor pair before gcloud or loopback startup.

Verify the checksum supplied by the release engineer before first launch:

```sh
shasum -a 256 -c SHA256SUMS
```

Install the Google Cloud CLI from the approved internal/software-management channel. Authenticate with one authorized personal account and pin the required project:

```sh
gcloud auth login
gcloud auth list --filter=status:ACTIVE
gcloud config set project petcare-c7483
gcloud config get-value project
```

There must be exactly one active personal identity. Service-account identities, inherited `GOOGLE_APPLICATION_CREDENTIALS`, Firebase Emulator variables, and a project other than `petcare-c7483` are rejected before the listener starts.

## Start and stop

Use the exact positive numeric Secret Manager version approved for the test window. Never use `latest`. The example version `7` below is illustrative; replace it with the approved numeric version without putting the secret value in the command line.

```sh
./peecare-test-tool-macos-arm64 --secret-version 7
./peecare-test-tool-macos-x64 --secret-version 7
```

The tool listens only on `127.0.0.1`, prefers port 5055, and opens the default browser. For an automated smoke, add `--no-open`; for an explicitly assigned port, add `--port 5055`.

Stop the foreground process with Control-C (`SIGINT`). Automation may send `SIGTERM`. Wait for process exit, then confirm no listener remains:

```sh
lsof -nP -iTCP -sTCP:LISTEN | rg peecare-test-tool || true
```

The process must clear its in-memory credential holder and leave no secret file or background process.

## Revoke operator access

At the end of the authorized window, remove the local gcloud login:

```sh
gcloud auth revoke <PERSONAL_ACCOUNT>
```

The access owner must also remove the operator's Secret Manager IAM binding for the fixed development Ingestion secret using the approved IAM change workflow. The test tool never grants, rotates, or revokes IAM itself. Record the IAM change ticket and verify that a new launch fails before listening.

## Withdraw a release

If an executable, checksum, signing identity, qualification record, or credential boundary is suspect, immediately mark the release `withdrawn` in the internal distribution channel and stop distributing both architectures as one pair.

1. Remove both executable downloads and `SHA256SUMS` from the handoff location; do not leave one architecture available.
2. Publish the affected executable hashes, release version, reason, and replacement status without account, token, secret-version, device, or event data.
3. Ask active operators to stop the process with SIGINT or SIGTERM, delete the withdrawn executable, and run `gcloud auth revoke <PERSONAL_ACCOUNT>` when access is no longer required.
4. Coordinate Secret Manager IAM removal and, only through the approved secret-rotation workflow, disable/replace an affected secret version. The tool itself performs no IAM or secret mutation.
5. Rebuild from a clean checkout, repeat native arm64 and native Intel qualification, publish a new paired checksum index, and rerun `npm run test-tool:macos:verify` before restoring distribution.
