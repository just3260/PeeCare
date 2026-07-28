## ADDED Requirements

### Requirement: Immutable development revision

Deployment SHALL target an approved development Cloud Run service using an immutable image digest and SHALL record that digest in verification output.

#### Scenario: Reject a mutable image
- **WHEN** deployment input uses a mutable tag without a digest
- **THEN** preflight exits before deployment

### Requirement: Least-privilege runtime identity

The service SHALL run as a dedicated development service account with only required Firestore access and access to the named current and previous webhook secret versions.

#### Scenario: Inspect the deployment plan
- **WHEN** dry-run succeeds
- **THEN** output lists the dedicated identity and secret references without secret values

### Requirement: Development resource gates

Deployment SHALL require an approved project, region, service name, max instances, and budget record, and SHALL set minimum instances to zero.

#### Scenario: Reject a target mismatch
- **WHEN** the manifest project differs from the approved inventory
- **THEN** no Cloud Run revision is created

### Requirement: Cloud smoke verification

Verification SHALL confirm health 200, unauthenticated webhook 401, and one authenticated fixture reaching development Firestore.

#### Scenario: Verify a deployed revision
- **WHEN** the revision is ready and secrets are valid
- **THEN** all three smoke checks pass and output contains no payload or secret

### Requirement: Revision rollback

Deployment records SHALL identify the prior healthy revision and SHALL provide a verified rollback command before EMQX integration.

#### Scenario: Validate rollback target
- **WHEN** a prior healthy revision exists
- **THEN** rollback dry-run resolves that exact revision

### Requirement: Public network ingress with application authentication

The development Cloud Run service SHALL accept public HTTPS invocation so EMQX can reach it. `GET /healthz` SHALL remain public, while `POST /v1/emqx/events` MUST enforce the existing current-or-previous Bearer authentication and SHALL return the uniform 401 error for missing or invalid credentials.

#### Scenario: Reach the webhook without a Bearer token
- **WHEN** a public client posts a valid-looking envelope without Authorization
- **THEN** Cloud Run reaches the service and the service returns HTTP 401 without invoking Firestore

### Requirement: Exact production runtime environment

The revision SHALL set `GOOGLE_CLOUD_PROJECT` to the approved development project, SHALL inject Secret Manager references as `EMQX_WEBHOOK_SECRET_CURRENT` and optional `EMQX_WEBHOOK_SECRET_PREVIOUS`, and SHALL NOT set `FIRESTORE_EMULATOR_HOST`. Current and previous secret values MUST differ.

#### Scenario: Reject an Emulator runtime variable
- **WHEN** the deployment manifest includes FIRESTORE_EMULATOR_HOST
- **THEN** preflight exits before creating a revision

### Requirement: Durable event smoke outcomes

Cloud smoke verification SHALL submit one urination and one battery fixture for an enabled registered development device and SHALL confirm HTTP 201 plus the exact immutable event, projection, and urination-only daily aggregate effects. Replaying either fixture SHALL return HTTP 200 with no writes.

#### Scenario: Replay the urination smoke fixture
- **WHEN** the same canonical urination event is posted twice
- **THEN** responses are 201 then 200, one event exists, and daily urinationCount increases once
