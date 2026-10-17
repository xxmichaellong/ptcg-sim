import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { createProvisionalRebinder } from './rebindProvisionalReferences.js';

describe('rebinding predicted references', () => {
  it('names the stack and window the room made for what was predicted', () => {
    const rebindProvisionalReferences = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const active = view.stacks['stack:blue:active']!;
    const played = active.evolutionCards.at(-1)!;
    const withLook: MatchViewState = {
      ...view,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          inspection: {
            id: 'room-inspection',
            sourceZoneId: `zone:${playerId}:deck`,
            cards: [],
          },
        },
      },
    };
    const attach: WireGameCommand = {
      type: 'PlaceCardOnPlayStack',
      cardId: 'energy',
      expectedSourceId: `predicted-inspection:${playerId}`,
      targetStackId: `predicted-stack:${played.id}`,
      expectedTargetTopCardId: played.id,
    } as unknown as WireGameCommand;
    expect(rebindProvisionalReferences(attach, withLook)).toMatchObject({
      expectedSourceId: 'room-inspection',
      targetStackId: active.id,
      expectedTargetTopCardId: played.id,
    });
    // Nothing predicted: the very same command.
    const plain: WireGameCommand = { type: 'FlipCoin' };
    expect(rebindProvisionalReferences(plain, view)).toBe(plain);
    // Not published yet: left for the room to refuse as stale.
    const unknown = {
      ...attach,
      targetStackId: 'predicted-stack:missing',
    } as WireGameCommand;
    expect(rebindProvisionalReferences(unknown, view)).toMatchObject({
      targetStackId: 'predicted-stack:missing',
    });
  });

  it('finds a window made by taking apart a predicted stack, after the stack is gone', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const active = view.stacks['stack:blue:active']!;
    const played = active.evolutionCards.at(-1)!;
    const predicted = `predicted-stack:${played.id}`;
    // Sent while the stack stood: it is learned.
    expect(
      rebind(
        {
          type: 'RotateStack',
          stackId: predicted,
        } as unknown as WireGameCommand,
        view
      )
    ).toMatchObject({ stackId: active.id });
    // Then the stack was taken apart into a window.
    const { [active.id]: _gone, ...stacks } = view.stacks;
    const apart: MatchViewState = {
      ...view,
      stacks,
      workAreas: {
        ...view.workAreas,
        [playerId]: {
          ...view.workAreas[playerId]!,
          attachmentResolution: {
            id: 'room-work-area',
            sourceStackId: active.id,
            cards: [],
            evolutionCards: [],
            attachmentCards: [],
            suggestedSlot: 'active',
          },
        },
      },
    };
    expect(
      rebind(
        {
          type: 'ResolveStagedCards',
          expectedWorkAreaId: `predicted-work-area:${predicted}`,
          destination: 'discard',
        } as WireGameCommand,
        apart
      )
    ).toMatchObject({ expectedWorkAreaId: 'room-work-area' });
  });

  it("finds a Pokémon whose card changed alias as it entered play (Solo's other seat), where it was played", () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const active = view.stacks['stack:blue:active']!;
    const now = active.evolutionCards.at(-1)!;
    const single: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [active.id]: { ...active, evolutionCards: [now] },
      },
    };
    const played = {
      type: 'MoveCardToPlay',
      cardId: 'alias-while-in-hand',
      expectedSourceZoneId: 'zone:spike-red:hand',
      boardPlayerId: active.boardPlayerId,
      slot: 'active',
    } as WireGameCommand;
    // The play itself is sent first, and is where the rebinder learns it,
    // on a table where the active spot was still empty.
    const { [active.id]: _absent, ...withoutActive } = view.stacks;
    expect(
      rebind(played, {
        ...view,
        stacks: withoutActive,
        boards: {
          ...view.boards,
          [active.boardPlayerId]: {
            ...view.boards[active.boardPlayerId]!,
            activeStackId: null,
          },
        },
      })
    ).toBe(played);
    expect(
      rebind(
        {
          type: 'PlaceCardOnPlayStack',
          cardId: 'energy',
          expectedSourceId: 'zone:spike-red:hand',
          targetStackId: 'predicted-stack:alias-while-in-hand',
          expectedTargetTopCardId: 'alias-while-in-hand',
        } as unknown as WireGameCommand,
        single
      )
    ).toMatchObject({
      targetStackId: active.id,
      expectedTargetTopCardId: now.id,
    });
  });

  it("never binds a refused play's stack to the Pokémon already in that spot", () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const active = view.stacks['stack:blue:active']!;
    const single: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [active.id]: {
          ...active,
          evolutionCards: [active.evolutionCards.at(-1)!],
        },
      },
    };
    // Sent while that one-card Pokémon was already active; the room refused
    // the play, and the active spot holds what it held.
    rebind(
      {
        type: 'MoveCardToPlay',
        cardId: 'refused-play',
        expectedSourceZoneId: 'zone:spike-blue:hand',
        boardPlayerId: active.boardPlayerId,
        slot: 'active',
      } as WireGameCommand,
      single
    );
    expect(
      rebind(
        {
          type: 'RotateStack',
          stackId: 'predicted-stack:refused-play',
        } as unknown as WireGameCommand,
        single
      )
    ).toMatchObject({ stackId: 'predicted-stack:refused-play' });
  });

  it("never binds a refused play's stack to another card someone put there", () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const active = view.stacks['stack:blue:active']!;
    const handId = 'zone:spike-blue:hand';
    const hand = view.zones[handId]!;
    const played = hand.cards.find((card) => card.kind === 'known')!;
    if (played.kind !== 'known') throw new Error('a known hand card');
    const other = active.evolutionCards.at(-1)!;
    if (other.kind !== 'known' || other.definitionId === played.definitionId) {
      throw new Error('a card of another definition');
    }
    const { [active.id]: _absent, ...withoutActive } = view.stacks;
    const empty: MatchViewState = {
      ...view,
      stacks: withoutActive,
      boards: {
        ...view.boards,
        [active.boardPlayerId]: {
          ...view.boards[active.boardPlayerId]!,
          activeStackId: null,
        },
      },
    };
    // A known card is played to the empty active spot...
    rebind(
      {
        type: 'MoveCardToPlay',
        cardId: played.id,
        expectedSourceZoneId: handId,
        boardPlayerId: active.boardPlayerId,
        slot: 'active',
      } as WireGameCommand,
      empty
    );
    // ...the room refuses it, and another card is put there instead.
    const filled: MatchViewState = {
      ...view,
      stacks: {
        ...view.stacks,
        [active.id]: { ...active, evolutionCards: [other] },
      },
    };
    expect(
      rebind(
        {
          type: 'SetDamage',
          stackId: `predicted-stack:${played.id}`,
          damage: 30,
        } as unknown as WireGameCommand,
        filled
      )
    ).toMatchObject({ stackId: `predicted-stack:${played.id}` });
  });

  it('names a drawn card as the hand has it once the draw has landed', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const shown = view.zones[`zone:${playerId}:deck`]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    // A player reads their own deck: its top card is known to them.
    const top = { ...hand.cards[0]!, id: 'deck-top-alias' as never };
    const deck = { ...shown, cards: [top, ...shown.cards.slice(1)] };
    const before: MatchViewState = {
      ...view,
      zones: { ...view.zones, [deck.id]: deck },
    };
    rebind({ type: 'DrawCards', count: 1 }, before);
    // The room published the draw: the card is the hand's last, renamed.
    const landed: MatchViewState = {
      ...before,
      zones: {
        ...before.zones,
        [deck.id]: { ...deck, cards: deck.cards.slice(1) },
        [hand.id]: {
          ...hand,
          cards: [...hand.cards, { ...top, id: 'alias-in-hand' as never }],
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: top.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        landed
      )
    ).toMatchObject({ cardId: 'alias-in-hand' });
  });

  it('names a card taken back into the hand as the hand has it', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const discard = view.zones[`zone:${playerId}:discard`]!;
    const card = { ...hand.cards[0]!, id: 'in-discard' as never };
    const before: MatchViewState = {
      ...view,
      zones: { ...view.zones, [discard.id]: { ...discard, cards: [card] } },
    };
    rebind(
      {
        type: 'MoveCard',
        cardId: 'in-discard',
        expectedSourceZoneId: discard.id,
        destinationZoneId: hand.id,
      },
      before
    );
    const landed: MatchViewState = {
      ...before,
      zones: {
        ...before.zones,
        [discard.id]: { ...discard, cards: [] },
        [hand.id]: {
          ...hand,
          cards: [...hand.cards, { ...card, id: 'back-in-hand' as never }],
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: 'in-discard',
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:lostZone`,
        },
        landed
      )
    ).toMatchObject({ cardId: 'back-in-hand' });
  });

  it('names a card moved within the hand as the hand has it after the move', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const [first, ...rest] = hand.cards;
    // Moved to the end of the hand: the room renames it as it goes.
    rebind(
      {
        type: 'MoveCard',
        cardId: first!.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: hand.id,
        destinationIndex: hand.cards.length - 1,
      },
      view
    );
    const landed: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: {
          ...hand,
          cards: [...rest, { ...first!, id: 'renamed-in-hand' as never }],
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: first!.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        landed
      )
    ).toMatchObject({ cardId: 'renamed-in-hand' });
  });

  it('follows a card renamed twice by two moves within the hand', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const [first, ...rest] = hand.cards;
    const reorder = (cardId: string) =>
      ({
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: hand.id,
        destinationZoneId: hand.id,
        destinationIndex: 0,
      }) as const;
    const withHand = (cards: MatchViewState['zones'][string]['cards']) =>
      ({
        ...view,
        zones: { ...view.zones, [hand.id]: { ...hand, cards } },
      }) as MatchViewState;
    // Sent at once: the first move.
    rebind(reorder(first!.id), view);
    // The second was queued on the old name; sent once the first landed.
    const once = withHand([
      ...rest,
      { ...first!, id: 'renamed-once' as never },
    ]);
    expect(rebind(reorder(first!.id), once)).toMatchObject({
      cardId: 'renamed-once',
    });
    // The discard was queued on the old name too; sent after both.
    const twice = withHand([
      { ...first!, id: 'renamed-twice' as never },
      ...rest,
    ]);
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: first!.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        twice
      )
    ).toMatchObject({ cardId: 'renamed-twice' });
  });
});
