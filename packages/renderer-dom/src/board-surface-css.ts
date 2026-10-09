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
  transition: scale var(--ptcgsim-motion-hover-duration, 170ms)
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
  .ptcgsim-board-surface[data-dragging='false'] .ptcgsim-card:enabled:hover > .ptcgsim-card__body {
    scale: var(--ptcgsim-hover-scale, 1.035);
  }
  .ptcgsim-board-surface[data-dragging='false'] .ptcgsim-card:enabled:hover .ptcgsim-card__face {
    --ptcgsim-lift: 3.2;
  }
}
.ptcgsim-card[data-held] > .ptcgsim-card__body {
  scale: var(--ptcgsim-lift-scale, 1.06);
  transition-duration: 120ms;
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
`;
