import type {
  CardPlaysAs,
  MatchViewState,
  ViewCardId,
} from '@ptcgsim/game-core';

import { locateViewCardActionSource } from './locateViewCardActionSource.js';

/**
 * The other kind a card's print lets it be played as (game-core
 * `CardDefinition.playsAs`), for a card the viewer can read: a Fossil
 * played as a Basic Pokémon, a Holon's Pokémon attached as an Energy.
 */
export const playsAsOf = (
  view: MatchViewState,
  cardId: ViewCardId
): CardPlaysAs | undefined => {
  const card = locateViewCardActionSource(view, cardId)?.card;
  return card?.kind === 'known'
    ? view.definitions[card.definitionId]?.playsAs
    : undefined;
};

/**
 * A Pokémon its print lets attach as an Energy, still a Pokémon where it
 * is: put on a Pokémon, it attaches as an Energy rather than evolve it.
 * Not one that is a Pokémon in play itself (its top card): attaching
 * starts from the hand, a window of cards, or under or on a Pokémon
 * (resolveAttachEvolveTargeting), so nothing offers what would do nothing.
 */
export const attachesAsEnergy = (
  view: MatchViewState,
  cardId: ViewCardId
): boolean => {
  const located = locateViewCardActionSource(view, cardId);
  const card = located?.card;
  const topOfAPokemon =
    located?.sourceKind === 'stack' &&
    !located.isLowerEvolution &&
    !(view.stacks[located.sourceId]?.attachmentCards ?? []).some(
      (attached) => attached.id === cardId
    );
  return (
    !topOfAPokemon &&
    card?.kind === 'known' &&
    card.category === 'Pokémon' &&
    view.definitions[card.definitionId]?.playsAs === 'Energy'
  );
};

/**
 * A card its print lets play as a Basic Pokémon (a Fossil), out of play:
 * put on the Bench, it is a Pokémon there.
 */
export const playsAsPokemon = (
  view: MatchViewState,
  cardId: ViewCardId
): boolean => {
  const located = locateViewCardActionSource(view, cardId);
  const card = located?.card;
  return (
    located?.sourceKind === 'zone' &&
    card?.kind === 'known' &&
    card.category !== 'Pokémon' &&
    view.definitions[card.definitionId]?.playsAs === 'Pokémon'
  );
};
