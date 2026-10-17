import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  isLegacyBoardCategoryChoice,
  isLegacyBoardMoveChoice,
  LEGACY_BOARD_CATEGORY_CHOICES,
  LEGACY_BOARD_CONTEXT_ACTION_REQUIREMENTS,
  LEGACY_BOARD_MOVE_CHOICES,
  LEGACY_BOARD_ZONE_ACTION_REQUIREMENTS,
  LEGACY_REPLAY_DISCLOSURE_CONTEXT_ACTIONS,
  resolveLegacyBoardOverlayAction,
  type LegacyBoardContextActionId,
  type LegacyBoardOverlayActionRequest,
} from './resolveLegacyBoardOverlayAction.js';

const zoneIn = (
  view: MatchViewState,
  playerId: string,
  kind: MatchViewState['zones'][string]['kind']
) =>
  Object.values(view.zones).find(
    (zone) => zone.ownerId === playerId && zone.kind === kind
  )!;

const context = (
  action: LegacyBoardContextActionId,
  cardId: ViewCardId
): Extract<LegacyBoardOverlayActionRequest, { readonly kind: 'context' }> =>
  ({ kind: 'context', action, cardId }) as Extract<
    LegacyBoardOverlayActionRequest,
    { readonly kind: 'context' }
  >;

