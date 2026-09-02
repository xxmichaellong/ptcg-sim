# PTCG Sim v2 web application

The default route is an isolated renderer decision harness. It does not replace
or alter the v1 production client. Use `?renderer=pixi` or `?renderer=dom` to
mount the same deterministic 61-card scene behind either adapter.

`RemoteRoomRuntime` and the lazily loaded `RemoteRoomRoute` are the first real
v2 room composition. They require an explicit trusted `ConnectSessionOptions`
handoff and are not selected by `main.tsx` yet. Admission capabilities must not
be placed in a URL, browser storage, DOM, or log; the public route stays closed
until ADR-018's one-time browser ticket bootstrap is implemented.

Both screens preserve the v1 75.5% board / 24% side-panel split. The room screen
mounts the effective live/replay board, multiplayer/replay activity surface,
legacy replay controls, and externally owned route teardown. Normal sidebar
actions, chat, deck/settings navigation, and public room admission remain later
slices.

Run the Chromium decision suite with `pnpm run test:renderer:browser` after
installing Playwright's Chromium browser. On NixOS, set
`PTCGSIM_CHROMIUM_PATH` to the Nix-provided Chromium executable.
