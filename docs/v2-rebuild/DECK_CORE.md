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
- simulator CSV serialization and transactional parsing; and
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
package adds 108 TypeScript tests over the same cases plus hardened boundaries.

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
  src/card-search.ts       pure normalization/planning/local controls
  src/index.ts             reviewed minimal public API
apps/web/src/features/deck/
  deck-builder-store.ts        independent main/alternate edit transactions
  tcgdex-card-catalog.ts        browser catalog orchestration and public seam
  tcgdex-catalog-contract.ts    provider limits, types, and typed failures
  tcgdex-catalog-http.ts        bounded direct-browser JSON transport
  tcgdex-catalog-decode.ts      strict provider response normalization
  tcgdex-catalog-runtime.ts     bounded concurrency and set-date LRU cache
```

The package has no runtime dependencies and uses an ES-only TypeScript project.
It is a root project reference and a reviewed public-API entrypoint. The web app
declares it only for the isolated deck adapters; no route imports them, so they
do not enter the production module graph yet.

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

## Verification and success criteria

This checkpoint is complete when:

1. all 79 unchanged v1 tests and all package tests pass;
2. strict TypeScript, formatting, lint, package-boundary, public-API, and cycle
   gates pass;
3. the complete repository quality and build gates pass;
4. the generated public API baseline contains only the deliberately exported
   deck operations and value types; and
5. production bundle output is unchanged because no route imports the package.

## Remaining deck slices

The following remain separate, reviewable checkpoints:

1. add file/download/unload and canonical deck-install adapters;
2. reconstruct the existing Deck panel in React without changing its controls,
   labels, layout, target-main/alternate behavior, or keyboard flow;
3. connect the already prepared custom-card-back chooser at its original Deck
   panel location; and
4. activate the panel only after component, browser, multiplayer, solo, import,
   and accessibility parity evidence is green.

Rollback for these checkpoints is removal of the unused package and unmounted
web adapters plus their project, lockfile, documentation, and public-API
entries. No saved, wire, canonical, or production runtime format is changed.
