# Development Firebase environment

The approved cloud target is `petcare-c7483` in Firestore region `asia-east1`.
The repository keeps `demo-peecare` as the default Emulator project and exposes
the real target only through the explicit `development` Firebase alias. Every
cloud command still validates the inventory and passes an explicit project ID.

## Required operator environment

Export these values in the operator shell. Do not commit access tokens, refresh
tokens, service-account JSON, or `GOOGLE_APPLICATION_CREDENTIALS` contents.

```sh
export PEECARE_DEVELOPMENT_PROJECT_ID=petcare-c7483
export PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST=petcare-c7483
export PEECARE_DEVELOPMENT_FIRESTORE_REGION=asia-east1
export PEECARE_DEVELOPMENT_BILLING_OWNER=andrewang9981@gmail.com
export PEECARE_DEVELOPMENT_AUTH_PROVIDER=google.com
export PEECARE_DEVELOPMENT_AUTH_PROVIDERS=google.com
export PEECARE_DEVELOPMENT_AUTHORIZED_DOMAINS=petcare-c7483.firebaseapp.com,petcare-c7483.web.app
export PEECARE_DEVELOPMENT_WEB_API_KEY='<Firebase Web API key>'
export PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION=APPROVE_DEVELOPMENT_FIREBASE_MUTATION
```

The Web build additionally requires `VITE_FIREBASE_ENVIRONMENT=development`,
`VITE_FIREBASE_APPROVED_PROJECT_ID=petcare-c7483`, the matching
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_API_KEY`,
and `VITE_FIREBASE_APP_ID`. Firebase Web config is public configuration, not an
authorization mechanism; Firestore Rules remain the authorization boundary.

## Required Auth console settings

Before running deployed readiness, configure Authentication for the development
project with the Google provider enabled and Email sign-in enabled. The Email
configuration must report `passwordRequired: false` and
`allowDuplicateEmails: false`. Authorized domains must include both the Hosting
domain (`petcare-c7483.web.app`) and action domain
(`petcare-c7483.firebaseapp.com`). The readiness command fails closed when any
of these exact settings is missing or unreadable.

The backend can still accept existing password credentials for internal seeded
readiness probes and backwards compatibility. The Web application does not
provide a password entry point; production user sign-in is limited to Google
popup and passwordless Email Link.

## Commands

```sh
npm run firebase:development:preflight -- --dry-run
npm run firebase:development:deploy -- --dry-run
npm run firebase:development:deploy -- --apply
npm run firebase:development:seed -- --apply
npm run firebase:development:seed -- --verify
npm run firebase:development:verify
```

Seed operations use two deterministic Auth users, `devices/PC-DEV-0001`, and a
`developmentSeeds` manifest. Every resource carries
`petcare-c7483-development-smoke-v1`; commands refuse conflicting resources and
summaries never contain credentials or passwords.

After downstream smoke journeys no longer need the fixture, remove only marked
seed resources with:

```sh
npm run firebase:development:seed -- --cleanup
```
