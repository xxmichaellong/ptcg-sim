# PTCG Sim v2 web application

The default route is an isolated renderer decision harness. It does not replace
or alter the v1 production client. Use `?renderer=pixi` or `?renderer=dom` to
mount the same deterministic 61-card scene behind either adapter.

`?room-lobby=1&renderer=dom` mounts the isolated, production-built v2
multiplayer lobby. It preserves the existing Name, Room ID, Generate, Copy,
coaching, spectator, and Join shape while routing those controls through the
real authority. Generate creates and privately owns a multiplayer room; Copy
mints a role-bound temporary invitation; Room ID paste is intercepted before
the bearer reaches the DOM; and Join transfers the owned creator or guest
runtime into the connected room route. This explicit query remains a rollout
flag: normal v2 traffic still receives the renderer harness, and the v1 client
is unchanged.

The connected route now mounts the existing Attack, Pass, flower, chat, Set Up,
Reset, and Leave Room controls with their original IDs and role visibility.
Player mutations resolve to atomic authority commands, while player and
spectator chat uses the authenticated ephemeral session channel so the browser
never supplies attribution. Replay hides the live controls. Leave retains the
legacy confirmation text, sends the durable session leave through runtime
disposal, clears the old private invitation custody, and returns to a fresh
lobby owner.

`RemoteRoomBootstrap` exchanges an explicitly supplied in-memory seat or
spectator capability through a same-origin, no-store POST and constructs the
room runtime with only the returned short-lived ticket. Neither credential is
placed in a URL, browser storage, DOM, React state, or log. The bootstrap returns
the lazy `RemoteRoomRoute` input. `RemoteRoomCreation` now validates lobby input,
creates an explicitly solo or multiplayer room through a strict bounded
same-origin POST, immediately bootstraps the creator, and keeps any player-two
and spectator master credentials in non-serializing in-memory custody. A solo
response never carries a player-two bearer, so its custody rejects player
invitation requests locally without network traffic. Multiplayer callers can
mint bounded 15-minute one-use player handoffs; both modes may mint spectator
handoffs when spectator custody exists. Player invitations rotate; spectator
invitations are independently bounded. The guest
bootstrap validates an untrusted handoff and exchanges its invitation through
the existing short-lived ticket boundary. `main.tsx` selects the renderer spike
for normal traffic and the accepted ADR-020 lobby only through the explicit
`room-lobby` flag.

## Development full-stack route

The Vite development build has a creator-only route that exercises the real
room creation, ticket exchange, WebSocket session, presentation, and selected
renderer stack without adding provisional lobby UI. Start these in separate
terminals:

```sh
corepack pnpm --filter @ptcgsim/server-v2 dev
corepack pnpm --filter @ptcgsim/web dev
```

Then open
`http://127.0.0.1:5173/?dev-room=1&renderer=dom&name=Developer`. React Strict
Mode probes are coalesced before the creation POST, so a development mount does
not create an abandoned duplicate room. The Vite proxy forwards only
`/v2/health` and `/v2/rooms*` to the Worker while `/v2/assets/*` stays owned by
the web app. Override the Worker origin with `PTCGSIM_V2_SERVER_ORIGIN` when it
is not listening at `http://127.0.0.1:8787`.

Add `&room-mode=solo` to exercise persisted single occupancy and solo replay;
the hidden route defaults to `multiplayer`. This is development-only protocol
coverage, not a visible mode selector.

This seam is deliberately available only under `import.meta.env.DEV`; it does
not choose an ADR-020 invitation transport or expose the player-two/spectator
credentials. The production bundle gate rejects any source provenance under
`apps/web/src/dev/`.

The Chromium suite starts both Wrangler and Vite and drives this route over the
real same-origin HTTP/WebSocket proxy. It verifies health, room creation,
admission-ticket exchange, a ready projected session and DOM board, a
server-attributed chat round trip, credential-free request URLs, and clean socket
closure. Its solo case additionally proves the exact creation request/response,
absence of player-two custody, real load/setup commands, and replay-local prize
disclosure without changing the live view. The separate in-process churn gate
retains the stronger 20-cycle ownership/teardown proof.

Both screens preserve the v1 75.5% board / 24% side-panel split. The room screen
mounts the effective live/replay board, multiplayer/replay activity surface,
legacy replay controls, authenticated live sidebox controls, and externally
owned route teardown. Live and replay Options now restore recipient-safe
battle-log export and browser full screen, while Clear battle log remains live
only as in v1; object URLs are revoked after the foreground download.
The connected Solo header tab also retains its v1 confirmed-leave behavior and
uses the same route-owned durable teardown as Leave Room. Game-state/replay
import and export, Deck/Settings navigation, and the remaining focus/visual
parity remain later slices.

The default v2 card back is published at `/v2/assets/cardback.png`. It is an
exact byte copy of the current v1 PNG, and the build gate verifies its digest,
dimensions, color format, and emitted bytes. The canonical Wrangler deployment
now publishes the complete Vite `dist` directory beside the Worker: `/v2/*`
runs authority code first except for the explicitly reviewed
`/v2/assets/cardback.png`, while unknown browser navigation receives the SPA
shell. The separate production-topology Chromium lane verifies those route
priorities, room creation/ticket exchange, repeated document replacement, exact
card-back bytes, and exclusion of the development room module. Managed-preview
and rollout approval remain separate gates.

Production builds retain hidden source maps for the local provenance checker,
but the entry modules do not advertise them and Wrangler excludes them through
`public/.assetsignore`. Upload maps to a controlled diagnostics destination if
production symbolication is enabled; do not expose them as static assets.

Run every Chromium lane with `pnpm run check:browser`, or only the combined
built-app/Worker lane with `pnpm run test:preview:browser`, after installing
Playwright's Chromium browser. On NixOS, set
`PTCGSIM_CHROMIUM_PATH` to the Nix-provided Chromium executable.
