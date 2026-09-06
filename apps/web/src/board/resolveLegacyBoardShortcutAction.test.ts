import type { LegacyBoardShortcutActionRequest } from './resolveLegacyBoardShortcutAction.js';

import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  resolveLegacyBoardShortcutAction,
  resolveLegacyBoardShortcutKey,
} from './resolveLegacyBoardShortcutAction.js';

describe('legacy board shortcut action resolver', () => {
  it('maps exact key/code and Alt combinations to closed selected-card requests', () => {
    const cardId = 'selected-card';
    const key = (keyValue: string, code: string, altKey = false) =>
      resolveLegacyBoardShortcutKey({ key: keyValue, code, altKey }, cardId);

    expect(key('3', 'Digit3')).toEqual({
      action: 'adjustDamage',
      cardId,
      delta: 30,
    });
    expect(key('Unidentified', 'Digit9', true)).toEqual({
      action: 'adjustDamage',
      cardId,
      delta: -90,
    });
    expect(
      resolveLegacyBoardShortcutKey(
        {
          key: 'Unidentified',
          code: 'Digit8',
          altKey: false,
          getModifierState: (modifier) => modifier === 'Alt',
        },
        cardId
      )
    ).toEqual({
      action: 'adjustDamage',
      cardId,
      delta: -80,
    });
    expect(key('0', 'Digit0', true)).toEqual({
      action: 'removeDamage',
      cardId,
    });
    expect(key('Y', 'KeyY')).toEqual({
      action: 'cycleSpecialCondition',
      cardId,
      remove: false,
    });
    expect(key('y', 'KeyY', true)).toEqual({
      action: 'cycleSpecialCondition',
      cardId,
      remove: true,
    });
    expect(key('W', 'KeyW', true)).toEqual({
      action: 'toggleAbility',
      cardId,
    });
    expect(key('C', 'KeyC', true)).toEqual({
      action: 'togglePrivateInspection',
      cardId,
    });
    expect(key('z', 'KeyZ')).toEqual({
      action: 'setPublicReveal',
      cardId,
      revealed: false,
    });
    expect(key('Unidentified', 'KeyZ', true)).toEqual({
      action: 'setPublicReveal',
      cardId,
      revealed: true,
    });
    expect(key('ArrowUp', 'ArrowUp')).toEqual({
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'moveToTop',
    });
    expect(key('Unidentified', 'ArrowDown')).toEqual({
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'moveToBottom',
    });
    expect(key('ArrowRight', 'ArrowRight')).toEqual({
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'swapWithTop',
    });
    expect(key('s', 'KeyS')).toEqual({
      action: 'moveCardRelativeToDeck',
      cardId,
      deckAction: 'shuffleIntoDeck',
    });
    expect(key('H', 'KeyH')).toEqual({
      action: 'moveCardToZone',
      cardId,
      destination: 'hand',
    });
    expect(key('Unidentified', 'KeyD')).toEqual({
      action: 'moveCardToZone',
      cardId,
      destination: 'discard',
    });
    expect(key('l', 'KeyL')).toEqual({
      action: 'moveCardToZone',
      cardId,
      destination: 'lostZone',
    });
    expect(key(' ', 'Space')).toEqual({
      action: 'moveCardToZone',
      cardId,
      destination: 'board',
    });
    expect(key('Unidentified', 'KeySpace')).toEqual({
      action: 'moveCardToZone',
      cardId,
      destination: 'board',
    });
    expect(key('A', 'KeyA')).toEqual({
      action: 'moveCardToPlay',
      cardId,
      slot: 'active',
    });
    expect(key('Unidentified', 'KeyB')).toEqual({
      action: 'moveCardToPlay',
      cardId,
      slot: 'bench',
    });
    expect(key('G', 'KeyG')).toEqual({
      action: 'moveCardToStadium',
      cardId,
    });
    expect(key('ArrowUp', 'ArrowUp', true)).toBeNull();
    expect(key('s', 'KeyS', true)).toBeNull();
    expect(key('h', 'KeyH', true)).toBeNull();
    expect(key(' ', 'Space', true)).toBeNull();
    expect(key('a', 'KeyA', true)).toBeNull();
    expect(key('b', 'KeyB', true)).toBeNull();
    expect(key('g', 'KeyG', true)).toBeNull();
    expect(
      resolveLegacyBoardShortcutKey(
        {
          key: 'ArrowDown',
          code: 'ArrowDown',
          altKey: false,
          getModifierState: (modifier) => modifier === 'Alt',
        },
        cardId
      )
    ).toBeNull();
    expect(key('e', 'KeyE', true)).toEqual({
      action: 'changeCardType',
      cardId,
      category: 'Energy',
    });
    expect(key('t', 'KeyT', true)).toEqual({
      action: 'changeCardType',
      cardId,
      category: 'Trainer',
    });
    expect(key('p', 'KeyP', true)).toEqual({
      action: 'changeCardType',
      cardId,
      category: 'Pokémon',
    });
    expect(key('e', 'KeyE')).toBeNull();
    expect(key('x', 'KeyX', true)).toBeNull();
  });

  it('reuses active/bench placement and dismisses accepted moves', () => {
    const view = createRendererSpikeView();
    const hand = view.zones['zone:spike-blue:hand']!;
    const card = hand.cards[0]!;
    for (const slot of ['active', 'bench'] as const) {
      expect(
        resolveLegacyBoardShortcutAction(view, {
          action: 'moveCardToPlay',
          cardId: card.id,
          slot,
        })
      ).toEqual({
        ok: true,
        command: {
          type: 'MoveCardToPlay',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          boardPlayerId: 'spike-blue',
          slot,
        },
        dismissSelection: true,
      });
    }
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardToPlay',
        cardId: card.id,
        slot: 'invalid',
      } as unknown as LegacyBoardShortcutActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    const active = view.stacks['stack:blue:active']!;
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardToPlay',
        cardId: active.evolutionCards.at(-1)!.id,
        slot: 'active',
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('reuses atomic stadium placement and dismisses accepted moves', () => {
    const view = createRendererSpikeView();
    const hand = view.zones['zone:spike-blue:hand']!;
    const card = hand.cards[0]!;
    const stadium = view.zones['zone:shared:stadium']!;
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardToStadium',
        cardId: card.id,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCardToStadium',
        cardId: card.id,
        expectedSourceId: hand.id,
        expectedStadiumCardId: stadium.cards[0]!.id,
      },
      dismissSelection: true,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardToStadium',
        cardId: stadium.cards[0]!.id,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('reuses generic per-card zone movement and dismisses accepted moves', () => {
    const view = createRendererSpikeView();
    const hand = view.zones['zone:spike-blue:hand']!;
    const card = hand.cards[0]!;
    for (const destination of ['discard', 'lostZone', 'board'] as const) {
      expect(
        resolveLegacyBoardShortcutAction(view, {
          action: 'moveCardToZone',
          cardId: card.id,
          destination,
        })
      ).toEqual({
        ok: true,
        command: {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:spike-blue:${destination}`,
        },
        dismissSelection: true,
      });
    }
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardToZone',
        cardId: card.id,
        destination: 'invalid',
      } as unknown as LegacyBoardShortcutActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardToZone',
        cardId: card.id,
        destination: 'hand',
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('reuses all four deck-relative resolvers and dismisses accepted moves', () => {
    const view = createRendererSpikeView();
    const hand = view.zones['zone:spike-blue:hand']!;
    const card = hand.cards[0]!;
    for (const [deckAction, type] of [
      ['moveToTop', 'MoveCardToDeckTop'],
      ['moveToBottom', 'MoveCardToDeckBottom'],
      ['swapWithTop', 'SwapCardWithDeckTop'],
      ['shuffleIntoDeck', 'ShuffleCardIntoDeck'],
    ] as const) {
      expect(
        resolveLegacyBoardShortcutAction(view, {
          action: 'moveCardRelativeToDeck',
          cardId: card.id,
          deckAction,
        })
      ).toEqual({
        ok: true,
        command: {
          type,
          cardId: card.id,
          expectedSourceId: hand.id,
        },
        dismissSelection: true,
      });
    }

    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardRelativeToDeck',
        cardId: card.id,
        deckAction: 'invalid',
      } as unknown as LegacyBoardShortcutActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    const deck = view.zones['zone:spike-blue:deck']!;
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardRelativeToDeck',
        cardId: deck.cards[0]!.id,
        deckAction: 'moveToTop',
      })
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'moveCardRelativeToDeck',
        cardId: view.stacks['stack:blue:active']!.evolutionCards[0]!.id,
        deckAction: 'moveToTop',
      })
    ).toEqual({ ok: false, reason: 'unsupported_source' });
  });

  it('reuses private-inspection and public-reveal resolvers without dismissing selection', () => {
    const view = createRendererSpikeView();
    const prizes = Object.values(view.zones).find(
      (zone) => zone.ownerId === 'spike-red' && zone.kind === 'prizes'
    )!;
    const prizeCard = prizes.cards[0]!;
    const stack = view.stacks['stack:blue:active']!;
    const stackCard = stack.evolutionCards.at(-1)!;

    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'togglePrivateInspection',
        cardId: prizeCard.id,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'BeginCardInspection',
        cardId: prizeCard.id,
        expectedSourceId: prizes.id,
      },
      dismissSelection: false,
    });
    const activeInspectionView = {
      ...view,
      privateInspections: [
        {
          id: 'shortcut-private-inspection',
          sourcePlayerId: 'spike-red',
          sourceId: prizes.id,
          cardIds: [prizeCard.id],
        },
      ],
    } as typeof view;
    expect(
      resolveLegacyBoardShortcutAction(activeInspectionView, {
        action: 'togglePrivateInspection',
        cardId: prizeCard.id,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'EndPrivateInspection',
        inspectionId: 'shortcut-private-inspection',
      },
      dismissSelection: false,
    });
    expect(
      resolveLegacyBoardShortcutAction(
        {
          ...view,
          privateInspections: [
            {
              id: 'shortcut-zone-inspection',
              sourcePlayerId: 'spike-red',
              sourceId: prizes.id,
              cardIds: [prizeCard.id, prizes.cards[1]!.id],
            },
          ],
        } as typeof view,
        {
          action: 'togglePrivateInspection',
          cardId: prizeCard.id,
        }
      )
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'setPublicReveal',
        cardId: prizeCard.id,
        revealed: true,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetPublicReveal',
        cardId: prizeCard.id,
        expectedSourceId: prizes.id,
        revealed: true,
      },
      dismissSelection: false,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'setPublicReveal',
        cardId: stackCard.id,
        revealed: false,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetPublicReveal',
        cardId: stackCard.id,
        expectedSourceId: stack.id,
        revealed: false,
      },
      dismissSelection: false,
    });
  });

  it('reuses bounded stack and annotation resolvers with source selection cleanup', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const cardId = stack.evolutionCards.at(-1)!.id;
    const cycleView = {
      ...view,
      stacks: {
        ...view.stacks,
        [stack.id]: { ...stack, specialCondition: 'P' },
      },
    };

    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'adjustDamage',
        cardId,
        delta: 30,
      })
    ).toEqual({
      ok: true,
      command: { type: 'SetDamage', stackId: stack.id, damage: 150 },
      dismissSelection: false,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'adjustDamage',
        cardId,
        delta: -130,
      })
    ).toEqual({
      ok: true,
      command: { type: 'SetDamage', stackId: stack.id, damage: null },
      dismissSelection: true,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'removeDamage',
        cardId,
      })
    ).toEqual({
      ok: true,
      command: { type: 'SetDamage', stackId: stack.id, damage: null },
      dismissSelection: true,
    });
    expect(
      resolveLegacyBoardShortcutAction(cycleView, {
        action: 'cycleSpecialCondition',
        cardId,
        remove: false,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetSpecialCondition',
        stackId: stack.id,
        condition: 'B',
      },
      dismissSelection: false,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'cycleSpecialCondition',
        cardId,
        remove: true,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetSpecialCondition',
        stackId: stack.id,
        condition: null,
      },
      dismissSelection: true,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'toggleAbility',
        cardId,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetAbilityUsed',
        stackId: stack.id,
        used: !stack.abilityUsed,
      },
      dismissSelection: true,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'changeCardType',
        cardId,
        category: 'Trainer',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'ChangeCardCategory',
        cardId,
        expectedSourceId: stack.id,
        category: 'Trainer',
      },
      dismissSelection: true,
    });
  });

  it('preserves the source Alt-Y default and fails closed for invalid targets and values', () => {
    const view = createRendererSpikeView();
    const stack = view.stacks['stack:blue:active']!;
    const cardId = stack.evolutionCards.at(-1)!.id;
    const withoutCondition = {
      ...view,
      stacks: {
        ...view.stacks,
        [stack.id]: { ...stack, specialCondition: null },
      },
    };
    const withoutDamage = {
      ...view,
      stacks: {
        ...view.stacks,
        [stack.id]: { ...stack, damage: null },
      },
    };
    expect(
      resolveLegacyBoardShortcutAction(withoutDamage, {
        action: 'adjustDamage',
        cardId,
        delta: -40,
      })
    ).toEqual({
      ok: true,
      command: { type: 'SetDamage', stackId: stack.id, damage: 40 },
      dismissSelection: false,
    });
    expect(
      resolveLegacyBoardShortcutAction(withoutCondition, {
        action: 'cycleSpecialCondition',
        cardId,
        remove: true,
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'SetSpecialCondition',
        stackId: stack.id,
        condition: 'P',
      },
      dismissSelection: false,
    });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'adjustDamage',
        cardId,
        delta: Number.NaN,
      })
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'setPublicReveal',
        cardId,
        revealed: 'true',
      } as unknown as LegacyBoardShortcutActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'changeCardType',
        cardId,
        category: 'Item',
      } as unknown as LegacyBoardShortcutActionRequest)
    ).toEqual({ ok: false, reason: 'invalid_value' });
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'changeCardType',
        cardId: stack.evolutionCards[0]!.id,
        category: 'Energy',
      })
    ).toEqual({ ok: false, reason: 'unsupported_target' });
    const knownHandCard = view.zones['zone:spike-blue:hand']!.cards[0]!;
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'togglePrivateInspection',
        cardId: knownHandCard.id,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
    const concealedPrizeCard = view.zones['zone:spike-red:prizes']!.cards[0]!;
    expect(
      resolveLegacyBoardShortcutAction(view, {
        action: 'setPublicReveal',
        cardId: concealedPrizeCard.id,
        revealed: false,
      })
    ).toEqual({ ok: false, reason: 'no_op' });
    expect(
      resolveLegacyBoardShortcutAction(
        { ...view, viewer: { kind: 'spectator' } },
        { action: 'toggleAbility', cardId }
      )
    ).toEqual({ ok: false, reason: 'not_player' });
  });
});
