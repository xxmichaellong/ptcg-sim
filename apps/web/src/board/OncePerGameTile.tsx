import { useId, type CSSProperties, type SVGProps } from 'react';

/** Inline SVG ids must be unique on the page; React's ids carry punctuation. */
const useSvgId = (name: string): string =>
  `${name}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

const DISPLAY_FONT: CSSProperties = {
  fontFamily:
    "var(--font-display, 'Jost Variable', 'Jost', 'Futura', 'Century Gothic', sans-serif)",
  fontStyle: 'italic',
  fontWeight: 900,
};

/** The GX marker's outline: rounded left corners, chamfered right ones. */
const GX_OUTLINE =
  'M8 2H134L148 16V84L136 98H8A6 6 0 0 1 2 92V8A6 6 0 0 1 8 2Z';

const GxFront = () => {
  const clip = useSvgId('gx-clip');
  const chrome = useSvgId('gx-chrome');
  return (
    <svg viewBox="0 0 150 100" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d={GX_OUTLINE} />
        </clipPath>
        <linearGradient id={chrome} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#e4e8ec" />
          <stop offset="0.55" stopColor="#a9b0b7" />
          <stop offset="1" stopColor="#f2f4f6" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="150" height="100" fill="#fff200" />
        <path d="M0 0H122L18 100H0Z" fill="#191515" />
        <rect width="150" height="44" fill="#ffffff" opacity="0.1" />
      </g>
      <path d={GX_OUTLINE} fill="none" stroke="#5f5f5f" strokeWidth="1.5" />
      <g style={DISPLAY_FONT} fontSize="62" textAnchor="middle">
        <text
          x="75"
          y="72"
          fill="#111111"
          stroke="#111111"
          strokeWidth="12"
          strokeLinejoin="round"
        >
          GX
        </text>
        <text
          x="75"
          y="72"
          fill="#1ba6e0"
          stroke="#1ba6e0"
          strokeWidth="6"
          strokeLinejoin="round"
        >
          GX
        </text>
        <text x="75" y="72" fill={`url(#${chrome})`}>
          GX
        </text>
      </g>
    </svg>
  );
};

/** Face down: the plain back of the counter-sheet piece. */
const GxBack = () => (
  <svg viewBox="0 0 150 100" aria-hidden="true" focusable="false">
    <path d={GX_OUTLINE} fill="#34363c" stroke="#1f2024" strokeWidth="1.5" />
    <text
      x="75"
      y="70"
      style={DISPLAY_FONT}
      fontSize="62"
      textAnchor="middle"
      fill="none"
      stroke="#50535b"
      strokeWidth="2"
    >
      GX
    </text>
  </svg>
);

const VSTAR_V = 'M14 22H44L56 62L104 16H156L64 86H40Z';

/** The V and STAR, drawn once per layer of the die-cut acrylic. */
const VstarLogo = (props: SVGProps<SVGGElement>) => (
  <g strokeLinejoin="round" {...props}>
    <path d={VSTAR_V} />
    <text x="66" y="84" style={DISPLAY_FONT} fontSize="40" letterSpacing="-1">
      STAR
    </text>
  </g>
);

const VstarFront = () => {
  const gold = useSvgId('vstar-gold');
  return (
    <svg viewBox="0 4 182 92" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8e7a8" />
          <stop offset="0.4" stopColor="#d8b451" />
          <stop offset="0.6" stopColor="#a9822a" />
          <stop offset="1" stopColor="#e9cf7c" />
        </linearGradient>
      </defs>
      <VstarLogo fill="#fbfcfd" stroke="#fbfcfd" strokeWidth="16" />
      <VstarLogo
        fill="none"
        stroke="#9aa3ad"
        strokeWidth="17.5"
        opacity="0.55"
      />
      <VstarLogo fill="#fbfcfd" stroke="#fbfcfd" strokeWidth="15" />
      <VstarLogo fill={`url(#${gold})`} stroke="#5b4510" strokeWidth="1.6" />
    </svg>
  );
};

/** Flipped over: the dark back of the acrylic marker. */
const VstarBack = () => (
  <svg viewBox="0 4 182 92" aria-hidden="true" focusable="false">
    <VstarLogo fill="#34363c" stroke="#34363c" strokeWidth="16" />
    <VstarLogo fill="#44474e" />
  </svg>
);

/**
 * The physical GX or VSTAR marker: a tile with a front and a back that turns
 * face down (3D, both faces backface-hidden) once the move is used.
 */
export const OncePerGameTile = ({
  marker,
}: {
  readonly marker: 'gx' | 'vstar';
}) => (
  <span className="once-per-game-tile" aria-hidden="true">
    <span className="once-per-game-tile__face once-per-game-tile__face--front">
      {marker === 'gx' ? <GxFront /> : <VstarFront />}
    </span>
    <span className="once-per-game-tile__face once-per-game-tile__face--back">
      {marker === 'gx' ? <GxBack /> : <VstarBack />}
    </span>
  </span>
);

/** Width over height of each tile's artwork. */
export const ONCE_PER_GAME_TILE_ASPECT: Readonly<
  Record<'gx' | 'vstar', number>
> = {
  gx: 150 / 100,
  vstar: 182 / 92,
};
