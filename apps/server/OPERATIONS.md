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

## Continuation key, quota, and namespace boundary (edge-inactive)

Wrangler declaratively exports dedicated SQLite `PtcgContinuation` and
`PtcgContinuationQuota` Durable Objects and binds them as `PTCG_CONTINUATION`
and `PTCG_CONTINUATION_QUOTA`. The edge Worker does not route to either. Exact
private source-room create, named-save create/recovery/restore, quota-reserve,
and target-room initialization RPCs are implemented; create acquires its quota
lease before encrypted save storage. Open/revoke and every public continuation
route remain absent. Save alarms clean records without decrypting them, and
quota alarms clean expired leases without reading capacity configuration, so
cleanup remains available when key or quota configuration is absent or invalid.
This private wiring is not evidence that continuation is enabled.

Before any public route is activated, provision
`CONTINUATION_KEYRING` as a Worker **secret**, never a plaintext Wrangler
`vars` value. The exact JSON format is:

```json
{
  "format": "ptcgsim-continuation-keyring-v1",
  "activeKeyId": "operator-chosen-bounded-id",
  "keys": [
    {
      "id": "operator-chosen-bounded-id",
      "material": "43-character-base64url-encoding-of-32-random-bytes"
    }
  ]
}
```

The loader accepts one active AES-256-GCM encrypt/decrypt key and at most three
distinct prior decrypt keys. It has no fallback. Invalid configuration emits
only a fixed safe error and must prevent all operations that need encryption or
decryption. Rotation adds a new active key while retaining every prior key that
can protect an unexpired record; key removal waits for the maximum retention
window plus verified record cleanup. The decoded temporary key buffer is zeroed
after non-extractable Web Crypto import. Key material, configuration, key
digests, capabilities, and thrown configuration values must never enter logs,
telemetry, health responses, PRs, or support tickets.

Also provision `CONTINUATION_QUOTA_CONFIGURATION` as an environment-specific
operator binding. It is policy rather than a secret, but it deliberately has no
checked-in production default:

```json
{
  "format": "ptcgsim-continuation-quota-configuration-v1",
  "shardCount": 64,
  "maximumActiveLeasesPerShard": 128
}
```

The numbers above illustrate the schema; they are not an approved production
capacity. `shardCount` must be an integer from 1 through 4,096 and
`maximumActiveLeasesPerShard` from 1 through 512. Their product is the hard
global lease ceiling. Missing, oversized, malformed, unsupported, or out-of-
range configuration fails closed with one redacted error. Room codes map to a
fixed digest-derived shard, and every accepted reservation counts until the
save's hard expiry. This conservative model may temporarily over-count a failed
downstream create but cannot leave a stored save uncounted.

Increasing either capacity input is an explicit cost-policy change. Decreasing
the shard count or per-shard capacity requires disabling new creates and waiting
one maximum retention period, or producing verified complete cleanup evidence;
otherwise still-live leases can exist above or outside the new partition set.

Cloudflare's declarative Durable Object `exports` entries are namespace
lifecycle state, not ordinary version metadata. Do not remove either live
class/export or attempt to roll back across its provisioning change. Before
continuation activation, a code rollback leaves both inert declarations intact.
After saves exist, a pause disables new create/restore while retaining both
alarm cleanup paths, the last compatible decrypt keyring, and the last
compatible quota partition interpretation until all records and leases expire
or are explicitly cleaned up.

## Structured event contract

`server-telemetry.ts` emits the closed
`ptcgsim-server-telemetry-v2` discriminated union through Cloudflare's
structured console sink. Every event has timestamp, random event correlation,
ephemeral random source-instance correlation, source (`edge` or `room`), and
sanitized build/protocol/authority/match-schema versions.

| Event kind        | Intended signal                                                             |
| ----------------- | --------------------------------------------------------------------------- |
| `http_request`    | Safe route class, derived outcome/status, and handler latency               |
| `room_lifecycle`  | Create/restore/expire/alarm repair, authority frontier, and bounded counts  |
| `room_rate_limit` | Allowed/limited room operation and retry interval                           |
| `room_admission`  | Invitation/ticket/initial/resume operation, role, safe outcome, and latency |
| `room_command`    | Safe command outcome, bytes, total latency, and numeric phase durations     |
| `room_socket`     | Upgrade/restore/close/error and current socket count                        |
| `server_failure`  | Fixed subsystem and retryability; never the thrown error                    |

A successful WebSocket `101` is an accepted HTTP outcome, not a rejected
request. Terminal socket events exclude the callback socket from
`activeSockets`, even when the hibernation API retains it in `getWebSockets()`
until the callback returns.

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

During full cutover, also record ADR-022's UTC cutover instant, each qualifying
stable v2 release, and every eligibility reset. Keep the explicit v1 fallback
and its synthetic health check green for at least 30 uninterrupted days and two
stable production release cycles, whichever takes longer. A rollback,
release-blocking pause, or severity-1/2 data/privacy incident restarts the
retirement window after full traffic safely resumes. Passing the window never
authorizes automatic room shutdown, runtime removal, or stored-data deletion.

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

