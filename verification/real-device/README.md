# Development real-device event verification

This directory contains the fail-closed verification primitives and sanitized evidence schema for the final development real-device flow. It proves a selected physical event across EMQX, Cloud Run, Firestore, and the hosted Web app; it does not certify production readiness or urine-volume accuracy.

## Dry-run fixture

Run the deterministic, credential-free fixture before arranging a physical test:

```sh
npm run real-device:development:dry-run
```

The command prints one schema-valid JSON evidence bundle. Fixture evidence is a harness check only and must not be presented as physical-device evidence.

## Approved live adapter contract

Live orchestration imports the functions from `run.mjs` and supplies narrowly scoped adapters for revision inspection, MQTT delivery/ACL probes, Cloud Run responses, Firestore metadata reads, hosted Web observations, evidence persistence, and cleanup. Adapters return only allowlisted metadata: timestamps, status codes, paths, hashes, event IDs, and request IDs. Never paste credentials or canonical payloads into arguments, logs, adapter results, or evidence.

Required inputs are the approved inventory references, `productModel`, `deviceId`, device-produced urination and battery `eventId` values, a positive observation window, two distinct opaque Auth test-member references, and a unique `rdv-*` cleanup marker.

## Physical operator checkpoints

1. Freeze and inspect the device inventory version, EMQX rule/action versions, Cloud Run image digest, Firebase project, and Hosting version. Stop if any value drifts.
2. Record the baseline daily documents and confirm the chosen event IDs do not already exist.
3. Trigger one physical urination report. Capture the device-produced `eventId` from the approved diagnostic transport; do not reconstruct it from a Cloud Run request ID.
4. Confirm first delivery `201`, one immutable event, the coherent latest urination tuple, and exactly one `Asia/Taipei` daily count increment. Replay the same canonical identity and require `200` with zero writes.
5. Trigger one physical battery report on the canonical `status/battery` topic. Confirm `201`, one immutable event, a coherent latest battery level/optional-voltage tuple, and byte-identical daily documents.
6. Run the unauthorized MQTT publish probe and require explicit denial.
7. Open overview, history, and stats as the Owner and non-owner test members. Require Owner visibility and explicit `permission-denied` for every non-owner route.
8. Persist the schema-valid pass/fail bundle, scan it for secrets and PII, then perform only marker-scoped cleanup. Never delete a broad collection or a path belonging to another marker.

Failures remain evidence: timeouts, revision drift, multiple events, projection/count mismatches, replay writes, ACL/Web failures, and sanitization failures must produce `status: failed` diagnostics before the run is considered complete.
