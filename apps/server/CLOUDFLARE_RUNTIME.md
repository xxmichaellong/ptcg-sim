# Cloudflare runtime spike record

Status: provisionally selected; local bundle/type checks plus real `workerd`
lifecycle, hibernation, concurrency, and bounded persistence-fault tests pass.
Preview deployment, platform-fault rehearsal, load/cost measurements, and
rollback evidence remain required before ADR-005 becomes accepted.

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
- `GET /v2/health` exposes only sanitized build and protocol/schema versions.
  The Worker and room emit a closed, versioned structured telemetry union for
  HTTP, lifecycle, rate, admission, command, publication-size, socket, and fixed
  failure-subsystem facts. Random correlations are unrelated to room/session
  authority, and the emitter cannot accept raw payloads or thrown errors.

## Evidence in this checkpoint

- `wrangler deploy --dry-run` bundles the Worker and recognizes the Durable
  Object binding, SQLite export, rate-limit binding, and build variable.
- Unit/integration tests cover serialized command execution, atomic storage,
  post-commit recovery, session supersession, lifecycle alarm retry/repair,
  concurrent fixed-window enforcement, redacted edge identity, closed telemetry
  serialization/failure isolation, health metadata, and reconstruction after
  simulated hibernation.
- `@cloudflare/vitest-plugin` 1.1.3 runs the deployed entrypoint and
  SQLite-backed room in Cloudflare's `workerd` runtime. The runtime suite proves
  health and creation routing through real bindings, atomic snapshot/lifecycle/
  alarm initialization, early-alarm repair, due unclaimed-room deletion, and
  the first admission's alarm cancellation.
- The runtime suite also keeps an admitted WebSocket attached while forcing a
  real Durable Object eviction. The hibernated socket wakes the reconstructed
  room, retains its serialized connection/session attachment and identical
  durable authority snapshot, answers an application ping, and durably accepts
  the next sequenced command.
- The Chromium suite starts local Wrangler and Vite together, then creates a
  room through the same-origin proxy, exchanges the creator ticket, completes a
  real WebSocket admission, renders the projected DOM board, observes a server
  notice, verifies credential-free transport URLs, and closes the socket. The
  live run also proves successful `101` upgrades are informational and terminal
  socket telemetry reports no phantom active connection.
- The canonical Wrangler configuration also owns Vite's built static assets,
  sends `/v2/*` to Worker code first except for the exact reviewed card-back
  asset, and uses SPA navigation fallback. A separate Chromium lane serves that
  production-like topology from one local `workerd` origin. It proves built
  module/card-back delivery, unknown-route isolation, repeated SPA/health
  document replacement, production exclusion of the developer room seam, and
  live room creation plus admission-ticket exchange. This is local routing
  evidence, not a managed preview or CDN-cache result.
- Web source maps remain available to the local bundle-provenance checker, but
  Vite emits no public map hints and Wrangler's copied `.assetsignore` omits all
  map files from the static manifest. A future telemetry integration must use a
  controlled symbolication upload rather than public asset delivery.
- One-shot faults at the production persistence-adapter boundary prove that a
  failed initial admission neither consumes its ticket nor cancels unclaimed
  expiry, and that retrying the same ticket commits exactly once. Concurrent
  second-seat admission and command traffic proves a failed pre-commit command
  has no durable effect or phantom acknowledgement before its exact retry.
- A separate ambiguous-write case commits the native storage transaction and
  then reports failure before publication. The room reloads that durable
  frontier, and exact retries both before and after eviction return the stored
  outcome without executing or writing the command again. The fault trigger is
  deterministic test instrumentation around the real adapter; the surrounding
  Worker, WebSocket, Durable Object, alarm, and SQLite storage paths remain the
  production runtime paths.
- The platform adapter has no game rules. It delegates all decisions to
  `@ptcgsim/room-authority` and `@ptcgsim/game-core`.

## Remaining spike gates

1. Rehearse Cloudflare platform-level storage unavailability and alarm retries
   in preview; local tests intentionally do not claim to synthesize failures
   inside the managed SQLite service.
2. Measure full-snapshot payloads, command latency including durable commit,
   memory, CPU, hibernation wake latency, and practical sockets per room.
3. Connect the implemented structured events to production dashboards and
   destinations, ratify alert thresholds in preview, and rehearse the runbooks;
   verify platform rate-limit distribution and alarm behavior there.
4. Prove sticky v2 room routing and rollback for new rooms without moving an
   active room between protocol generations.

## Primary references checked 2026-09-03

- [Use WebSockets with Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Hibernation WebSocket server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Workers Vitest test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Wrangler configuration and declarative exports](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static asset binding and Worker-first routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Single-page application routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
