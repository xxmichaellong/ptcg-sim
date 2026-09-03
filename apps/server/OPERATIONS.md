# V2 server operations contract

Status: structured telemetry and health boundary implemented; production
dashboards, account-level destinations/retention, preview thresholds, paging,
and rehearsed rollback evidence remain release gates.

## Public health boundary

`GET /v2/health` returns a `no-store` document containing only:

- `status`;
- sanitized build ID;
- wire protocol version;
- authority snapshot schema version; and
- match-state schema version.

Queries and non-GET methods are rejected. The endpoint does not inspect or
create a room and never returns configuration, bindings, room identifiers, or
credentials. A successful response proves only that the deployed Worker can
execute; synthetic room creation/admission/command probes remain necessary.

## Structured event contract

`server-telemetry.ts` emits the closed
`ptcgsim-server-telemetry-v1` discriminated union through Cloudflare's
structured console sink. Every event has timestamp, random event correlation,
ephemeral random source-instance correlation, source (`edge` or `room`), and
sanitized build/protocol/authority/match-schema versions.

| Event kind        | Intended signal                                                             |
| ----------------- | --------------------------------------------------------------------------- |
| `http_request`    | Safe route class, derived outcome/status, and handler latency               |
| `room_lifecycle`  | Create/restore/expire/alarm repair, authority frontier, and bounded counts  |
| `room_rate_limit` | Allowed/limited room operation and retry interval                           |
| `room_admission`  | Invitation/ticket/initial/resume operation, role, safe outcome, and latency |
| `room_command`    | Safe command type/outcome/reason, revisions, bytes, deliveries, and latency |
| `room_socket`     | Upgrade/restore/close/error and current socket count                        |
| `server_failure`  | Fixed subsystem and retryability; never the thrown error                    |

The emitter rebuilds every event field-by-field, bounds numeric values,
allowlists reasons, sanitizes labels, freezes the record, and isolates clock,
identifier, serialization, and sink failures from application behavior.

Telemetry must never contain raw request/command/message bodies, chat,
usernames, card names, card/deck/definition/view IDs, image URLs, room codes,
session or command IDs, seat/resume/invitation/ticket/save capabilities or
digests, socket close reasons, IP addresses or IP-derived hashes, exception
messages, or stack traces. Adding a field requires a schema change, privacy
test, this document update, and review against VIS-002, VIS-004, SEC-003, and
OPS-001.

## Initial dashboard and alert specification

Production dashboards should group only by the bounded enum/version fields in
the event contract. Do not group on `eventId` or `sourceInstanceId`; those are
short-lived diagnostic correlations.

The preview environment must establish normal baselines before thresholds are
ratified. Initial conservative alert candidates are:

- any sustained `server_failure` for `room_restoration` or `room_alarm`;
- HTTP 5xx ratio above 1% for five minutes with a minimum request floor;
- command `failed` ratio above 0.5% for five minutes;
- p95 room-command duration at or above 250 ms or p99 at or above 500 ms;
- p95 resume admission duration at or above two seconds;
- unexpected increase in rejected/duplicate commands or admission failures by
  safe reason;
- rate-limited creation/room operations above the preview baseline;
- restored room socket count without a matching healthy command/admission
  signal; and
- any health/schema version mismatch across the intended cohort.

Alerts are not production-approved until load tests set minimum-volume windows,
expected abuse baselines, ownership, notification routes, and false-positive
handling. Platform request/CPU/memory/storage metrics supplement these events;
application logs are not an accounting source.

## Incident runbooks

### Persistence or command-failure spike

1. Pause new v2 cohort allocation; do not migrate active v2 rooms to v1.
2. Confirm health/build/schema versions and Cloudflare Durable Object status.
3. Group fixed failure subsystems and safe command reasons; never inspect or
   export payloads to diagnose.
4. Preserve active rooms and rely on persisted idempotency/reconnect. Do not
   manually replay client commands.
5. Roll back only new-room routing after the documented rehearsal. Reopen the
   cohort after recovery and a synthetic commit/reconnect probe.

### Room restoration or alarm loop

1. Pause new v2 rooms if restoration failures are not isolated.
2. Distinguish `room_restoration` from retryable `room_alarm` deletion events.
3. Do not remove an `expiring` tombstone or recreate the same room identity.
4. Verify platform alarm delivery/storage health, then allow at-least-once retry
   to finish cleanup.
5. Escalate malformed persisted state for offline, access-controlled analysis;
   never place snapshots in logs or tickets.

### Reconnect/admission spike

1. Compare `hello_resume`, `hello_ticket`, socket, HTTP, and rate-limit signals
   by build/protocol version.
2. Check deployment/network health before changing security budgets.
3. Do not relax capability validation, one-use redemption, same-origin checks,
   or room limits as an incident workaround.
4. Pause new cohort allocation if the reconnect-to-usable p95 exceeds budget;
   existing rooms remain sticky to v2.

### Suspected hidden-data or credential leak

1. Treat any confirmed leak as rollout-blocking and immediately pause new v2
   allocation.
2. Restrict access to affected telemetry; do not copy suspected material into
   issues, chat, or new logs.
3. Identify the event schema/build window and revoke/expire affected authority
   where supported.
4. Preserve minimal access-controlled forensic evidence, fix the projection or
   telemetry boundary, rerun recursive leak scans, and obtain security approval
   before reopening.

### Canary pause and rollback

1. Stop assigning new rooms to v2 through the cohort control once implemented.
2. Keep existing v2 rooms on their original engine/protocol until completion or
   normal expiry; never live-downgrade canonical state.
3. Verify v1 remains healthy independently and retain the v2 namespace/storage
   for investigation and reconnect.
4. Record build/schema versions and aggregate safe outcomes, then rehearse the
   forward fix before resuming at the smallest cohort.

Image-provider, save/import, and client/renderer incident procedures will be
added with those production slices; their absence still blocks external beta.

## Local runtime measurement

Run `corepack pnpm run measure:v2:server` from the repository root to exercise a
120-card, two-player, one-spectator room through the deployed Worker,
SQLite-backed Durable Object, and runtime WebSockets. The runner writes a
machine-readable report to the gitignored
`artifacts/performance/server-local.json` and records frame/fanout bytes, local
command and hibernation-wake distributions, storage category counts/bytes, and
socket attachment size.

This local observation is diagnostic evidence, not a substitute for managed
Cloudflare preview load, CPU/memory/cost, alarm, or network distributions. The
versioned baseline, CI envelopes, privacy limits, and open journal-retention
finding are documented in
[`../../docs/v2-rebuild/SERVER_PERFORMANCE_BASELINE.md`](../../docs/v2-rebuild/SERVER_PERFORMANCE_BASELINE.md).
