import type {
  CardBackColour,
  CardBackDesign,
  CardBackPattern,
} from '@ptcgsim/game-core';

import { emblemImage } from './card-back-emblems.js';

/**
 * A designed sleeve drawn as SVG from its four values (ADR-041): the same
 * values draw the same image in every viewer's browser, and the sleeve
 * designer previews with this module. The colors are muted, natural
 * tones, so a sleeve sits on the mat as a printed one would; the emblem is
 * real Pokémon iconography (card-back-emblems.ts), carried in the SVG.
 */

export const CARD_BACK_COLOUR_HEX: Readonly<Record<CardBackColour, string>> = {
  ink: '#1d2129',
  charcoal: '#36383d',
  slate: '#4a5360',
  stone: '#8a857d',
  navy: '#1f2f52',
  denim: '#3a5677',
  royal: '#2f4f9e',
  sky: '#5c8fc2',
  ocean: '#1f5a6e',
  teal: '#2a7472',
  mint: '#8cc2ab',
  jade: '#2f7a58',
  forest: '#26422f',
  sage: '#8aa38a',
  olive: '#6b6b3a',
  lime: '#8aa84a',
  gold: '#c9a34a',
  amber: '#c97f35',
  peach: '#e6b096',
  rust: '#9c4a2c',
  coral: '#d06f5f',
  crimson: '#9e2f3b',
  wine: '#5e1f2b',
  rose: '#c86f86',
  mauve: '#9a7590',
  violet: '#5e4a8f',
  lavender: '#b4a6d6',
  plum: '#4f2c4c',
  cocoa: '#5a3f30',
  sand: '#d6c4a0',
  cream: '#efe6d2',
  snow: '#f2f3f5',
};

/** The card's own proportions, 63 × 88. */
const WIDTH = 630;
const HEIGHT = 880;
const INSET = 26;
/** The emblem's medallion at the card's middle. */
const MEDALLION = 168;

const patternTile = (pattern: CardBackPattern, accent: string): string => {
  const ink = `fill="${accent}" fill-opacity="0.32"`;
  const faint = `fill="${accent}" fill-opacity="0.18"`;
  const line = `stroke="${accent}" stroke-opacity="0.34" fill="none"`;
  const thin = `stroke="${accent}" stroke-opacity="0.28" fill="none"`;
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  switch (pattern) {
    case 'plain':
      return '';
    case 'stripes':
      return `<pattern id="p" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="36" ${ink}/></pattern>`;
    case 'pinstripes':
      return `<pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M11 0 V22" stroke-width="3" ${line}/></pattern>`;
    case 'checks':
      return `<pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="30" height="30" ${ink}/><rect x="30" y="30" width="30" height="30" ${ink}/></pattern>`;
    case 'grid':
      return `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 H0 V40" stroke-width="3" ${line}/></pattern>`;
    case 'plaid':
      return `<pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="96" height="30" ${faint}/><rect x="0" y="0" width="30" height="96" ${faint}/><path d="M60 0 V96 M0 60 H96" stroke-width="4" ${thin}/></pattern>`;
    case 'dots':
      return `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="7" ${ink}/></pattern>`;
    case 'halftone':
      return `<pattern id="p" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="4" ${faint}/></pattern>`;
    case 'waves':
      return `<pattern id="p" width="80" height="32" patternUnits="userSpaceOnUse"><path d="M0 16 Q20 0 40 16 T80 16" stroke-width="6" ${line}/></pattern>`;
    case 'swirl': {
      // Broken rings about the middle, each turned a little further: a card
      // back's vortex.
      const rings = Array.from({ length: 10 }, (_, index) => {
        const r = 70 + index * 44;
        const round = 2 * Math.PI * r;
        return `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}" stroke-width="${String(Math.max(3, 9 - index * 0.6))}" stroke-dasharray="${(round * 0.58).toFixed(1)} ${(round * 0.42).toFixed(1)}" transform="rotate(${String(index * 37)} ${String(cx)} ${String(cy)})" ${line}/>`;
      }).join('');
      return `<pattern id="p" width="${String(WIDTH)}" height="${String(HEIGHT)}" patternUnits="userSpaceOnUse">${rings}</pattern>`;
    }
    case 'rays':
      return `<pattern id="p" width="${String(WIDTH)}" height="${String(HEIGHT)}" patternUnits="userSpaceOnUse">${Array.from(
        { length: 18 },
        (_, index) =>
          `<path d="M${String(cx)} ${String(cy)} L${String(cx - 90)} -400 L${String(cx + 90)} -400 Z" transform="rotate(${String(index * 20)} ${String(cx)} ${String(cy)})" ${faint}/>`
      ).join('')}</pattern>`;
    case 'diamonds':
      return `<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M24 4 L44 24 L24 44 L4 24 Z" ${ink}/></pattern>`;
    case 'chevrons':
      return `<pattern id="p" width="60" height="36" patternUnits="userSpaceOnUse"><path d="M0 26 L30 6 L60 26" stroke-width="7" ${line}/></pattern>`;
    case 'hexagons':
      return `<pattern id="p" width="60" height="104" patternUnits="userSpaceOnUse"><path d="M30 2 L56 17 V47 L30 62 L4 47 V17 Z M30 62 V104 M0 92 L4 90 M56 90 L60 92" stroke-width="4" ${line}/></pattern>`;
    case 'scales':
      return `<pattern id="p" width="48" height="28" patternUnits="userSpaceOnUse"><path d="M0 28 A24 24 0 0 1 48 28" stroke-width="5" ${line}/><path d="M-24 14 A24 24 0 0 1 24 14 M24 14 A24 24 0 0 1 72 14" stroke-width="5" ${line}/></pattern>`;
    case 'crosshatch':
      return `<pattern id="p" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M0 0 L26 26 M26 0 L0 26" stroke-width="2.5" ${thin}/></pattern>`;
  }
};

