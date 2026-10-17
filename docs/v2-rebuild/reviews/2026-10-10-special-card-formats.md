# Physical card formats and second experience audit

Research and implementation: 10 October 2026. This extends the [experience review](2026-10-10-experience-review.md). The previous pass was broad, but it did not exhaustively validate every interaction or unusual card format. This pass adds real format support, checks its authority and privacy behavior, and records reproducible coverage. It does not claim zero bugs or a completed full-day usability study.

## What the physical cards require

| Format                    | Physical treatment                                                                              | Implemented treatment                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legendary Stadium         | Two separate portrait cards beside one another; together they occupy the Stadium area           | Matching parts join in either arrival order. Replacing the Stadium removes every incumbent part to its owner's discard in one authoritative revision. Missing parts remain missing.           |
| Pokémon LEGEND            | Two sideways cards, one above the other                                                         | Rotate the scans into reading orientation, position by part number, fit the entire shape in Active/Bench, and inspect the combined artwork or either half.                                    |
| Pokémon V-UNION           | Four separate cards forming a 2×2 illustration                                                  | Position by artwork/printing and quadrant, independently of arrival order. Drag any quadrant to move the stack. Rotation and board flipping preserve its arrangement.                         |
| Pokémon BREAK             | A landscape card across the upper part of the previous Pokémon, leaving its attack text visible | A reusable upper-half overlay layout; previous evolutions and attached cards retain their identities. Preview individual BREAK cards upright in landscape.                                    |
| Head Ringer / Jamming Net | A Tool attached to an opponent's Pokémon, still owned by the player who supplied it             | Attachment targeting includes both boards; individual shortcuts and bulk staged-card resolution preserve the card's owner. Evolution targeting remains on the source board.                   |
| Other and custom artwork  | Formats and translations cannot safely be inferred from a card name alone                       | Explicit presentation metadata supports 2–4 pieces, including three-part layouts, independent reading rotation, and the upper-half overlay. Ordinary portrait cards retain existing behavior. |

The upcoming English mechanic is **Legendary Stadiums**. Pokémon's 5 October reveal identifies **Legendary Pyroduct**, with left/right collector numbers 94/95, in **Mega Evolution—Delta Reign**, releasing 6 November 2026. The reveal explicitly compares it to LEGEND and V-UNION. [Official English preview](https://www.pokemon.com/us/features/sneak-a-peek-at-cards-from-the-mega-evolution-delta-reign-expansion).

