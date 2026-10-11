import {
  resolveCardPresentation,
  type MatchViewState,
  type ViewCard,
} from '@ptcgsim/game-core';
import { finishForCard, type CardFinish } from '@ptcgsim/renderer-contract';

export { finishForCard, type CardFinish };

/**
 * How a card catches the light in the inspector. Real finishes vary by print;
 * until a per-print index exists this reads the card's name and category:
 * rule-box Pokémon (ex, V, VSTAR, VMAX, GX, EX) get the full rainbow foil,
 * other Pokémon a holo on the art box, everything else a gentle sheen.
 */
export interface CardInspection {
  readonly cardId: string;
  readonly name: string;
  /** The full-size face: the board paints the small one. */
  readonly imageUrl: string;
  readonly finish: CardFinish;
  readonly foilRegion: 'artwork' | 'full' | 'none' | undefined;
  readonly readingQuarterTurns: number;
}

const findCard = (view: MatchViewState, cardId: string): ViewCard | null => {
  for (const zone of Object.values(view.zones)) {
    const found = zone.cards.find((card) => card.id === cardId);
    // The deck is face down on the table even when its owner may read it in
    // the zone viewer: its cards are never shown large from the board.
    if (found) return zone.kind === 'deck' ? null : found;
  }
  for (const stack of Object.values(view.stacks)) {
    const found =
      stack.evolutionCards.find((card) => card.id === cardId) ??
      stack.attachmentCards.find((card) => card.id === cardId);
    if (found) return found;
  }
  for (const areas of Object.values(view.workAreas)) {
    for (const area of [areas.inspection, areas.attachmentResolution]) {
      const found = area?.cards.find((card) => card.id === cardId);
      if (found) return found;
    }
  }
  return null;
};

/**
 * What the inspector may show for a hovered card: only a card this viewer
 * can read, face up and outside the deck, from the recipient-safe view.
 */
export const inspectCard = (
  view: MatchViewState | undefined,
  cardId: string
): CardInspection | null => {
  if (!view) return null;
  const card = findCard(view, cardId);
  if (!card || card.kind !== 'known' || card.face === 'down') return null;
  const definition = view.definitions[card.definitionId];
  if (!definition?.imageUrl) return null;
  return {
    cardId,
    name: definition.name,
    imageUrl: definition.imageUrl,
    finish: finishForCard(definition),
    foilRegion: definition.presentation?.foilRegion,
    readingQuarterTurns:
      resolveCardPresentation(definition)?.readingQuarterTurns ?? 0,
  };
};
