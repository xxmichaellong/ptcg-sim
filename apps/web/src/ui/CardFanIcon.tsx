import IconBase from '@phosphor-icons/react/dist/lib/IconBase';
import type { IconProps, IconWeight } from '@phosphor-icons/react';
import { forwardRef, type ReactElement } from 'react';

/**
 * Two trading cards held in a fan: portrait cards (63 × 88), the one behind
 * leaning left and the one in front leaning right with the ring of a card
 * back. Drawn on Phosphor's 256 grid with its stroke weights, like DeckIcon,
 * so it sits beside the other icons and takes the same props.
 *
 * The card behind is only the part of its outline clear of the front card
 * and a gap (worked out once per stroke weight), so nothing crosses the
 * front card and nothing needs a mask: a mask is found by id, and an exit
 * copy of a Settings page (dock-slide.ts) has its ids stripped.
 */

/** A card centred on the origin, 110 × 154 with Phosphor's corners. */
const CARD =
  'M-41,-77H41a14,14,0,0,1,14,14V63a14,14,0,0,1-14,14H-41a14,14,0,0,1-14-14V-63A14,14,0,0,1-41,-77Z';
const FRONT = 'translate(158 134) rotate(10)';
/** The card behind (CARD at translate(98 126) rotate(-12)), as seen. */
const BEHIND: Readonly<Record<8 | 12 | 16 | 24, string>> = {
  8: 'M83.2,207.9L72.7,210.0L70.1,210.1L67.4,209.7L64.3,208.5L61.7,206.6L59.5,204.1L58.0,201.2L57.3,199.1L31.1,75.8L30.8,73.6L30.9,71.0L31.9,67.4L34.0,64.0L36.8,61.4L40.2,59.7L105.2,45.7',
  12: 'M74.6,209.7L71.9,210.1L69.1,210.0L66.7,209.5L64.1,208.3L62.0,206.9L60.1,204.9L58.7,202.8L57.6,200.3L31.1,75.8L30.8,73.6L30.9,71.3L31.8,67.6L33.7,64.3L36.6,61.5L39.9,59.8L94.5,48.0',
  16: 'M65.3,208.9L62.6,207.4L60.3,205.1L58.6,202.6L57.4,199.6L31.1,75.8L30.8,73.6L30.9,71.3L31.8,67.6L33.7,64.3L36.4,61.7L39.7,59.9L41.9,59.2L84.9,50.1',
  24: 'M48.9,159.4L31.1,75.6L30.8,73.1L31.0,70.5L32.0,67.2L33.7,64.3L36.0,62.0L39.0,60.2L41.6,59.3L67.3,53.8',
};

const stroke = (width: number) =>
  ({
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }) as const;

const drawn = (
  width: 8 | 12 | 16 | 24,
  front: 'line' | 'wash' | 'solid'
): ReactElement => (
  <>
    <path d={BEHIND[width]} {...stroke(width)} />
    {front === 'solid' ? (
      <path d={CARD} transform={FRONT} fill="currentColor" />
    ) : (
      <>
        {front === 'wash' ? (
          <path d={CARD} transform={FRONT} fill="currentColor" opacity={0.2} />
        ) : null}
        <path d={CARD} transform={FRONT} {...stroke(width)} />
        <circle cx={0} cy={0} r={24} transform={FRONT} {...stroke(width)} />
      </>
    )}
  </>
);

const WEIGHTS = new Map<IconWeight, ReactElement>([
  ['thin', drawn(8, 'line')],
  ['light', drawn(12, 'line')],
  ['regular', drawn(16, 'line')],
  ['bold', drawn(24, 'line')],
  ['duotone', drawn(16, 'wash')],
  // Solid: the front card filled, its ring left out, as Phosphor's fills are.
  ['fill', drawn(16, 'solid')],
]);

export const CardFanIcon = forwardRef<SVGSVGElement, IconProps>(
  (props, ref) => <IconBase ref={ref} {...props} weights={WEIGHTS} />
);
CardFanIcon.displayName = 'CardFanIcon';
