## ADDED Requirements

### Requirement: Development-only Hosting target

Deployment SHALL require the approved development Firebase project and Hosting site and SHALL reject demo, Emulator, production, or mismatched targets before upload.

#### Scenario: Reject an Emulator build
- **WHEN** the build contains an Emulator host
- **THEN** deployment exits before Hosting upload

### Requirement: Secret-free cloud build

The public build SHALL contain only approved Firebase client configuration and SHALL NOT contain MQTT credentials, webhook secrets, Admin credentials, or source environment files.

#### Scenario: Inspect deployment artifacts
- **WHEN** the build artifact is scanned
- **THEN** no prohibited secret or environment file is found

### Requirement: SPA and cache behavior

Hosting SHALL rewrite application routes to the index shell, revalidate the shell, and immutable-cache content-hashed assets.

#### Scenario: Reload a protected route
- **WHEN** an authenticated member reloads `/history`
- **THEN** Hosting serves the app shell and the router restores the route

### Requirement: Development member smoke journey

Post-deploy verification SHALL cover sign-in, owned-device overview, history, daily stats, non-owner denial, and sign-out on a mobile viewport.

#### Scenario: Complete the smoke journey
- **WHEN** a marked development member signs in
- **THEN** all owned views load, non-owned data remains denied, and sign-out returns to the sign-in view

### Requirement: Hosting release record

A healthy release SHALL record the build hash, Hosting version, target, verification timestamp, and rollback version without credentials.

#### Scenario: Record a verified release
- **WHEN** all smoke checks pass
- **THEN** the release record identifies the deployed and rollback versions

### Requirement: Development cloud service selection

The hosted build SHALL select the development Firebase adapter through the explicit environment discriminator, SHALL target the approved project, and SHALL contain no loopback host or Emulator connector activation.

#### Scenario: Inspect the hosted Firebase target
- **WHEN** deployment verification loads the built configuration
- **THEN** it resolves the approved development project and no Emulator endpoint

### Requirement: Member data cache exclusion

The service worker SHALL NOT cache Firebase Auth, Firestore, Google identity, or Cloud Run API requests or responses. After sign-out, cached assets SHALL NOT reveal the prior member's device, event, or stats data.

#### Scenario: Sign out and open offline
- **WHEN** a member signs out and the app is reopened without network access
- **THEN** the shell can load but no prior member domain data is visible

### Requirement: No browser MQTT capability

The hosted build SHALL contain no MQTT client dependency, Broker URL, MQTT credential, or direct subscription path.

#### Scenario: Scan the production bundle
- **WHEN** the Hosting artifact is inspected
- **THEN** no MQTT package import, websocket Broker endpoint, username, or password is present

### Requirement: Protected route reload matrix

Verification SHALL directly reload `/`, `/history`, and `/stats` as an authenticated Owner and as a signed-out visitor, and SHALL directly load `/sign-in`. Owner sessions SHALL restore the requested protected route; signed-out sessions SHALL render no protected content and SHALL reach sign-in.

#### Scenario: Reload stats while signed out
- **WHEN** a signed-out browser directly opens `/stats`
- **THEN** Hosting serves the shell and the router shows sign-in without rendering stats
