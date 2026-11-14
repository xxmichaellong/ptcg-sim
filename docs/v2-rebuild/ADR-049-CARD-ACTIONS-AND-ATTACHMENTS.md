# ADR-049: Card options and compact attachments

- Status: **ACCEPTED**
- Decision date: 2026-11-07
- Request: consistent card options before artwork, clearer moves and targets, readable Pokémon with attachments.
- Amends: ADR-030/031 (table windows and drag targets), ADR-042 (selection actions), ADR-043 (card windows).
- Parity: PX-099, PX-100, PX-101.

## Decision

Double-clicking a hand, Prize, Stadium or loose card opens its options window. It uses the Pokémon window's frame, focus boundary, close control and enter/exit motion. Prize actions come first for Prizes. Common destinations are direct buttons; the selected-card bar offers these and Actions, which opens the same window. Card actions, image origins and dragging refer to the requested piece of an assembled Stadium; its full piece list remains available for joined artwork. Direct moves close the options window consistently, including swapping with the deck top or shuffling into an empty deck. Group selection keeps its existing group controls. Replay disclosure stays local and spectators receive no mutations.

View card opens artwork explicitly. The distant corner close icon is removed. Clicking/tapping the art or pressing Escape returns to the options window. Joined Pokémon also open their options first; View whole card, individual pieces and attachment previews remain available. Reading controls sit below the artwork, with their own reserved space. An incomplete LEGEND or V-UNION stack can show its whole artwork envelope even with one piece and no attachments, with the existing piece count; a loose piece still opens its individual scan.

Geometry v2 presents attachments as compact handles over the Pokémon's edge without widening the play row. Unambiguous Basic Energy names use Energy symbols. Special Energy, other attachments and ambiguous names retain art; the window still lists every individual card. Two rows bound the table footprint, with an overflow handle opening the complete window. Counts describe attached cards, never Energy provided. Carrying an individual handle expands it into the actual card; carrying the whole Pokémon keeps its handles compact. Group fans use the expanded lead card dimensions both while dragging and when released, so pending moves keep the cards where they were let go. Cancel restores the handle, with reduced-motion behavior preserved. Geometry v1 remains available for characterization.

Markers paint only while their parent card is painted. Hidden overflow, pile and work-area cards retain marker data so a card lifted or revealed later keeps its marks; carrying the whole Pokémon leaves its hidden attachments and their markers hidden. An individual overflow attachment, or a group moved from its window, remains painted at the drop point until authority resolves the move. Expanding an individual compact handle repositions and sizes its badge against the full card face, including quarter turns and either player orientation. A settling card moves its retained marker bounds to the drop point too, so they stay together while the room answers. Badges use the same drag, fan and settling layers as their cards in flat and tilted views, and travel in the lift layer over open windows without duplicate identities or hints. Their visible copies track text and inline-node changes as well as attributes, so incoming damage and reminder updates remain current during a drag or flight.

TCG Live's [publisher screenshots](https://apps.apple.com/us/app/pok%C3%A9mon-tcg-live/id1557962344) informed the Energy symbols and Tool artwork approach. Pocket's [Energy Zone rules](https://support.pokemon.com/hc/en-us/articles/38906248102292-Pok%C3%A9mon-TCG-Pocket-Battle-Rules-FAQ) differ from the main TCG and are not used to infer attached Energy. The official [EX Holon Phantoms card text](https://assets.pokemon.com/assets/cms/pdf/tcg/carddex/EX_Holon_Phantoms.pdf) lists Special Darkness and Metal Energy: their bare names are ambiguous, so only explicitly Basic forms become symbols.

## Targeting and responsive layout

Modern work-area scene rectangles are not physical drop targets and their placeholder cards are not painted. Only a registered, visible, active window's actual DOM bounds accept ingress. Its own source, hidden windows and exit copies do not intercept drops. Physical picking and logical eligibility are separate: the controller retains a valid work-area id supplied by the visible-window adapter so the actual window highlights during hover and across new projections. Physical card picking excludes unpainted nodes. View board hides and inerts every other header action, including Undo, across all panels.

The toolbar avoids the actual Stadium envelope, including joined artwork and rotated cards, rather than only its original layout slot. Portrait piles are smaller, with Deck then Discard at the right edge and Prizes at the left. Counts sit on the pile corner away from the hand, with smaller badges and less outset. The owner's landscape-phone card size is retained. Thickness now has a maximum of 1 and a default of 0.6; older larger choices are clamped.

## Verification

Coverage includes real-room desktop, tablet, portrait-phone and landscape-phone flows; source-hidden drop targets; keyboard/focus behavior; native drag suppression; card-list completeness and host size with large attachment sets; artwork return paths; generic and joined-card windows; and flat/depth dragging. The shared gate and independent review loop are required before shipping.
