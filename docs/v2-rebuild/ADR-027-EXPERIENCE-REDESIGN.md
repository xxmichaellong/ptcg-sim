# ADR-027: redesign the look and feel; keep v1's behaviour

- Status: **ACCEPTED**
- Decision date: 2026-10-09
- Scope: visual design, motion, card presentation, overlays and board layout
  of the v2 client
- Supersedes: the "no UI or UX redesign" and "restyled board is a non-goal"
  commitments in `ADR-004-BOARD-RENDERER.md`,
  `01-current-system-and-parity-contract.md` and
  `04-client-renderer-and-parity.md` (where `AnimationSystem` was limited to
  "short parity-preserving transitions"), for the _visual_ layer only

## Context

v2 reached behavioural parity with v1 by reproducing v1's look as well: its
percentage geometry, colours, small cards, native browser dialogs and the
absence of motion. On 2026-10-09 the owner judged that design outdated and
asked for the whole experience to be rethought -- treating the current design
as "a good template with working functionality" -- so that the sandbox feels
like playing the physical game across a table: cards that move, lift and
settle like cards, readable card sizes, animated overlays, real-looking
counters, and full use of the screen. It is still a manual sandbox: nothing
here automates rules.

The research behind this decision (2026-10-09) surveyed Pokémon TCG Live and
PTCGO, the physical game, manual simulators (Untap, Tabletop Simulator,
Cockatrice, Duelingbook), polished digital card games (Balatro, Hearthstone,
Slay the Spire, Marvel Snap, TCG Pocket), holo-card rendering
(`simeydotme/pokemon-cards-css`, GPL-3.0 -- technique only, no code), the web
platform's motion and overlay primitives, and the real accessories. It is
summarised in `EXPERIENCE_DESIGN.md`.

## Decision

1. **Behaviour stays; the look changes.** Every command, keybind, privacy
   rule, multiplayer and replay behaviour keeps v1 parity. Colours, type,
   iconography, card sizes, layout, overlays and motion are redesigned.
2. **The React DOM renderer stays the board renderer** (ADR-004's choice
   still holds). The effects asked for -- pointer-tracked tilt, holographic
   glare, 3D lift, springs -- are native CSS on the compositor; the card art
   (limitlesstcg, no CORS) cannot be sampled by WebGL without a proxy. A lazy
   WebGL layer stays possible later for particles only.
3. **Motion is a first-class primitive, never a blocker.**
   - Game state still changes instantly. Each card's _painted_ position
     chases its scene position with an interruptible spring (closed-form, so
     a flight can change course mid-air without losing speed).
   - Every scene install carries a cause (`advance`, `predict`, `rollback`,
     `layout`, `flip`, `replace`). Only the first three and `flip` animate.
   - A pure planner compares two recipient-safe scenes; it pairs re-keyed
     cards by zone deltas, never by identity, so motion discloses nothing.
   - Input is never blocked by animation. Reduced motion follows the OS
     unless the player chooses; an animation-speed setting scales durations;
     dragging is never slowed.
4. **Overlays use one primitive set** (dialog, popover, menu, context menu,
   tooltip, toast) with shared animation and focus behaviour, replacing every
   `window.confirm`, `alert` and `prompt`.
5. **Design tokens** (CSS custom properties: colour in `oklch`, type, space,
   radii, elevation, motion) are the only source of visual constants. The
   renderer reads them through `var()` with fallbacks, so it stays usable
   outside the app.
6. **A new board geometry** (`geometryVersion: 2`) lays the table out like
   the official play mat at readable sizes. `geometryVersion: 1` stays frozen
   with its v1 oracle tests until it is retired; it is not edited in place.

## Consequences

- Tests that pin v1 _visuals_ of the v2 DOM (card edge paint, chrome
  screenshots, overlay paint geometry) are re-baselined against the new
  design or retired; tests that pin behaviour, privacy, paint order and the
  v1 layout model are kept.
- Re-baselining keeps v1 as the source of _content and semantics_: the same
  menu rows, cards, images, names, controls and select values, in the same
  order, with the same cursors, modal semantics, focus trap and focus
  return. The new paint is held to invariants instead of v1's pixels: solid,
  rounded, raised surfaces on the screen, and cards and type never smaller
  than v1 drew them (`react-dom-overlay-paint`,
  `react-dom-transformed-overlay-paint`, `react-dom-protected-input`,
  `legacy-deck-builder-browser-parity`). A tab order follows the new reading
  order of a panel; keystrokes (Enter confirms, Escape cancels) do not move.
- Visual regressions get their own baseline screenshots of the new look.
- The renderer-spike route keeps installing scenes without a motion cause, so
  the geometry oracles still read final rectangles immediately.

## Alternatives considered

- **Promote the Pixi renderer.** Rejected for now: no CORS on card art, a
  second production engine to keep in parity, and no gain for the effects
  that matter most (which CSS does well).
- **A general animation library for the board (Motion, GSAP Flip).** Rejected
  for the board: they measure geometry the scene already knows and reset
  velocity on interruption, which is exactly wrong for drop → confirm/reject.
- **Restyle in place without new geometry.** Rejected: v1's geometry is the
  main reason cards are unreadable (85 × 119 px hand cards at 1440 × 900).
