import { i18n } from '@lingui/core';
import type { BasicEnergyType, DeckCard, DeckList } from '@ptcgsim/deck-core';
import { basicEnergyTypeOf, hasRuleBox } from '@ptcgsim/deck-core';
import type { CSSProperties } from 'react';

import { CardImage } from './CardImage.js';
import { deckCoverImageOf } from './deck-home-covers.js';
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

const TONE_BY_TYPE: Readonly<Record<BasicEnergyType, DeckBoxTone>> = {
  grass: 'Grass',
  fire: 'Fire',
  water: 'Water',
  lightning: 'Lightning',
  psychic: 'Psychic',
  fighting: 'Fighting',
  darkness: 'Darkness',
  metal: 'Metal',
  fairy: 'Fairy',
};

const basicEnergyTone = (
  card: DeckList[number]['card']
): DeckBoxTone | undefined => {
  if (card.category !== 'Energy' || card.facts?.energyType === 'Special') {
    return undefined;
  }
  // The deck rules' own reading of a basic Energy's name.
  const type = basicEnergyTypeOf(card.name);
  return type ? TONE_BY_TYPE[type] : undefined;
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
 * The first character a reader sees, as a capital in the page's language:
 * a whole flag, family or accented letter (a grapheme), never a part of
 * one, and never an invisible mark or space before it.
 */
const initialOf = (text: string): string => {
  const locale = i18n.locale || undefined;
  const seen = text.replace(/^[\s\p{Cf}]+/u, '');
  const first =
    typeof Intl.Segmenter === 'function'
      ? ([
          ...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(
            seen
          ),
        ][0]?.segment ?? '')
      : (Array.from(seen)[0] ?? '');
  return first.toLocaleUpperCase(locale);
};

/**
 * A deck as its cover's art (ADR-033 §19): the illustration of its cover
 * card, cropped to a 16:10 window, at the head of its tile on the shelves
 * and small in a seat's switch -- the same shape, so a deck put on a seat
 * flies from one to the other (deck-box-flight.ts). A deck with no cover
 * shows its initial on its colour (the basic Energy it plays most of).
 * Only a picture: the button around it carries the name and the action.
 */
export const DeckBox = ({
  cover,
  name,
  tone,
  size = 'shelf',
  invalid = false,
  style,
}: {
  readonly cover: DeckCard | undefined;
  readonly name: string;
  readonly tone?: DeckBoxTone | undefined;
  /** At the head of a deck's tile, or small in a seat's switch. */
  readonly size?: 'shelf' | 'tray';
  /** Not playable as it stands (size or legality): a warning dot. */
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
    <span
      className="deck-box__window"
      // Rule-box prints are full art, their Pokémon lower than a plain card's.
      data-full-art={cover && hasRuleBox(cover) ? 'true' : undefined}
    >
      {cover ? (
        <CardImage
          {...deckCoverImageOf(cover, size)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className="deck-box__initial">{initialOf(name)}</span>
      )}
    </span>
    {invalid ? <span className="deck-box__tab" /> : null}
  </span>
);
