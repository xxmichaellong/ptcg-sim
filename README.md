# PTCG-sim

PTCG-sim is a manual Pokémon TCG tabletop for Solo practice and online play.
Players move the cards and manage the game; the simulator does not enforce
Pokémon TCG rules automatically.

The current v2 application is React and TypeScript in `apps/web`, backed by a
Cloudflare Worker and room Durable Objects in `apps/server`. Shared game,
session, deck, protocol, and renderer code lives in `packages/`. The legacy
Express/Socket.IO application remains in `client/` and `server/` with its own
startup command.

## Develop v2

Use Node.js 24 or newer and the pnpm version pinned in `package.json` through
Corepack. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @ptcgsim/web run build
```

The initial web build creates `apps/web/dist`, which the Worker's static-assets
configuration requires. Then start the two development servers in separate
terminals:

```sh
corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 8787
```

```sh
corepack pnpm run dev:v2 --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://127.0.0.1:5173/> for a Solo table. The app bar opens Play online,
Deck, Settings, and the command palette. `?room-lobby=1` opens Play online
instead of creating the initial Solo room. The default renderer is React DOM;
`?renderer=pixi` selects Pixi on either entry.

Vite proxies the authority's HTTP and WebSocket routes to the local Worker.
Set `PTCGSIM_V2_SERVER_ORIGIN` on the web development command if the Worker uses
another origin; no client URL edit is needed. See
[the web contributor guide](./apps/web/README.md) for diagnostic routes and
ownership details.

## Verify changes

Run these commands from the repository root:

- `corepack pnpm run check:ci` — formatting, lint, translations, architecture,
  types, legacy/unit/runtime tests, and builds.
- `corepack pnpm run check:browser` — Chromium regression and built-Worker
  browser lanes.
- `corepack pnpm run check:cross-browser` — focused Firefox and WebKit journeys.
- `corepack pnpm run audit:dependencies` — lockfile advisory check.
- `corepack pnpm run check:full` — all of the above.

Browser checks need the corresponding Playwright browsers. Local browser runs
must use a checkout that is not being edited while Vite serves it. See
[quality gates](./docs/v2-rebuild/QUALITY_GATES.md) for environment requirements,
CI behavior, and verification limits.

The [architecture and migration documents](./docs/v2-rebuild/README.md) record
the accepted contracts. Current interface decisions include the
[table shell](./docs/v2-rebuild/ADR-030-TABLE-FIRST-SHELL-AND-MOBILE.md),
[app bar](./docs/v2-rebuild/ADR-036-APP-BAR.md), and
[tutorial](./docs/v2-rebuild/ADR-038-TUTORIAL-MODE.md). Deployment and continuation
activation have separate procedures in
[server operations](./apps/server/OPERATIONS.md) and the
[continuation preview runbook](./apps/server/CONTINUATION_PREVIEW_RUNBOOK.md).

## Run the legacy application

After installing dependencies, create its database directory and start its
Express server from the repository root:

```sh
mkdir -p server/database
corepack pnpm start
```

Open <http://localhost:4000/>. SQLite creates `server/database/db.sqlite` on
startup. `PORT` changes the HTTP listener, and `ADMIN_PASSWORD` configures the
Socket.IO admin password. The legacy browser still has a hard-coded Socket.IO
origin in
[`global-variables.js`](./client/src/initialization/global-variables/global-variables.js);
it has no environment override, so its multiplayer traffic does not
automatically follow a local server or a changed `PORT`. For isolated local
play, use the commented `io('http://localhost:4000/')` declaration in that file
instead of the production origin, matching your chosen port.

## Contact

- [Twitter](https://twitter.com/xxmichaellong)
- [Discord](https://discord.gg/jMfhQa38mh)

PTCG-sim is open source under the [MIT license](./LICENSE).
