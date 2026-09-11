# Deck core migration

## Status and scope

`@ptcgsim/deck-core` is the browser-independent foundation for the replacement
deck builder. It ports the behavior currently characterized by the 79 frozen v1
deck tests, while remaining unused by both production routes. This checkpoint
therefore changes no visible UI, deck workflow, or live-game behavior.

The package owns only deterministic data work:

- card identity comparison and immutable grouped-deck updates;
- counts, type filters, flattening, and display-order sorting;
- TCG versus Pocket detection and validation;
- simulator CSV serialization and transactional parsing;
- pasted-list parsing, format detection, local image resolution, and legacy
  card-type lookup; and
- search-term normalization, query planning, local pool filtering, and sorting.

It does not own React state, file pickers, unload prompts, downloads, browser
storage, image loading, or TCGdex requests. Those concerns belong to explicit
web adapters. The existing network-bound search implementation is therefore not
inside this package: the unmounted web catalog adapter injects request and
cancellation behavior and returns data to these pure search controls.

## Compatibility contract

For valid existing inputs, the port preserves:

- grouping by card name and variant equality that ignores `image` and `count`;
- Pokémon, Trainer, Energy, and total counts;
- Pokémon-before-Trainer-before-Energy display order;
- Pocket detection from `/tcgp/` and `/pocket/` image paths;
- exact 20-card Pocket and 60-card TCG sizes, two/four non-Energy copy limits,
  and the existing TCG tie-break for automatic format detection;
- all E4, LV.X, Prism Star, Gold Star, Delta, EX, and GX query aliases; and
- the `QTY,Name,Type,URL` simulator interchange shape and legacy image mapping.

The v1 modules and their 79 tests remain frozen and continue to run. The new
package adds 119 TypeScript tests over the same cases plus hardened boundaries.

## Deliberate hardening

The new APIs close malformed-input behaviors without changing the valid path:

- added cards are cloned so later caller mutation cannot alter stored deck
  state;
- cyclic metadata comparison terminates;
- card names such as `__proto__` are ordinary own entries and cannot mutate the
  result object's prototype;
- every variant is inspected for mixed TCG/Pocket pools instead of trusting only
  the first variant in a same-name group; and
- CSV parsing is bounded, understands quoted commas/quotes/newlines and CRLF or
  BOM input, validates every row, and returns no deck if any issue exists.

`parseSimCsvResult` is the production-facing import boundary. It returns either
the complete deck or typed issues; there is no partially accepted deck. Current
bounds are one million input code units, 10,000 rows, 10,000 copies per row,
100,000 total cards, 256 code units for a name, 64 for a type, and 4,096 for an
image URL. These are resource bounds, not URL host or scheme restrictions. A
valid image string is retained exactly and later browser rendering follows the
direct arbitrary-image policy in
[`ADR-013-ARBITRARY-IMAGE-URLS.md`](./ADR-013-ARBITRARY-IMAGE-URLS.md).

## Files and dependency boundary

```text
packages/deck-core/
  src/types.ts             shared deck/card value types
  src/card-compare.ts      internal variant identity
  src/deck-state.ts        immutable grouping/count/filter operations
  src/card-sort.ts         internal flattening and supertype ordering
  src/deck-validation.ts   format detection and rules
  src/csv-adapter.ts       bounded transactional interchange
  src/pasted-decklist.ts   bounded local pasted-list parser/resolver
  src/legacy-card-type-lookup.ts  source-equivalent threshold lookup
  src/legacy-{,old-}card-types.json  frozen v1 threshold-table copies
  src/card-search.ts       pure normalization/planning/local controls
  src/index.ts             reviewed minimal public API
apps/web/src/features/deck/
  LegacyDeckBuilderSession.tsx    unmounted route/session composition owner
  LegacyDeckBuilderWorkspace.tsx  unmounted source-shaped React workspace
  LegacyDeckBuilderWorkspace.css  source-equivalent light/dark workspace skin
  LegacyDeckImportPanel.tsx  unmounted source-shaped right panel/review table
  LegacyDeckImportPanel.css  source-equivalent panel/menu/review-table skin
  popular-decklists.ts       lazy validated/cached sample-corpus boundary
  popular-decklists-data.json  exact dynamically imported v1 sample data
  pasted-decklist-import.ts   local parse/provider merge/native preload transaction
  limitless-decklist-contract.ts  provider limits, result types, typed failures
  limitless-decklist-http.ts      bounded credential-free JSON POST transport
  limitless-decklist-decode.ts    strict consumed-field response decoder
  deck-builder-store.ts        independent main/alternate edit transactions
  deck-browser-io.ts           bounded CSV file/download/unload ownership
  deck-install-adapter.ts      canonical conversion and acknowledged drain
  tcgdex-card-catalog.ts        browser catalog orchestration and public seam
  tcgdex-catalog-contract.ts    provider limits, types, and typed failures
  tcgdex-catalog-http.ts        bounded direct-browser JSON transport
  tcgdex-catalog-decode.ts      strict provider response normalization
  tcgdex-catalog-runtime.ts     bounded concurrency and set-date LRU cache
apps/web/src/dev/
  LegacyDeckBuilderBrowserHarness.tsx  direct-import-only Playwright mount
tests/browser/
  legacy-deck-builder-browser-parity.spec.ts  real-v1 parity and lifecycle gate
```

