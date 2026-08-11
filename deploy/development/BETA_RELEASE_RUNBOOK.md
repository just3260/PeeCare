# Development Web Beta Release Runbook

This runbook releases only the approved `petcare-c7483` Firebase Hosting site. The beta scope is exactly one operator-provisioned tester and the marked device `PC-DEV-000001`; multi-tester coverage is deferred to a later change.

## Operator prerequisites

The operator creates the Firebase Auth tester account and the Firestore ownership mapping before this workflow. Do not create, reset, export, or store that account from repository tooling.

Set the approved public development Web configuration in the current shell. Keep the tester email, Firebase UID, password, ID token, refresh token, and every credential out of environment files, command arguments, JSON, terminal history, logs, screenshots, and release evidence.

Create the ignored local inventory at `deploy/development/beta-tester-inventory.local.json` with this non-PII shape:

```json
{
  "environment": "development",
  "marker": "peecare-development-web-beta-v1",
  "testers": [
    { "alias": "tester-1", "deviceId": "PC-DEV-000001" }
  ]
}
```

Confirm that Git excludes it:

```sh
git check-ignore --no-index deploy/development/beta-tester-inventory.local.json
```

The ignored inventory is an assignment marker, not an identity or credential store.

## 1. Read-only dry-run

Run the release gate, inspected cloud build, exact cloud inventory checks, and sanitized plan without uploading:

```sh
npm run web:development:beta:dry-run
```

Review the single JSON plan. It must name only the approved project, site, target, Web app, Auth domain, region, Member API origin, tester alias, and counts. Stop if it contains an email, UID, credential, token, device payload, custom name, or event payload.

## 2. Apply and verify

For an existing live release, preserve the exact current Hosting version as the rollback target. For the first live release only, acknowledge that no rollback exists in the current shell:

```sh
export PEECARE_BETA_FIRST_RELEASE_CONFIRMATION=APPROVE_FIRST_DEVELOPMENT_HOSTING_RELEASE_WITHOUT_ROLLBACK
```

Then run:

```sh
npm run web:development:beta:release
```

Tester email and password enter only through the hidden interactive TTY prompts. The release must pass the Emulator non-owner denial gate before upload, then verify the live shell at `/`, `/history`, `/stats`, and `/sign-in`; the `tester-1` Owner overview, history, stats, rename/clear round trip, protected-route reload, exact ownership boundary, sign-out, and browser-state teardown must all pass.

A healthy record contains one sanitized tester stage and explicit check statuses. A bootstrap record must contain `rollbackAvailable: false` and `rollbackVersion: null`. A later release must contain the exact prior Hosting version.

## 3. Failure containment

Any preflight failure means zero upload. If upload succeeds but smoke verification fails, preserve only sanitized failed evidence and do not call the release healthy.

If marker clearing fails, record `cleanup required`, stop tester handoff, manually clear the marker, and rerun verification. If browser teardown fails, close the context and clear Auth persistence, IndexedDB, Cache Storage, and service-worker member state before retrying.

Never run an automatic rollback. First generate and review the exact target:

```sh
npm run web:development:beta:rollback
```

The rollback dry-run must identify one distinct prior version and emit the reviewed Firebase Hosting REST command without executing it. If it returns `rollback_unavailable`, do not guess a target. A failed bootstrap release has no rollback; deploy a corrected build and repeat verification.

## Final handoff checklist

- `npm run check:release` passes without lockfile drift.
- `npm run web:development:beta:dry-run` returns a sanitized single-tester plan.
- The live apply record is healthy only after every required check passes.
- The ignored inventory contains exactly `tester-1` → `PC-DEV-000001`.
- No email, UID, password, credential, token, custom name, device payload, or event payload is persisted.
- multi-tester coverage is deferred and must not be claimed by this beta release.
