# Development device MQTT identity

This runbook is limited to `PC-000001` in the approved `petcare-c7483` development environment. It never accepts the device password in command arguments, environment variables, files, stdout, stderr, or JSON summaries.

## Required operator setup

Authenticate with Google Application Default Credentials, obtain an EMQX API key limited to the `access_control` scope, and export only the documented runtime management inputs. Confirm the MQTT endpoint uses a trusted certificate at `mqtts://...:8883`.

Run the read-only gate first:

```sh
npm run device:development:dry-run
```

## Initial provisioning

Run `npm run device:development:apply` from an interactive terminal. The command creates the credential and ACL, verifies `initial-connect`, then displays the new device password once on `/dev/tty`. Inject it directly into the physical device's protected configuration; do not copy it into a shell command, note, chat, or file.

## Rotation rehearsal

Stop the device publisher before rotation. Run `npm run device:development:rotate` from an interactive terminal and enter the current password at the no-echo prompt. The command installs the new password for the same `device-PC-000001` username, verifies `old-password-rejected` and `new-password-connect`, then displays the new password once. Restart the publisher only after injecting it.

If verification or handoff fails, the command restores the prior credential and ACL or reports `rollback_failed`. Never continue with an unknown credential state.

## Revocation rehearsal

Stop the device publisher, run `npm run device:development:revoke`, and enter the current password at the no-echo prompt. Success requires `revoked-password-rejected`. A failed verification recreates the prior non-superuser credential and ACL or reports `rollback_failed`.

Every stdout or stderr line is a fixed-shape JSON summary containing only `mode`, `deviceId`, `principal`, `status`, and verification names. Live apply, rotate, ACL verification, and revoke are operator-approved mutations; tests and the dry-run command never perform them automatically.