describe('legacy board overlay action resolver', () => {
  it('pins every legacy control to command, input, choice, or local ownership', () => {
    expect(LEGACY_BOARD_CONTEXT_ACTION_REQUIREMENTS).toEqual({
      toggleAbility: 'command',
      setDamage: 'input',
      setSpecialCondition: 'input',
      shufflePrizes: 'command',
      togglePrizes: 'command',
      revealPrizes: 'command',
      shufflePrizesToDeckBottom: 'command',
      discardHand: 'input',
      shuffleHandToDeck: 'input',
      shuffleHandToDeckBottom: 'input',
      toggleOpponentHand: 'command',
      randomOpponentHandCard: 'command',
      shuffleDeck: 'command',
      drawCards: 'input',
      viewDeckTop: 'input',
      viewDeckBottom: 'input',
      discardBoard: 'command',
      moveBoardToHand: 'command',
      shuffleBoardToDeck: 'command',
      moveBoardToLostZone: 'command',
      moveCard: 'choice',
      revealCard: 'command',
      changeCardType: 'choice',
    });
    expect(LEGACY_BOARD_ZONE_ACTION_REQUIREMENTS).toEqual({
      shuffleDeck: 'command',
      shuffleDiscardToDeck: 'command',
      sortZone: 'local',
    });
    expect(LEGACY_REPLAY_DISCLOSURE_CONTEXT_ACTIONS).toEqual([
      'revealPrizes',
      'togglePrizes',
      'toggleOpponentHand',
      'revealCard',
    ]);
  });

  it('looks at the Prizes still face down, and covers every look at them', () => {
    const view = createRendererSpikeView();
    const localId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const prizes = zoneIn(view, localId, 'prizes');
    const [first, second, ...others] = prizes.cards;
    const known = (card: (typeof prizes.cards)[number]) =>
      ({
        kind: 'known',
        id: card.id,
        definitionId: 'def',
        category: 'Pokémon',
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
      }) as unknown as (typeof prizes.cards)[number];
    // One Prize looked at on its own: the rest are still to see.
    const oneLooked: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [prizes.id]: { ...prizes, cards: [known(first!), second!, ...others] },
      },
      privateInspections: [
        {
          id: 'look-one',
          sourcePlayerId: localId as never,
          sourceId: prizes.id,
          cardIds: [first!.id],
        },
      ],
    };
    expect(
      resolveLegacyBoardOverlayAction(
        oneLooked,
        context('togglePrizes', second!.id)
      )
    ).toMatchObject({ ok: true, command: { type: 'BeginZoneInspection' } });
    // All seen, by two looks: covering ends both.
    const allSeen: MatchViewState = {
      ...oneLooked,
      zones: {
        ...view.zones,
        [prizes.id]: { ...prizes, cards: prizes.cards.map(known) },
      },
      privateInspections: [
        ...oneLooked.privateInspections,
        {
          id: 'look-rest',
          sourcePlayerId: localId as never,
          sourceId: prizes.id,
          cardIds: [second!.id, ...others.map((card) => card.id)],
        },
      ],
    };
    expect(
      resolveLegacyBoardOverlayAction(
        allSeen,
        context('togglePrizes', first!.id)
      )
    ).toEqual({
      ok: true,
      command: { type: 'EndPrivateInspection', inspectionId: 'look-one' },
      followUps: [{ type: 'EndPrivateInspection', inspectionId: 'look-rest' }],
    });
  });

  it("looks at the rest of the opponent's hand, and covers every look at it", () => {
    const view = createRendererSpikeView();
    const localId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const opponentId = view.playerOrder.find((id) => id !== localId)!;
    const hand = zoneIn(view, opponentId, 'hand');
    const [first, second, ...others] = hand.cards;
    expect(others.length).toBeGreaterThan(0);
    const known = (card: (typeof hand.cards)[number]) =>
      ({
        kind: 'known',
        id: card.id,
        definitionId: 'def',
        category: 'Pokémon',
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
      }) as unknown as (typeof hand.cards)[number];
    const look = (
      id: string,
      cards: readonly (typeof hand.cards)[number][]
    ) => ({
      id,
      sourcePlayerId: opponentId as never,
      sourceId: hand.id,
      cardIds: cards.map((card) => card.id),
    });
    // One card looked at on its own (coaching): the rest are still to see.
    const oneLooked: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: [known(first!), second!, ...others] },
      },
      privateInspections: [look('look-one', [first!])],
    };
    expect(
      resolveLegacyBoardOverlayAction(
        oneLooked,
        context('toggleOpponentHand', second!.id)
      )
    ).toMatchObject({
      ok: true,
      command: { type: 'BeginZoneInspection', zoneId: hand.id },
    });
    // Every card seen, each on its own: covering ends every look.
    const allSeen: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.map(known) },
      },
      privateInspections: hand.cards.map((card, index) =>
        look(`look-${String(index)}`, [card])
      ),
    };
    expect(
      resolveLegacyBoardOverlayAction(
        allSeen,
        context('toggleOpponentHand', first!.id)
      )
    ).toEqual({
      ok: true,
      command: { type: 'EndPrivateInspection', inspectionId: 'look-0' },
      followUps: hand.cards.slice(1).map((_, index) => ({
        type: 'EndPrivateInspection',
        inspectionId: `look-${String(index + 1)}`,
      })),
    });
  });

  it('reuses stale-safe annotation, visibility, inspection, and random resolvers', () => {
    const view = createRendererSpikeView();
    const localId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const opponentId = view.playerOrder.find((id) => id !== localId)!;
    const active = view.stacks[view.boards[localId]!.activeStackId!]!;
    const activeCard = active.evolutionCards.at(-1)!;
    const prizes = zoneIn(view, localId, 'prizes');
    const opponentHand = zoneIn(view, opponentId, 'hand');

    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('toggleAbility', activeCard.id)
      )
    ).toEqual({
      ok: true,
      command: {
        type: 'SetAbilityUsed',
        stackId: active.id,
        used: !active.abilityUsed,
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('revealPrizes', prizes.cards[0]!.id)
      )
    ).toMatchObject({
      ok: true,
      command: {
        type: 'SetZonePublicReveal',
        targetPlayerId: localId,
        zoneId: prizes.id,
        revealed: true,
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('togglePrizes', prizes.cards[0]!.id)
      )
    ).toMatchObject({
      ok: true,
      command: {
        type: 'BeginZoneInspection',
        targetPlayerId: localId,
        zoneId: prizes.id,
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('toggleOpponentHand', opponentHand.cards[0]!.id)
      )
    ).toMatchObject({
      ok: true,
      command: {
        type: 'BeginZoneInspection',
        targetPlayerId: opponentId,
        zoneId: opponentHand.id,
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('randomOpponentHandCard', opponentHand.cards[0]!.id)
      )
    ).toEqual({
      ok: true,
      command: { type: 'PlayRandomCardFaceDown', targetPlayerId: opponentId },
    });
  });

  it('maps complete zone and bulk workflows to one semantic command', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const prizes = zoneIn(view, playerId, 'prizes');
    const deck = zoneIn(view, playerId, 'deck');
    const discard = zoneIn(view, playerId, 'discard');
    const board = zoneIn(view, playerId, 'board');

    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('shufflePrizes', prizes.cards[0]!.id)
      )
    ).toEqual({
      ok: true,
      command: { type: 'ShuffleZone', zoneId: prizes.id },
    });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('shufflePrizesToDeckBottom', prizes.cards[0]!.id)
      )
    ).toEqual({ ok: true, command: { type: 'MovePrizesToDeckBottom' } });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('shuffleDeck', deck.cards[0]!.id)
      )
    ).toEqual({
      ok: true,
      command: { type: 'ShuffleZone', zoneId: deck.id },
    });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'zone',
        action: 'shuffleDiscardToDeck',
        zoneId: discard.id,
      })
    ).toEqual({
      ok: true,
      command: { type: 'ShuffleZoneIntoDeck', sourceZoneId: discard.id },
    });
    for (const [action, destination] of [
      ['discardBoard', 'discard'],
      ['moveBoardToHand', 'hand'],
      ['shuffleBoardToDeck', 'shuffleIntoDeck'],
      ['moveBoardToLostZone', 'lostZone'],
    ] as const) {
      expect(
        resolveLegacyBoardOverlayAction(
          view,
          context(action, board.cards[0]!.id)
        )
      ).toMatchObject({
        ok: true,
        command: {
          type: 'ResolveLooseBoardCards',
          targetPlayerId: playerId,
          destination,
        },
      });
    }
  });

  it('opens and resolves the bounded damage editor without guessing edits', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const active = view.stacks[view.boards[playerId]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;

    expect(
      resolveLegacyBoardOverlayAction(view, context('setDamage', cardId))
    ).toEqual({
      ok: true,
      input: { kind: 'damage', cardId, initialValue: '120' },
    });

    const withoutDamage: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [active.id]: { ...active, damage: null },
      },
    };

    expect(
      resolveLegacyBoardOverlayAction(
        withoutDamage,
        context('setDamage', cardId)
      )
    ).toEqual({
      ok: true,
      input: { kind: 'damage', cardId, initialValue: '10' },
      command: { type: 'SetDamage', stackId: active.id, damage: 10 },
    });

    for (const [value, damage] of [
      ['70', 70],
      ['0', null],
      ['-10', null],
      ['   ', null],
    ] as const) {
      expect(
        resolveLegacyBoardOverlayAction(view, {
          kind: 'context',
          action: 'setDamage',
          cardId,
          value,
        })
      ).toEqual({
        ok: true,
        command: { type: 'SetDamage', stackId: active.id, damage },
      });
    }
    for (const value of ['damage', '10.5', '9991', '1e100000000000000']) {
      expect(
        resolveLegacyBoardOverlayAction(view, {
          kind: 'context',
          action: 'setDamage',
          cardId,
          value,
        })
      ).toEqual({ ok: false, reason: 'invalid_value' });
    }
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'setDamage',
        cardId,
        value: 70,
      } as unknown as LegacyBoardOverlayActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
  });

  it('maps the exact category submenu choices through the stale-safe annotation resolver', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const active = view.stacks[view.boards[playerId]!.activeStackId!]!;
    const top = active.evolutionCards.at(-1)!;
    expect(LEGACY_BOARD_CATEGORY_CHOICES).toEqual([
      'Energy',
      'Trainer',
      'Pokémon',
    ]);
    expect(isLegacyBoardCategoryChoice('Energy')).toBe(true);
    expect(isLegacyBoardCategoryChoice('Trainer')).toBe(true);
    expect(isLegacyBoardCategoryChoice('Pokémon')).toBe(true);
    expect(isLegacyBoardCategoryChoice('Tool')).toBe(false);

    for (const category of LEGACY_BOARD_CATEGORY_CHOICES) {
      expect(
        resolveLegacyBoardOverlayAction(view, {
          kind: 'context',
          action: 'changeCardType',
          cardId: top.id,
          category,
        })
      ).toEqual({
        ok: true,
        command: {
          type: 'ChangeCardCategory',
          cardId: top.id,
          expectedSourceId: active.id,
          category,
        },
      });
    }
    expect(
      resolveLegacyBoardOverlayAction(view, context('changeCardType', top.id))
    ).toEqual({ ok: false, reason: 'requires_choice' });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'changeCardType',
        cardId: top.id,
        category: 'Tool',
      } as unknown as LegacyBoardOverlayActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'changeCardType',
        cardId: active.evolutionCards[0]!.id,
        category: 'Energy',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });

    const hand = zoneIn(view, playerId, 'hand');
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'changeCardType',
        cardId: hand.cards[0]!.id,
        category: 'Energy',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
  });

  it('maps the exact move submenu choices through existing stale-safe movement resolvers', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const hand = zoneIn(view, playerId, 'hand');
    const board = zoneIn(view, playerId, 'board');
    const deck = zoneIn(view, playerId, 'deck');
    const cardId = hand.cards[0]!.id;
    expect(LEGACY_BOARD_MOVE_CHOICES).toEqual([
      'board',
      'deckTop',
      'deckBottom',
      'deckSwitch',
      'deckShuffle',
    ]);
    for (const choice of LEGACY_BOARD_MOVE_CHOICES) {
      expect(isLegacyBoardMoveChoice(choice)).toBe(true);
    }
    expect(isLegacyBoardMoveChoice('deck')).toBe(false);

    const expected = {
      board: {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: hand.id,
        destinationZoneId: board.id,
      },
      deckTop: {
        type: 'MoveCardToDeckTop',
        cardId,
        expectedSourceId: hand.id,
      },
      deckBottom: {
        type: 'MoveCardToDeckBottom',
        cardId,
        expectedSourceId: hand.id,
      },
      deckSwitch: {
        type: 'SwapCardWithDeckTop',
        cardId,
        expectedSourceId: hand.id,
      },
      deckShuffle: {
        type: 'ShuffleCardIntoDeck',
        cardId,
        expectedSourceId: hand.id,
      },
    } as const;
    for (const destination of LEGACY_BOARD_MOVE_CHOICES) {
      expect(
        resolveLegacyBoardOverlayAction(view, {
          kind: 'context',
          action: 'moveCard',
          cardId,
          destination,
        })
      ).toEqual({ ok: true, command: expected[destination] });
    }

    const active = view.stacks[view.boards[playerId]!.activeStackId!]!;
    const top = active.evolutionCards.at(-1)!;
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'moveCard',
        cardId: top.id,
        destination: 'board',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardFromStack',
        cardId: top.id,
        expectedStackId: active.id,
        destinationZoneId: board.id,
      },
    });

    const withoutHandCard = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
      },
    };
    const inspectedView: MatchViewState = {
      ...withoutHandCard,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          inspection: {
            id: 'move-submenu-inspection',
            sourceZoneId: hand.id,
            cards: [hand.cards[0]!],
          },
        },
      },
    };
    expect(
      resolveLegacyBoardOverlayAction(inspectedView, {
        kind: 'context',
        action: 'moveCard',
        cardId,
        destination: 'board',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveInspectedCard',
        cardId,
        expectedWorkAreaId: 'move-submenu-inspection',
        destinationZoneId: board.id,
      },
    });
    const stagedView: MatchViewState = {
      ...withoutHandCard,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'move-submenu-staged',
            sourceStackId: active.id,
            cards: [hand.cards[0]!],
            evolutionCards: [],
            attachmentCards: [hand.cards[0]!],
            suggestedSlot: 'active',
          },
        },
      },
    };
    expect(
      resolveLegacyBoardOverlayAction(stagedView, {
        kind: 'context',
        action: 'moveCard',
        cardId,
        destination: 'board',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveStagedCard',
        cardId,
        expectedWorkAreaId: 'move-submenu-staged',
        destinationZoneId: board.id,
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(view, context('moveCard', cardId))
    ).toEqual({ ok: false, reason: 'requires_choice' });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'moveCard',
        cardId,
        destination: 'deck',
      } as unknown as LegacyBoardOverlayActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'moveCard',
        cardId: active.evolutionCards[0]!.id,
        destination: 'board',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardFromStack',
        cardId: active.evolutionCards[0]!.id,
        expectedStackId: active.id,
        destinationZoneId: board.id,
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'moveCard',
        cardId: board.cards[0]!.id,
        destination: 'board',
      })
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveLegacyBoardOverlayAction(
        {
          ...view,
          zones: { ...view.zones, [deck.id]: { ...deck, cards: [] } },
        },
        {
          kind: 'context',
          action: 'moveCard',
          cardId,
          destination: 'deckSwitch',
        }
      )
    ).toEqual({ ok: false, reason: 'empty_deck' });
  });

  it('opens and resolves the active special-condition editor with legacy defaults', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const active = view.stacks[view.boards[playerId]!.activeStackId!]!;
    const cardId = active.evolutionCards.at(-1)!.id;

    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('setSpecialCondition', cardId)
      )
    ).toEqual({
      ok: true,
      input: {
        kind: 'specialCondition',
        cardId,
        initialValue: 'Poisoned',
      },
    });

    const withoutCondition: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [active.id]: { ...active, specialCondition: null },
      },
    };
    expect(
      resolveLegacyBoardOverlayAction(
        withoutCondition,
        context('setSpecialCondition', cardId)
      )
    ).toEqual({
      ok: true,
      input: { kind: 'specialCondition', cardId, initialValue: 'P' },
      command: {
        type: 'SetSpecialCondition',
        stackId: active.id,
        condition: 'P',
      },
    });

    for (const [value, condition] of [
      [' Pa ', 'Pa'],
      ['0', null],
      ['   ', null],
    ] as const) {
      expect(
        resolveLegacyBoardOverlayAction(view, {
          kind: 'context',
          action: 'setSpecialCondition',
          cardId,
          value,
        })
      ).toEqual({
        ok: true,
        command: {
          type: 'SetSpecialCondition',
          stackId: active.id,
          condition,
        },
      });
    }
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'setSpecialCondition',
        cardId,
        value: 'condition text too long',
      })
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'setSpecialCondition',
        cardId,
        value: 1,
      } as unknown as LegacyBoardOverlayActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });

    const hand = zoneIn(view, playerId, 'hand');
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('setSpecialCondition', hand.cards[0]!.id)
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });
  });

  it('delegates protected counts and never invents local values', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const hand = zoneIn(view, playerId, 'hand');
    const deck = zoneIn(view, playerId, 'deck');

    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('discardHand', hand.cards[0]!.id)
      )
    ).toEqual({
      ok: true,
      input: {
        kind: 'count',
        action: 'discardHand',
        cardId: hand.cards[0]!.id,
        zoneId: hand.id,
        message: 'Draw how many cards?',
        initialValue: '0',
        minimum: 0,
        invalidMessage: 'Please enter a valid number for the draw amount.',
      },
    });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'context',
        action: 'drawCards',
        cardId: deck.cards[0]!.id,
        value: '2',
      })
    ).toEqual({ ok: true, command: { type: 'DrawCards', count: 2 } });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'zone',
        action: 'sortZone',
        zoneId: deck.id,
      })
    ).toEqual({ ok: false, reason: 'local_only' });
  });

  it('fails closed for spectators, stale references, and forged targets', () => {
    const view = createRendererSpikeView();
    const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
    const opponentId = view.playerOrder.find((id) => id !== playerId)!;
    const hand = zoneIn(view, playerId, 'hand');
    const opponentDeck = zoneIn(view, opponentId, 'deck');
    const spectator: MatchViewState = {
      ...view,
      viewer: { kind: 'spectator' },
    };
    const request = context('revealCard', hand.cards[0]!.id);

    expect(resolveLegacyBoardOverlayAction(spectator, request)).toEqual({
      ok: false,
      reason: 'not_player',
    });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('revealCard', 'missing-card' as ViewCardId)
      )
    ).toEqual({ ok: false, reason: 'stale_card' });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('shuffleDeck', hand.cards[0]!.id)
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveLegacyBoardOverlayAction(
        view,
        context('shuffleDeck', opponentDeck.cards[0]!.id)
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'zone',
        action: 'shuffleDeck',
        zoneId: 'missing-zone',
      })
    ).toEqual({ ok: false, reason: 'stale_zone' });
  });
  it('maps the work-area popup buttons onto the bulk and restore commands', () => {
    const base = createRendererSpikeView();
    const playerId = base.playerOrder[0]!;
    const hand = base.zones[`zone:${playerId}:hand`]!;
    const [inspected, staged] = hand.cards;
    if (!inspected || !staged) throw new Error('Fixture hand is too small');
    const view: MatchViewState = {
      ...base,
      zones: {
        ...base.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(2) },
      },
      workAreas: {
        ...base.workAreas,
        [playerId]: {
          inspection: {
            id: 'popup-inspection',
            cards: [inspected],
            sourceZoneId: `zone:${playerId}:deck`,
          },
          attachmentResolution: {
            id: 'popup-staged',
            sourceStackId: 'removed-stack',
            cards: [staged],
            evolutionCards: [],
            attachmentCards: [staged],
            suggestedSlot: 'bench',
          },
        },
      },
    };
    const board = view.boards[playerId]!;

    const expectations = [
      ['inspection', 'discardAll', 'discard'],
      ['inspection', 'shuffleAll', 'shuffleIntoDeck'],
      ['inspection', 'shuffleBottom', 'shuffleToDeckBottom'],
      ['inspection', 'lostZoneAll', 'lostZone'],
      ['inspection', 'toHand', 'hand'],
      ['staged', 'discardAll', 'discard'],
      ['staged', 'shuffleAll', 'shuffleIntoDeck'],
      ['staged', 'lostZoneAll', 'lostZone'],
      ['staged', 'toHand', 'hand'],
    ] as const;
    for (const [source, action, destination] of expectations) {
      expect(
        resolveLegacyBoardOverlayAction(view, {
          kind: 'workArea',
          source,
          action,
        })
      ).toEqual({
        ok: true,
        command: {
          type:
            source === 'inspection'
              ? 'ResolveInspectionCards'
              : 'ResolveStagedCards',
          expectedWorkAreaId:
            source === 'inspection' ? 'popup-inspection' : 'popup-staged',
          destination,
        },
      });
    }
    // "Leave in play" restores the staged stack to the slot it came from.
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'workArea',
        source: 'staged',
        action: 'leaveInPlay',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'RestoreStagedStack',
        expectedWorkAreaId: 'popup-staged',
        expectedActiveStackId: board.activeStackId,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot: 'bench',
      },
    });
    // The inspection popup has no such button, and a missing popup fails closed.
    expect(
      resolveLegacyBoardOverlayAction(view, {
        kind: 'workArea',
        source: 'inspection',
        action: 'leaveInPlay',
      })
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(
      resolveLegacyBoardOverlayAction(base, {
        kind: 'workArea',
        source: 'inspection',
        action: 'toHand',
      })
    ).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(
      resolveLegacyBoardOverlayAction(
        { ...view, viewer: { kind: 'spectator' } },
        { kind: 'workArea', source: 'staged', action: 'toHand' }
      )
    ).toEqual({ ok: false, reason: 'not_player' });
  });
});