The package has no runtime dependencies and uses an ES-only TypeScript project.
It is a root project reference and a reviewed public-API entrypoint. The web app
declares it only for the isolated deck adapters; no route imports them, so they
do not enter the production module graph yet.

## Pasted deck-list parser checkpoint

`parsePastedDecklist` is the deterministic local half of the source textarea
importer. It recognizes the existing Pokémon TCG Live list shapes, promo and
Pocket-promo codes, gallery-prefixed numbers, historical PTCGO set codes,
pokemontcg.io catalog IDs, Japanese TPC set codes, name-only custom rows, and
the source's Basic Energy spellings. It detects Pocket versus legacy context to
disambiguate `B2`, preserves all six existing language choices, and synthesizes
the same direct TCGdex-independent image locations used by v1.

The current and historical card-type threshold tables are data-only copies of
the frozen v1 tables. Lookup is isolated behind two small pure functions;
malformed IDs and unknown sets return `Unknown` instead of throwing. The parser
itself performs no DOM, image, network, storage, timer, or random work. Missing
metadata remains an editable row for the later bounded provider fallback rather
than disappearing.

Valid source behavior is retained, with three deliberate parser corrections:

- each structured format must consume the complete line, so digits inside a
  card name or heading cannot become a fake set and card number;
- a rewritten gallery entry such as `BRS-TG 17` resolves as `BRS` / `TG17`
  instead of being split at earlier words in the card name; and
- advertised multiword name-only cards and Basic Energy rows keep their full
  names instead of donating their final words to fake metadata. The legacy
  no-image catalog override table is also applied in the local path where it
  was intended to run.

The boundary is transactional and capped before expensive parsing: one million
input code units, 10,000 lines, 8,192 code units per line, 10,000 copies per
row, 100,000 total cards, 256 code units per card name, 128 per identifier
token, and 4,096 per synthesized image URL. Invalid untyped language values
fall back to English, matching the source UI default. Successful rows are
frozen and the caller receives no partial result when any resource or value
check fails.

Ten deterministic tests cover each input family, format collisions, language
routing and runtime fallback, type thresholds, incomplete editable rows,
immutability, and every resource boundary. A read-only compatibility audit also
parsed all 168 checked-in sample decks (3,861 rows): every list parsed without
failure, retained a 60-card total, and had no locally missing image or type
metadata. That audit is evidence only; v2 does not import the v1 sample module.

## Bounded Limitless fallback and image-preload checkpoint

`pasted-decklist-import.ts` reconstructs the remaining non-UI import
transaction. It first calls the pure local parser, sends only unresolved
quantity/name rows to the source Limitless deck-list endpoint, merges matching
metadata without replacing local row identity, applies the source's final
Pocket Trainer fallback, and then requires every resolved image to emit a
native browser `load` event. No partial rows are published on failure. When the
source workflow expects manual correction, a failure may carry the same frozen,
bounded rows as an explicitly transient review draft; that draft cannot enter
the deck store or authority without the separate review-table confirmation.

The provider edge is explicit and narrow:

