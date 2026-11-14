# Authority snapshot storage

Cloudflare's SQLite-backed Durable Object storage limits each combined key and
value to [2 MB](https://developers.cloudflare.com/durable-objects/platform/limits/).
Allowed decks, image URLs, and the complete 34-session command outcome caches
can together exceed that limit. Local workerd accepts oversized values and does
not establish production compatibility.

`DurableRoomSnapshotStore` retains its logical v6 authority envelope and all
snapshot validation, schema migration, deduplication, frontier, journal, and
admission behavior. `snapshot-storage.ts` changes only its physical snapshot
representation:

- Envelopes whose JSON UTF-8 encoding is at most 512 KiB keep their existing
  native object value at `authority:snapshot`. This conservative cutoff leaves
  substantial room for V8 serialization overhead below the platform limit.
- Larger envelopes are encoded once as JSON UTF-8 and split into binary values
  of at most 512 KiB. `authority:snapshot` holds a
  `ptcgsim-authority-snapshot-chunks-v1` manifest with generation, exact byte
  length, chunk count, and SHA-256. Parts use
  `authority:snapshot:chunk:<generation>:<zero-based-index>`.
- `authority:snapshot:chunk-index` duplicates that small manifest. A writer reads
  this index to remove obsolete parts without fetching a complete ordinary
  snapshot during a cached-frontier commit. Native heads have no chunk index.

Manifests allow at most 128 parts and 64 MiB, generously above the native room's
400 cards/definitions, current and replay-base states, bounded inspection
permissions, projection identities, 34 full outcome caches, and 512 KiB replay
suffix. The bounds prevent malformed metadata from requesting unlimited reads
or allocation; they do not reduce accepted command/deck limits or drop outcomes.
A missing or mismatched index, invalid count/generation/length, absent or wrongly
sized/type part, digest mismatch, invalid UTF-8/JSON, or reconstructed generation
mismatch fails closed. Chunk boundaries may split a UTF-8 sequence; decoding
happens only after joining all bytes. Deletion keys come from validated
namespace/generation/index data, never arbitrary stored key lists.

Chunk writes, manifest/index replacement, old-part removal, snapshot frontier,
journal/retention updates, and lifecycle/alarm changes remain inside the same
native storage transaction. A failed put or deletion rolls back all of them.
Transaction retries build from the current index. A committed transaction whose
caller observes an error is recovered through the existing reload/version and
outcome-cache checks. A new store instance reconstructs the complete committed
head. The adapter's direct snapshot `get` also uses a native transaction, so its
manifest and parts cannot straddle generations. Whole-room deletion removes
parts and metadata together.

## Reading old state and rolling back

Current code continues to read native v1–v6 envelopes and retains existing
migration/repair behavior. No game-domain event, authority snapshot schema,
protocol frame, accepted input limit, or continuation activation changes.

**An older binary that lacks the chunk reader cannot load a chunked head.**
A rollback candidate must retain `snapshot-storage.ts` and its constructor
integration, or an explicitly validated atomic conversion must first restore
native heads that fit the platform's per-value limit. Converting an oversized
head back to one value is not a safe rollback. Keep this reader with any code
rollback while chunked rooms remain retained; changing the logical v6 schema
number alone does not make older binaries compatible.

The focused Node regression uses `node:v8.serialize` to enforce the actual
2,000,000-byte key/value ceiling. The native SQLite runtime regression adds a
conservative per-value guard because local workerd neither enforces the limit
nor implements `node:v8.serialize`; it covers complete reloads, stale writers,
part-deletion rollback, old-generation cleanup, and committed-then-threw recovery.
