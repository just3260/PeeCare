## ADDED Requirements

### Requirement: Immutable development Member API revision

The Member API SHALL be deployed to an approved development Cloud Run service from an immutable image digest. The deployment record MUST bind the exact project, region, service, revision, and digest.

#### Scenario: Deploy an approved immutable image

- **WHEN** an approved operator deploys a verified Member API image digest
- **THEN** Cloud Run creates a development revision and the release record contains the same digest

#### Scenario: Reject a mutable image reference

- **WHEN** a deployment plan uses a mutable image tag
- **THEN** preflight exits non-zero before a Cloud Run revision is created

### Requirement: Dedicated Member API runtime identity

The Member API revision SHALL run as a dedicated service account with only the approved development Firestore access and read-only Firebase Authentication Viewer access required for revoked-token lookup. It MUST use Application Default Credentials and MUST NOT use a service-account private key.

#### Scenario: Verify the runtime identity

- **WHEN** deployment verification inspects the active Member API revision
- **THEN** the revision uses the approved dedicated service account and contains no service-account key material

### Requirement: Public transport with member authorization

The Member API SHALL accept public HTTPS network invocation. Every device-name mutation MUST verify a non-revoked Firebase ID token and the caller's ownership before invoking Firestore. CORS responses SHALL allow only the exact approved development Web origin.

#### Scenario: Rename an owned device

- **WHEN** an authenticated owner sends a valid rename request from the approved Web origin
- **THEN** the service returns HTTP 200 and persists the canonical custom name

#### Scenario: Reject a missing token without persistence

- **WHEN** a rename request omits its Firebase ID token
- **THEN** the service returns the canonical HTTP 401 error and performs zero Firestore operations

#### Scenario: Deny a non-owner

- **WHEN** an authenticated non-owner requests a device rename
- **THEN** the service returns HTTP 404 and leaves the device document unchanged

#### Scenario: Reject an unapproved browser origin

- **WHEN** a preflight or mutation request uses an origin different from the approved development Web origin
- **THEN** the response contains no permissive Access-Control-Allow-Origin value

### Requirement: Verified Member API origin handoff

The Web cloud build SHALL receive VITE_MEMBER_API_URL only from a healthy Member API release record. The origin MUST use HTTPS and MUST NOT contain credentials, a path, query, fragment, loopback host, Emulator host, or a service from another project.

#### Scenario: Build with the verified origin

- **WHEN** the Member API release passes health, authorization, CORS, and ownership smoke checks
- **THEN** its exact HTTPS origin becomes eligible for the development Web build

#### Scenario: Reject an unverified origin

- **WHEN** a Web build is given an origin that lacks a matching healthy Member API release record
- **THEN** Web deployment preflight exits non-zero before uploading Hosting files

### Requirement: Member API smoke and rollback

A healthy release SHALL pass public health, CORS, missing/wrong/revoked token, Owner rename, non-owner denial, and Firestore project-isolation checks. Rollback SHALL route traffic only to a prior healthy immutable revision of the same service.

#### Scenario: Record a healthy release

- **WHEN** every Member API smoke check succeeds
- **THEN** verification emits a sanitized healthy release record with the revision and image digest

#### Scenario: Roll back a failed revision

- **WHEN** post-deploy smoke fails and a prior healthy revision exists
- **THEN** rollback resolves that exact revision and restores its traffic without rebuilding an image