- the browser sends a credential-free CORS JSON `POST` only when local metadata
  is incomplete; complete sample/source rows make no provider request;
- input is limited to 200 parsed rows and a 65,536-code-unit JSON body;
- the streamed response is limited to one million code units, 200 cards, 200
  error strings, and bounded consumed name/set/number/region/type fields;
- non-2xx, network, body, malformed JSON, invalid-shape, and oversized-response
  cases become typed failures without exposing player text in diagnostics;
- name matching retains v1's trim/case/hyphen/whitespace equivalence and its
  first-match behavior; and
- an outage remains contained when local metadata plus the existing Pocket
  fallback can still complete the import, but unresolved rows remain retryable
  and are reported only by one-based row position.

The subsequent image preflight deliberately uses native `<img>` assignment,
not application `fetch`. It applies no URL parser, rewrite, scheme or host
allowlist, proxy, `crossOrigin` assignment, or CORS opt-in. The exact bounded
string is assigned to `src`; success retains that original string rather than
the browser's normalized property. V1 starts a whole deck in one pass, so the
default allows all rows to start while the 200-row ceiling keeps fan-out finite.
Abort detaches active handlers, prevents new loads, and publishes nothing.

The Limitless endpoint was checked read-only on 2026-09-10 with one known and
one unknown card. It returned the currently consumed `cards`/`errors`,
`name`/`set`/`number`/`region`/`card_type` shape and an explicit permissive CORS
response. This observation is not a test dependency. Twelve deterministic web
tests plus one new core resolver test cover no-request local completion,
request custody, normalized metadata merge, arbitrary TPC regions, Pocket
classification and outage containment, status/decoder/resource failures,
parse/empty/row limits, exact arbitrary native image assignment, load failure,
concurrency, and abort cleanup. The seam remains unmounted and absent from
production output.

## TCGdex catalog adapter checkpoint

The provider boundary follows the current official TCGdex v2 REST contract:

