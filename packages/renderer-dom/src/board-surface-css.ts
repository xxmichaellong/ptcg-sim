/**
 * The board's own stylesheet. Inline styles still carry everything a card's
 * geometry depends on; this sheet only adds states (hover, held, flying) and
 * reads the app's design tokens through `var()` with fallbacks, so the
 * renderer keeps working outside the app.
 *
 * Shadows use `--ptcgsim-shadow-x/y`, set per card, so they always fall
 * down-screen whatever the card's quarter turn.
 */
export const BOARD_SURFACE_CSS = `
/* A held card shown over the table's windows by its copy on the lift layer
   (held-card-lift.ts) stays where it is, unseen: it still has the pointer. */
.ptcgsim-card[data-lifted] {
  visibility: hidden !important;
}
.ptcgsim-depth-mat {
  position: absolute;
  left: 0;
  top: 0;
  z-index: -15;
  transform-origin: 0 0;
  pointer-events: none;
  border-radius: 18px;
  /* What is printed on it (the halves' tints) keeps to its rounded corners. */
  overflow: hidden;
  /* A cloth playmat on the desk: a fine woven texture that foreshortens
     with the table, the lamp's light falling off from up and to the left,
     an overlocked edge, and the rubber's thickness along its near side. */
  background:
    radial-gradient(ellipse 60% 55% at 42% 38%, var(--color-felt-glow, rgb(255 214 160 / 0.13)), transparent 72%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Cfilter id='f' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.05 0.95' numOctaves='2' seed='3' stitchTiles='stitch' result='a'/%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95 0.05' numOctaves='2' seed='7' stitchTiles='stitch' result='b'/%3E%3CfeComposite in='a' in2='b' operator='arithmetic' k1='0' k2='0.5' k3='0.5' k4='0' result='c'/%3E%3CfeColorMatrix in='c' type='matrix' values='0.2 0.2 0.2 0 0.2 0.2 0.2 0.2 0 0.2 0.2 0.2 0.2 0 0.2 0 0 0 0 1'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url%28%23f%29'/%3E%3C/svg%3E"),
    radial-gradient(ellipse 110% 105% at 46% 46%, var(--color-felt, #1e4636) 38%, var(--color-felt-deep, #143024) 100%);
  background-size: auto, 96px 96px, auto;
  background-blend-mode: normal, soft-light, normal;
  box-shadow:
    inset 0 0 0 1px var(--color-felt-rim, #0d1410),
    inset 0 0 0 5px var(--color-felt-thread, #14261d),
    inset 0 0 0 6px var(--color-felt-thread-hi, #2b4a3b),
    inset 0 0 90px var(--color-felt-vignette, rgb(10 6 2 / 0.28)),
    0 3px 0 var(--color-felt-rim, #0d1410),
    0 14px 34px rgb(10 6 2 / 0.4);
  /* Kept as painted while the table resizes; only its transform follows
     (BoardSurface's MAT_SETTLE_MS). */
  will-change: transform;
}
/* What is printed on the mat, at the table's current size on a layer of its
   own, so laying the table out again never repaints the mat's cloth. */
.ptcgsim-depth-mat__print {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  pointer-events: none;
  will-change: transform;
}
/* A held Pokémon that would swap places with the one under it: ⇄ on its face. */
.ptcgsim-card__drop-action {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 44%;
  aspect-ratio: 1;
  translate: -50% -50%;
  border-radius: 999px;
  background: rgb(22 15 10 / 0.74);
  color: #f3ebdc;
  box-shadow:
    0 0 0 2px rgb(243 235 220 / 0.9),
    0 6px 16px rgb(0 0 0 / 0.38);
  pointer-events: none;
  animation: ptcgsim-drop-action-in 170ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.ptcgsim-card__drop-action svg {
  width: 58%;
  height: 58%;
}
@keyframes ptcgsim-drop-action-in {
  from {
    opacity: 0;
    scale: 0.6;
  }
}
:is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-reduced-motion='true'] .ptcgsim-card__drop-action {
  animation: none;
}
.ptcgsim-card__depth {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.ptcgsim-card__depth [data-depth-shadow] { fill: var(--ptcgsim-shadow-tint, #0e0804); }
.ptcgsim-card__depth [data-depth-contact] { fill: var(--ptcgsim-contact-tint, #070402); }
/* A card's edge is paper; a stack's, many papers. */
.ptcgsim-card__depth [data-depth-side] { fill: var(--ptcgsim-card-edge, #d8d0bf); stroke: #6d6352; stroke-width: 0.45; }
.ptcgsim-card__depth [data-depth-lines] { fill: none; stroke: #f3ecdc; stroke-width: 0.4; opacity: 0.55; }
.ptcgsim-card[data-depth-card] .ptcgsim-card__face { box-shadow: var(--ptcgsim-ring, 0 0 #0000), 0 0 0 0.55px rgb(243 236 220 / 0.3); }
.ptcgsim-card[data-depth-card]:not([data-in-hand]) > .ptcgsim-card__body,
.ptcgsim-card[data-depth-card][data-held] > .ptcgsim-card__body {
  scale: 1 !important;
  translate: none !important;
  transform: none !important;
}
:is(.ptcgsim-board-surface, .ptcgsim-board-lift) .ptcgsim-card {
  background: transparent;
  -webkit-tap-highlight-color: transparent;
}
/* The focus ring is drawn on the body, so it stays on the card as it lifts
   in the hand or swings while held. */
:is(.ptcgsim-board-surface, .ptcgsim-board-lift) .ptcgsim-card:focus-visible {
  outline: none;
}
:is(.ptcgsim-board-surface, .ptcgsim-board-lift) .ptcgsim-card:focus-visible > .ptcgsim-card__body {
  outline: 2px solid var(--ptcgsim-focus-ring, rgb(120 160 255));
  outline-offset: 3px;
}
.ptcgsim-card__body {
  position: absolute;
  inset: 0;
  display: block;
  transform-origin: 50% 55%;
  transition:
    scale var(--ptcgsim-motion-hover-duration, 170ms)
      var(--ptcgsim-motion-hover-easing, cubic-bezier(0.2, 0.8, 0.2, 1)),
    translate var(--ptcgsim-motion-hover-duration, 170ms)
      var(--ptcgsim-motion-hover-easing, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.ptcgsim-card__face {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  border-radius: var(--ptcgsim-card-radius, 4.8% / 3.4%);
  background: var(--ptcgsim-card-blank, #777);
  --ptcgsim-lift: 1;
  box-shadow:
    var(--ptcgsim-ring, 0 0 #0000),
    calc(var(--ptcgsim-shadow-x, 0) * var(--ptcgsim-lift) * 1.5px)
      calc(var(--ptcgsim-shadow-y, 1) * var(--ptcgsim-lift) * 2px)
      calc(var(--ptcgsim-lift) * 4px)
      var(--ptcgsim-card-shadow, rgb(0 0 0 / 0.32));
  transition: box-shadow var(--ptcgsim-motion-hover-duration, 170ms) ease-out;
}
/* The hovered card leans toward the pointer (HoverTilt sets the angles). */
.ptcgsim-card__body[data-tilt] {
  transform: perspective(820px) rotateX(var(--ptcgsim-tilt-x, 0deg))
    rotateY(var(--ptcgsim-tilt-y, 0deg));
  transition:
    scale var(--ptcgsim-motion-hover-duration, 170ms)
      var(--ptcgsim-motion-hover-easing, cubic-bezier(0.2, 0.8, 0.2, 1)),
    translate var(--ptcgsim-motion-hover-duration, 170ms)
      var(--ptcgsim-motion-hover-easing, cubic-bezier(0.2, 0.8, 0.2, 1)),
    transform 120ms ease-out;
}
.ptcgsim-card__body[data-swing] {
  transform: perspective(900px) rotateX(var(--ptcgsim-drag-pitch, 0deg))
    rotateY(var(--ptcgsim-drag-yaw, 0deg));
}
/* ...and catches the light where the pointer is. */
.ptcgsim-card__face::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(
    circle at var(--ptcgsim-glare-x, 50%) var(--ptcgsim-glare-y, 30%),
    rgb(255 255 255 / 0.42),
    rgb(255 255 255 / 0.08) 38%,
    rgb(255 255 255 / 0) 62%
  );
  mix-blend-mode: overlay;
  opacity: var(--ptcgsim-glare, 0);
  transition: opacity 220ms ease-out;
}
/* A Pokémon answering a card that joined it: a ring of light that swells
   from its edge and fades (BoardMotionDirector.acknowledge animates it). */
.ptcgsim-card__ack {
  position: absolute;
  inset: -2px;
  z-index: 3;
  border-radius: var(--ptcgsim-card-radius, 4.8% / 3.4%);
  box-shadow:
    0 0 0 2.5px var(--ptcgsim-ack-edge, rgb(255 228 160 / 0.95)),
    0 0 20px 6px var(--ptcgsim-ack-glow, rgb(255 196 90 / 0.55)),
    inset 0 0 18px var(--ptcgsim-ack-wash, rgb(255 232 170 / 0.4));
  opacity: 0;
  pointer-events: none;
}
.ptcgsim-card__ack[data-kind='evolve'] {
  box-shadow:
    0 0 0 3px var(--ptcgsim-ack-edge, rgb(255 228 160 / 1)),
    0 0 28px 9px var(--ptcgsim-ack-glow, rgb(255 196 90 / 0.6)),
    inset 0 0 26px var(--ptcgsim-ack-wash, rgb(255 232 170 / 0.5));
}
/* Scans run a little wider than a card's 63 × 88 (TCGdex's are 0.727 to the
   card's 0.716), so the picture is fitted to the card exactly: contained,
   the blank card showed through above and below it as a second, darker
   rim, thicker on some scans than others. */
.ptcgsim-card__face > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
/* Once the picture is in, its own rounded corners are the card's. */
.ptcgsim-card__face:has(> img[data-card-image-state='ready']) {
  background: transparent;
}
.ptcgsim-card__face > .ptcgsim-card__turn {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ptcgsim-card[data-ring='selected'] .ptcgsim-card__face,
.ptcgsim-card[data-ring='drop'] .ptcgsim-card__face {
  --ptcgsim-ring: 0 0 0 calc(var(--ptcgsim-ring-width, 4px))
    var(--ptcgsim-ring-selected, rgb(90 110 188 / 0.86));
}
.ptcgsim-card[data-ring='target'] .ptcgsim-card__face {
  --ptcgsim-ring: 0 0 0 calc(var(--ptcgsim-ring-width, 4px))
    var(--ptcgsim-ring-target, rgb(143 215 153 / 0.86));
}
@media (hover: hover) and (pointer: fine) {
  /* On the table the hand runs off the screen edge: a hovered card rises
     fully into view, above its neighbours (in its own frame, so the
     opponent's turned hand rises toward the centre). Not while a card just
     dropped is settling under a pointer that has not moved since. */
  :is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-geometry='2'][data-dragging='false']:not([data-hover-rest]) .ptcgsim-card[data-in-hand]:not([data-held]):enabled:hover {
    z-index: 8500 !important;
  }
  :is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-geometry='2'][data-dragging='false']:not([data-hover-rest]) .ptcgsim-card[data-in-hand]:not([data-held]):enabled:hover > .ptcgsim-card__body {
    translate: 0 -22%;
    scale: 1.06;
  }
  /* Turned to read upright for the viewer, the far hand rises down toward
     the table's centre instead. */
  :is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-geometry='2'][data-dragging='false'][data-far-upright]:not([data-hover-rest]) .ptcgsim-card[data-in-hand][data-card-side='opponent']:not([data-held]):enabled:hover > .ptcgsim-card__body {
    translate: 0 22%;
  }
  :is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-dragging='false']:not([data-hover-rest]) .ptcgsim-card:enabled:hover > .ptcgsim-card__body {
    scale: var(--ptcgsim-hover-scale, 1.035);
  }
  :is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-dragging='false']:not([data-hover-rest]) .ptcgsim-card:enabled:hover .ptcgsim-card__face {
    --ptcgsim-lift: 3.2;
  }
}
.ptcgsim-card[data-held] > .ptcgsim-card__body {
  scale: var(--ptcgsim-lift-scale, 1.06);
  transition-duration: calc(120ms * var(--motion-scale, 1));
}
.ptcgsim-card[data-held] .ptcgsim-card__face {
  --ptcgsim-lift: 6;
}
/* In flight a card rises over the table but keeps the table's order among
   the other moving cards (--ptcgsim-z is its scene z-index), so an attached
   Energy never crosses in front of its Pokémon mid-move. */
.ptcgsim-card[data-flying] {
  clip-path: none !important;
  z-index: calc(9000 + var(--ptcgsim-z, 0)) !important;
}
.ptcgsim-card-ghost .ptcgsim-card__face {
  --ptcgsim-lift: 3;
}
.ptcgsim-damage-change {
  position: absolute;
  z-index: 9500;
  padding: 3px 7px;
  border: 1px solid var(--color-border-strong, #ffffff30);
  border-radius: 8px;
  background: var(--color-surface-2, #20232f);
  box-shadow: var(--shadow-2, 0 3px 8px #0005);
  color: var(--color-gold, #eed59c);
  font: 700 15px/1.2 var(--font-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  white-space: nowrap;
}
.ptcgsim-damage-change[data-direction='heal'] {
  color: var(--color-mint, #9fd6bb);
}
/* A row on the flat table sliding aside to make room for a held card. */
.ptcgsim-card:not([data-depth-card]) {
  transition: translate calc(200ms * var(--motion-scale, 1)) cubic-bezier(0.2, 0.8, 0.2, 1);
}
:is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-reduced-motion='true'] .ptcgsim-card,
:is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-reduced-motion='true'] .ptcgsim-card__body,
:is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-reduced-motion='true'] .ptcgsim-card__face {
  transition: none;
}
:is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-reduced-motion='true'] .ptcgsim-card > .ptcgsim-card__body {
  scale: none !important;
  rotate: none !important;
}
/* A hovered hand card still rises into view (it is mostly off the screen),
   only without the slide. */
:is(.ptcgsim-board-surface, .ptcgsim-board-lift)[data-reduced-motion='true'] .ptcgsim-card:not([data-in-hand]:hover) > .ptcgsim-card__body {
  translate: none !important;
}

/* ---- The play-mat table (geometry v2) ---------------------------------- */
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone {
  border-radius: var(--radius-md, 10px);
  transition:
    background-color var(--duration-fast, 140ms) ease-out,
    box-shadow var(--duration-fast, 140ms) ease-out;
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-zone-outline='true'] {
  box-shadow: inset 0 0 0 1.5px var(--color-felt-line, rgb(255 255 255 / 0.14));
  background: var(--color-felt-zone, oklch(1 0 0 / 0.018));
}
.ptcgsim-board-surface[data-geometry='2'][data-reduced-motion='false'] .ptcgsim-zone-lostZone {
  transition:
    background-color var(--duration-fast, 140ms) ease-out,
    box-shadow var(--duration-fast, 140ms) ease-out,
    opacity 200ms ease-out;
}
/* The optional Lost Zone, put out, fades onto the mat rather than popping. */
@starting-style {
  .ptcgsim-board-surface[data-geometry='2'][data-reduced-motion='false'] .ptcgsim-zone-lostZone {
    opacity: 0;
  }
}
/* The mark printed under each Active, as on an official mat: a ring with
   a band across it, faint enough that a card covers it. */
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone-active[data-zone-outline='true']::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  height: 74%;
  aspect-ratio: 1;
  translate: -50% -50%;
  border: 2px solid var(--color-felt-mark, rgb(232 220 192 / 0.1));
  border-radius: 50%;
  pointer-events: none;
  background:
    radial-gradient(circle, transparent 13%, var(--color-felt-mark, rgb(232 220 192 / 0.1)) 13% 17%, transparent 17%),
    linear-gradient(transparent calc(50% - 1px), var(--color-felt-mark, rgb(232 220 192 / 0.1)) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px));
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone-board[data-zone-outline='true'] {
  box-shadow: none;
  background: none;
  outline: 1.5px dashed var(--color-felt-line, rgb(255 255 255 / 0.14));
  outline-offset: -1.5px;
}
/* The mat prints no names. An empty spot says what it is for while the
   pointer rests on it: its name eases in, large and faint across the middle
   of the spot as a mat prints it, and the spot lightens a touch. */
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-zone-outline='true'][data-zone-label] {
  container-type: inline-size;
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-zone-outline='true'][data-zone-label]::after {
  content: attr(data-zone-label);
  position: absolute;
  inset: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-felt-label, rgb(255 255 255 / 0.45));
  /* In the card game's own typeface, like a real mat. */
  font: 600 clamp(13px, 11cqi, 26px)/1.1 var(--font-display, sans-serif);
  letter-spacing: 0.01em;
  text-align: center;
  pointer-events: none;
  /* A long name (a translation, a narrow spot on a phone) wraps inside the
     spot rather than running out of it. */
  overflow-wrap: anywhere;
  opacity: 0;
  translate: 0 3px;
  transition:
    opacity 240ms var(--ease-out, ease-out),
    translate 240ms var(--ease-out, ease-out);
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-zone-outline='true'][data-zone-empty] {
  transition:
    background-color 240ms var(--ease-out, ease-out),
    box-shadow 240ms var(--ease-out, ease-out),
    outline-color 240ms var(--ease-out, ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ptcgsim-board-surface[data-geometry='2'][data-dragging='false'] .ptcgsim-zone[data-zone-outline='true'][data-zone-empty]:not([data-drop-target]):hover {
    background-color: var(--color-felt-hover, oklch(1 0 0 / 0.045));
    box-shadow: inset 0 0 0 1.5px var(--color-felt-hover-line, oklch(1 0 0 / 0.2));
  }
  .ptcgsim-board-surface[data-geometry='2'][data-dragging='false'] .ptcgsim-zone-board[data-zone-outline='true'][data-zone-empty]:not([data-drop-target]):hover {
    box-shadow: none;
    outline-color: var(--color-felt-hover-line, oklch(1 0 0 / 0.24));
  }
  .ptcgsim-board-surface[data-geometry='2'][data-dragging='false'] .ptcgsim-zone[data-zone-outline='true'][data-zone-empty][data-zone-label]:not([data-drop-target]):hover::after {
    /* Faint: it says what the spot is for without standing out. */
    opacity: 0.55;
    translate: 0 0;
  }
}
.ptcgsim-board-surface[data-geometry='2'][data-reduced-motion='true'] .ptcgsim-zone[data-zone-outline='true'][data-zone-empty],
.ptcgsim-board-surface[data-geometry='2'][data-reduced-motion='true'] .ptcgsim-zone[data-zone-outline='true'][data-zone-label]::after {
  transition: none;
}
/* Piles print their name under the card spot, centred, as on the mat. */
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone, .ptcgsim-zone-stadium)[data-zone-outline='true'][data-zone-label]::after {
  inset: auto 4px 8px;
  display: block;
  font-size: clamp(9px, 14cqi, 13px);
  white-space: normal;
}
/* Counted piles keep their name clear of the badge on the near corner. */
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone)[data-zone-outline='true'][data-zone-label][data-zone-side='local']::after {
  right: 16px;
}
/* The opponent's mat is turned round: a pile's name sits at its far end. */
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone)[data-zone-outline='true'][data-zone-label][data-zone-side='opponent']::after {
  left: 16px;
  right: 4px;
  top: 8px;
  bottom: auto;
}
/* A pile as small as a phone's keeps its name inside it: smaller type,
   edge to edge, under the card spot on either side, above the count badge
   on its corner (a long name wraps upward). */
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone, .ptcgsim-zone-stadium) {
  container-type: inline-size;
}
@container (max-width: 71px) {
  .ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone, .ptcgsim-zone-stadium)[data-zone-outline='true'][data-zone-label][data-zone-side]::after {
    left: 2px;
    right: 2px;
    top: auto;
    bottom: 14px;
    font-size: 7.5px;
  }
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone-hand {
  border-radius: 0;
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-drop-target='true'] {
  background: var(--color-felt-drop-soft, var(--color-accent-soft, rgb(90 110 188 / 0.25)));
  box-shadow:
    inset 0 0 0 2px var(--color-felt-drop, var(--color-accent, rgb(90 110 188))),
    0 0 24px var(--color-felt-drop-soft, var(--color-accent-soft, rgb(90 110 188 / 0.3)));
}
/* Each half glows from its outer edge in its seat's colour, which follows
   the player: turned around, the seat at the bottom keeps its own. */
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame {
  --ptcgsim-seat-glow: var(--color-you-soft, rgb(90 110 188 / 0.18));
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-frame-tone='opponent'] {
  --ptcgsim-seat-glow: var(--color-opponent-soft, rgb(188 90 113 / 0.18));
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-frame-side='local'] {
  background: linear-gradient(to top, var(--ptcgsim-seat-glow), transparent 22%);
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-frame-side='opponent'] {
  background: linear-gradient(to bottom, var(--ptcgsim-seat-glow), transparent 18%);
}
/* The centre line, printed on the mat. It stops either side of the Stadium
   that straddles it, as a real mat's print would sit under the card. */
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-physical-side='lower']::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 0;
  right: 0;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(
    to right,
    var(--color-felt-line-strong, rgb(255 255 255 / 0.25)) 0 var(--ptcgsim-seam-gap-start, 100%),
    transparent var(--ptcgsim-seam-gap-start, 100%) var(--ptcgsim-seam-gap-end, 100%),
    var(--color-felt-line-strong, rgb(255 255 255 / 0.25)) var(--ptcgsim-seam-gap-end, 100%)
  );
}
.ptcgsim-zone-count--badge {
  min-width: 26px;
  height: 22px;
  margin: -9px;
  padding: 0 7px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border-strong, rgb(255 255 255 / 0.2));
  border-radius: 999px;
  background: var(--color-surface-2, rgb(30 34 44 / 0.94));
  color: var(--color-text, #fff);
  font: 700 13px/1 var(--font-display, sans-serif);
  font-variant-numeric: tabular-nums;
  box-shadow: var(--shadow-2, 0 2px 6px rgb(0 0 0 / 0.4));
}
.ptcgsim-zone-count--badge.ptcgsim-zone-count-hand {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 6px;
  border-color: color-mix(in oklab, var(--ptcgsim-count-tint, currentColor) 70%, transparent);
}
/* Two fanned cards: this is the hand's count, not a pile's. */
.ptcgsim-zone-count--badge.ptcgsim-zone-count-hand::before {
  content: '';
  flex: none;
  width: 14px;
  height: 14px;
  background: var(--ptcgsim-count-tint, currentColor);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1.6' y='3.6' width='7.4' height='10.4' rx='1.4' transform='rotate(-14 5.3 8.8)' fill='white'/%3E%3Crect x='6.6' y='1.8' width='7.4' height='10.4' rx='1.4' transform='rotate(9 10.3 7)' fill='white' stroke='black' stroke-width='1.6'/%3E%3C/svg%3E")
    center / contain no-repeat;
  mask-mode: luminance;
}
`;