The run intentionally fills the 128-command outcome/audit window, advances 32
commands past it, forces repeated hibernating eviction, and commits once after
wake. The current authority-frontier run took 8.766 seconds for the measured
scenario and 12.12 seconds for the complete Vitest invocation; fixture setup was
664 ms. It remains outside the fast CI gate; the smaller deterministic payload
envelope stays in `test:v2:runtime`.

The Durable Object keeps only the 32 latest accepted-command observations in
memory so the harness can collect the same numeric durations without parsing
console output. The window has no room, session, command, card, or capability
values, is not persisted, is not exposed by an HTTP route, and resets on
eviction. It adds local-only detail for invariant validation,
resolution/execution, history/candidate construction, adapter and predecessor
validation, frontier hits/fallbacks, and the atomic transaction. The
machine-readable local report is `ptcgsim-runtime-performance-v3`; production
monitoring continues to use the structured telemetry sink's coarser v2 schema
and phases.

The multiplayer optimization uses two opaque, non-persisted proof layers. A
single-use transition proof binds the exact recursively frozen predecessor and
its proof to one canonical cloned event batch, the exact resulting state/replay
objects, and the configured replay limits. Cached canonical UTF-8 entry sizes
select the minimum compacted prefix without serializing or replaying the retained
suffix. The resulting snapshot proof is bound to the exact candidate plus its
exact source snapshot and validation, session, outcome, and canonical batch. It
is correctness evidence, not a security credential or portable integrity claim,
and neither proof enters storage, telemetry, or the wire.
Missing, forged, stale, reused, cross-room, mutated, or mismatched evidence falls
back to complete candidate and predecessor-transition validation. Restore,
migration, retry reload, external install, and other trust boundaries always
perform full validation and recursive freezing.

The storage optimization adds a strict v1 `authority:frontier` record while
keeping the snapshot envelope rollback-compatible at v6 with an optional
128-bit generation. The record binds that generation to the envelope/domain
schemas, match, mode, authority version, and state revision. An exact
cache/proof/frontier hit lets a multiplayer command read only lifecycle and the
small frontier, not the snapshot; its rotated snapshot/frontier pair, journal,
retention index, and pruning are one transaction. Missing or malformed frontier
data and an old writer's generation-free v6 envelope take a full-validation
repair path. A well-formed divergent pair fails closed. Admissions retain a full
predecessor read and pair the new frontier with journal, retention,
lifecycle/alarm, and pruning changes. Expiry validates and repairs the pair
before acting. This follows Cloudflare's documented
[storage transaction](https://developers.cloudflare.com/durable-objects/api/storage-api/)
and [alarm](https://developers.cloudflare.com/durable-objects/api/alarms/)
lifecycle boundaries. It changes no game-domain, wire, or production telemetry
schema.

The current mature plateau minimum/p50/p95/p99/max is 29/43/50/53/53 ms from
command send through all publications and 21/34/42/44/44 ms inside server
handling. Authority,
projection, persistence, publication serialization, and socket-send p50/p95 are
18/22, 7/11, 8/12, 1/1, and 0/1 ms. Inner input, resolution/execution,
history/candidate, candidate validation, adapter validation, predecessor
validation, and transaction p50/p95 are 0/0, 3/6, 9/11, 6/8, 0/0, 0/0, and
8/12 ms. All 32 mature commands hit the frontier and none fell back. Relative to
the incremental-replay run, p95 fell from 252 to 50 ms end to end, 243 to 42 ms
server-side, and 207 to 12 ms for persistence; scenario time fell from 26.204 to
8.766 seconds. This diagnostic local run has 200 ms and 208 ms of headroom
against the accepted 250 ms p95 user and server objectives respectively. It does
not count as ADR-015 managed-preview or physical/network release evidence.

The post-hibernation command measured 181 ms end to end and 43 ms server-side:
16 ms authority, 14 ms projection, 12 ms persistence, 0 ms publication
serialization, and 1 ms socket send. Its input/resolution/history/candidate/
adapter/predecessor/frontier/transaction detail was 0/3/7/6/0/0/1/11 ms. The
largest observed frame and three-recipient publication were 62,431 and 149,276
bytes. Peak storage was 139 entries/368,318 serialized key/value bytes; the final
post-wake state was 139/358,243, including a 297-byte frontier. Continue using
the same incident threshold while managed-preview and soak evidence is gathered;
do not introduce another shortcut around restore or fallback validation.

This local observation is diagnostic evidence, not a substitute for managed
Cloudflare preview load, CPU/memory/cost, alarm, or network distributions. The
versioned baseline, CI envelopes, privacy limits, implemented journal-retention
contract, validated-snapshot handoff, authority-frontier result, and remaining
managed-preview/soak gates are documented in
[`../../docs/v2-rebuild/SERVER_PERFORMANCE_BASELINE.md`](../../docs/v2-rebuild/SERVER_PERFORMANCE_BASELINE.md).
