## ADDED Requirements

### Requirement: Immutable development revision

Deployment SHALL target an approved development Cloud Run service using an immutable image digest and SHALL record that digest in verification output.

#### Scenario: Reject a mutable image
- **WHEN** deployment input uses a mutable tag without a digest
- **THEN** preflight exits before deployment

##### Example: Reject latest tag
- **GIVEN** image `asia-east1-docker.pkg.dev/petcare-c7483/peecare/ingestion-api:latest`
- **WHEN** the operator requests a deployment dry-run
- **THEN** preflight exits non-zero and invokes no `gcloud` mutation

### Requirement: Least-privilege runtime identity

The service SHALL run as a dedicated development service account with only required Firestore access and access to the named current and previous webhook secret versions.

#### Scenario: Inspect the deployment plan
- **WHEN** dry-run succeeds
- **THEN** output lists the dedicated identity and secret references without secret values

##### Example: Sanitized rotation plan
- **GIVEN** runtime identity `peecare-ingestion-runtime@petcare-c7483.iam.gserviceaccount.com` and distinct current/previous Secret Manager version references
- **WHEN** dry-run emits its JSON plan
- **THEN** the plan contains the identity and resource references but contains neither resolved secret value nor service-account key material

### Requirement: Development resource gates

Deployment SHALL require project `petcare-c7483`, region `asia-east1`, service `peecare-ingestion-development`, 1 CPU, 512 MiB memory, 60-second timeout, concurrency 20, maximum instances 2, minimum instances zero, and an approved Cloud Billing budget resource name matching `billingAccounts/{billing-account-id}/budgets/{budget-id}`.

#### Scenario: Reject a target mismatch
- **WHEN** the manifest project differs from the approved inventory
- **THEN** no Cloud Run revision is created

##### Example: Reject the Emulator project
- **GIVEN** manifest project `demo-peecare` and approved project `petcare-c7483`
- **WHEN** the operator requests dry-run or apply
- **THEN** preflight exits non-zero before invoking `gcloud`

### Requirement: Cloud smoke verification

Verification SHALL confirm health 200, unauthenticated webhook 401, and one authenticated fixture reaching development Firestore.

#### Scenario: Verify a deployed revision
- **WHEN** the revision is ready and secrets are valid
- **THEN** all three smoke checks pass and output contains no payload or secret

##### Example: Sanitized healthy revision
- **GIVEN** exact revision `peecare-ingestion-development-00001-abc`, authenticated fixture event `PC-DEV-0001:smoke-urination-1`, and project `petcare-c7483`
- **WHEN** health returns 200, unauthenticated webhook returns 401, and the authenticated fixture reaches Firestore
- **THEN** verification emits a passing summary containing revision and event ID but no payload or secret

### Requirement: Revision rollback

Deployment records SHALL identify the prior healthy revision and SHALL provide a verified rollback command before EMQX integration.

#### Scenario: Validate rollback target
- **WHEN** a prior healthy revision exists
- **THEN** rollback dry-run resolves that exact revision

##### Example: Resolve the same-service prior revision
- **GIVEN** active revision `peecare-ingestion-development-00002-def` and prior healthy revision `peecare-ingestion-development-00001-abc`
- **WHEN** rollback dry-run targets the prior release record
- **THEN** the plan resolves `peecare-ingestion-development-00001-abc` without changing traffic

### Requirement: Public network ingress with application authentication

The development Cloud Run service SHALL accept public HTTPS invocation so EMQX can reach it. Cloud Run public `GET /health` SHALL return `200 {"status":"ok"}` without authentication, while `POST /v1/emqx/events` MUST enforce the existing current-or-previous Bearer authentication and SHALL return the uniform 401 error for missing or invalid credentials. The container SHALL retain `GET /healthz` for compatibility, but live rollout verification SHALL use `/health` because Cloud Run intercepts the exact `/healthz` path.

#### Scenario: Reach the webhook without a Bearer token
- **WHEN** a public client posts a valid-looking envelope without Authorization
- **THEN** Cloud Run reaches the service and the service returns HTTP 401 without invoking Firestore

### Requirement: Exact production runtime environment

The revision SHALL set `GOOGLE_CLOUD_PROJECT` to the approved development project, SHALL inject Secret Manager references as `EMQX_WEBHOOK_SECRET_CURRENT` and optional `EMQX_WEBHOOK_SECRET_PREVIOUS`, and SHALL NOT set `FIRESTORE_EMULATOR_HOST`. Current and previous secret values MUST differ.

