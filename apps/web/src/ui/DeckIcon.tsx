import IconBase from '@phosphor-icons/react/dist/lib/IconBase';
import type { IconProps, IconWeight } from '@phosphor-icons/react';
import { forwardRef, type ReactElement } from 'react';

/**
 * A deck of trading cards: portrait cards (63 × 88) squared up in a pile,
 * the two under the top card showing their corners, and the ring of a
 * card back on top. Drawn on Phosphor's 256 grid with its stroke weights, so it
 * sits beside the other icons and takes the same props.
 */

const TOP_CARD =
  'M58,84.5H134a16,16,0,0,1,16,16v119a16,16,0,0,1-16,16H58a16,16,0,0,1-16-16v-119a16,16,0,0,1,16-16Z';
const UNDER_CARDS = [
  'M74,84.5v-16a16,16,0,0,1,16-16h76a16,16,0,0,1,16,16v119a16,16,0,0,1-16,16H150',
  'M106,52.5v-16a16,16,0,0,1,16-16h76a16,16,0,0,1,16,16v119a16,16,0,0,1-16,16H182',
];
// The ring on a card back; a band across it reads as a minus at 16px.
const EMBLEM = { cx: 96, cy: 160, r: 24 };

const stroke = (width: number) =>
  ({
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }) as const;

const drawn = (width: number, topFill?: number): ReactElement => (
  <>
    {UNDER_CARDS.map((d) => (
      <path key={d} d={d} {...stroke(width)} />
    ))}
    {topFill === undefined ? null : (
      <path d={TOP_CARD} fill="currentColor" opacity={topFill} />
    )}
    <path d={TOP_CARD} {...stroke(width)} />
    <circle {...EMBLEM} {...stroke(width)} />
  </>
);

const WEIGHTS = new Map<IconWeight, ReactElement>([
  ['thin', drawn(8)],
  ['light', drawn(12)],
  ['regular', drawn(16)],
  ['bold', drawn(24)],
  ['duotone', drawn(16, 0.2)],
  // Solid: the top card filled, its ring left out, as Phosphor's fills are.
  [
    'fill',
    <>
      {UNDER_CARDS.map((d) => (
        <path key={d} d={d} {...stroke(16)} />
      ))}
      <path d={TOP_CARD} fill="currentColor" />
    </>,
  ],
]);

export const DeckIcon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <IconBase ref={ref} {...props} weights={WEIGHTS} />
));
DeckIcon.displayName = 'DeckIcon';
