# V2 quality gates

## Purpose

The rebuild now has one reproducible local contract and one matching pull-request
workflow. The gates apply only to the isolated v2 workspace and its shared
characterization/browser evidence; they intentionally do not reformat or lint
the frozen v1 runtime.

## Canonical commands

| Command                         | Contract                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run format:check:v2`      | Check formatting for v2 apps/packages/tests/docs, tooling, and root configuration.                                           |
| `pnpm run lint:v2`              | Run non-type-aware `typescript-eslint` rules plus JavaScript ESLint rules with zero warnings.                                |
| `pnpm run check:boundaries:v2`  | Reject legacy/deep/undeclared imports and cycles in the workspace source graph; verify card-back source integrity.           |
| `pnpm run check:api:v2`         | Reject unreviewed workspace entrypoints and exported symbol additions, removals, renames, or type/value-kind changes.        |
| `pnpm run check:cycles:v2`      | Check relative TypeScript module cycles while excluding generated `lib`, `dist`, and Worker types.                           |
| `pnpm run typecheck:browser:v2` | Typecheck Playwright specs/support against the strict production profile, including unchecked-index protection.              |
| `pnpm run typecheck:v2`         | Strictly build production references and typecheck Worker model/runtime plus browser harnesses.                              |
| `pnpm run test:tooling:v2`      | Prove the boundary checker rejects legacy/deep imports, workspace cycles, forbidden web provenance, and missing maps.        |
| `pnpm run build:v2`             | Build Worker and web artifacts, then verify bundle provenance, fixture exclusion, and emitted card-back bytes.               |
| `pnpm run check:v2`             | Run every non-legacy, non-browser check above plus v2 unit and Worker-runtime tests.                                         |
| `pnpm run check:ci`             | Run the frozen 79-test v1 suite followed by `check:v2`; this is the required non-browser CI job.                             |
| `pnpm run check:browser`        | Start local Wrangler and Vite, then run all browser, transport, characterization, and renderer tests in one Chromium worker. |
| `pnpm run check:full`           | Run `check:ci` and then `check:browser` locally.                                                                             |

Use `corepack pnpm` when invoking these commands directly from a new checkout.
The repository pins pnpm 11.24.0 in `packageManager`.

## Enforced architecture boundary

`scripts/check-v2-boundaries.mjs --source` parses production TypeScript with the
TypeScript compiler API. It rejects:

- imports into the root v1 `client/` or `server/` trees;
- relative imports across workspace ownership boundaries;
- `@ptcgsim/*` deep imports that bypass a package export;
- undeclared workspace imports; and
- cycles in the workspace import graph.

`--bundles` requires parseable version-3 source maps and checks their provenance.
The web artifact may contain the web app, client session, protocol, renderer
packages, and only the explicitly safe game-core identity/hash helpers. It may
not contain room-authority, server, legacy, or `apps/web/src/dev/` sources. The
last rule makes the creator-only `?dev-room=1` integration seam fail closed if
its development guard is ever defeated. The Worker artifact may contain only
its server app, game core, protocol, and room-authority sources. Every emitted
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

The report currently records 8 export-bearing packages, 8 entrypoints, and 464
symbols. `pnpm run check:api:v2` is part of `check:static:v2`. Regenerate the
report with `node scripts/check-v2-public-api.mjs --write` only after reviewing
whether each surface change is deliberately public; the quality job separately
ensures generators leave tracked files unchanged.

## Strict browser harness

`tsconfig.browser.json` inherits the same strict and
`noUncheckedIndexedAccess` settings as production. It covers Playwright
configuration, every browser specification/support module, and the shared typed
renderer-spike window handle. Legacy oracle traversal uses literal tuple indices
where cardinality is fixed and explicit fail-fast checks where fixture data is
looked up dynamically, so malformed evidence cannot be hidden with unchecked
casts or a weaker test-only compiler profile.

The default `/v2/assets/cardback.png` is copied byte-for-byte from the current v1
asset. Source and built copies must retain SHA-256
`44a5ffdcd9df23d3322250da733099c2c29c984362260efc5914a5a8745fa327`,
1,065,955 bytes, and a 736×1024 RGBA8 non-interlaced PNG header.

## GitHub Actions contract

`.github/workflows/ci.yml` runs for pull requests, pushes to `main`, and manual
dispatch. It grants read-only repository contents permission, cancels superseded
runs, pins action revisions, and pins Ubuntu 24.04 plus Node 24.19.0.

The `quality` job runs `check:ci` and verifies that its generators do not modify
tracked files. Only after it succeeds does the `chromium` job install
Playwright's own Chromium with its Linux dependencies and run `check:browser`.
Playwright starts Wrangler on port 8787 and Vite on port 4173, waits on both
health URLs, and tears both down after the sequential run. Browser reports,
failure screenshots, and traces are retained as a 14-day artifact. Browser
binaries are not cached.

## Explicit residual gaps

- Current CI proves default renderer cases at 1280×720/DPR 1 and source-oracle
  cases with explicit 1600×900/DPR 1 overrides. The planned 1366×768 and
  1920×1080/DPR 2, pinned-font, Firefox, Safari, and physical-GPU release matrix
  remains outstanding.
- Source-map provenance enforces package containment; it does not replace the
  browser request-interception tests that prove hidden card identities and image
  URLs are never requested.
- The web build owns `/v2/assets/*`. The Cloudflare Worker has no static-assets
  binding and correctly does not embed the 1 MiB card back, so deployment routing
  must join the Worker and static web origin before a public room route ships.
- The developer-only creator route exercises the actual route/runtime/renderer
  ownership stack. A 20-cycle StrictMode test proves exact teardown with mocked
  transport, while a separate Chromium gate proves the real local Wrangler/Vite
  HTTP and WebSocket path for one complete creator session. Deployed navigation
  churn and the ADR-020 second-browser invitation path remain outstanding.
