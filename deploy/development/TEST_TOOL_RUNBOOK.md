# Development Test Tool API runbook

This workflow targets only project `petcare-c7483`, region `asia-east1`, Cloud
Run service `peecare-test-tool-development`, and beta device
`PC-DEV-000001` (`pc-mini`). It never provisions an account, changes device
ownership, or handles a generic upstream request.

## Prerequisites

- Use Application Default Credentials; never use a service-account key.
- Confirm the existing Cloud Billing budget resource before any mutation.
- Select one enabled numeric version of
  `peecare-emqx-webhook-current`; never use `latest` or print its value.
- Keep the tester signed in at `https://petcare-c7483.web.app/` in an isolated
  browser context. ID tokens stay inside that browser session.
- Run `npm run check:release` and retain no PII, token, custom name, payload, or
  resolved secret in build/deploy evidence.

## Build and immutable deploy

Build from the repository root with
`services/test-tool-api/cloudbuild.json`, then resolve the pushed Artifact
Registry tag to its `sha256` digest. The deploy command accepts only the exact
`test-tool-api@sha256:...` repository.

```sh
npm run test-tool:development:deploy -- \
  --dry-run \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@sha256:<digest>' \
  --revision-suffix '<00000-abc>'

npm run test-tool:development:deploy -- \
  --apply \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@sha256:<digest>' \
  --revision-suffix '<00000-abc>'
```

Preflight is read-only until the image digest, enabled numeric secret version,
budget, dedicated identity, absence of user-managed keys, and bounded IAM are
all confirmed. The generated Cloud Run v1 service uses one gen1 container so
the non-root runtime owns the single mode-`0600` secret file. Secret access is
conditioned to that one version. A staging failure performs zero cloud
mutation; a cleanup warning never disguises an already-deployed revision.

## Verify and Web handoff

First review the zero-mutation smoke plan:

```sh
npm run test-tool:development:verify -- \
  --dry-run \
  --revision 'peecare-test-tool-development-<suffix>' \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/test-tool-api@sha256:<digest>'
```

The live apply uses the approved isolated browser harness so the current
Firebase ID token never leaves the browser. It verifies, in order:

1. public health, exact CORS, unauthorized zero-write, and the owner’s unmarked
   denial;
2. an exact operator marker update on `PC-DEV-000001` that preserves ownership
   and registry fields;
3. foreign-owner denial, canonical urination and battery submissions, and the
   immediate rate limit;
4. both Firestore event documents, daily/device projections, Hosting-visible
   projections, `/test-tool` direct reload, sign-out/offline state, Cache
   Storage exclusion, and log privacy.

Only the exact 11-check healthy record may set
`VITE_TEST_TOOL_API_URL=https://peecare-test-tool-development-348528459946.asia-east1.run.app`
for the verified Web build. Deploy Hosting only from that immutable release
record, then repeat the `/test-tool` reload and cache/privacy smoke against the
live version.

## Disable and rollback

Contain a Test Tool incident by deploying a reviewed revision with
`PEECARE_TEST_TOOL_ENABLED` not equal to `true`; authentication remains first,
and authenticated event submission returns sanitized `503` with zero ledger or
Ingestion calls. Do not change the Ingestion service or device ownership.

Rollback is always a dry-run first:

```sh
export PEECARE_TEST_TOOL_RELEASE_RECORD=/absolute/path/to/sanitized-release.json
npm run test-tool:development:rollback
```

The plan is emitted only for one distinct prior healthy revision after
rechecking its approved image repository, exact gen1 `0600` numeric secret
mount, enabled secret version, dedicated identity, no user-managed keys, and
bounded project/secret IAM. Review the exact traffic command before an operator
executes it. If the tool returns `rollback_unavailable`, do not guess a target.
