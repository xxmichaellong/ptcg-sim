# Legacy characterization locks

These tests freeze externally visible v1 surfaces while v2 is developed beside
it. They deliberately read the legacy source as data; they do not import its DOM
modules or make the new engine depend on v1.

If a legacy action, replay exception, or key binding changes, update the manifest
only after recording its explicit preserve/fix decision in
`docs/v2-rebuild/LEGACY_ACTION_MAP.md`. These inventory locks are the first layer;
scenario fixtures will add state, message, visibility, and ordering outcomes.

Renderer geometry locks additionally pair a manually reviewed numeric fixture
with source digests. Text sources are normalized to LF for portable hashing;
image fixtures are hashed as raw bytes. The browser harness loads those sources
through a deny-by-default origin and records CSS geometry without contacting the
legacy application server.

`legacy-contained-card-layout.test.ts` pins the narrower pile/stadium contract:
deck-first versus discard/lost-zone-last covers, single-card owner-readable
stadium orientation, closed-cover marker placement, and the exact HTML/CSS/JS/
asset sources behind those claims. Its browser companion compares contained
cover/stadium boxes with the React DOM candidate while retaining explicit
exclusions for cover-open UX, opened-zone layout, top-owner candidate browser
parity, undersized assets, Pixi geometry, and rotated hit regions.

`legacy-evolution-reflow-layout.test.ts` pins the separate ordinary-evolution
boundary. Four isolated local/opponent active/bench cases record a second
attachment-free evolution both immediately after `evolveCard` and after the
unconditional `refreshBoard` reconstruction settles. The fixture preserves
integer `clientWidth` offsets, logical versus DOM versus hit order, transient
rotation margins, and the MutationObserver-delayed empty-wrapper removal. The
transient phase is diagnostic rather than user-visible. Attachments, counters,
BREAK/rotation, overflow/flex shrink, history-dependent restore paths, face
hide/reveal/source mutation, and Pixi parity remain excluded. Its browser
companion now compares the exact stable three-card boundary with a separately
mounted React DOM candidate; this does not broaden the source oracle's scope.

`legacy-energy-attachment-reflow-layout.test.ts` pins the next, smaller
attachment boundary separately from the older mixed five-card transcription.
It records exactly one face-up Energy attached to one unrotated active Pokémon
on both physical sides, immediately after attach and after the unconditional
refresh reconstruction settles. The source-only fixture preserves the integer
`clientWidth / 6` offset, stable `adjustCards` wrapper width, attachment
target/relative/layer state, logical/DOM/hit order, and delayed ghost-wrapper
cleanup. Trainer-as-Tool, multiple or reordered attachments, departures,
evolution layers, bench/overflow, rotated hit regions, candidate parity, and
interaction behavior remain excluded.
