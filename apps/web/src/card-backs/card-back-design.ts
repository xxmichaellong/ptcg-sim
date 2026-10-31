import type {
  CardBackColour,
  CardBackDesign,
  CardBackEmblem,
  CardBackPattern,
} from '@ptcgsim/game-core';

/**
 * A designed sleeve drawn as SVG from its four values (ADR-041): the same
 * values draw the same picture in every viewer's browser, nothing is fetched,
 * and the sleeve designer previews with this module.
 */

export const CARD_BACK_COLOUR_HEX: Readonly<Record<CardBackColour, string>> = {
  ink: '#1c1f26',
  slate: '#465062',
  navy: '#1d2f5c',
  royal: '#2b4fb3',
  sky: '#3d8fd6',
  teal: '#1f7a7a',
  jade: '#1f8a5b',
  lime: '#7cb342',
  gold: '#d4a52c',
  amber: '#e07b22',
  crimson: '#b3263a',
  rose: '#d9577a',
  violet: '#6a3fb5',
  plum: '#5a2a52',
  snow: '#eef0f3',
  sand: '#d8c7a3',
};

/** The card's own proportions, 63 × 88. */
const WIDTH = 630;
const HEIGHT = 880;
const INSET = 26;

const patternTile = (pattern: CardBackPattern, accent: string): string => {
  const ink = `fill="${accent}" fill-opacity="0.32"`;
  const line = `stroke="${accent}" stroke-opacity="0.34" fill="none"`;
  switch (pattern) {
    case 'plain':
      return '';
    case 'stripes':
      return `<pattern id="p" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="36" ${ink}/></pattern>`;
    case 'checks':
      return `<pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="30" height="30" ${ink}/><rect x="30" y="30" width="30" height="30" ${ink}/></pattern>`;
    case 'dots':
      return `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="7" ${ink}/></pattern>`;
    case 'waves':
      return `<pattern id="p" width="80" height="32" patternUnits="userSpaceOnUse"><path d="M0 16 Q20 0 40 16 T80 16" stroke-width="6" ${line}/></pattern>`;
    case 'rays':
      return `<pattern id="p" width="${String(WIDTH)}" height="${String(HEIGHT)}" patternUnits="userSpaceOnUse">${Array.from(
        { length: 18 },
        (_, index) =>
          `<path d="M${String(WIDTH / 2)} ${String(HEIGHT / 2)} L${String(WIDTH / 2 - 90)} -400 L${String(WIDTH / 2 + 90)} -400 Z" transform="rotate(${String(index * 20)} ${String(WIDTH / 2)} ${String(HEIGHT / 2)})" ${ink}/>`
      ).join('')}</pattern>`;
    case 'diamonds':
      return `<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M24 4 L44 24 L24 44 L4 24 Z" ${ink}/></pattern>`;
    case 'scales':
      return `<pattern id="p" width="48" height="28" patternUnits="userSpaceOnUse"><path d="M0 28 A24 24 0 0 1 48 28" stroke-width="5" ${line}/><path d="M-24 14 A24 24 0 0 1 24 14 M24 14 A24 24 0 0 1 72 14" stroke-width="5" ${line}/></pattern>`;
  }
};

/** Each emblem drawn in a 200 × 200 box about the card's middle. */
const emblemShape = (emblem: CardBackEmblem, accent: string): string => {
  const fill = `fill="${accent}"`;
  switch (emblem) {
    case 'none':
      return '';
    case 'ball':
      return `<circle cx="100" cy="100" r="88" fill="none" stroke="${accent}" stroke-width="16"/><path d="M12 100 H188" stroke="${accent}" stroke-width="16"/><circle cx="100" cy="100" r="30" ${fill}/>`;
    case 'star':
      return `<path d="M100 8 L127 72 L196 76 L143 121 L160 190 L100 152 L40 190 L57 121 L4 76 L73 72 Z" ${fill}/>`;
    case 'bolt':
      return `<path d="M118 4 L36 116 H92 L74 196 L164 76 H106 Z" ${fill}/>`;
    case 'leaf':
      return `<path d="M100 8 C168 40 176 132 100 192 C24 132 32 40 100 8 Z" ${fill}/><path d="M100 30 V180" stroke="#00000033" stroke-width="8"/>`;
    case 'flame':
      return `<path d="M100 4 C138 54 172 82 168 128 C164 172 134 196 100 196 C66 196 36 172 32 128 C30 96 52 76 66 56 C70 84 82 96 92 100 C86 64 92 32 100 4 Z" ${fill}/>`;
    case 'drop':
      return `<path d="M100 4 C130 58 170 98 170 136 C170 174 138 196 100 196 C62 196 30 174 30 136 C30 98 70 58 100 4 Z" ${fill}/>`;
    case 'moon':
      return `<path d="M128 8 A96 96 0 1 0 192 132 A76 76 0 1 1 128 8 Z" ${fill}/>`;
  }
};

/** The sleeve as an SVG document. */
export const cardBackDesignSvg = (design: CardBackDesign): string => {
  const base = CARD_BACK_COLOUR_HEX[design.base];
  const accent = CARD_BACK_COLOUR_HEX[design.accent];
  const tile = patternTile(design.pattern, accent);
  const emblem = emblemShape(design.emblem, accent);
  const inner = {
    x: INSET,
    y: INSET,
    width: WIDTH - INSET * 2,
    height: HEIGHT - INSET * 2,
  };
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}">`,
    tile ? `<defs>${tile}</defs>` : '',
    `<rect width="${String(WIDTH)}" height="${String(HEIGHT)}" rx="30" fill="${accent}"/>`,
    `<rect x="${String(inner.x)}" y="${String(inner.y)}" width="${String(inner.width)}" height="${String(inner.height)}" rx="18" fill="${base}"/>`,
    tile
      ? `<rect x="${String(inner.x)}" y="${String(inner.y)}" width="${String(inner.width)}" height="${String(inner.height)}" rx="18" fill="url(#p)"/>`
      : '',
    emblem
      ? `<g transform="translate(${String(WIDTH / 2 - 120)} ${String(HEIGHT / 2 - 120)}) scale(1.2)">${emblem}</g>`
      : '',
    '</svg>',
  ].join('');
};

/** The sleeve as an image source, drawn in the viewer's browser. */
export const cardBackDesignImage = (design: CardBackDesign): string =>
  `data:image/svg+xml,${encodeURIComponent(cardBackDesignSvg(design))}`;
