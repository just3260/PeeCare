## MODIFIED Requirements

### Requirement: Deployed Auth and Firestore readiness

The environment verification SHALL confirm that the approved development Firebase project enables `google.com`, enables Email authentication with `signIn.email.passwordRequired: false`, sets `signIn.allowDuplicateEmails: false`, and authorizes the approved Hosting and Email Link action domains. It SHALL confirm that the inventory primary Auth provider is `google.com` and that the expected provider list contains `google.com` without `apple.com`, `phone`, or `password`. It SHALL also confirm required Firestore indexes are ready and deployed Rules pass Owner, non-owner, anonymous, and client-write denial probes. Every readiness summary MUST contain only provider identifiers, Boolean or count results, project identity, and Firestore probe outcomes; it MUST NOT contain an Email, client secret, OAuth token, OOB code, Email Link, or Firebase User identifier.

#### Scenario: Detect a building index

- **WHEN** a required Firestore index is not ready
- **THEN** environment verification fails and downstream Web deployment remains blocked

#### Scenario: Accept the first-release authentication configuration

- **WHEN** `google.com` is enabled, Email authentication is enabled with `passwordRequired: false`, duplicate Email accounts are disabled, and every approved Hosting and action domain is authorized
- **THEN** the authentication readiness stage passes with a sanitized result

#### Scenario: Reject a missing Google provider

- **WHEN** `google.com` is absent or disabled
- **THEN** environment verification returns `auth_provider_not_ready` and downstream Web deployment remains blocked

#### Scenario: Reject an incompatible Email configuration

- **WHEN** Email authentication is disabled or `signIn.email.passwordRequired` is not `false`
- **THEN** environment verification returns `email_link_not_ready` and downstream Web deployment remains blocked

#### Scenario: Reject duplicate Email accounts

- **WHEN** `signIn.allowDuplicateEmails` is not `false`
- **THEN** environment verification returns `email_link_not_ready` and downstream Web deployment remains blocked

#### Scenario: Reject an unauthorized callback domain

- **WHEN** the approved Hosting domain or Firebase Email Link action domain is absent from authorized domains
- **THEN** environment verification returns `authorized_domain_not_ready` and downstream Web deployment remains blocked

#### Scenario: Reject an out-of-scope provider inventory

- **WHEN** the first-release inventory or readiness provider list includes `apple.com`, `phone`, or `password`, or omits `google.com`
- **THEN** preflight returns `invalid_inventory` or `readiness_config_invalid` before any cloud mutation
