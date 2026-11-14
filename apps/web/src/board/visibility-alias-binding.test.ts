import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { createProvisionalRebinder } from './rebindProvisionalReferences.js';

const fixture = () => {
  const view = createRendererSpikeView();
  const playerId = view.playerOrder[0]!;
  const zone = view.zones[`zone:${playerId}:discard`]!;
  const template = zone.cards.find((card) => card.kind === 'known')!;
  if (template.kind !== 'known') throw new Error('Known card required');
  const cards = ['target', 'second', 'third'].map((id) => ({
    ...template,
    id: id as never,
    face: 'up' as const,
    publiclyRevealed: true,
  }));
  const before: MatchViewState = {
    ...view,
    zones: { ...view.zones, [zone.id]: { ...zone, cards } },
  };
  const hidden = {
    ...cards[0]!,
    id: 'hidden-target' as never,
    face: 'down' as const,
    publiclyRevealed: false,
  };
  const withCards = (
    current: readonly ViewCard[],
    revision = before.revision + 1
  ): MatchViewState => ({
    ...before,
    revision,
    zones: { ...before.zones, [zone.id]: { ...zone, cards: current } },
  });
  const hide: WireGameCommand = {
    type: 'SetPublicReveal',
    cardId: cards[0]!.id,
    expectedSourceId: zone.id,
    revealed: false,
  };
  const take: WireGameCommand = {
    type: 'MoveCard',
    cardId: cards[0]!.id,
    expectedSourceZoneId: zone.id,
    destinationZoneId: `zone:${playerId}:hand`,
  };
  return { before, zone, playerId, cards, hidden, withCards, hide, take };
};

