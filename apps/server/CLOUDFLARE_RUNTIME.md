# Cloudflare runtime spike record

Status: provisionally selected; local bundle/type/hibernation-reconstruction tests
pass. Preview deployment, Workers-pool lifecycle tests, load/cost measurements,
and rollback evidence remain required before ADR-005 becomes accepted.

## Implemented runtime boundary

- The stateless Worker rate-limits creation, creates a high-entropy room code,
  initializes a named `PtcgRoom`, and proxies only the versioned creation,
  invitation, admission-ticket, and `/v2/rooms/:code/connect` routes.
- `PtcgRoom` is declared as a SQLite-backed Durable Object through Wrangler's
  declarative `exports` configuration.
- The Durable Object uses the hibernation WebSocket API (`acceptWebSocket`), not
  standard event listeners.
- Each socket attachment stores only connection/session reconstruction metadata,
  well below the 16,384-byte attachment ceiling. Canonical room state remains in
  transactional Durable Object storage.
- On constructor wake, the room reloads and validates its authority snapshot,
  rebuilds the command coordinator, orders socket attachments by authority
  version, and restores the newest controlling binding.
- No timers, intervals, outbound sockets, or background fetches are held by a
  room, preserving hibernation eligibility.
- Cloudflare protocol ping/pong remains automatic; the application `Ping`/`Pong`
  message measures application reachability and sequence health separately.
- Initialization stores a five-minute unclaimed lifecycle marker and schedules
  its alarm in the same transaction as the authority snapshot. The first
  successful session admission atomically marks the room claimed and cancels
  that alarm. An alarm first writes an `expiring` tombstone and then calls
  `deleteAll()`, so an at-least-once alarm retry completes cleanup while
  concurrent authority/rate-limit transactions fail closed.
- The Worker Rate Limiting binding permits 12 valid anonymous room-creation
  requests per hashed edge identity per 60 seconds. This intentionally coarse,
  location-local limit protects allocation but is not an authorization or
  accounting primitive.
- Each room separately persists exact fixed-window budgets: 24 invitation
  issues, 60 admission-ticket exchanges, 120 WebSocket upgrades, and 120
  `Hello` attempts per 60 seconds. These bounded operational records are outside
  canonical match state and survive object eviction.

## Evidence in this checkpoint

- `wrangler deploy --dry-run` bundles the Worker and recognizes the Durable
  Object binding, SQLite export, rate-limit binding, and build variable.
- Unit/integration tests cover serialized command execution, atomic storage,
  post-commit recovery, session supersession, lifecycle alarm retry/repair,
  concurrent fixed-window enforcement, redacted edge identity, and
  reconstruction after simulated hibernation.
- The platform adapter has no game rules. It delegates all decisions to
  `@ptcgsim/room-authority` and `@ptcgsim/game-core`.

## Remaining spike gates

1. Run the Worker under `@cloudflare/vitest-pool-workers` and force Durable Object
   eviction while live WebSockets remain attached.
2. Verify simultaneous admission and command traffic under storage fault
   injection with the real runtime input/output gates.
3. Measure full-snapshot payloads, command latency including durable commit,
   memory, CPU, hibernation wake latency, and practical sockets per room.
4. Add structured redacted logs, production alert thresholds, and a preview
   environment; verify platform rate-limit distribution and alarm behavior there.
5. Prove sticky v2 room routing and rollback for new rooms without moving an
   active room between protocol generations.

## Primary references checked 2026-09-03

- [Use WebSockets with Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Hibernation WebSocket server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Wrangler configuration and declarative exports](https://developers.cloudflare.com/workers/wrangler/configuration/)
