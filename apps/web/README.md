# PTCG Sim v2 web application

The default route is an isolated renderer decision harness. It does not replace
or alter the v1 production client. Use `?renderer=pixi` or `?renderer=dom` to
mount the same deterministic 61-card scene behind either adapter.

`RemoteRoomBootstrap` exchanges an explicitly supplied in-memory seat or
spectator capability through a same-origin, no-store POST and constructs the
room runtime with only the returned short-lived ticket. Neither credential is
placed in a URL, browser storage, DOM, React state, or log. The bootstrap returns
the lazy `RemoteRoomRoute` input, but `main.tsx` still selects the renderer spike
until the existing visible create/join workflow is ported.

Both screens preserve the v1 75.5% board / 24% side-panel split. The room screen
mounts the effective live/replay board, multiplayer/replay activity surface,
legacy replay controls, and externally owned route teardown. Normal sidebar
actions, chat, deck/settings navigation, and create/join form wiring remain
later slices.

Run the Chromium decision suite with `pnpm run test:renderer:browser` after
installing Playwright's Chromium browser. On NixOS, set
`PTCGSIM_CHROMIUM_PATH` to the Nix-provided Chromium executable.