- REST is HTTPS, GET-only JSON according to the
  [official REST overview](https://tcgdex.dev/rest);
- card search returns `CardBrief` objects from `/v2/en/cards` according to the
  [official card-list documentation](https://tcgdex.dev/rest/cards);
- query fields use the provider's default case-insensitive contains filter, with
  `name=pikachu` as its documented example, according to the
  [official filtering documentation](https://tcgdex.dev/rest/filtering-sorting-pagination);
- detailed cards come from `/v2/en/cards/{id}` according to the
  [official card documentation](https://tcgdex.dev/rest/card); and
- set release dates come from `/v2/en/sets/{id}` according to the
  [official set documentation](https://tcgdex.dev/rest/set).

The `tcgdex-catalog-*` modules preserve the valid v1 search behavior while
closing its lifecycle and resource gaps:

- normalized terms and LV.X/EX/GX plans come from `deck-core`; dual spellings
  retain query order and deduplicate IDs;
- an empty term performs no request and a result above 2,000 summaries performs
  no detail requests;
- at most 150 details are hydrated, with eight concurrent detail requests and
  four concurrent set requests by default;
- list, detail, and set bodies have independent code-unit limits and every
  consumed provider field has a type/length decoder;
- non-2xx, unreadable, malformed JSON, invalid shape, and oversized search
  responses fail with typed errors; an individual bad detail or set lookup is
  contained as in v1;
- one `AbortSignal` covers list, detail, and set work, and cancellation is never
  converted into a successful empty result;
- requests omit credentials, request JSON directly from TCGdex, and never use a
  server proxy; and
- set release dates use an explicit 512-entry least-recently-used cache with a
  lifecycle `clearCache` operation.

Seventeen deterministic adapter tests cover query construction, normalization,
deduplication, huge-result/detail limits, detail and set concurrency, normalized
cards, partial provider failure, response validation and size limits, bounded
cache eviction/clearing, missing browser fetch, and cancellation before and
during hydration. A read-only live smoke on 2026-09-10 returned and normalized
all 12 current `Furret` summaries; its first card's set date was hydrated through
the set endpoint. This live observation is evidence, not a CI dependency.

## Headless deck-builder store checkpoint

`deck-builder-store.ts` owns only editor state and install acknowledgement. It
has no React, DOM, file, network, board, or room dependencies. Main and
alternate decks keep independent immutable snapshots, edit revisions, installed
revisions, dirty flags, and in-flight install generations. Target switching
therefore cannot move one target's unsaved flag onto the other target.

Closing the eventual panel can drain dirty installs in deterministic main, then
alternate order, with only one authority command in flight so the second cannot
carry a revision made stale by the first. An empty edited deck remains an
explicit install receipt; it is not silently marked clean and discarded. A
successful receipt marks only the exact submitted revision installed. If the
player edits again while that request is in flight, the newer revision stays
dirty and becomes a later receipt. Failure stays retryable, duplicate begins are
suppressed, copied or foreign acknowledgements are rejected, and an
authoritative external sync invalidates the older in-flight receipt
transactionally.

Multiplayer construction disables alternate selection and edits while retaining
the same main-deck behavior. Solo construction permits either target. External
deck synchronization does not switch the visible target, and all ingress decks
are cloned before being published as stable frozen snapshots suitable for
`useSyncExternalStore` later.

Thirteen deterministic tests cover independent target edits, selection and
multiplayer denial, no-op mutations, immutable add/remove/clear behavior,
uncloneable input rollback, external synchronization, dual and empty install
receipts, success/failure/retry, edits during an in-flight install, stale and
foreign acknowledgements, stable snapshots, and subscription teardown. The
store is still unmounted, so it changes no current route or UI behavior.

## Browser I/O and canonical install checkpoint

`deck-browser-io.ts` owns the browser-only edges excluded from `deck-core`.
Foreground CSV import rejects a file above 3,000,003 bytes before calling
`File.text()`, contains read failures and cancellation, and then delegates the
authoritative one-million-code-unit/all-or-nothing parse to
`parseSimCsvResult`. It does not inspect the filename, MIME type, URL scheme, or
host. Download retains `ptcg-sim-deck.csv` and
`text/csv;charset=utf-8`, removes its temporary anchor, and revokes its object
URL on both success and failure. The separately installed `beforeunload` guard
requests the browser-native confirmation only while either store slot is dirty
and has idempotent teardown.

`deck-install-adapter.ts` is the only permissive-deck-to-wire boundary. It
walks every actual variant instead of trusting cached group totals, aggregates
equal definitions, normalizes `Pokemon` to the canonical `Pokémon` category,
maps other unsupported types to `Unknown`, and enforces the protocol's 200-card
and 200-entry limits before submission. Large and optional small image strings
remain code-unit-for-code-unit exact; they receive only the shared
nonempty/4,096
code-unit resource checks and no parsing, rewriting, preload, CORS, scheme, or
host policy.

Canonical definition IDs are `deck:sha256:<digest>` over the exact visible
name/category/large-image/small-image tuple. This keeps IDs stable across
targets and reloads without embedding player text. Missing Web Crypto, digest
failure, malformed output, or a detected within-deck collision fails closed;
there is no weaker hash fallback.

`DeckInstallCoordinator` holds one store receipt through conversion, remote
submission, authority result, and its covering publication. It waits for an
empty client outbox before stamping each `LoadDeck`, preventing an earlier
queued command from making its revision stale. Main, alternate, and edits made
during an in-flight install then drain one at a time. Local submission failure,
authority rejection, terminal session state, disposal, conversion failure, and
external synchronization all release the receipt without incorrectly marking
the deck clean; the exact dirty revision remains retryable. Failure reporting
is typed and cannot mutate transaction state even if its UI callback throws.

Seventeen focused tests cover arbitrary non-web URL preservation, deterministic
definition identity, category mapping, aggregation, empty decks, wire/resource
bounds, malformed structures, digest/collision/cancellation failures, bounded
file reads, transactional parser errors, exact download and cleanup, dirty
unload teardown, outbox waiting, dual-target drains, in-flight edits, external
sync, local/authority/session failures, and disposal. Both adapters remain
unmounted and absent from the production module graph.

## React workspace reconstruction checkpoint

`LegacyDeckBuilderWorkspace.tsx` reconstructs the current full-height Deck
workspace in React without mounting it in either production route. It retains
the source IDs, labels, control order, default search/filter/sort values,
main/alternate target colors, summary and validation text, empty state,
right-click search preview, deck-row preview and add/remove controls, CSV
controls, clear confirmation, Play control, custom-card dialog, and light/dark
layout. The extracted stylesheet keeps the current dimensions and visual rules;
the v2 dark-route selector is the only selector-context translation.

The component consumes the already isolated catalog, transactional store, and
browser I/O boundaries. Rendering is a pure projection of stable store
snapshots. Main and alternate target state cannot alias, an import is applied
to the target selected when its file read began, a newer search aborts and
supersedes an older one, and unmount aborts both catalog and file work. The
closed off-canvas workspace is inert and hidden from accessibility APIs, the
custom dialog supports Escape and returns focus to its trigger, and async
notices use live regions. These changes do not alter the visible open-workspace
flow.

Custom-card image entry intentionally has no URL parser, scheme check, host
allowlist, proxy, application fetch, `crossOrigin` attribute, or CORS opt-in.
After legacy-compatible whitespace trimming and the shared 4,096-code-unit
resource bound, the exact string is assigned to a native `<img>`. The browser's
foreground `load` event remains required before the card can be added, as
required by ADR-013. The same string is then retained in all card image fields
and in the legacy-shaped custom card ID.

Nine deterministic component tests cover source DOM/default parity, closed
inertness, search and local filtering, stale-search cancellation, target-stable
import/export/clear/Play behavior, multiplayer alternate-target denial,
arbitrary-scheme native image assignment and load gating, exact custom-card
metadata, modal keyboard/focus behavior, deck-row event isolation and preview,
and teardown cancellation. This module and its CSS remain unimported by any
route, so the checkpoint changes no production UI or bundle.

## Right-side Deck panel and popular-corpus checkpoint

`LegacyDeckImportPanel.tsx` reconstructs the source's remaining right 24% Deck
surface without mounting it in a route. It retains the `deckImport`, P1/P2,
main/alternate textarea, book, Import, Confirm, Cancel, Save, wand, status,
language, card-back, and four-column review-table IDs and visible labels. Main
and alternate text remain independent, the selected target and language are
captured before asynchronous import, multiplayer keeps P2 disabled with the
source `Solo only!` notice, and every pending provider/sample operation has
explicit teardown ownership.

The imported candidate is held in a transient review transaction. Successful
provider rows and bounded incomplete/failing rows can be corrected in the same
QTY/Name/Type/URL table used by v1. Save downloads that draft without
publishing it. Cancel discards it. Confirm runs the hardened CSV boundary and
then atomically replaces only the target captured when Import began. In
particular, a player can fill an unresolved URL cell with any nonempty string
within the shared 4,096-code-unit bound; no parser, host/scheme allowlist,
rewrite, proxy, application fetch, or CORS setting is added, and the trimmed
exact string reaches the deck store only on Confirm.

The 22 historical menu groups and all 168 source decks are copied exactly into
`popular-decklists-data.json`. The source file is pinned by SHA-256
`88cfc37dc8d9251f31dedc2217376c46dca53a4978753e8c7328f1f2144fb526`.
The small source adapter dynamically imports the 125,609-code-unit corpus only
on first book/wand use, validates and freezes it under explicit group, deck,
name, per-list, and aggregate bounds, shares concurrent decoding, retries
failures, and preserves v1's ordered two-random-draw selection. An aborted
caller cannot cancel or poison the shared local-module result.

Seven panel tests and six sample-source tests cover exact defaults and labels,
closed inertness, target isolation/denial, lazy book selection, random target
custody, language/target capture, transient incomplete-row editing, arbitrary
image strings, Save/Cancel/Confirm publication boundaries, download content,
deduplicated loading, cancellation, exact corpus order/count/provenance, all
168 locally complete 60-card parses, source-equivalent random selection,
malformed/resource failures, retry, freezing, and shared-load abort behavior.
The panel, corpus, and review table remain absent from production output.

## Deck session-composition checkpoint

`LegacyDeckBuilderSession.tsx` joins the previously isolated pieces behind one
route-neutral React boundary without importing that boundary from a production
route. It creates one editor store and TCGdex catalog for the component
lifetime, shares the store across the right import panel and full-height
workspace, and accepts only `open` plus `onRequestClose` navigation ownership
from its eventual route. Multiplayer construction disables the alternate slot;
solo construction preserves both targets.

The boundary owns one `DeckInstallCoordinator` and one browser-native dirty-page
guard. Editing while Deck is open does not emit room traffic. A true-to-false
open transition or the workspace Play button begins the deterministic main,
then alternate drain. The editor remains dirty until the exact `LoadDeck`
command receives its authority result and covering state publication; failures
release in-flight ownership, report through a contained typed callback, and
leave the same revision retryable. Unmount disposes coordinator, session
subscription, pending ownership, unload listener, catalog/search/import work,
and card-back selection outside-in.

The source Change Card Back control now reaches the already isolated foreground
hook through this composition seam. It refuses to prompt until a ready player
projection exists, resolves the other side from the captured projection for a
solo alternate request, and otherwise submits for the actor. The hook retains
the accepted arbitrary-URL behavior and makes superseded/unmounted requests
inert.

Six composition tests plus the 73 directly adjacent store, install, browser-I/O,
workspace, panel, sample, pasted-import, and card-back tests cover shared target
state, multiplayer denial, closed-state traffic silence, close/Play flushing,
authority-publication acknowledgement, retryable rejection, exact arbitrary
card backs for both sides, not-ready refusal, unload guarding, and teardown.
The composed module remains absent from production output, so this checkpoint
still changes no current route, control, bundle, UI, or UX.

## Source-browser composition checkpoint

`LegacyDeckBuilderBrowserHarness.tsx` mounts that complete session only when a
Playwright test directly imports it from the Vite development server. It builds
the source-shaped application shell and uses a publication-capable fake client
session, but no application entry point imports the harness or composed Deck
surface. Production bundle provenance therefore remains the route-activation
boundary rather than relying on a runtime feature flag.

The browser gate opens the checked-in complete v1 runtime and the React
candidate side by side at 1600×900. It compares every visible control's tag,
label, select options, and placeholder; checks 12 panel/workspace landmarks
within two CSS pixels; and applies a bidirectional foreground-paint comparison
to main, alternate, and dark-alternate states. The paint ceiling is 0.5% in
each direction with three-pixel spatial and 24-channel color tolerance. This
gate found and corrected three source-parity gaps before route activation: CSS
percentage padding had been resolved against the new sidebar instead of the
source viewport containing block, and one source inline whitespace node between
the card-back and language controls had been omitted. The hosted Linux browser
also exposed that the candidate's textarea was missing the v1 form-control font
rule and therefore fell back to the user-agent monospace face; the component now
pins the same `Segoe UI` fallback stack as the source.

Two additional browser workflows exercise behavior that screenshots cannot:

- a custom or review-table image URL is assigned directly to a native `<img>`
  and retained exactly after trim, without `crossOrigin`, an application fetch,
  proxying, or a host/scheme policy; and
- import replacement, close/Play flushing, covering-publication
  acknowledgement, retry after authority rejection, multiplayer alternate
  denial, closed inertness, focus return, and idempotent teardown all retain
  their intended custody.

The three Playwright scenarios pass together with no page or console errors.
The direct-import harness, browser spec, session composition, and Deck feature
modules remain absent from the production module graph.

## Verification and success criteria

This checkpoint is complete when:

1. all 79 unchanged v1 tests and all package tests pass;
2. strict TypeScript, formatting, lint, package-boundary, public-API, and cycle
   gates pass;
3. the complete repository quality and build gates pass;
4. the generated public API baseline contains only the deliberately exported
   deck operations and value types; and
5. production bundle output is unchanged because no route imports the package;
   and
6. the real-v1/candidate browser composition gate passes control, geometry,
   paint, arbitrary-image, recovery, multiplayer, focus, and teardown evidence.

## Remaining deck slices

The source-browser prerequisite is now green. Production route activation
remains a separate, reviewable checkpoint: replace the current Deck navigation
ownership with this composed surface, prove bundle/route isolation and the full
live solo/multiplayer session matrix, and retain the legacy route as the
rollback boundary.

Rollback for these checkpoints is removal of the unused package and unmounted
web adapters plus their project, lockfile, documentation, and public-API
entries. No saved, wire, canonical, or production runtime format is changed.
