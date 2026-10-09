import {
  legacyMarkerCssColor,
  markerFace,
  markerLabelFontSizePx,
  type MarkerFace,
} from '@ptcgsim/renderer-contract';
import type { MarkerSceneNode } from '@ptcgsim/renderer-contract';
import { memo, type CSSProperties, type ReactNode } from 'react';

/**
 * The colours a token paints with, as custom properties its stylesheet reads.
 * A counter's face colour goes through its design token first.
 */
const faceVariables = (face: MarkerFace): CSSProperties => {
  const fill = legacyMarkerCssColor(face.fill);
  return {
    '--ptcgsim-marker-fill': face.fillToken
      ? `var(${face.fillToken}, ${fill})`
      : fill,
    '--ptcgsim-marker-rim': legacyMarkerCssColor(face.rim),
    '--ptcgsim-marker-ink': legacyMarkerCssColor(face.ink),
    ...(face.art
      ? { '--ptcgsim-marker-art': legacyMarkerCssColor(face.art) }
      : {}),
  } as CSSProperties;
};

const artProps = {
  className: 'ptcgsim-marker__art',
  viewBox: '0 0 100 100',
  'aria-hidden': true,
  focusable: false,
} as const;

/**
 * Chip artwork, drawn in a 100-unit square and clipped by the round chip.
 * Burn and Poison follow the current rulebook markers; the other three are
 * the familiar symbols for what the table does by turning the card.
 */
const CONDITION_ART: Readonly<Record<string, ReactNode>> = {
  poisoned: (
    <svg {...artProps}>
      <path
        fill="var(--ptcgsim-marker-art)"
        d="M0 100 V52 C0 47 4 45 8 45 C14 45 17 49 17 54 V58 C17 62 20 64 23 64 C26 64 28 62 28 58 V40 C28 35 32 32 36 32 C40 32 43 35 43 40 V50 C43 56 47 60 52 60 C57 60 60 56 60 51 V48 C60 45 62 43 64 43 C66 43 68 45 68 48 V64 C68 67 70 68 72 68 C74 68 75 67 75 64 V47 C75 42 79 39 84 39 C90 39 94 43 96 47 L100 47 V100 Z"
      />
    </svg>
  ),
  burned: (
    <svg {...artProps}>
      <path
        fill="var(--ptcgsim-marker-art)"
        d="M12 100 V82 C12 66 17 52 24 40 C26 46 28 52 30 56 C31 59 33 60 35 59 C37 57 37 52 36 46 C38 40 42 36 47 35 C53 34 57 37 58 42 C58 48 59 54 61 57 C62 59 64 59 65 57 C66 52 67 47 69 41 C77 50 85 62 87 76 V100 Z"
      />
    </svg>
  ),
  asleep: (
    <svg {...artProps}>
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path strokeWidth="9" d="M20 54h25L20 79h25" />
        <path strokeWidth="6.5" d="M51 34h14L51 48h14" />
        <path strokeWidth="4.5" d="M69 19h9l-9 9h9" />
      </g>
    </svg>
  ),
  paralyzed: (
    <svg {...artProps}>
      <path
        fill="currentColor"
        stroke="rgb(0 0 0 / 0.35)"
        strokeWidth="2"
        strokeLinejoin="round"
        d="M57 12 28 56h19l-7 32 32-48H53l9-28Z"
      />
    </svg>
  ),
  confused: (
    <svg {...artProps}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        d="M50 50a5 5 0 0 1 10 0 10 10 0 0 1-20 0 15 15 0 0 1 30 0 20 20 0 0 1-40 0 25 25 0 0 1 50 0"
      />
    </svg>
  ),
};

const CheckGlyph = () => (
  <svg
    className="ptcgsim-marker__check"
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M3 8.6 6.4 12 13 4.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** A counter disc or condition chip, centred in the marker's box. */
const MarkerToken = ({
  marker,
  face,
}: {
  readonly marker: MarkerSceneNode;
  readonly face: MarkerFace;
}) => {
  const diameter =
    Math.min(marker.bounds.width, marker.bounds.height) * face.scale;
  return (
    <span
      className="ptcgsim-marker__token"
      data-marker-face={face.face}
      style={
        {
          width: diameter,
          height: diameter,
          '--ptcgsim-marker-d': `${diameter}px`,
          ...faceVariables(face),
        } as CSSProperties
      }
    >
      {CONDITION_ART[face.face] ?? null}
      {face.label === '' ? null : (
        <span
          className="ptcgsim-marker__label"
          style={{ fontSize: markerLabelFontSizePx(diameter, face.label) }}
        >
          {face.label}
        </span>
      )}
    </span>
  );
};

/**
 * The "Ability" lozenge printed on cards, ticked. A wide box (the active and
 * bench stacks) carries the word; a square one (a single card) only the tick.
 */
const AbilityTab = ({
  marker,
  face,
}: {
  readonly marker: MarkerSceneNode;
  readonly face: MarkerFace;
}) => {
  const { width, height } = marker.bounds;
  const wide = width >= height * 2.2;
  const side = Math.min(width, height) * 0.92;
  return (
    <span
      className="ptcgsim-marker__tab"
      data-marker-face={face.face}
      data-marker-tab={wide ? 'wide' : 'compact'}
      style={{
        ...(wide
          ? { fontSize: Math.min(height * 0.6, width / 6) }
          : { width: side, height: side, fontSize: side * 0.72 }),
        ...faceVariables(face),
      }}
    >
      {wide ? (
        <span className="ptcgsim-marker__tab-label">{face.label}</span>
      ) : null}
      <CheckGlyph />
    </span>
  );
};

/**
 * One marker. The outer box keeps the scene's exact rectangle, z-index and
 * data attributes (geometry tests and the motion director's counter pulse
 * address it); the token painted inside it is the real accessory.
 */
export const MarkerNode = memo(function MarkerNode({
  marker,
}: {
  readonly marker: MarkerSceneNode;
}) {
  const face = markerFace(marker);
  return (
    <div
      className={`ptcgsim-marker ptcgsim-marker-${marker.kind}`}
      data-marker-id={marker.id}
      data-marker-presentation={marker.presentation}
      data-marker-side={marker.side}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: marker.bounds.x,
        top: marker.bounds.y,
        width: marker.bounds.width,
        height: marker.bounds.height,
        zIndex: marker.zIndex,
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {marker.kind === 'abilityUsed' ? (
        <AbilityTab marker={marker} face={face} />
      ) : (
        <MarkerToken marker={marker} face={face} />
      )}
    </div>
  );
});
