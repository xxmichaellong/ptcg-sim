import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { createProvisionalRebinder } from './rebindProvisionalReferences.js';
import { predictWireCommand } from './predictWireCommand.js';

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

  it("forgets a refused play's stack, even with another copy in its spot", () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const active = view.stacks['stack:blue:active']!;
    const top = active.evolutionCards.at(-1)!;
    if (top.kind !== 'known') throw new Error('a known card');
    const handId = 'zone:spike-blue:hand';
    // The card played, and another copy of it.
    const played = { ...top, id: 'played-copy' };
    const other = { ...top, id: 'other-copy' };
    const { [active.id]: _absent, ...withoutActive } = view.stacks;
    const empty: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [handId]: {
          ...view.zones[handId]!,
          cards: [...view.zones[handId]!.cards, played],
        },
      },
      stacks: withoutActive,
      boards: {
        ...view.boards,
        [active.boardPlayerId]: {
          ...view.boards[active.boardPlayerId]!,
          activeStackId: null,
        },
      },
    };
    const play = rebind(
      {
        type: 'MoveCardToPlay',
        cardId: played.id,
        expectedSourceZoneId: handId,
        boardPlayerId: active.boardPlayerId,
        slot: 'active',
      } as WireGameCommand,
      empty
    );
    // The room refuses it; someone puts the other copy there instead.
    rebind.refused(play);
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

  it('names a prize taken face down into the hand as the hand has it', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const prizes = view.zones[`zone:${playerId}:prizes`]!;
    const prize = {
      kind: 'concealed',
      id: 'prize-alias',
      ownerId: playerId,
      cardBackUrl: '/v2/assets/cardback.png',
      publiclyRevealed: false,
    } as const;
    const before: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [prizes.id]: { ...prizes, cards: [prize as never] },
      },
    };
    rebind(
      {
        type: 'MoveCard',
        cardId: 'prize-alias',
        expectedSourceZoneId: prizes.id,
        destinationZoneId: hand.id,
      },
      before
    );
    const landed: MatchViewState = {
      ...before,
      zones: {
        ...before.zones,
        [prizes.id]: { ...prizes, cards: [] },
        [hand.id]: {
          ...hand,
          cards: [
            ...hand.cards,
            { ...hand.cards[0]!, id: 'prize-in-hand' as never },
          ],
        },
      },
    };
    const playIt = {
      type: 'MoveCard',
      cardId: 'prize-alias',
      expectedSourceZoneId: hand.id,
      destinationZoneId: `zone:${playerId}:discard`,
    } as const satisfies WireGameCommand;
    expect(rebind(playIt, landed)).toMatchObject({
      cardId: 'prize-in-hand',
    });
  });

  it('never guesses which new card a face-down arrival became', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const prizes = view.zones[`zone:${playerId}:prizes`]!;
    const prize = {
      kind: 'concealed',
      id: 'prize-alias',
      ownerId: playerId,
      cardBackUrl: '/v2/assets/cardback.png',
      publiclyRevealed: false,
    } as const;
    const before: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [prizes.id]: { ...prizes, cards: [prize as never] },
      },
    };
    rebind(
      {
        type: 'MoveCard',
        cardId: 'prize-alias',
        expectedSourceZoneId: prizes.id,
        destinationZoneId: hand.id,
      },
      before
    );
    // Two new cards for one taken face down (another came meanwhile):
    // which is which can't be told, so the move goes as it was made.
    const landed: MatchViewState = {
      ...before,
      zones: {
        ...before.zones,
        [prizes.id]: { ...prizes, cards: [] },
        [hand.id]: {
          ...hand,
          cards: [
            ...hand.cards,
            { ...hand.cards[0]!, id: 'new-one' as never },
            { ...hand.cards[0]!, id: 'new-two' as never },
          ],
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: 'prize-alias',
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        landed
      )
    ).toMatchObject({ cardId: 'prize-alias' });
  });

  it('follows a card put on the deck, drawn back and played, to its name', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const deck = view.zones[`zone:${playerId}:deck`]!;
    const card = hand.cards[0]!;
    rebind(
      {
        type: 'MoveCardToDeckTop',
        cardId: card.id,
        expectedSourceId: hand.id,
      },
      view
    );
    // Published: on top of the deck, face down under a new alias.
    const onDeck: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
        [deck.id]: {
          ...deck,
          cards: [
            {
              kind: 'concealed',
              id: 'on-deck' as never,
              ownerId: playerId,
              cardBackUrl: '/v2/assets/cardback.png',
              publiclyRevealed: false,
            },
            ...deck.cards,
          ],
        },
      },
    };
    rebind({ type: 'DrawCards', count: 1 }, onDeck);
    // Drawn back: in the hand under another.
    const drawn: MatchViewState = {
      ...onDeck,
      zones: {
        ...onDeck.zones,
        [deck.id]: deck,
        [hand.id]: {
          ...hand,
          cards: [...hand.cards.slice(1), { ...card, id: 'drawn' as never }],
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        drawn
      )
    ).toMatchObject({ cardId: 'drawn' });
  });

  it('follows a card dragged onto an empty deck, drawn back and played', () => {
    const rebind = createProvisionalRebinder();
    const base = createRendererSpikeView();
    const playerId = base.playerOrder[0]!;
    const hand = base.zones[`zone:${playerId}:hand`]!;
    const deck = { ...base.zones[`zone:${playerId}:deck`]!, cards: [] };
    const view: MatchViewState = {
      ...base,
      zones: { ...base.zones, [deck.id]: deck },
    };
    const card = hand.cards[0]!;
    // Dragged onto the pile: a plain move, not a deck shortcut.
    rebind(
      {
        type: 'MoveCard',
        cardId: card.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: deck.id,
      },
      view
    );
    const onDeck: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
        [deck.id]: {
          ...deck,
          cards: [
            {
              kind: 'concealed',
              id: 'on-deck' as never,
              ownerId: playerId,
              cardBackUrl: '/v2/assets/cardback.png',
              publiclyRevealed: false,
            },
          ],
        },
      },
    };
    rebind({ type: 'DrawCards', count: 1 }, onDeck);
    const drawn: MatchViewState = {
      ...onDeck,
      zones: {
        ...onDeck.zones,
        [deck.id]: deck,
        [hand.id]: {
          ...hand,
          cards: [...hand.cards.slice(1), { ...card, id: 'drawn' as never }],
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        drawn
      )
    ).toMatchObject({ cardId: 'drawn' });
  });

  it('never takes a card shuffled into the deck for the one at its edge', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const deck = view.zones[`zone:${playerId}:deck`]!;
    const card = hand.cards[0]!;
    rebind(
      {
        type: 'ShuffleCardIntoDeck',
        cardId: card.id,
        expectedSourceId: hand.id,
      },
      view
    );
    // Shuffled in: some other card now lies at either edge, new names all.
    const shuffled: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: { ...hand, cards: hand.cards.slice(1) },
        [deck.id]: {
          ...deck,
          cards: [...deck.cards, card].map((entry, index) => ({
            ...entry,
            id: `shuffled-${index}` as never,
          })),
        },
      },
    };
    expect(
      rebind(
        {
          type: 'MoveCard',
          cardId: card.id,
          expectedSourceZoneId: deck.id,
          destinationZoneId: `zone:${playerId}:discard`,
        },
        shuffled
      )
    ).toMatchObject({ cardId: card.id });
  });

  it('names a card renamed by an unindexed move within the hand', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const [first, ...rest] = hand.cards;
    // An unindexed hand move keeps its original renaming semantics.
    rebind(
      {
        type: 'MoveCard',
        cardId: first!.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: hand.id,
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

  it("forgets a refused hand move's card, so a new copy isn't taken for it", () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const [first, ...rest] = hand.cards;
    const move = rebind(
      {
        type: 'MoveCard',
        cardId: first!.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: hand.id,
      },
      view
    );
    // Refused (the hand was reset meanwhile); a copy of the same card is
    // drawn into the new hand.
    rebind.refused(move);
    const redrawn: MatchViewState = {
      ...view,
      zones: {
        ...view.zones,
        [hand.id]: {
          ...hand,
          cards: [...rest, { ...first!, id: 'a-new-copy' as never }],
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
        redrawn
      )
    ).toMatchObject({ cardId: first!.id });
  });

  it('follows a card renamed twice by unindexed moves within the hand', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const [first, ...rest] = hand.cards;
    const move = (cardId: string) =>
      ({
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: hand.id,
        destinationZoneId: hand.id,
      }) as const;
    const withHand = (cards: MatchViewState['zones'][string]['cards']) =>
      ({
        ...view,
        zones: { ...view.zones, [hand.id]: { ...hand, cards } },
      }) as MatchViewState;
    // Sent at once: the first move.
    rebind(move(first!.id), view);
    // The second was queued on the old name; sent once the first landed.
    const once = withHand([
      ...rest,
      { ...first!, id: 'renamed-once' as never },
    ]);
    expect(rebind(move(first!.id), once)).toMatchObject({
      cardId: 'renamed-once',
    });
    // The discard was queued on the old name too; sent after both.
    const twice = withHand([
      ...rest,
      { ...first!, id: 'renamed-twice' as never },
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

  it('keeps the stable alias across two indexed hand arrangements and the action queued on them', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const first = hand.cards[0]!;
    const arrange = (destinationIndex: number) => ({
      type: 'MoveCard' as const,
      cardId: first.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: hand.id,
      destinationIndex,
    });
    const end = arrange(hand.cards.length - 1);
    expect(rebind(end, view)).toBe(end);
    const once = predictWireCommand(view, end)!;
    expect(once.zones[hand.id]!.cards.at(-1)).toBe(first);
    const start = arrange(0);
    expect(rebind(start, once)).toBe(start);
    const twice = predictWireCommand(once, start)!;
    expect(twice.zones[hand.id]!.cards[0]).toBe(first);
    const discard = {
      type: 'MoveCard' as const,
      cardId: first.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: `zone:${playerId}:discard`,
    };
    expect(rebind(discard, twice)).toBe(discard);
  });

  it('never takes a different identical copy for an accepted hand arrangement whose card left before the next send', () => {
    const rebind = createProvisionalRebinder();
    const view = createRendererSpikeView();
    const playerId = view.playerOrder[0]!;
    const hand = view.zones[`zone:${playerId}:hand`]!;
    const [first, ...rest] = hand.cards;
    if (first?.kind !== 'known') throw new Error('Known hand card required');
    const arrange = {
      type: 'MoveCard' as const,
      cardId: first.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: hand.id,
      destinationIndex: hand.cards.length - 1,
    };
    expect(rebind(arrange, view)).toBe(arrange);
    const arranged = predictWireCommand(view, arrange)!;
    expect(arranged.zones[hand.id]!.cards.at(-1)).toBe(first);
    // The arrangement succeeded; while its result was missed, the original
    // left under another alias and a different copy entered the hand.
    const latest: MatchViewState = {
      ...arranged,
      revision: view.revision + 3,
      zones: {
        ...arranged.zones,
        [hand.id]: {
          ...hand,
          cards: [...rest, { ...first, id: 'different-copy' as never }],
        },
      },
    };
    const discard = {
      type: 'MoveCard' as const,
      cardId: first.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: `zone:${playerId}:discard`,
    };
    expect(rebind(discard, latest)).toBe(discard);
  });
});
