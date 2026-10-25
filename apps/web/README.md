# PTCG Sim v2 web application

The web app opens a live Solo table by default. The table fills the window;
Play online, Deck, Settings, and help open from the app bar. The activity log
can open over the table or dock beside it. React DOM is the default renderer,
and `?renderer=pixi` selects the retained Pixi adapter.

This application and the Worker in `apps/server` are separate from the legacy
`client/` and `server/` application. Local development and browser checks do not
change production routing.

## Local development

Use Node.js 24 or newer and Corepack's pinned pnpm. Run the following from the
repository root, including the first web build so Wrangler has its configured
static-assets directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @ptcgsim/web run build
```

Start these in separate terminals:

```sh
corepack pnpm --filter @ptcgsim/server-v2 dev --ip 127.0.0.1 --port 8787
```

```sh
corepack pnpm --filter @ptcgsim/web dev --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://127.0.0.1:5173/>. Vite serves the app and `/v2/assets/*`, and proxies
`/v2/health`, `/v2/rooms*`, `/v2/continuations*`, `/v2/decks*`, `/v2/cards*`, and
`/v2/tournaments*` to the Worker, including WebSocket upgrades. The proxy keeps
the browser's host so same-origin admission checks work. Override the Worker
target with `PTCGSIM_V2_SERVER_ORIGIN` on the Vite command if needed.

## Entry points

The entry points are selected by `src/main.tsx` and the tutorial host:

| Address                                    | Behavior                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `/`                                        | Creates and opens the initial Solo room.                                                         |
| `/?room-lobby=1`                           | Opens Play online over an empty table; no room is created until requested.                       |
| `/?tutorial` or `/?tutorial=damage`        | Opens the tutorial lesson list or a named lesson on a separate practice table.                   |
| `/?renderer=pixi`                          | Selects Pixi instead of React DOM; combine with the other entries.                               |
| `/?renderer-spike=1&renderer=dom`          | Opens the synthetic renderer comparison scene without creating a room.                           |
| `/?dev-room=1&renderer=dom&name=Developer` | Development-only direct room bootstrap; defaults to multiplayer. Add `&room-mode=solo` for Solo. |
| `/?depth-lab=1`                            | Development-only table-depth diagnostic page.                                                    |

The `dev-room` and `depth-lab` modules are excluded from production bundles.
The renderer comparison remains available through its explicit flag; it is not
the normal landing page. Tutorial entry is removed from the address after it is
handled, so reload returns to the normal entry.

## Ownership and data flow

- `RemoteRoomLobby` owns room creation, invitation custody, and runtime
  replacement. Opening Play online over a Solo table keeps that game live;
  joining another room replaces it only after admission succeeds. The tutorial
  uses its own practice room while the player's table is retained.
- `RemoteRoomRuntime` owns the remote session, replay coordinator, and
  presentation stores. The Worker owns canonical game state; clients receive
  recipient-safe projections and submit typed commands through the board
  controller. Room credentials stay in private memory, outside URLs, React
  state, DOM, and browser storage.
- `@ptcgsim/renderer-contract` builds shared scenes and layout for both adapters.
  Renderer choice does not change authority, session, or replay ownership.
- Deck editing loads lazily. Saved decks use IndexedDB, with an in-memory
  fallback when storage is unavailable; preferences use local storage. Deck
  selections and card-back custody survive screen and room navigation.
- Replay downloads contain view-only perspective data. Solo can import those
  files without changing the live authority, and exiting replay returns to its
  latest view. Server-held multiplayer save/resume controls appear only when
  the Worker reports continuation enabled; checked-in configuration leaves it
  disabled.

The card catalog is built from TCGdex, and current deck suggestions come from
Limitless. The tournament deck-index crawl is configured `off` pending its
hosting-capacity decision. Browser tests supply catalog fixtures and disable
external catalog/crawl sources in their local Worker configuration.

The current interface contracts are
[ADR-030: table shell](../../docs/v2-rebuild/ADR-030-TABLE-FIRST-SHELL-AND-MOBILE.md),
[ADR-031: tabletop](../../docs/v2-rebuild/ADR-031-TABLETOP-BY-DEFAULT.md),
[ADR-033: deck screen](../../docs/v2-rebuild/ADR-033-DECK-SCREEN.md),
[ADR-036: app bar](../../docs/v2-rebuild/ADR-036-APP-BAR.md), and
[ADR-038: tutorial](../../docs/v2-rebuild/ADR-038-TUTORIAL-MODE.md).
[ADR-012](../../docs/v2-rebuild/ADR-012-MULTIPLAYER-SAVES-AND-EXPORTS.md) explains
replay and continuation boundaries. User-facing text uses Lingui; follow
[ADR-034](../../docs/v2-rebuild/ADR-034-LOCALIZATION.md) when adding messages.

## Build and verify

Run `corepack pnpm run check:ci` from the repository root for the non-browser
gate, or `corepack pnpm run build:v2` for web/Worker builds and bundle-boundary
checks. The build emits `apps/web/dist`, which Wrangler serves alongside the
Worker. Hidden source maps remain available for local provenance checks and are
excluded from public assets by `.assetsignore`.

`corepack pnpm run check:browser` covers the Chromium regression suite plus the
built-Worker and continuation configurations. For focused Firefox/WebKit
journeys, run `corepack pnpm run check:cross-browser`. The standalone built-Worker
topology lane is `corepack pnpm run test:preview:browser`; it starts
local Wrangler unless an external preview URL is explicitly supplied. These
checks validate their configured browser environments; physical-device and
production rollout acceptance are separate work.

On NixOS, `PTCGSIM_CHROMIUM_PATH`, `PTCGSIM_FIREFOX_PATH`, and
`PTCGSIM_WEBKIT_PATH` can select compatible browser executables. Use a quiet
checkout for browser runs, since source edits trigger Vite reloads. See
[quality gates](../../docs/v2-rebuild/QUALITY_GATES.md) for exact lanes and
[server operations](../server/OPERATIONS.md) for hosting. Continuation activation
and managed-preview procedures are in the
[continuation preview runbook](../server/CONTINUATION_PREVIEW_RUNBOOK.md).
