# Local Firebase Platform

A cloud-free local Firebase environment for PeeCare development. Everything runs
against the Firebase Emulator Suite under the fixed demo project `demo-peecare`;
no real Firebase or Google Cloud project is ever created, selected, or accessed.

## Prerequisites

| Requirement | Version | Notes |
| ----------- | ------- | ----- |
| Node.js | `^20.19.0 \|\| >=22.12.0` | Same version as the Vue app (`package.json` → `engines`). |
| Java (JRE/JDK) | 11 or newer | Required by the Firestore Emulator only. Check with `java -version`. |

Install dependencies once with `npm install`; the Firebase CLI ships as the
`firebase-tools` dev dependency, so no global install is needed.

## Fixed configuration

The platform pins a single demo project and binds every Emulator to loopback
only. These values are committed in `firebase.json`, `.firebaserc`, and
`.env.example` and must stay in sync:

| Service | Endpoint |
| ------- | -------- |
| Project ID | `demo-peecare` |
| Authentication Emulator | `127.0.0.1:9099` |
| Cloud Firestore Emulator | `127.0.0.1:8085` |
| Emulator Suite UI | `127.0.0.1:4000` |

> Firestore uses port **8085** rather than Firebase's default 8080, which is
> often taken by a local Apache or other tooling. The port is fixed on purpose;
> if 8085 is already in use, free it — the Emulator fails fast and never silently
> switches ports.

## Security: keep Emulators on loopback

Emulator traffic (including Auth tokens) is **unencrypted**. Never rebind the
Emulators to `0.0.0.0`, a LAN address, or any non-loopback host, and do not
forward or tunnel these ports off the local machine. The client adapter and the
reset tool both fail closed on any non-loopback host, and the deny-by-default
Firestore rules mean no document is readable or writable until a future change
adds explicit, tested rules.

## Environment file

Copy the non-secret demo defaults into your local environment file:

```bash
cp .env.example .env.development.local
```

`.env.development.local` is gitignored and loaded only by Vite development mode,
so production builds do not inherit Emulator settings. It only holds demo values
(`demo-peecare`, `demo-api-key`, loopback hosts/ports) — never put a real project
ID, API key, or service account here.

`.env.development.local` is needed by the Vue app when it uses
`getLocalFirebaseServices`; it is **not** required to run the checks below.

## Commands

Run all commands from the repository root.

### Start the Emulators

```bash
npm run emulators:start
```

Starts Authentication, Firestore, and the Emulator UI in the foreground under
`demo-peecare`, loading `firestore.rules` and `firestore.indexes.json`. Open the
UI at <http://127.0.0.1:4000>. Stop with `Ctrl+C`.

### Reset local state

With the Emulators running (in another terminal):

```bash
npm run emulators:reset
```

Deletes every Auth account and every Firestore document for `demo-peecare`. It
validates the demo project and loopback endpoints before issuing any delete, and
exits non-zero (naming the failing endpoint) if either Emulator is unreachable.

### Fast frontend gate

```bash
npm run check
```

Type-checks, runs the unit tests, and builds the Vue app. Needs neither Java nor
a running Emulator.

### Firebase integration tests

```bash
npm run test:firebase
```

Starts Auth and Firestore via `firebase emulators:exec`, runs the local client
adapter tests, Security Rules tests, and a real Auth/Firestore reset lifecycle,
then shuts the Emulators down.

### Full local gate

```bash
npm run check:all
```

Runs `check` followed by `test:firebase`. This is the complete local verification
and the entry point CI uses. It does **not** require `firebase login`,
`firebase use`, or any cloud project.

## First-time walkthrough (clean checkout)

```bash
npm install
cp .env.example .env.development.local
npm run check:all
```

`check:all` should pass end to end without selecting or creating any cloud
project.
