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
    ]);
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
    ).toEqual({ ok: false, reason: 'unsupported_source' });
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
});
