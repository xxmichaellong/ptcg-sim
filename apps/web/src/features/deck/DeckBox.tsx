import type { DeckCard, DeckList } from '@ptcgsim/deck-core';
import { hasRuleBox } from '@ptcgsim/deck-core';
import type { CSSProperties } from 'react';

import { CardImage } from './CardImage.js';
import { deckCardImageOf } from './deck-home-covers.js';
import './deck-box.css';

/** The basic Energy types a deck box can wear the colour of. */
export type DeckBoxTone =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Fairy';

/**
 * A basic Energy's name however a list writes it: "Fire Energy", "Basic
 * Fire Energy", Pokémon TCG Live's "Basic {R} Energy" (PTCGO's adds another
 * "Energy").
 */
const BASIC_ENERGY =
  /^(?:basic\s+)?(?:\{([grwlpfdmy])\}|(grass|fire|water|lightning|psychic|fighting|darkness|dark|metal|fairy))\s+energy(?:\s+energy)?$/iu;

const TONE_BY_SYMBOL: Readonly<Record<string, DeckBoxTone>> = {
  g: 'Grass',
  r: 'Fire',
  w: 'Water',
  l: 'Lightning',
  p: 'Psychic',
  f: 'Fighting',
  d: 'Darkness',
  m: 'Metal',
  y: 'Fairy',
};

const TONE_BY_NAME: Readonly<Record<string, DeckBoxTone>> = {
  grass: 'Grass',
  fire: 'Fire',
  water: 'Water',
  lightning: 'Lightning',
  psychic: 'Psychic',
  fighting: 'Fighting',
  darkness: 'Darkness',
  dark: 'Darkness',
  metal: 'Metal',
  fairy: 'Fairy',
};

const basicEnergyTone = (
  card: DeckList[number]['card']
): DeckBoxTone | undefined => {
  if (card.category !== 'Energy' || card.facts?.energyType === 'Special') {
    return undefined;
  }
  const match = BASIC_ENERGY.exec(card.name.trim());
  if (!match) return undefined;
  const [, symbol, name] = match;
  return symbol
    ? TONE_BY_SYMBOL[symbol.toLowerCase()]
    : TONE_BY_NAME[(name ?? '').toLowerCase()];
};

/**
 * A deck's colour: the basic Energy it plays most of, as a real player
 * picks a deck box to match. A deck with none (or a list not read yet) gets
 * the plain box.
 */
export const deckBoxToneOf = (
  cards: DeckList | undefined
): DeckBoxTone | undefined => {
  if (!cards) return undefined;
  const counts = new Map<DeckBoxTone, number>();
  for (const { card, count } of cards) {
    const type = basicEnergyTone(card);
    if (type) counts.set(type, (counts.get(type) ?? 0) + count);
  }
  let best: DeckBoxTone | undefined;
  let most = 0;
  for (const [type, total] of counts) {
    if (total > most) {
      best = type;
      most = total;
    }
  }
  return best;
};

/**
 * A deck box on the desk (ADR-033 §13): a plastic box in the deck's colour,
 * its lid closed, the cover card showing through a window in its front.
 * Only a picture -- the button around it carries the name and the action.
 */
export const DeckBox = ({
  cover,
  name,
  tone,
  size = 'shelf',
  sticker,
  invalid = false,
  style,
}: {
  readonly cover: DeckCard | undefined;
  readonly name: string;
  readonly tone?: DeckBoxTone | undefined;
  /** A box on a shelf, or the small one in a seat's tray. */
  readonly size?: 'shelf' | 'tray';
  /** A placing sticker on its front ("1st"). */
  readonly sticker?: string | undefined;
  /** Not playable as it stands (size or legality): a red tab on the lid. */
  readonly invalid?: boolean;
  readonly style?: CSSProperties;
}) => (
  <span
    className="deck-box"
    data-size={size}
    data-tone={tone}
    data-empty={cover ? undefined : 'true'}
    aria-hidden="true"
    style={style}
  >
    <span className="deck-box__body">
      <span className="deck-box__side" />
      <span className="deck-box__top" />
      <span className="deck-box__front">
        <span className="deck-box__lid" />
        <span
          className="deck-box__window"
          // Rule-box prints are full art, their Pokémon lower than a plain card's.
          data-full-art={cover && hasRuleBox(cover) ? 'true' : undefined}
        >
          {cover ? (
            <CardImage
              {...deckCardImageOf(cover)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <span className="deck-box__initial">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className="deck-box__gloss" />
      </span>
      {invalid ? <span className="deck-box__tab" /> : null}
      {sticker ? <span className="deck-box__sticker">{sticker}</span> : null}
    </span>
  </span>
);
