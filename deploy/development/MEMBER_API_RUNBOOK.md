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

`roles/datastore.user` is a database-wide capability. Firestore IAM and Rules do
not restrict this Admin SDK identity to a collection or field. The Claim
repository and release probes therefore enforce the application-enforced logical scope
for enabled registry reads, `deviceClaimSessions`, `activeDeviceClaims`,
and first-set `ownerUid`. The direct IAM audit does not reduce the residual
runtime compromise blast radius: compromised Member API code could use the
database-wide role outside that logical scope.

The runtime identity may have direct `roles/secretmanager.secretAccessor` only
on `peecare-claim-webhook-current` and `peecare-pair-code-hmac-key`. Both Cloud
Run bindings must select approved numeric Secret Manager versions; `latest`, an
empty reference, equal references, an unapproved secret, an extra direct project
role, or any direct binding on another project secret stops before IAM grants or
revision mutation.

The non-secret application environment is exactly `NODE_ENV=production`,
`GOOGLE_CLOUD_PROJECT=petcare-c7483`,
`PEECARE_WEB_ORIGIN=https://petcare-c7483.web.app`, the numeric HMAC key version,
the approved shared development MQTT username, plus Cloud Run's `PORT`. The
Claim webhook credential and HMAC key enter only through the two approved secret
bindings.

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
full Cloud Billing budget resource name, two numeric Claim secret references,
matching numeric HMAC key version, and approved shared MQTT username in the
operator environment. Its project IAM and all-project Secret Manager inventory
checks fail closed on blank, malformed, or duplicate output.

## Verify and hand off to the Web build

First verify the marker-scoped Firebase seed. That seed covers the owned
`PC-DEV-0001` naming fixture but does not prepare this Claim fixture. Before live
verification, an explicitly approved operator must use an Admin surface to
prepare `devices/68E274BD2A58` with matching `deviceId`, `productModel: pc-mini`,
and `ingestionStatus: enabled`; it must have no `ownerUid` field, and
`activeDeviceClaims/68E274BD2A58` must not exist. Confirm those exact conditions
read-only immediately before the run. Do not repurpose a member-owned or
production device: the successful probe intentionally sets first ownership and
does not clean it up automatically.

Provide the Firebase Web API key only through the current controlled operator
environment, together with the same approved numeric Claim references used by
the revision. Do not commit ID tokens, passwords, API-key output, environment
files, or release-record paths.

```sh
npm run firebase:development:seed -- --verify

export PEECARE_DEVELOPMENT_WEB_API_KEY='<approved-web-api-key>'
export PEECARE_MEMBER_CLAIM_SMOKE_DEVICE_ID='68E274BD2A58'
export PEECARE_MEMBER_CLAIM_SMOKE_CLIENT_ID='claim-smoke-client'
export PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF='projects/petcare-c7483/secrets/peecare-claim-webhook-current/versions/<numeric-version>'
export PEECARE_PAIR_CODE_HMAC_KEY_REF='projects/petcare-c7483/secrets/peecare-pair-code-hmac-key/versions/<numeric-version>'
export PEECARE_PAIR_CODE_HMAC_KEY_VERSION='<same-numeric-version>'
export PEECARE_CLAIM_SHARED_MQTT_USERNAME='approved-legacy-device'

npm run member:development:verify -- \
  --revision 'peecare-member-development-<suffix>' \
  --image 'asia-east1-docker.pkg.dev/petcare-c7483/peecare/member-api@sha256:<digest>' \
  > /tmp/peecare-member-release.json
```

A healthy sanitized record covers public health, exact CORS, missing/wrong/
revoked token zero-write checks, Owner rename and clear, non-owner denial, exact
direct IAM bindings, and Claim persistence. The Claim checks create a session,
prove credential cross-use causes zero persistence, set first ownership on the
approved ownerless fixture, repeat the terminal bind, and confirm that only the
expected Claim state and first-set `ownerUid` changed. Evidence must not contain
Pair Code, UID, token, credential, code MAC, or complete bind payload.

Only that record may supply `VITE_MEMBER_API_URL`:

```sh
export PEECARE_MEMBER_RELEASE_RECORD=/tmp/peecare-member-release.json
npm run member:development:web-build:dry-run
npm run member:development:web-build
```

The approved QR contract is exactly
`https://petcare-c7483.web.app/connect?deviceId=68E274BD2A58`. A QR carries only
the approved Hosting origin, `/connect`, and one non-sensitive 12-character
uppercase hexadecimal `deviceId`; it never carries a Pair Code, token, UID, or
credential. Opening the URL does not create a session until the signed-in member
explicitly confirms the displayed device identifier.

## Rollback dry-run

Verification may bind a prior healthy immutable revision from the same service.
Review the generated traffic command; the dry-run never changes traffic.

```sh
export PEECARE_MEMBER_RELEASE_RECORD=/tmp/peecare-member-release.json
npm run member:development:rollback
```

If the record lacks an exact prior healthy revision, rollback exits non-zero.

For the complete Claim rollback, 先停用 EMQX bind rule so no new bind delivery
can reach the Member API. Then review and apply the exact prior Web and Member API
revision rollback procedures. Pending sessions may expire naturally; rollback
must 不自動移除已成功設定的 `ownerUid`. Test ownership cleanup is a separate,
explicitly approved Admin operation limited to a marked fixture.