describe('same-location visibility alias binding', () => {
  it.each(['public', 'face'] as const)(
    'binds an owned hide among identical copies at exact completion (%s)',
    (kind) => {
      const input = fixture();
      const rebind = createProvisionalRebinder();
      const command: WireGameCommand =
        kind === 'public'
          ? input.hide
          : { type: 'SetCardFace', cardId: input.cards[0]!.id, face: 'down' };
      rebind(command, input.before);
      const after = input.withCards([input.hidden, ...input.cards.slice(1)]);
      rebind.accepted(command, after.revision, after);
      expect(rebind(input.take, after)).toMatchObject({
        cardId: input.hidden.id,
      });
    }
  );

  it('declines a reordered or expanded source instead of guessing an identical copy by index', () => {
    for (const change of ['reorder', 'arrival'] as const) {
      const input = fixture();
      const rebind = createProvisionalRebinder();
      rebind(input.hide, input.before);
      const after = input.withCards(
        change === 'reorder'
          ? [input.cards[1]!, input.hidden, input.cards[2]!]
          : [
              input.hidden,
              ...input.cards.slice(1),
              { ...input.hidden, id: 'other-fresh-copy' as never },
            ]
      );
      rebind.accepted(input.hide, after.revision, after);
      expect(rebind(input.take, after)).toBe(input.take);
    }
  });

  it('declines an unguarded face change when peer movement changed another container', () => {
    const input = fixture();
    const rebind = createProvisionalRebinder();
    const face: WireGameCommand = {
      type: 'SetCardFace',
      cardId: input.cards[0]!.id,
      face: 'down',
    };
    rebind(face, input.before);
    const board = input.before.zones[`zone:${input.playerId}:board`]!;
    const after: MatchViewState = {
      ...input.withCards([
        { ...input.hidden, id: 'replacement-at-old-place' as never },
        ...input.cards.slice(1),
      ]),
      zones: {
        ...input.before.zones,
        [input.zone.id]: {
          ...input.zone,
          cards: [
            { ...input.hidden, id: 'replacement-at-old-place' as never },
            ...input.cards.slice(1),
          ],
        },
        [board.id]: { ...board, cards: [...board.cards, input.hidden] },
      },
    };
    rebind.accepted(face, after.revision, after);
    expect(rebind(input.take, after)).toBe(input.take);
  });

  it('never reuses a before-known opponent definition after the intended result becomes concealed', () => {
    const input = fixture();
    const opponent = input.before.playerOrder[1]!;
    const target = { ...input.cards[0]!, ownerId: opponent };
    const before = input.withCards(
      [target, ...input.cards.slice(1)],
      input.before.revision
    );
    const rebind = createProvisionalRebinder();
    rebind(input.hide, before);
    const concealed: ViewCard = {
      kind: 'concealed',
      id: 'concealed-opponent' as never,
      ownerId: opponent,
      cardBackUrl: '/opponent',
      publiclyRevealed: false,
    };
    const hand = before.zones[`zone:${input.playerId}:hand`]!;
    const after: MatchViewState = {
      ...input.withCards([concealed, ...input.cards.slice(1)]),
      zones: {
        ...before.zones,
        [input.zone.id]: {
          ...input.zone,
          cards: [concealed, ...input.cards.slice(1)],
        },
        [hand.id]: {
          ...hand,
          cards: [
            ...hand.cards,
            { ...target, id: 'unrelated-known-copy' as never },
          ],
        },
      },
    };
    rebind.accepted(input.hide, after.revision, after);
    expect(rebind(input.take, after)).toBe(input.take);
  });

  it.each(['newer', 'idle', 'refused'] as const)(
    'cannot learn a later identical replacement (%s)',
    (mode) => {
      const input = fixture();
      const rebind = createProvisionalRebinder();
      rebind(input.hide, input.before);
      const exact = input.withCards([input.hidden, ...input.cards.slice(1)]);
      const later = input.withCards(
        [
          { ...input.hidden, id: 'different-copy' as never },
          ...input.cards.slice(1),
        ],
        exact.revision + 2
      );
      if (mode === 'idle') rebind.accepted(input.hide, exact.revision, exact);
      else if (mode === 'newer')
        rebind.accepted(input.hide, exact.revision, later);
      else rebind.refused(input.hide);
      expect(rebind(input.take, later)).toMatchObject({
        cardId: mode === 'idle' ? input.hidden.id : input.cards[0]!.id,
      });
    }
  );

  it.each([
    'SetPublicReveal',
    'BeginCardInspection',
    'SetZonePublicReveal',
    'BeginZoneInspection',
  ] as const)(
    'can bind a revealed formerly concealed prize through %s',
    (type) => {
      const input = fixture();
      const prizes = input.before.zones[`zone:${input.playerId}:prizes`]!;
      const hidden: ViewCard = {
        kind: 'concealed',
        id: 'private-prize' as never,
        ownerId: input.playerId,
        cardBackUrl: '/back',
        publiclyRevealed: false,
      };
      const before: MatchViewState = {
        ...input.before,
        zones: {
          ...input.before.zones,
          [prizes.id]: { ...prizes, cards: [hidden] },
        },
      };
      const command: WireGameCommand =
        type === 'SetPublicReveal'
          ? {
              type,
              cardId: hidden.id,
              expectedSourceId: prizes.id,
              revealed: true,
            }
          : type === 'BeginCardInspection'
            ? { type, cardId: hidden.id, expectedSourceId: prizes.id }
            : type === 'SetZonePublicReveal'
              ? {
                  type,
                  targetPlayerId: input.playerId,
                  zoneId: prizes.id,
                  expectedCardIds: [hidden.id],
                  revealed: true,
                }
              : {
                  type,
                  targetPlayerId: input.playerId,
                  zoneId: prizes.id,
                  expectedCardIds: [hidden.id],
                };
      const rebind = createProvisionalRebinder();
      rebind(command, before);
      const revealed = {
        ...input.cards[0]!,
        id: 'known-prize' as never,
        publiclyRevealed: type.includes('Public'),
      };
      const after: MatchViewState = {
        ...before,
        revision: before.revision + 1,
        zones: {
          ...before.zones,
          [prizes.id]: { ...prizes, cards: [revealed] },
        },
      };
      rebind.accepted(command, after.revision, after);
      expect(
        rebind(
          { ...input.take, expectedSourceZoneId: prizes.id, cardId: hidden.id },
          after
        )
      ).toMatchObject({ cardId: revealed.id });
    }
  );
});
