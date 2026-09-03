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
