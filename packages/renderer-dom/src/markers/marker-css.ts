/**
 * Paint for board markers: counters and chips that look like the physical
 * accessories, lit from the top left like the cards. Every colour comes from
 * the custom properties `MarkerNode` sets from the renderer contract; shared
 * values read the app's design tokens through `var()` with fallbacks.
 *
 * `--ptcgsim-marker-d` is the token's painted diameter in pixels, so the rim
 * and bevel keep their proportions at every board size.
 */
export const BOARD_MARKER_CSS = `
.ptcgsim-marker__token {
  position: relative;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  flex: none;
  overflow: hidden;
  border-radius: 50%;
  background-color: var(--ptcgsim-marker-fill);
  color: var(--ptcgsim-marker-ink);
  box-shadow: var(
    --shadow-2,
    0 2px 6px rgb(0 0 0 / 0.38),
    0 1px 2px rgb(0 0 0 / 0.3)
  );
}
.ptcgsim-marker__token::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(
      ellipse 58% 42% at 36% 24%,
      rgb(255 255 255 / 0.5),
      rgb(255 255 255 / 0) 72%
    ),
    radial-gradient(circle at 50% 46%, rgb(0 0 0 / 0) 62%, rgb(0 0 0 / 0.2));
  box-shadow:
    inset 0 0 0 calc(var(--ptcgsim-marker-d) * 0.06) var(--ptcgsim-marker-rim),
    inset 0 calc(var(--ptcgsim-marker-d) * 0.075)
      calc(var(--ptcgsim-marker-d) * 0.05)
      calc(var(--ptcgsim-marker-d) * -0.03) rgb(255 255 255 / 0.32),
    inset 0 calc(var(--ptcgsim-marker-d) * -0.075)
      calc(var(--ptcgsim-marker-d) * 0.07)
      calc(var(--ptcgsim-marker-d) * -0.03) rgb(0 0 0 / 0.3);
}
.ptcgsim-marker__art {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.ptcgsim-marker__label {
  position: relative;
  z-index: 2;
  display: block;
  color: var(--ptcgsim-marker-ink);
  font-family: var(
    --font-display,
    'Jost Variable',
    'Jost',
    'Futura',
    'Century Gothic',
    ui-sans-serif,
    sans-serif
  );
  font-weight: 800;
  font-variant-numeric: tabular-nums lining-nums;
  letter-spacing: -0.035em;
  line-height: 1;
  white-space: nowrap;
}
.ptcgsim-marker__token[data-marker-face='damage-100'] .ptcgsim-marker__label {
  text-shadow:
    0 0.03em 0.06em rgb(70 0 6 / 0.7),
    0 0 0.12em rgb(70 0 6 / 0.45);
}
.ptcgsim-marker__token[data-marker-face='condition-note'] .ptcgsim-marker__label {
  font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
  font-weight: 700;
  letter-spacing: 0;
}
.ptcgsim-marker__tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.28em;
  box-sizing: border-box;
  flex: none;
  width: 100%;
  height: 100%;
  padding: 0 0.5em;
  border: max(1px, 0.09em) solid var(--ptcgsim-marker-rim);
  border-radius: var(--radius-pill, 999px);
  background-color: var(--ptcgsim-marker-fill);
  background-image: linear-gradient(
    180deg,
    rgb(255 255 255 / 0.26),
    rgb(255 255 255 / 0) 46%,
    rgb(0 0 0 / 0.28)
  );
  box-shadow: var(--shadow-1, 0 1px 2px rgb(0 0 0 / 0.35));
  color: var(--ptcgsim-marker-ink);
  transform: skewX(-14deg);
}
.ptcgsim-marker__tab > * {
  transform: skewX(14deg);
}
.ptcgsim-marker__tab[data-marker-tab='compact'] {
  padding: 0;
  border-radius: 28%;
  transform: none;
}
.ptcgsim-marker__tab[data-marker-tab='compact'] > * {
  transform: none;
}
.ptcgsim-marker__tab-label {
  font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
  font-style: italic;
  font-weight: 750;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  text-shadow: 0 0.05em 0.08em rgb(80 0 6 / 0.6);
}
.ptcgsim-marker__check {
  display: block;
  flex: none;
  width: 1em;
  height: 1em;
}
`;
