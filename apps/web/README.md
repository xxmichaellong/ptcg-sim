# PTCG Sim v2 web application

The default route is an isolated renderer decision harness. It does not replace
or alter the v1 production client. Use `?renderer=pixi` or `?renderer=dom` to
mount the same deterministic 61-card scene behind either adapter.

`RemoteRoomBootstrap` exchanges an explicitly supplied in-memory seat or
spectator capability through a same-origin, no-store POST and constructs the
room runtime with only the returned short-lived ticket. Neither credential is
placed in a URL, browser storage, DOM, React state, or log. The bootstrap returns
the lazy `RemoteRoomRoute` input. `RemoteRoomCreation` now validates lobby input,
creates a room through a strict bounded same-origin POST, immediately bootstraps
the creator, and keeps the player-two and spectator master credentials in
non-serializing in-memory custody. Callers can mint bounded 15-minute one-use
invitation handoffs without receiving those master credentials. Player
invitations rotate; spectator invitations are independently bounded. The guest
bootstrap validates an untrusted handoff and exchanges its invitation through
the existing short-lived ticket boundary. `main.tsx` selects the renderer spike
for normal traffic until ADR-020 chooses how that handoff moves between browsers
and the existing visible create/join workflow is ported.

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

This seam is deliberately available only under `import.meta.env.DEV`; it does
not choose an ADR-020 invitation transport or expose the player-two/spectator
credentials. The production bundle gate rejects any source provenance under
`apps/web/src/dev/`.

The Chromium suite starts both Wrangler and Vite and drives this route over the
real same-origin HTTP/WebSocket proxy. It verifies health, room creation,
admission-ticket exchange, a ready projected session and DOM board, a
bidirectional server notice, credential-free request URLs, and clean socket
closure. The separate in-process churn gate retains the stronger 20-cycle
ownership/teardown proof.

Both screens preserve the v1 75.5% board / 24% side-panel split. The room screen
mounts the effective live/replay board, multiplayer/replay activity surface,
legacy replay controls, and externally owned route teardown. Normal sidebar
actions, chat, deck/settings navigation, and create/join form wiring remain
later slices.

The default v2 card back is published at `/v2/assets/cardback.png`. It is an
exact byte copy of the current v1 PNG, and the build gate verifies its digest,
dimensions, color format, and emitted bytes. The Worker does not serve web
assets itself: a deployment must route `/v2/assets/*` to this Vite build (or an
equivalent static origin) before remote rooms are exposed.

Run the Chromium decision suite with `pnpm run test:renderer:browser` after
installing Playwright's Chromium browser. On NixOS, set
`PTCGSIM_CHROMIUM_PATH` to the Nix-provided Chromium executable.
