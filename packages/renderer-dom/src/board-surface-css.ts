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
.ptcgsim-board-surface .ptcgsim-card {
  background: transparent;
  -webkit-tap-highlight-color: transparent;
  outline-offset: 3px;
}
.ptcgsim-board-surface .ptcgsim-card:focus-visible {
  outline: 2px solid var(--ptcgsim-focus-ring, rgb(120 160 255));
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
.ptcgsim-card__face > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
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
     opponent's turned hand rises toward the centre). */
  .ptcgsim-board-surface[data-geometry='2'][data-dragging='false'] .ptcgsim-card[data-in-hand]:not([data-held]):enabled:hover {
    z-index: 8500 !important;
  }
  .ptcgsim-board-surface[data-geometry='2'][data-dragging='false'] .ptcgsim-card[data-in-hand]:not([data-held]):enabled:hover > .ptcgsim-card__body {
    translate: 0 -22%;
    scale: 1.06;
  }
  .ptcgsim-board-surface[data-dragging='false'] .ptcgsim-card:enabled:hover > .ptcgsim-card__body {
    scale: var(--ptcgsim-hover-scale, 1.035);
  }
  .ptcgsim-board-surface[data-dragging='false'] .ptcgsim-card:enabled:hover .ptcgsim-card__face {
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
.ptcgsim-card[data-flying] {
  clip-path: none !important;
  z-index: 9000 !important;
}
.ptcgsim-card-ghost .ptcgsim-card__face {
  --ptcgsim-lift: 3;
}
.ptcgsim-board-surface[data-reduced-motion='true'] .ptcgsim-card__body,
.ptcgsim-board-surface[data-reduced-motion='true'] .ptcgsim-card__face {
  transition: none;
}
.ptcgsim-board-surface[data-reduced-motion='true'] .ptcgsim-card > .ptcgsim-card__body {
  scale: none !important;
  rotate: none !important;
}
/* A hovered hand card still rises into view (it is mostly off the screen),
   only without the slide. */
.ptcgsim-board-surface[data-reduced-motion='true'] .ptcgsim-card:not([data-in-hand]:hover) > .ptcgsim-card__body {
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
  background: oklch(1 0 0 / 0.018);
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone-board[data-zone-outline='true'] {
  box-shadow: none;
  background: none;
  outline: 1.5px dashed var(--color-felt-line, rgb(255 255 255 / 0.14));
  outline-offset: -1.5px;
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-zone-outline='true'][data-zone-label]::after {
  content: attr(data-zone-label);
  position: absolute;
  left: 8px;
  top: 6px;
  color: var(--color-felt-label, rgb(255 255 255 / 0.45));
  font: 600 10px/1 var(--font-ui, sans-serif);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  pointer-events: none;
  white-space: nowrap;
}
/* Piles print their name under the card spot, centred, as on the mat. */
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone, .ptcgsim-zone-stadium)[data-zone-outline='true'][data-zone-label]::after {
  left: 4px;
  right: 4px;
  top: auto;
  bottom: 8px;
  font-size: 9px;
  text-align: center;
  white-space: normal;
}
/* Counted piles keep their name clear of the badge on the near corner. */
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone)[data-zone-outline='true'][data-zone-label][data-zone-side='local']::after {
  right: 16px;
}
/* The opponent's mat is turned round: its labels sit at the far corner. */
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-zone-outline='true'][data-zone-label][data-zone-side='opponent']::after {
  left: auto;
  top: auto;
  right: 8px;
  bottom: 6px;
}
.ptcgsim-board-surface[data-geometry='2'] :is(.ptcgsim-zone-deck, .ptcgsim-zone-discard, .ptcgsim-zone-lostZone)[data-zone-outline='true'][data-zone-label][data-zone-side='opponent']::after {
  left: 16px;
  right: 4px;
  top: 8px;
  bottom: auto;
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone-hand {
  border-radius: 0;
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-zone[data-drop-target='true'] {
  background: var(--color-accent-soft, rgb(90 110 188 / 0.25));
  box-shadow:
    inset 0 0 0 2px var(--color-accent, rgb(90 110 188)),
    0 0 24px var(--color-accent-soft, rgb(90 110 188 / 0.3));
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-frame-side='local'] {
  background: linear-gradient(
    to top,
    var(--color-you-soft, rgb(90 110 188 / 0.18)),
    transparent 22%
  );
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-frame-side='opponent'] {
  background: linear-gradient(
    to bottom,
    var(--color-opponent-soft, rgb(188 90 113 / 0.18)),
    transparent 18%
  );
}
.ptcgsim-board-surface[data-geometry='2'] .ptcgsim-player-frame[data-player-physical-side='lower'] {
  border-top: 1px solid var(--color-felt-line-strong, rgb(255 255 255 / 0.25));
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
