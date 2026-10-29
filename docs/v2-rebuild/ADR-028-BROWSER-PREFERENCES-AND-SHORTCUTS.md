# ADR-028: one store for browser preferences; players choose their own keys

- Status: **ACCEPTED**
- Decision date: 2026-10-13
- Scope: everything the v2 client remembers on a device, and the keyboard
  shortcuts list

## Context

By 2026-10-13 the client kept its choices in `localStorage` through separate
hand-written stores: motion (`ptcgsim.motion.v1`), table depth
(`ptcgsim.table-depth.v1`), the Board view (`ptcgsim.board-view.v1`, which
took over Hide containers and Hide opponent's hand) and, in the dev lab, its
own key. Each repeated the same guarded read, JSON parse, validate, write and
listener code. Each wrote synchronously on every change, and none heard
another tab. Other choices were not kept at all: dark mode, the background
and the multiplayer name were React state, so a reload put them back.

The owner asked for preferences saved "in a logical, centralized, and
performant way". They also asked for a button and a clearer dialog in place
of v1's hold-Shift sheet, and for players to choose their own keys, with a
way back to the defaults.

## Decision

### Preferences

1. **One store, one definition per preference.**
   `apps/web/src/preferences/preference-store.ts` gives each preference a
   `definePreference({ key, defaults, parse })`. One `PreferenceStore` per
   page holds them all. `usePreference(PREF)` is the React hook. A feature
   owns its definition, next to the code that uses it. The store owns
   storage.
2. **Keys stay per preference and versioned** (`ptcgsim.<name>.v<n>`). A
   change to one preference never rewrites another. A corrupt entry harms
   only itself. The `storage` event names exactly what changed. Existing keys (motion,
   table depth, Board view) kept their names, so nothing needed migrating.
3. **Only what differs from the defaults is stored.** A preference at its
   defaults leaves no key behind. A default improved later reaches everyone
   who never chose otherwise.
4. **Parse field by field, never throw.** One bad field falls back alone.
   Blocked, full or hand-edited storage leaves the choice working for the
   visit.
5. **Performance.**
   - Each key is read and parsed once, lazily, then served from memory.
   - Changes apply in memory at once. Storage writes are batched (250 ms)
     and flushed on `pagehide` and when the page is hidden, so a dragged
     slider writes once.
   - Values keep their identity until they change, and listeners are per
     key, so a component re-renders only for its own preference.
6. **Tabs agree.** Another tab's change arrives through the `storage` event
   and is published like a local one.
7. **What is saved:**

   | Key                           | Holds                                                                           |
   | ----------------------------- | ------------------------------------------------------------------------------- |
   | `ptcgsim.table.v1`            | dark mode, background (addresses up to 2 KB)                                    |
   | `ptcgsim.board-view.v1`       | Board view: halves shown, split, zone outlines, Solo hand hiding, hover preview |
   | `ptcgsim.motion.v1`           | reduce motion, animation speed                                                  |
   | `ptcgsim.table-depth.v1`      | table depth view                                                                |
   | `ptcgsim.hotkeys.v1`          | the player's changed shortcuts only                                             |
   | `ptcgsim.shortcuts-dialog.v1` | whether the shortcuts dialog shows its keyboard map                             |
   | `ptcgsim.player.v1`           | the name last used to host or join a multiplayer room                           |

   The saved theme is put on the page root before React mounts, so a Day
   table never flashes Night.

8. **What is not saved, on purpose:**
   - anything about a room or a game: selection, open popups, a flipped
     board, the camera viewpoint (bounded by contract);
   - invitations and room codes, which are credentials;
   - the sidebar tab and full-screen state, which belong to this visit;
   - decks, which are documents rather than preferences and deserve their
     own storage and import/export;
   - a pasted `data:` background, which still applies for the visit but
     could be megabytes on every load.

### Keyboard shortcuts

1. **One catalogue.** `apps/web/src/hotkeys/hotkey-catalogue.ts` names every
   shortcut. For each it records the label, its group, where it works (`card`
   selected, `table` with nothing selected, or `any`) and v1's key. The
   dialog, the card-menu hints and the board's key handling all read it. It
   replaces the text catalogue behind the hold-Shift sheet.
2. **Moved keys are translated, not re-handled.** The board's characterized
   v1 handling stays exactly as it was. A key press is resolved through the
   player's keymap first:
   - With no changes (most players), it passes through untouched.
   - A moved shortcut arrives as the default key it stands for.
   - A default key the player moved away from does nothing. That includes
     the Ctrl and Shift variants v1 also accepted, and `?` never falls back
     to `/`.
3. **Number keys and Esc are fixed.** Counts (draw, damage, look at top or
   bottom cards) and Esc cannot be moved, and no shortcut may take them. Tab
   stays focus navigation. Shift+1 types `!`, which is free.
4. **Clashes are per situation.** Two shortcuts may share a key only if they
   never work at the same moment: V shows a selected card and otherwise
   the deck. Taking a key that is in use asks whether to swap keys,
   take the key and leave the other shortcut unset, or cancel.
5. **The dialog** opens from `?`, the keyboard button in the sidebar, the
   Settings panel or the welcome card. It opens on the keys for the current
   situation (card selected or not). A keyboard map, with Shift, Alt and Ctrl
   layers, can sit over a grouped and searchable list: hidden until the
   player shows it (since 2026-10-29; the owner found it noisy), then kept
   as it was left. Each changed shortcut
   resets on its own, and "Reset to defaults" resets them all. Mac players
   see ⌥ Option and ⌘ in place of Alt and Win.
6. **A shortcut paints no focus ring** (2026-10-29). Browsers show
   `:focus-visible` after any key, so a card picked with a click wore a
   keyboard ring once `b` sent it on. The page notes how the focus last
   moved (`data-focus-from`, `ui/focus-from.ts`): a press makes it the
   pointer's, and Tab, F6, the menu key or Shift+F10 make it the keyboard's,
   as do the arrows, Home/End and Page Up/Down when they actually move the
   focus (on a card, or from a clicked rail button, the arrows send the
   selected card to the deck). Under the pointer no ring is painted
   (`design/focus-from.css`), except on a field being typed in.
7. **A move to where the card already is never reaches the room**
   (2026-10-29, PX-068): `b` on a Benched Pokémon, `a` on the Active, `d`
   in the discard pile say "Already on the Bench" and the like, a calm
   notice, not a refusal; menus and the palette don't offer them.

## Consequences

- Hold-Shift no longer shows a sheet (PX-025). Shift is needed for Shift+G
  and for the player's own Shift chords.
- Adding a preference means one `definePreference` beside its feature and a
  row in the table above.
- A shape `parse` cannot read gets a new version suffix. The old key is then
  ignored, and its value can be read once by the new `parse` if it matters.