The Japanese product page supplies actual paired images and diagrams: different left/right cards with the same name are placed together, and the shared Stadium is positioned so both players can read it. The card art has deliberately opposed reading directions; rotating both halves into separately upright text would break the illustration. The reviewed Japanese pair is **Legendary Summit**, not Pyroduct. Confirmed M6 pairs on that page are 71/72 and 73/74. No collector-number position was inferred for unretrieved artwork. [Official Storm Emeralda product and placement guide](https://www.pokemon-card.com/ex/m6/).

The [official V-UNION introduction](https://www.pokemon.com/us/news/pokemon-v-union-arrive-in-the-pokemon-tcg) and [Silver Tempest rulebook, Appendix D](https://assets.pokemon.com/assets/cms2-nb-no/pdf/trading-card-game/rulebook/swsh12_rulebook_en.pdf) distinguish separate cards outside play from the assembled Pokémon in play. The [HeartGold & SoulSilver rulebook](https://assets.pokemon.com/assets/cms/pdf/tcg/rulebooks/HeartGold_SoulSilver_Rulebook.pdf) and [Undaunted rulebook](https://assets.pokemon.com/assets/cms/pdf/tcg/rulebooks/Undaunted_Rulebook.pdf) document LEGEND. The [BREAKthrough rulebook, Appendix H](https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/rulebook/xy8-rulebook-en.pdf) documents the sideways BREAK placement. The [Primal Clash rulebook, Appendix F](https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/rulebook/xy5-rulebook-en.pdf) documents Team Flare Hyper Gear and returning it to its owner.

Actual TCGdex scans were inspected for Lugia LEGEND, Mewtwo V-UNION, Greninja BREAK, and Head Ringer. In particular, the BREAK and LEGEND source bitmaps are portrait rectangles with sideways printed artwork. Their reading rotation belongs to the card definition; rotating only a modal container is insufficient. [TCGdex card data and image API](https://tcgdex.dev/rest/card).

These sources inform visualization and ownership. The simulator still does not enforce eligibility, both-halves-in-hand requirements, V-UNION assembly prerequisites, card effects, once-per-game restrictions, or game rules.

## Building blocks and compatibility

`CardPresentation` is optional definition metadata, carried through deck installation, cloning, recipient-safe projection, wire validation, Solo disclosure, replay disclosure, and persisted match definitions. Its bounded schema describes reading quarter-turns and either a grid position or an upper-half overlay. Grid keys identify an illustration/printing, not just a Pokémon name. A duplicate position or mixed illustration falls back to a visible ordinary stack; cards are never silently merged or discarded.

A layout example for the bottom-right quarter of a custom four-piece card:

```json
{
  "readingQuarterTurns": 0,
  "join": {
    "key": "custom-illustration-1",
    "columns": 2,
    "rows": 2,
    "part": 3
  }
}
```

The custom-card dialog exposes these choices under **Card layout (optional)**. Give all pieces of one illustration the same artwork group and assign each its position. The CSV importer/exporter preserves this data in an optional fifth `Presentation` column containing quoted JSON. Existing four-column files and ordinary definition identities remain compatible. JSON shape and size are bounded; installation and protocol validation enforce the semantic limits.

Known English HGSS LEGEND printings and the identified Sword & Shield promo V-UNION printings are recognized from their exact image paths and names. BREAK names receive the known orientation. Confirmed Japanese reveal paths receive paired Stadium metadata. Unknown printings, translations, mirrors, and future catalog IDs require explicit metadata; there is no claim that every external image URL can be identified. Name-only guesses would confuse the four quarters and mix illustrations.

The renderer contract owns composition geometry. It reserves missing cells, calculates the whole footprint, applies whole-stack rotations, and fits the result into the current row. DOM and Pixi consume the same bounds and rotations. Concealed cards receive no artwork descriptor or hidden composition geometry. Individual attachment order and authoritative card IDs remain intact.

A held assembly preserves relative piece positions and paint order. Individual drag sway is disabled on a joined assembly to avoid opening its seams. Counters follow the held object in both renderers. The DOM motion director continues to animate arrivals and board flips. Pixi uses its existing presentation path; this work does not claim that the alternate Pixi renderer has every DOM animation or material effect.

Full previews use disclosed full-size definition images instead of the board's small thumbnail. Assembled previews offer individual reading views. BREAK/LEGEND inspection rotates the original bitmap inside a correctly shaped reading frame in the board preview, hover inspector, and deck-builder zoom/preview. Small browsing thumbnails remain physical portrait scans; open them to read sideways formats. Assembled preview scans normalize to the physical cell dimensions; source scans with slightly different crop/aspect can receive slight scaling at a seam.

The combined real-art review exposed two additional layout faults. Restoring focus to an animated card could programmatically scroll the whole playmat sideways; the fixed table now uses overflow clipping, with scrolling confined to its own browsing surfaces. Paired Stadium artwork could overlap the side piles at 1024×768; its shared footprint now fits the corridor between both Active slots and both players' side piles. Geometry regressions cover both perspectives at four board widths, including the 724-pixel play area inside the narrow shell.

## Interaction and authority behavior

- Use the existing attach/evolve action to put Pokémon pieces into one stack. Clicking any visible joined evolution piece selects the same target stack; the submitted command still validates its current top-card identity.
- **G** places a Stadium, joining a compatible missing piece automatically. **Shift+G** explicitly adds another piece for custom/manual layouts. Other arrivals replace the whole Stadium. The bounded shared zone supports up to four individual cards.
- Multi-piece Stadium commands carry the exact occupant snapshot. The authority resolves recipient aliases and rejects stale/foreign aliases and capacity violations. Displacement and arrival are one event batch/revision. The client predicts the zone-source case with the same complete replacement semantics; unsupported source cases wait for authority.
- Foreign Tools keep immutable ownership. Bulk discard, hand, Lost Zone, and deck resolution split the staged cards by owner. Existing departure and shuffle events preserve event-log compatibility. Predictions use the same ownership split; hidden opponent arrivals remain concealed.
- Solo can resolve the other seat's staged work area through its bulk buttons. An explicit target seat is accepted by authority only in Solo; the same request is rejected in multiplayer. This closes a control gap exposed while testing Head Ringer.
- Normal board flips and stack rotations turn the assembly. Stadium pieces retain individual orientation controls; manually turning just one can intentionally break its artwork arrangement. This is still a sandbox.

## Audit coverage

The first review contains the baseline design research, full UI test evidence, layout measurements, and motion rationale. This pass inspected the definition-to-image call chain, the shared layout contract, both renderer paint/hold paths, preview modes, hover inspection, deck custom-card creation/import/export, command resolution, prediction, projection, replay disclosure, and bulk departures. It did not independently hand-exercise every combination of every existing menu item.

| Surface or interaction                                                   | Evidence and scope                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome, Solo, multiplayer lobby, room options/settings, deck workspace  | Existing component and full-stack suites; first-pass visual captures and keyboard checks                                                                                  |
| Confirmation and input dialogs, menus, shortcut reference, zone browsers | Existing modal/focus/paint tests and three first-pass interaction scenarios; updated shortcut count and image-loading assertions                                          |
| Card previews and attachment views                                       | New assembled/individual format journeys, landscape reading, focus restoration, real-art captures                                                                         |
| Active/Bench geometry                                                    | Unit checks at 1024, 1440, 1920 widths and both perspectives; rotated footprint, part hit tests, missing/duplicate/mixed parts, concealed metadata                        |
| Dragging and markers                                                     | New any-piece drag journey; shared held geometry; Pixi sprite/counter checks; existing pointer, drag cancellation, protected-input, transformed-layout, and motion suites |
| Stadium replacement                                                      | Core atomicity/capacity/stale tests, authority alias tests, optimistic replacement test, browser pair/replacement journey                                                 |
| Foreign Tools                                                            | Cross-board targeting/core ownership, mixed-owner bulk destinations, optimistic ownership, Solo/multiplayer authorization, and browser attach/depart/resolve journey      |
| Import, export, protocol                                                 | Optional CSV round trip, malformed JSON, layout bounds, definition identity, legacy four-column compatibility                                                             |
| Replay, undo, reconnect, save/restore                                    | Existing regression suites plus explicit metadata preservation in disclosure paths; new formats do not add an out-of-band renderer-only state                             |
| Accessibility and motion preferences                                     | Existing focus, keyboard, reduced/instant motion and image-failure suites; new subview focus handling. This is not a screen-reader certification.                         |
| Browser engines and performance                                          | See final validation record below. Functional headless checks do not certify real-device GPU frame rate.                                                                  |

## Validation record

- Full unit suite: **2,671 tests in 275 files passed** (`unit-full-final.log`). Subsequent layout, custom-form and metadata-disclosure checks passed in a **30-test focused run** (`final-additional-unit.log`); the new Stadium spacing checks also passed with the 37 existing scene tests (`stadium-spacing.log`).
- `check:static:v2` passed, including formatting, lint, dependency cycles, API and source boundaries, and all TypeScript targets (`static-final.log`). Later test-only changes passed focused formatting/lint and browser type checking.
- Runtime: **32 passed**. Tooling: **49 passed**. Legacy unit checks: **79 passed** (`runtime.log`, `tooling.log`, `legacy-final.log`).
- Final web and server production builds passed, including bundle-boundary checks (`build-release-final.log`). The server build was a dry run; nothing was deployed.
- Broad Chromium run: **207 passed, 8 failed out of 215** (`browser-full-final.log`). All eight failed cases subsequently passed in the focused runs below, so all 215 have passing coverage across runs; the broad run itself is not described as an uninterrupted green run. The two long resource cases passed, including 140 setup/reset cycles with 560 pile openings and a separate animated lifecycle check. Source edits/reloads occurred during earlier browser cases; follow-up runs used stable application sources. Updated expectations cover the intentionally expanded attachment target list and Stadium shortcut. A DPR test now permits a real Chromium resize signal to reconcile before its synthetic signal; it still verifies final DPR, resize coalescing, zero-size recovery and foreground resume.
- Chromium follow-up: **24 UI cases passed**, covering all experience-refinement, board chrome, protected-input and resize cases (`browser-recheck.log`). **All four special-format journeys passed** (`formats-final.log`). The foreign Tool journey waits for the authoritative staged-resolution publication and tolerates the intermediate absence of a board card while its work area closes.
- Firefox: **all seven experience and special-format journeys passed** (`firefox-final.log`). Earlier concurrent runs could not establish two rooms; those attempts are retained in `firefox.log` and are not counted as passes.
- The real-art combined journey passed at **1440×900 and 1024×768**, with no horizontal playmat scrolling. Captures include V-UNION, assembled and individual BREAK, LEGEND, and the Japanese Legendary Summit pair. Final captures are in `/tmp/ptcg-special-cards/real-art-all/all-real-real-artwork-all-formats-together-large-and-narrow/`; diagnostics are in `all-real-final.log`.

All named logs are under `/tmp/ptcg-special-cards`. These temporary artifacts supplement the repository regression cases; they are not a claim of coverage for every possible UI combination.

## Remaining boundaries

Automatic recognition is intentionally limited to verified printings. Catalog expansion should add explicit metadata, not progressively broader name/URL guessing. Rare custom rules remain manual. Assembling/disassembling still uses the existing sandbox actions and their activity-log wording; no rules engine or new deck legality policy was introduced. Overlays retain native HTML dragging. A fully touch-first phone layout, real-device animation profiling, exact per-print foil masks, and a formal accessibility study remain separate work. WebKit was unavailable on this host in the first pass; no WebKit certification is implied.
