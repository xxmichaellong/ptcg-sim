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
web adapters. In particular, the existing network-bound search implementation
was not copied into this package: the later catalog adapter will inject request
and cancellation behavior and return data to these pure search controls.

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
```

The package has no runtime dependencies and uses an ES-only TypeScript project.
It is a root project reference and a reviewed public-API entrypoint. No app
declares it as a dependency until a production consumer is ready in the same
reviewed change.

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

1. add an abortable TCGdex catalog adapter with injected transport, bounded
   concurrency, response validation, caching, and failure tests;
2. add a headless main/alternate deck-builder store with dirty-state semantics;
3. add file/download/unload and canonical deck-install adapters;
4. reconstruct the existing Deck panel in React without changing its controls,
   labels, layout, target-main/alternate behavior, or keyboard flow;
5. connect the already prepared custom-card-back chooser at its original Deck
   panel location; and
6. activate the panel only after component, browser, multiplayer, solo, import,
   and accessibility parity evidence is green.

Rollback for this checkpoint is removal of the unused package and its project,
lockfile, documentation, and public-API entries. No saved, wire, canonical, or
production runtime format is changed.
