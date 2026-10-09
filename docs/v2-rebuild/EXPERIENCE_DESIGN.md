# PTCG Sim experience design

Decision record: `ADR-027-EXPERIENCE-REDESIGN.md`. This document is the
working specification for the redesign: what it should feel like, the
building blocks it is made of, and the order they land in.

## 1. The experience

PTCG Sim is a manual sandbox: players move every card themselves, so the
quality of the experience is the quality of _handling cards_. The goal is
that a game here feels like a game across a table -- with a friend, or
against yourself -- and never like operating a form.

**Principles** (each one traced to the research):

1. **Cards never teleport.** The game state changes at once; what you see
   catches up with a spring. A card always comes _from_ somewhere and goes
   _to_ somewhere, including draws, prizes and the opponent's plays.
   (Balatro, Slay the Spire; every manual sim that lacks it feels broken.)
2. **Your own actions are instant.** Pokémon is sequential, so the acting
   player's client shows the outcome immediately and the room's confirmation
   changes nothing on screen. A refusal sends the card home with a reason.
3. **Never block input.** No animation waits for itself. A second action
   during a flight redirects it. (PTCG Live's most criticised flaw.)
4. **Readable at a glance, legible on demand.** The board shows state the
   way the table does -- shape, rotation, counters -- and any card can be read
   at full size by hovering it, without covering the board.
5. **Physical, not decorative.** Lift, shadow, swing, a settle with a small
   overshoot, a counter that pops: effects that explain a change. Restraint
   elsewhere: no screen shake, no ambient sparkle.
6. **Hover plus one key beats menus.** The keyboard model is kept and made
   discoverable; menus are for what is rare.
7. **Accessible by default.** Reduced motion follows the system; an
   animation-speed setting covers taste; contrast meets WCAG AA; everything is
   reachable by keyboard.

## 2. Building blocks

The redesign is built from a small set of primitives, each with one owner.

| Primitive          | Where                                  | What it owns                                                                                  |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Spring             | `renderer-contract/src/spring.ts`      | Closed-form damped spring (state at any instant), CSS `linear()` easings, velocity tracker    |
| Motion settings    | `web/src/motion/motion-settings.ts`    | Reduce motion (system/reduce/full), animation speed, persistence                              |
| Scene motion cause | `renderer-contract/src/model.ts`       | Why a scene was installed: `advance`, `predict`, `rollback`, `layout`, `flip`, `replace`      |
| Motion planner     | `renderer-contract/src/motion-plan.ts` | Pure: previous + next scene → flights, ghosts, counter pulses                                 |
| Motion director    | `renderer-dom/src/motion/`             | Runs a plan on the compositor (WAAPI), retargets mid-flight, ghosts, reduced motion           |
| Card anatomy       | `renderer-dom/src/BoardSurface.tsx`    | Button (input, final rect, quarter turn) > body (lift, tilt, swing) > face (art, ring, shine) |
| Design tokens      | `web/src/design/tokens.css`            | Colour, type, space, radii, elevation, motion; read by the renderer through `var()`           |
| Overlay primitives | `web/src/ui/`                          | Dialog, confirm, popover, menu, context menu, tooltip, toast                                  |
| Card inspector     | `web/src/board/`                       | The large docked card view on hover/focus, with holo finish                                   |
| Geometry v2        | `renderer-contract/src/layout-v2.ts`   | The play-mat layout at readable sizes                                                         |

### 2.1 Motion

- **Flights** come from the planner and run as Web Animations on the card
  button's individual `translate`/`scale` properties. React keeps writing the
  final `left/top` and `transform: rotate(...)`, so the final rect is what
  tests and hit-testing see; the animation only supplies where it _was_.
- **Retargeting**: a running flight is sampled analytically at its current
  time; the next flight starts from that offset and velocity.
- **Drop → confirm/reject** needs no special case: the drop point is the last
  painted rect, the prediction (or the room) moves the scene rect, and the
  card flies from where it was released, carrying the release velocity.
- **Ghosts** are `aria-hidden`, input-transparent copies without
  `data-card-id`, for cards that leave the painted table (into a deck, under a
  pile) or that keep a pile covered while its new top flies in.
- **Re-keyed cards** (aliases change at every concealment boundary) are paired
  by the planner from zone deltas of the same owner -- never by identity.

| Moment                      | Cause               | Spring (response / damping) | Notes                                                            |
| --------------------------- | ------------------- | --------------------------- | ---------------------------------------------------------------- |
| Own move lands              | `predict`           | 0.28 s / 0.82               | from the release point, with release velocity                    |
| Opponent / room move        | `advance`           | 0.42 s / 0.86               | staggered 45 ms per card from the same source, cap 400 ms        |
| Refused move goes home      | `rollback`          | 0.34 s / 1.0                | no overshoot; a reason toast                                     |
| Counter changes             | any                 | 0.38 s / 0.62               | pop to 1.3×, settle                                              |
| Card turns over             | any                 | half the flight             | squash-flip at mid-flight                                        |
| Drag lift                   | gesture             | —                           | scale 1.06, shadow e5, swing ≈ 1.75° per card-width/s, clamp 14° |
| Hover                       | gesture             | —                           | scale 1.035, shadow e3, tilt ≤ 8°, glare                         |
| Board flip                  | `flip`              | 0.6 s                       | the table turns; cards stay upright in their frames              |
| Relayout / reconnect / seek | `layout`, `replace` | —                           | snap; running flights stop                                       |

Reduced motion: no travel; arrivals fade in place (150 ms), counters flash
instead of popping, no tilt or swing. Animation speed: relaxed ×1.35, normal,
fast ×0.6, instant (no flights at all).

### 2.2 Card anatomy

```
button.ptcgsim-card      data-card-id, input, final rect, rotate(q·90°), z
└─ span.ptcgsim-card__body   lift, hover tilt, drag swing (never FLIP)
   └─ span.ptcgsim-card__face  rounded art, ring, shadow, shine/glare layers
      └─ img                    the card (or its back)
```

Real cards are 63 × 88 mm with ~3 mm corners: the face radius is
`4.8% / 3.4%`. Shadows are cast down-screen whatever the card's quarter turn.

### 2.3 Holo

Technique only (the reference implementation is GPL-3.0): a glare layer
(`radial-gradient`, `overlay`) that follows the pointer, and a shine layer
(repeating rainbow gradient, `color-dodge`, masked to the art box) whose
position moves at a reduced rate for parallax. Only the hovered card and the
inspector card animate. Finish per card comes from rarity first; a per-print
foil index (malie.io, mirrored) is a later step.

## 3. Visual language

- **Table**: a deep teal-blue felt with a soft vignette and printed zone
  markings, the way a play mat looks under a lamp ("Night"). A light linen
  variant ("Day") is the alternative.
- **Type**: Inter (UI, tabular numerals); Jost 800 for counters and big
  numbers (it is the closest free match to the Futura on real cards).
- **Colour** (`oklch`): your side blue, the opponent's red, gold for
  selection, mint for valid targets, a calm neutral surface for chrome. Text
  contrast ≥ 4.5:1.
- **Icons**: Phosphor; energy types use the rulebook's own symbols.
- **Counters**: the real accessories -- yellow 10, orange 50, red 100 damage
  discs; Burn and Poison markers; GX and VSTAR tiles that turn face-down when
  used; a gold coin. Asleep, Paralyzed and Confused stay rotations, as at the
  table.

## 4. Layout (geometry v2)

Each half follows the official play mat: prizes as a 2 × 3 grid on the
outer left, the Lost Zone above them; the Active at the centre line; five
bench slots below it; deck at the right with the discard below; the stadium
on the seam. The hand runs along the bottom edge as a fan that rises on hover;
the opponent's hand is a row of backs along the top. The chrome becomes a
right rail (log, chat, settings) that can collapse, and a small action dock.
Target sizes at 1440 × 900: hand and Active ≈ 150 px tall, bench ≈ 125 px,
prizes ≈ 80 px. A docked inspector shows the hovered card at ≈ 40% of the
screen height.

## 5. Order of work

1. Foundations: spring, motion settings, scene motion cause, planner. ✅
2. Card anatomy and the motion director (flights, ghosts, pulses, retarget).
3. Drag physics (lift, swing, release velocity) and hover (lift, tilt, glare).
4. Design tokens, fonts, icons; the renderer reads tokens.
5. Overlay primitives; every native dialog replaced.
6. Card inspector with holo.
7. Geometry v2 and the new chrome.
8. Real counters and markers; coin flip, shuffle, turn banner, board flip.
9. Re-baselined visual tests and screenshots of the new look.

## 6. Tests

- Behaviour, privacy, paint order and the v1 layout model stay as they are.
- New: planner unit tests; director tests with reduced motion forced and with
  `Animation.finished`; final rest positions asserted once motion is idle.
- The renderer-spike harness installs scenes without a motion cause, so its
  geometry oracles keep reading final rectangles immediately.
