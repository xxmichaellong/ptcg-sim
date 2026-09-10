# V2 quality gates

## Purpose

The rebuild now has one reproducible local contract and one matching pull-request
workflow. Static, type, build, and browser gates apply to the isolated v2
workspace and its shared characterization evidence; they intentionally do not
reformat or lint the frozen v1 runtime. The repository-wide dependency audit and
narrow legacy-server startup smoke test are explicit security exceptions.

## Canonical commands

| Command                         | Contract                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run format:check:v2`      | Check formatting for v2 apps/packages/tests/docs, tooling, and root configuration.                                           |
| `pnpm run lint:v2`              | Run non-type-aware `typescript-eslint` rules plus JavaScript ESLint rules with zero warnings.                                |
| `pnpm run check:boundaries:v2`  | Reject legacy/deep/undeclared imports and cycles in the workspace source graph; verify card-back source integrity.           |
| `pnpm run check:api:v2`         | Reject unreviewed workspace entrypoints and exported symbol additions, removals, renames, or type/value-kind changes.        |
| `pnpm run check:cycles:v2`      | Check relative TypeScript module cycles while excluding generated `lib`, `dist`, `.wrangler`, and Worker types.              |
| `pnpm run typecheck:browser:v2` | Typecheck Playwright specs/support against the strict production profile, including unchecked-index protection.              |
| `pnpm run typecheck:v2`         | Strictly build production references and typecheck Worker model/runtime, browser harnesses, and TypeScript operator tooling. |
| `pnpm run test:tooling:v2`      | Prove architecture/API gates, legacy-corpus privacy/determinism, and legacy-server dependency compatibility.                 |
| `pnpm run check:legacy-corpus`  | Operator-only: convert an explicit private corpus into redacted deterministic evidence, optionally comparing a baseline.     |
| `pnpm run build:v2`             | Build Worker and web artifacts, then verify bundle provenance, fixture exclusion, and emitted card-back bytes.               |
| `pnpm run check:v2`             | Run every non-legacy, non-browser check above plus v2 unit and Worker-runtime tests.                                         |
| `pnpm run check:ci`             | Run the frozen 79-test v1 suite followed by `check:v2`; this is the required non-browser CI job.                             |
| `pnpm run test:preview:browser` | Build the web app, serve it and the room Worker from one Wrangler origin, and run the production-topology Chromium gate.     |
| `pnpm run check:browser`        | Run the sequential Vite/Wrangler browser suite, then the isolated built-production topology lane, in Chromium without retry. |
| `pnpm run check:full`           | Run `check:ci` and then `check:browser` locally.                                                                             |
| `pnpm run audit:dependencies`   | Query the registry advisory service and reject known runtime or development dependency vulnerabilities at any severity.      |

Hosted CI disables the runner's unrelated Google Chrome apt source before
installing Playwright Chromium, then may retry that browser/dependency install
up to three times because required package mirrors can still be temporarily
inconsistent. The browser regression command itself remains single-attempt and
fail-fast, so this infrastructure recovery cannot conceal a test failure.

Use `corepack pnpm` when invoking these commands directly from a new checkout.
The repository pins pnpm 11.24.0 in `packageManager`.

`check:legacy-corpus` is deliberately not a CI corpus run because no raw private
exports belong in the repository. It accepts `--input <directory>` and optional
`--expect <redacted-report.json>` arguments. In-repository source data must be
under the ignored `.private/legacy-import-corpus/` tree; the expected report must
be outside that input tree. The checked-in ten-test synthetic suite still runs
inside `test:tooling:v2`. Full handling and privacy caveats are documented in
[`LEGACY_IMPORT.md`](./LEGACY_IMPORT.md).

## Enforced architecture boundary

`scripts/check-v2-boundaries.mjs --source` parses production TypeScript with the
TypeScript compiler API. It rejects:

- imports into the root v1 `client/` or `server/` trees;
- relative imports across workspace ownership boundaries;
- `@ptcgsim/*` deep imports that bypass a package export;
- undeclared workspace imports;
- any production, optional, or peer runtime dependency declaration on the
  quarantined `@ptcgsim/legacy-import` package; and
- cycles in the workspace import graph.

The importer quarantine applies even when the declared dependency is unused;
dev-only declarations remain available for isolated compatibility tests. It may
be removed only in the reviewed route-activation change after representative
real-user compatibility evidence is approved.

`--bundles` requires parseable version-3 source maps and checks their provenance.
The web artifact may contain the web app, client session, protocol, renderer
packages, and only the explicitly safe game-core identity/hash helpers. It may
not contain room-authority, server, frozen legacy roots,
`packages/legacy-import/`, or `apps/web/src/dev/` sources. The last two rules
keep both the importer and creator-only `?dev-room=1` integration seam closed if
an earlier source/development guard is defeated. The Worker artifact may contain
only its server app, game core, protocol, and room-authority sources, so it also
rejects importer provenance. Every emitted
JavaScript file must have a map except a syntax-checked
import/export-only facade whose targets are present in the build, or the exact
digest-pinned source-free Rolldown runtime emitted by the pinned toolchain. The
checker also rejects the serve-only renderer cache fixture in production output.

## Reviewed workspace API surface

`scripts/check-v2-public-api.mjs` discovers every export-bearing package under
`apps/*` and `packages/*`, resolves each explicit package entrypoint with the
TypeScript compiler, and compares its exported names and type/value kinds with
[`PUBLIC_API_SURFACE.json`](./PUBLIC_API_SURFACE.json). It fails closed on
unsupported or divergent conditional exports, targets outside the owning
package, missing/non-TypeScript targets, entrypoint compiler errors, newly
exported packages or subpaths, and symbol drift.

The report currently records 9 export-bearing packages, 9 entrypoints, and 494
symbols. The current reviewed addition is the room-authority admission
transaction validator used by the server persistence adapter; private decoders
and candidate-building internals remain unexported. `pnpm run
check:api:v2` is part of `check:static:v2`. Regenerate the
report with `node scripts/check-v2-public-api.mjs --write` only after reviewing
whether each surface change is deliberately public; the quality job separately
ensures generators leave tracked files unchanged.

## Strict browser harness

`tsconfig.browser.json` inherits the same strict and
`noUncheckedIndexedAccess` settings as production. It covers Playwright
configuration for both browser lanes, every browser specification/support
module, and the shared typed renderer-spike window handle. Legacy oracle
traversal uses literal tuple indices where cardinality is fixed and explicit
fail-fast checks where fixture data is looked up dynamically, so malformed
evidence cannot be hidden with unchecked casts or a weaker test-only compiler
profile.

The default `/v2/assets/cardback.png` is copied byte-for-byte from the current v1
asset. Source and built copies must retain SHA-256
`44a5ffdcd9df23d3322250da733099c2c29c984362260efc5914a5a8745fa327`,
1,065,955 bytes, and a 736×1024 RGBA8 non-interlaced PNG header.

## Production-topology preview

The canonical Wrangler configuration publishes `apps/web/dist` as the Worker's
static asset collection. Static files are served before Worker code, unknown
browser navigation receives the Vite SPA shell, and `/v2/*` runs the authority
first except for the explicit `/v2/assets/cardback.png` static route. New public
assets under the versioned namespace require a reviewed exception instead of
silently inheriting an open subtree. `build:v2` builds web assets before the
Worker dry run so the uploaded asset manifest cannot come from a stale or
missing directory.

Vite still emits hidden source maps because the bundle-provenance gate parses
them locally. The built entry modules contain no `sourceMappingURL` hint, and
`apps/web/public/.assetsignore` excludes every map from Wrangler's public asset
manifest. Production symbolication must upload those maps to a separately
controlled diagnostics destination; making them public requires explicit
review.

`playwright.preview.config.ts` owns an isolated server on port 4174 and executes
only `tests/browser/production-topology.spec.ts`. It verifies the built app and
hashed modules load from Wrangler, nested navigation falls back to the SPA, the
developer-only room route and handle stay absent even when their query flag is
requested, and repeated SPA → health → SPA document replacement leaves exactly
one fresh DOM board or no board as appropriate. It also proves:

- `/v2/health`, room creation, and admission-ticket exchange reach Worker JSON
  routes on that same origin with the hardened no-store boundary;
- an unknown authority path returns Worker `404 Not Found`, not the SPA shell;
- `/v2/assets/cardback.png` remains the digest-pinned static PNG and a missing
  browser subresource request does not fall back to HTML;
- built entry JavaScript advertises no map URL and guessed map paths cannot
  return source-map JSON; and
- no authority request is triggered by the production app merely because the
  development query flag is present.

This local `workerd` lane validates routing and artifact composition. It does
not claim Cloudflare CDN-cache behavior, a managed preview deployment, regional
network behavior, or production rollout approval.

## GitHub Actions contract

`.github/workflows/ci.yml` runs for pull requests, pushes to `main`, and manual
dispatch. It grants read-only repository contents permission, cancels superseded
runs, pins action revisions, and pins Ubuntu 24.04 plus Node 24.19.0.

The `quality` job installs the frozen lockfile, runs `audit:dependencies`, runs
`check:ci`, and verifies that its generators do not modify tracked files. The
audit fails on any reported severity; registry transport failures are ignored so
an advisory-service outage cannot make unrelated changes unmergeable. The
updated legacy dependency graph is additionally exercised through a child-process
smoke test covering its rendered root, SQLite-backed import lookup, and a real
Socket.IO player admission. Only after the quality job succeeds does the `chromium` job install
Playwright's own Chromium with its Linux dependencies and run `check:browser`.
The first Playwright lane starts Wrangler on port 8787 and Vite on port 4173.
After it tears both down, the production-topology lane builds Vite and starts
one Wrangler origin on port 4174. Browser reports, failure screenshots, and
traces are retained as a 14-day artifact. Browser binaries are not cached.

## Explicit residual gaps

- Current CI proves default renderer cases at 1280×720/DPR 1 and source-oracle
  cases with explicit 1600×900/DPR 1 overrides. The planned 1366×768 and
  1920×1080/DPR 2, pinned-font, Firefox, Safari, and physical-GPU release matrix
  remains outstanding.
- Source-map provenance enforces package containment; it does not replace the
  browser request-interception tests that prove hidden card identities and image
  URLs are never requested.
- Wrangler now joins built web assets and Worker routes under one production-like
  origin and the local browser gate proves the routing contract. A managed
  preview deployment still must validate CDN headers/cache behavior, WebSocket
  upgrade routing, regional/platform behavior, and rollback before a public room
  route ships.
- The developer-only creator route exercises the actual route/runtime/renderer
  ownership stack. A 20-cycle StrictMode test proves exact teardown with mocked
  transport, while a separate Chromium gate proves the real local Wrangler/Vite
  HTTP and WebSocket path through initial admission, an unclean-loss reconnect
  with the rotated resume capability, same-renderer continuity, a post-resume
  command, and exact two-socket teardown. The browser supplies the reserved
  unclean-close event that ordinary JavaScript cannot generate from the network;
  the resumed socket, Durable Object handshake, prior-socket supersession, and
  command are real. A second Chromium case performs three full document
  navigation cycles through that stack and proves each non-persisted
  `pagehide` closes the session, starts its native socket close, and removes the
  owner before the neutral document mounts; persisted pagehide preservation is
  pinned in the unit layer. ADR-020's separate five-context Chromium path covers
  rotated player invitation transfer plus two distinct spectator claims without
  URL, document, or storage exposure. A four-context companion drives the
  production-built lobby's actual Generate, Copy, native paste, role reflection,
  Join, rotated rejection, player-two/spectator connection, authenticated chat,
  flower and player Attack submission, spectator mutation exclusion, confirmed
  durable Leave, fresh-lobby return, and safe-DOM path.
  The production-topology lane separately proves the query-gated lobby chunk is
  reachable from the built SPA without creating a room on mount. Deployed
  navigation and physical BFCache restoration remain outstanding.
- Schema-v7 admission now makes solo replay disclosure structurally safe by
  persisting a one-player ceiling and rejecting a second human through every
  credential path. The protocol, Worker, client bootstrap, and hidden
  development harness now select that persisted mode at creation and exercise
  real solo replay. A visible production mode selector remains deliberately
  unwired; it must reuse this explicit request rather than infer safety from
  live sockets.
- The keyboard parity lane includes a deny-by-default real-v1 oracle for Enter,
  Alt-Enter, and Slash loose-board actions plus a selected-DOM candidate case.
  The source pages pin destination and shuffled-deck arrays, outer action and
  export records, while the candidate pins viewer-derived ordered preconditions
  and editable-target silence. The existing overlay lane also proves native
  Enter menu activation cannot leak into the global board shortcut bridge.
- The unselected deck-key lane pairs five fresh deny-by-default v1 pages with a
  candidate DOM case. It pins draw/top-view/bottom-view/shuffle arrays, outer
  and export actions, deterministic indices, viewer-derived commands, count
  clamps, editable silence, and the exact v1 Alt-Control-digit partial mutation
  plus DOM exception. The candidate must reject that ambiguous chord with zero
  traffic.
- The global coin-key lane pairs five fresh deny-by-default v1 pages with one
  candidate DOM case. It pins deterministic heads/tails text and random-call
  count, selected-card fallthrough, empty legacy action logs, replay/spectator
  silence, and the Alt-`F` board-flip boundary. The candidate must submit only
  parameterless `FlipCoin`, retain selection, suppress editable input, and
  reject replay before submission.
- The Alt-`F` lane pairs seven fresh deny-by-default v1 pages with the protected
  candidate. It pins reversible orientation, modifier variants, retained
  selection, ordinary multiplayer's consumed no-op, coaching/spectator
  eligibility and two legacy visibility relays, replay-local behavior, editor
  silence, and empty action/export history. The candidate must call only the
  renderer-local perspective seam for an explicitly eligible player or a
  spectator, retain replay/selection state, and create no authority, command,
  action, rejection, or socket traffic; disclosure remains projection-owned.
- The global Escape lane pairs six fresh deny-by-default v1 pages with the
  protected candidate. It pins simultaneous popup/zone/selection/target cleanup,
  selected full-stack closure, Control/Alt/Shift variants, replay/spectator
  locality, focused-input silence, non-consumed defaults, and empty action,
  export, and socket history. The candidate must call only the existing
  all-scope local presentation dismissal, clear selection/context/zone/preview,
  preserve overlay-owned scoped Escape, and emit no command or rejection.
- The Shift-reference lane pairs six fresh deny-by-default v1 pages with the
  protected candidate. It compares all six headings, 53 ordered entries and
  shortcut values, 52 code tokens, the macOS note, exact 1600×900 bounds, and
  computed light/dark paint. It pins left/right Shift hold/release, selected
  player prevention, spectator/native defaults, replay, editable suppression,
  release after focus migration, Escape closure, and empty action/export/socket
  history. Candidate blur cleanup must also prevent a sticky reference without
  producing controller, command, rejection, or renderer traffic.
- The selected Q/E lane begins with nine fresh deny-by-default V1 cases. They
  pin identical Q/E target mode, source-board-only active/bench tops, exact green
  paint, evolution/attachment order, export mirroring, three cancellation paths,
  input/spectator/top-card guards, cross/same-stack reattachment, lower-evolution
  reclassification, staged resolution, and the V1 replay leak. The atomic
  stable-ID V2 contract in `ATTACH_EVOLVE_TARGETING.md` is now implemented across
  both renderers, controller cleanup, strict protocol, authority policy, source
  and target preconditions, event replay/persistence, private work-area
  ownership, and server model generation. Native Chromium drives Q/E paint,
  Escape/background cancellation, hand evolution/attachment, existing
  attachment and lower-evolution placement, exactly-once submission, and replay
  denial. V2 rejects replay before installing target paint or submitting a
  command.
- The unselected lifecycle-key lane pairs nine fresh deny-by-default v1 pages
  with one candidate DOM case. It pins exact setup/reset/turn messages and
  action/export records, owner rewriting, selection boundaries, spectator
  silence, and the v1 replay-guard defect. The candidate must derive the viewer,
  preserve selected-key precedence, suppress editable input, emit each intended
  live command once, and reject each replay request before submission.
- The unselected hand-key lane pairs ten fresh deny-by-default v1 pages with one
  candidate DOM case. It pins all three native prompt/default paths, cancel
  alert, Alt-`D` default suppression, deterministic zone/shuffle order,
  random-call counts, messages, live/export records, selected/spectator silence,
  and v1 replay leakage. The candidate must bind the prompt to the viewer/hand
  and initiating action, reject forged stages, preserve invalid/cancel behavior,
  submit exactly one existing atomic command for valid input, leave randomness
  to authority, suppress selected/editable input, and reject replay before a
  prompt appears.
- The solo-undo key lane pairs six fresh deny-by-default v1 pages with one
  explicitly solo-capable candidate DOM case. It pins successful source
  reconstruction, announcement/action/export records, loading-button state,
  rapid-repeat suppression, selected default prevention,
  multiplayer/spectator/editable silence, and replay leakage. The candidate
  must derive the viewer, emit only `ApplySoloUndo`, reject replay before
  resolution, and queue at most one command for a rapid repeat. A real session
  unit gate must prove `command_pending` allocates no sequence and writes no
  frame until the first authority result settles.
- The mulligan-key lane pairs seven fresh deny-by-default v1 pages with the
  protected candidate and real local Worker/browser route. It pins exact
  neutral text/class and solo/multiplayer host, modifier behavior, relay shape,
  empty action/export history, selected default prevention, spectator/editor
  silence, and v1 replay leakage. V2 must send no actor/text, derive the player
  from the active server binding, broadcast a typed ephemeral fact without any
  authority/sequence/history mutation, reject spectator forgery, validate the
  current revision/player on receipt, and consume live delivery silently during
  replay. General chat is not accepted as a substitute.
- The R-key lane pairs ten fresh deny-by-default v1 pages with the protected
  candidate. It pins local refresh and refresh-before-reset ordering, top/lower
  stack rotation, single-card BREAK rotation, stadium constraints, action
  indices, selection/default behavior, replay/full-view/spectator/editor
  boundaries, and exact candidate target-value commands. Unselected refresh
  must create no command or state change; selected commands must resolve a
  current stable card ID, retain selection, and reject replay. Legacy
  inline-angle, margin, and per-evolution BREAK history remains diagnostic and
  must not be inferred from canonical quarter turns.
- The V-key lane pairs eleven fresh deny-by-default v1 pages with the protected
  candidate and real local Worker/browser route. It pins modifier-agnostic
  bottom-deck opening, exact solo/multiplayer row and relay shape, selected
  stack/card preview, spectator/default behavior, editable silence, empty action
  history, and v1 replay leakage. V2 must route deck/preview presentation by
  stable recipient-safe IDs, send a parameterless player declaration only after
  local opening, derive its actor at the server, reject spectators and malformed
  revision/player delivery, create no authority/command/replay mutation, and
  allow local replay inspection without sending or presenting a live declaration.
