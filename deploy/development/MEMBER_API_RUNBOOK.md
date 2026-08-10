# Development Member API runbook

The approved target is project `petcare-c7483`, region `asia-east1`, service
`peecare-member-development`. Public health uses `GET /health`; `/healthz`
remains a container-level compatibility route because Cloud Run intercepts it.

## Identity and configuration

The revision runs as
`peecare-member-runtime@petcare-c7483.iam.gserviceaccount.com` with only
`roles/datastore.user` and the read-only `roles/firebaseauth.viewer` needed by
revoked-aware Firebase ID-token verification. Use Application Default
Credentials. Never configure a service-account key, Emulator host, or Ingestion
secret.

The application environment is exactly `NODE_ENV=production`,
`GOOGLE_CLOUD_PROJECT=petcare-c7483`,
`PEECARE_WEB_ORIGIN=https://petcare-c7483.web.app`, plus Cloud Run's `PORT`.

## Build and deploy

Build `services/member-api/Dockerfile` from the repository root, push it to the
approved `asia-east1` Artifact Registry, and resolve the resulting digest. The
deployment command rejects mutable tags.

```sh
npm run member:development:deploy -- \
  --dry-run \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:<digest>' \
  --revision-suffix '<00000-abc>'

npm run member:development:deploy -- \
  --apply \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:<digest>' \
  --revision-suffix '<00000-abc>'
```

The deploy preflight also requires the approved project, region, Web origin,
and full Cloud Billing budget resource name in the operator environment.

## Verify and hand off to the Web build

First verify the marker-scoped Firebase seed. Then provide the Firebase Web API
key only through the operator environment and run every live smoke check. Do
not commit ID tokens, passwords, API-key output, or release-record paths.

```sh
npm run firebase:development:seed -- --verify

npm run member:development:verify -- \
  --revision 'peecare-member-development-<suffix>' \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:<digest>' \
  > /tmp/peecare-member-release.json
```

A healthy sanitized record covers public health, exact CORS, missing/wrong/
revoked token zero-write checks, Owner rename and clear, non-owner denial, and
Firestore project isolation. Only that record may supply `VITE_MEMBER_API_URL`:

```sh
export PEECARE_MEMBER_RELEASE_RECORD=/tmp/peecare-member-release.json
npm run member:development:web-build:dry-run
npm run member:development:web-build
```

## Rollback dry-run

Verification may bind a prior healthy immutable revision from the same service.
Review the generated traffic command; the dry-run never changes traffic.

```sh
export PEECARE_MEMBER_RELEASE_RECORD=/tmp/peecare-member-release.json
npm run member:development:rollback
```

If the record lacks an exact prior healthy revision, rollback exits non-zero.