#### Scenario: Reject an Emulator runtime variable
- **WHEN** the deployment manifest includes FIRESTORE_EMULATOR_HOST
- **THEN** preflight exits before creating a revision

##### Example: Reject loopback Emulator injection
- **GIVEN** runtime environment `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`
- **WHEN** the operator requests dry-run or apply
- **THEN** preflight exits non-zero before invoking `gcloud`

### Requirement: Durable event smoke outcomes

Cloud smoke verification SHALL submit one urination and one battery fixture for an enabled registered development device and SHALL confirm HTTP 201 plus the exact immutable event, projection, and urination-only daily aggregate effects. Replaying either fixture SHALL return HTTP 200 with no writes.

#### Scenario: Replay the urination smoke fixture
- **WHEN** the same canonical urination event is posted twice
- **THEN** responses are 201 then 200, one event exists, and daily urinationCount increases once

### Requirement: Live rollout prerequisite validation

Before any live IAM or Cloud Run mutation, the rollout SHALL confirm an authenticated operator principal, approved project `petcare-c7483`, region `asia-east1`, an existing immutable Artifact Registry digest, a resolvable approved Cloud Billing budget resource, enabled numeric current and optional previous Secret Manager versions, and an enabled smoke fixture device `PC-DEV-0001` whose fixed smoke event IDs do not exist. Prerequisite output MUST contain no access token, secret value, service-account key, or device payload.

#### Scenario: Reject an unresolved live prerequisite
- **WHEN** the image digest, budget resource, required secret version, fixture device, or approved inventory cannot be resolved by read-only inspection
- **THEN** the rollout exits before invoking IAM or Cloud Run mutation and emits a sanitized failed prerequisite result

##### Example: Missing current secret version
- **GIVEN** current reference `projects/petcare-c7483/secrets/emqx-webhook-current/versions/7` resolves to no enabled version
- **WHEN** the operator runs the live prerequisite gate
- **THEN** the gate fails without invoking `gcloud projects add-iam-policy-binding`, `gcloud secrets add-iam-policy-binding`, or `gcloud run deploy`

### Requirement: Verified live development rollout

The rollout SHALL execute a sanitized dry-run and live apply with the same immutable image digest, budget resource, and Secret Manager version references. Completion SHALL require read-only Cloud Run inspection to prove that the exact deployed revision serves 100 percent of traffic with the planned digest and runtime identity, followed by successful Cloud smoke verification and a sanitized healthy release record.

#### Scenario: Complete a real development rollout
- **WHEN** approved prerequisites pass, live apply succeeds, the exact revision serves 100 percent of traffic, and all durable smoke checks pass
- **THEN** the rollout records the same project, region, service, revision, image digest, runtime identity, and healthy status observed in Cloud Run without recording secrets or payloads

##### Example: Healthy first rollout
- **GIVEN** planned digest `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` and deployed revision `peecare-ingestion-development-00001-abc`
- **WHEN** Cloud Run inspection reports that revision at 100 percent traffic and verification returns health 200, unauthorized 401, urination 201/200, and battery 201/200
- **THEN** the healthy release record contains that revision and digest and reports one urination aggregate increment with zero duplicate writes

### Requirement: Failed live rollout containment

A failed live apply, revision inspection, or smoke verification MUST NOT produce a healthy release record or enable downstream EMQX integration. When a prior healthy immutable revision exists, rollback SHALL require a sanitized exact-revision dry-run, explicit operator execution of the reviewed traffic command, and read-only confirmation that the prior revision serves 100 percent of traffic. When no prior healthy revision exists, the workflow SHALL stop without inventing a rollback target.

#### Scenario: Roll back a failed rollout
- **WHEN** post-deployment smoke verification fails and a verified prior healthy revision exists
- **THEN** the operator reviews the exact rollback plan, executes only that traffic command, and confirms the prior revision serves 100 percent of traffic while no healthy record is written for the failed revision

#### Scenario: Stop a failed first rollout
- **WHEN** post-deployment verification fails and no prior healthy revision exists
- **THEN** the workflow emits sanitized failure evidence, creates no healthy release record, starts no EMQX integration, and requires explicit operator remediation

##### Example: First revision health failure
- **GIVEN** deployed revision `peecare-ingestion-development-00001-abc`, no prior healthy release record, and health response HTTP 503
- **WHEN** live verification evaluates the revision
- **THEN** the workflow records a sanitized `smoke_failed` result, writes no healthy release record, executes no rollback traffic command, and leaves EMQX integration blocked
