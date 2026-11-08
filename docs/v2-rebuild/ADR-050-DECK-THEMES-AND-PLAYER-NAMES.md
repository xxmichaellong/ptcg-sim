# ADR-050: Deck themes, player names and room entry

- Status: **ACCEPTED**
- Decision date: 2026-11-07
- Request: compose a deck's sleeves, coin and playmat, reuse named themes, edit both board names in Settings, and simplify Play online.
- Amends: ADR-033 (deck building), ADR-041/048 (custom assets), ADR-047 (rooms by code).
- Parity: PX-102, PX-103.

## Deck composition

Deck list and Customize are separate sections of the editor. A saved deck can carry sleeves, a coin and a playmat. The existing asset chooser supports a landscape mat design/crop, in addition to sleeves and coins. Named themes copy these choices between decks and are kept as bounded device preferences. Reset returns a deck to defaults. A mat without an explicit choice follows the current table style.

Deck fields survive storage, duplication and deferred-draft promotion. Merely opening an outside list is still unsaved. A real appearance change promotes it; a new empty deck with an appearance, notes, cover or format edit is retained. Seat headers show the deck title and size; tournament finishes remain in browsing metadata and saved names.

A chosen deck applies its looks to its live seat. Personal coin defaults remain available; queued choices respect the latest deck and transient refusals retry. Accepted synchronization does not overwrite Undo. Solo can dress both seats, multiplayer only its own. Both viewers see each deck's mat. The card-back visibility preference continues to control card backs independently.

Opening or remounting the editor retains a restored table's live looks. Explicitly choosing a deck or editing its appearance applies its saved choices, including choosing the same deck again. A list without saved looks takes defaults; deleting only the saved entry leaves the live table dressed until a real deck choice or card replacement. Accepted synchronization survives editor/board remounts and reconnects, while an explicit repeated choice starts a fresh attempt.

Restored canonical coins take precedence before personal-default synchronization, including Standard after Undo. Fresh empty seats still take their personal default. Names, notes, covers and other metadata changes do not redress a live seat. A mat-only edit changes only the mat. Library loading completes before restored deck associations are baselined; explicit choices made during loading remain pending and apply afterward.

Deleting a custom asset in Customize also takes it off saved decks wearing it, including live seats linked to those decks. Sleeves and mats share their asset collection; coins keep their own. Undo restores only the affected fields still at their defaults and never recreates a deleted deck or replaces a later choice. Coin deletion keeps the personal-default Undo behavior too. From the table's coin editor, deletion and Undo also change the selected live seat, including the other Solo seat and a coin set by its deck; newer live choices take precedence.

## Canonical player metadata

Settings' first page exposes both player names. Solo can edit either, multiplayer only its own, and spectators/replays cannot change live names. `SetPlayerProfile` carries a bounded name and/or playmat through authority, events, projections, persistence and replay. The room resolves seat permissions before execution. Published acknowledgements update clean name fields without replacing a newer unsaved draft. Blur and Enter save trimmed edits; Escape cancels the draft. A disabled field shows the canonical value while keeping an unsaved draft for editing to resume, including after a reconnect. A revert queues behind an earlier pending change.

Authenticated session names follow a canonical player-name change in the same committed candidate, including Undo. Unchanged players' session records retain their identity and fields; command candidate validation permits only the corresponding name change alongside the ordinary issuer outcome update. Renaming does not invalidate a live connection.

## Room entry

Play online separates Host and Join, shares the Name field, and shows one primary action for the current flow. Join keeps explicit Play/Watch controls and native code/link paste. Explicit Paste buttons are removed from room entry and deck browsing; keyboard, system paste menus and file import remain.

The form follows [GOV.UK's button guidance](https://design-system.service.gov.uk/components/button/) on a clear primary action and [NN/g's progressive-disclosure guidance](https://www.nngroup.com/videos/progressive-disclosure/) on revealing the relevant flow. It avoids nested competing form cards and the former OR divider.

## Verification

Coverage includes deck-look round trips and copies; preservation of real edits; latest queued choices and Undo; both Solo names and authority-session consistency; multiplayer seat permissions; landscape asset design; native paste/file-import races; and desktop/phone room entry. All 20 language catalogs are synchronized. The shared gate and independent review loop are required before shipping.
