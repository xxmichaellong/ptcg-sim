import { asViewDefinitionId } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { applySoloOpponentHandVisibility } from './solo-opponent-hand-visibility.js';

const disclosedView = () => {
  const view = createRendererSpikeView();
  if (view.viewer.kind !== 'player') throw new Error('player view required');
  const opponentHand = Object.values(view.zones).find(
    (zone) =>
      zone.kind === 'hand' &&
      zone.ownerId !== null &&
      zone.ownerId !== view.viewer.playerId
  );
  if (!opponentHand) throw new Error('opponent hand required');
  const definitionId = asViewDefinitionId('solo-hand-face-definition');
  const cards = opponentHand.cards.map((card) => ({
    kind: 'known' as const,
    id: card.id,
    definitionId,
    ownerId: card.ownerId,
    category: 'Trainer' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false as const,
  }));
  return {
    view: {
      ...view,
      definitions: {
        ...view.definitions,
        [definitionId]: {
          id: definitionId,
          name: 'Solo opponent card',
          category: 'Trainer' as const,
          imageUrl: 'https://cards.example/solo-face.png',
        },
      },
      zones: {
        ...view.zones,
        [opponentHand.id]: {
          ...opponentHand,
          cards,
        },
      },
    },
    opponentHand,
  };
};

describe('Solo opponent-hand display preference', () => {
  it('covers the opponent hand locally while preserving aliases and input', () => {
    const prepared = disclosedView();
    const before = JSON.stringify(prepared.view);
    const covered = applySoloOpponentHandVisibility(prepared.view, true);
    const cards = covered.zones[prepared.opponentHand.id]!.cards;

    expect(covered).not.toBe(prepared.view);
    expect(cards.map((card) => card.id)).toEqual(
      prepared.opponentHand.cards.map((card) => card.id)
    );
    expect(
      cards.every(
        (card) =>
          card.kind === 'concealed' &&
          card.cardBackUrl ===
            prepared.view.players[card.ownerId]?.cardBackUrl &&
          !card.publiclyRevealed
      )
    ).toBe(true);
    expect(JSON.stringify(prepared.view)).toBe(before);
  });

  it('is a no-op while unchecked or for a spectator projection', () => {
    const { view } = disclosedView();
    expect(applySoloOpponentHandVisibility(view, false)).toBe(view);
    const spectator = { ...view, viewer: { kind: 'spectator' as const } };
    expect(applySoloOpponentHandVisibility(spectator, true)).toBe(spectator);
  });
});