/**
 * The sleeve as an SVG document. `emblem` is the emblem's image (a data
 * URL), absent while it is fetched or for none: the medallion waits empty.
 */
export const cardBackDesignSvg = (
  design: CardBackDesign,
  emblem?: string,
  shape: 'card' | 'coin' = 'card'
): string => {
  const base = CARD_BACK_COLOUR_HEX[design.base];
  const accent = CARD_BACK_COLOUR_HEX[design.accent];
  const tile = patternTile(design.pattern, accent);
  const inner = {
    x: INSET,
    y: INSET,
    width: WIDTH - INSET * 2,
    height: HEIGHT - INSET * 2,
  };
  const withEmblem = design.emblem !== 'none';
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const art = MEDALLION * 1.5;
  if (shape === 'coin') {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 125 630 630">',
      `<defs>${tile}<clipPath id="coin"><circle cx="315" cy="440" r="287"/></clipPath><radialGradient id="metal" cx="30%" cy="20%"><stop stop-color="#fff" stop-opacity=".5"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs>`,
      `<circle cx="315" cy="440" r="313" fill="${accent}"/>`,
      `<circle cx="315" cy="440" r="287" fill="${base}"/>`,
      tile ? '<circle cx="315" cy="440" r="287" fill="url(#p)"/>' : '',
      withEmblem
        ? `<circle cx="315" cy="440" r="168" fill="${base}" stroke="${accent}" stroke-width="10"/>`
        : '',
      withEmblem && emblem
        ? `<image href="${emblem}" x="189" y="314" width="252" height="252" preserveAspectRatio="xMidYMid meet"/>`
        : '',
      '<circle cx="315" cy="440" r="313" fill="url(#metal)"/>',
      `<circle cx="315" cy="440" r="300" fill="none" stroke="${base}" stroke-opacity=".5" stroke-width="5" stroke-dasharray="3 9"/>`,
      '</svg>',
    ].join('');
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}">`,
    tile ? `<defs>${tile}</defs>` : '',
    `<rect width="${String(WIDTH)}" height="${String(HEIGHT)}" rx="30" fill="${accent}"/>`,
    `<rect x="${String(inner.x)}" y="${String(inner.y)}" width="${String(inner.width)}" height="${String(inner.height)}" rx="18" fill="${base}"/>`,
    tile
      ? `<rect x="${String(inner.x)}" y="${String(inner.y)}" width="${String(inner.width)}" height="${String(inner.height)}" rx="18" fill="url(#p)"/>`
      : '',
    // The emblem lies on a medallion of the field's own color, ringed in
    // the accent, so a busy pattern never runs through it.
    withEmblem
      ? `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(MEDALLION)}" fill="${base}" stroke="${accent}" stroke-width="10"/>`
      : '',
    withEmblem && emblem
      ? `<image href="${emblem}" x="${String(cx - art / 2)}" y="${String(cy - art / 2)}" width="${String(art)}" height="${String(art)}" preserveAspectRatio="xMidYMid meet"/>`
      : '',
    '</svg>',
  ].join('');
};

/**
 * The sleeve as an image source, drawn in the viewer's browser: with its
 * emblem once that has come (card-back-emblems.ts), before then without.
 */
export const cardBackDesignImage = (
  design: CardBackDesign,
  shape: 'card' | 'coin' = 'card'
): string =>
  `data:image/svg+xml,${encodeURIComponent(
    cardBackDesignSvg(design, emblemImage(design.emblem), shape)
  )}`;
