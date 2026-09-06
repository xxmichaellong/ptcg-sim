import { asViewDefinitionId } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  applyReplayLocalDisclosure,
  isValidReplayLocalDisclosure,
  reconcileReplayLocalDisplayState,
  toggleReplayLocalDisclosure,
} from './replayLocalDisclosure.js';

const fixture = () => {
  const view = createRendererSpikeView();
  if (view.viewer.kind !== 'player') throw new Error('player fixture required');
  const viewerId = view.viewer.playerId;
  const zones = Object.values(view.zones).filter(
    (zone) =>
      zone.kind === 'prizes' ||
      (zone.kind === 'hand' && zone.ownerId !== viewerId)
  );
  const definitionId = asViewDefinitionId('replay-local-definition-fixture');
  const disclosure = {
    definitions: [
      {
        id: definitionId,
        name: 'Replay-local card',
        category: 'Pokémon' as const,
        imageUrl: '/replay-local-card.png',
      },
    ],
    zoneIds: zones.map((zone) => zone.id),
    cards: zones.flatMap((zone) =>
      zone.cards
        .filter((card) => card.kind === 'concealed')
        .map((card) => ({
          kind: 'known' as const,
          id: card.id,
          definitionId,
          ownerId: card.ownerId,
          category: 'Pokémon' as const,
          face: 'up' as const,
          orientationQuarterTurns: 0 as const,
          abilityUsed: false,
          publiclyRevealed: false as const,
        }))
    ),
  };
  return { view, disclosure, zones };
};

describe('solo replay local disclosure projection', () => {
  it('shows and covers one eligible zone without mutating the safe view', () => {
    const { view, disclosure, zones } = fixture();
    const safeBefore = JSON.stringify(view);
    const initial = reconcileReplayLocalDisplayState(view, disclosure);
    expect(initial).not.toBeNull();
    const prize = zones.find((zone) => zone.kind === 'prizes')!;
    const cardId = prize.cards[0]!.id;
    const shown = toggleReplayLocalDisclosure(
      view,
      initial!,
      'togglePrizes',
      cardId
    );
    const displayed = applyReplayLocalDisclosure(view, shown!);
    expect(displayed).not.toBe(view);
    expect(
      displayed.zones[prize.id]!.cards.every(
        (card) => card.kind === 'known' && card.face === 'up'
      )
    ).toBe(true);
    expect(displayed.definitions).toHaveProperty(
      'replay-local-definition-fixture'
    );
    expect(
      zones
        .filter((zone) => zone.id !== prize.id)
        .every((zone) => displayed.zones[zone.id] === view.zones[zone.id])
    ).toBe(true);

    const hidden = toggleReplayLocalDisclosure(
      view,
      shown!,
      'revealPrizes',
      cardId
    );
    const covered = applyReplayLocalDisclosure(view, hidden!);
    expect(
      covered.zones[prize.id]!.cards.every((card) => card.kind === 'concealed')
    ).toBe(true);
    expect(covered.definitions).not.toHaveProperty(
      'replay-local-definition-fixture'
    );
    expect(JSON.stringify(view)).toBe(safeBefore);
  });

  it('permits only prize and opponent-hand action pairings', () => {
    const { view, disclosure, zones } = fixture();
    const initial = reconcileReplayLocalDisplayState(view, disclosure)!;
    const opponentHand = zones.find((zone) => zone.kind === 'hand')!;
    const prize = zones.find((zone) => zone.kind === 'prizes')!;
    expect(
      toggleReplayLocalDisclosure(
        view,
        initial,
        'toggleOpponentHand',
        opponentHand.cards[0]!.id
      )
    ).not.toBeNull();
    expect(
      toggleReplayLocalDisclosure(
        view,
        initial,
        'toggleOpponentHand',
        prize.cards[0]!.id
      )
    ).toBeNull();
    expect(
      toggleReplayLocalDisclosure(
        view,
        initial,
        'togglePrizes',
        opponentHand.cards[0]!.id
      )
    ).toBeNull();
  });

  it('fails closed on extra zones, aliases, collisions, and spectators', () => {
    const { view, disclosure } = fixture();
    expect(isValidReplayLocalDisclosure(view, disclosure)).toBe(true);
    expect(
      isValidReplayLocalDisclosure(view, {
        ...disclosure,
        zoneIds: disclosure.zoneIds.slice(1),
      })
    ).toBe(false);
    expect(
      isValidReplayLocalDisclosure(view, {
        ...disclosure,
        cards: disclosure.cards.slice(1),
      })
    ).toBe(false);
    expect(
      isValidReplayLocalDisclosure(view, {
        ...disclosure,
        definitions: [
          {
            ...disclosure.definitions[0]!,
            id: Object.values(view.definitions)[0]!.id,
          },
        ],
      })
    ).toBe(false);
    expect(
      isValidReplayLocalDisclosure(
        { ...view, viewer: { kind: 'spectator' } },
        disclosure
      )
    ).toBe(false);
  });

  it('carries zone modes across advance reconciliation but not resync', () => {
    const { view, disclosure, zones } = fixture();
    const prize = zones.find((zone) => zone.kind === 'prizes')!;
    const shown = toggleReplayLocalDisclosure(
      view,
      reconcileReplayLocalDisplayState(view, disclosure)!,
      'togglePrizes',
      prize.cards[0]!.id
    )!;
    expect(
      reconcileReplayLocalDisplayState(
        { ...view, revision: view.revision + 1 },
        disclosure,
        shown
      )?.zoneModes[prize.id]
    ).toBe('shown');
    expect(
      reconcileReplayLocalDisplayState(view, disclosure)?.zoneModes
    ).toEqual({});
  });
});
