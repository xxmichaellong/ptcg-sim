import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { predictQueue, predictWireCommand } from './predictWireCommand.js';

const blue = asPlayerId('spike-blue');
const red = asPlayerId('spike-red');
const view = createRendererSpikeView();
const hand = view.zones[`zone:${blue}:hand`]!;
const discard = view.zones[`zone:${blue}:discard`]!;
const deck = view.zones[`zone:${blue}:deck`]!;
const prizes = view.zones[`zone:${blue}:prizes`]!;
const active = view.stacks['stack:blue:active']!;
const cardIn = (next: MatchViewState, cardId: string): string | undefined => {
  for (const zone of Object.values(next.zones)) {
    if (zone.cards.some((card) => card.id === cardId)) return zone.id;
  }
  for (const stack of Object.values(next.stacks)) {
    if (
      stack.evolutionCards.some((card) => card.id === cardId) ||
      stack.attachmentCards.some((card) => card.id === cardId)
    ) {
      return stack.id;
    }
  }
  for (const areas of Object.values(next.workAreas)) {
    if (areas.attachmentResolution?.cards.some((card) => card.id === cardId)) {
      return areas.attachmentResolution.id;
    }
  }
  return undefined;
};

describe('predictWireCommand', () => {
  it('rearranges a hand and benches a Pokémon at the place asked for, as the room will', () => {
    const [first, second, third] = hand.cards;
    const rearranged = predictWireCommand(view, {
      type: 'MoveCard',
      cardId: first!.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: hand.id,
      destinationIndex: 2,
    })!;
    expect(
      rearranged.zones[hand.id]!.cards.slice(0, 3).map((card) => card.id)
    ).toEqual([second!.id, third!.id, first!.id]);

    // Two Pokémon benched, then the Active benched between them.
    const benched = [hand.cards[0]!, hand.cards[1]!].reduce(
      (current, card, index) =>
        predictWireCommand(current, {
          type: 'MoveCardToPlay',
          cardId: card.id,
          expectedSourceZoneId: hand.id,
          boardPlayerId: blue,
          slot: 'bench',
          benchIndex: index,
        })!,
      view
    );
    const bench = benched.boards[blue]!.benchStackIds;
    expect(bench).toHaveLength(2);
    const between = predictWireCommand(benched, {
      type: 'MovePlayStack',
      stackId: active.id,
      expectedSourceSlot: 'active',
      expectedActiveStackId: active.id,
      expectedBenchStackIds: [...bench],
      destinationSlot: 'bench',
      benchIndex: 1,
    })!;
    expect(between.boards[blue]).toMatchObject({
      activeStackId: null,
      benchStackIds: [bench[0], active.id, bench[1]],
    });
    // The far left of the bench.
    const left = predictWireCommand(between, {
      type: 'MovePlayStack',
      stackId: bench[1]!,
      expectedSourceSlot: 'bench',
      expectedActiveStackId: null,
      expectedBenchStackIds: [bench[0]!, active.id, bench[1]!],
      destinationSlot: 'bench',
      benchIndex: 0,
    })!;
    expect(left.boards[blue]!.benchStackIds).toEqual([
      bench[1],
      bench[0],
      active.id,
    ]);
  });

  it('moves a card between zones and refuses when the card is not where the command says', () => {
    const card = hand.cards[0]!;
    const predicted = predictWireCommand(view, {
      type: 'MoveCard',
      cardId: card.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: discard.id,
    })!;
    expect(cardIn(predicted, card.id)).toBe(discard.id);
    expect(predicted.zones[hand.id]!.cards).toHaveLength(hand.cards.length - 1);
    expect(predicted.revision).toBe(view.revision);
    // Re-applying on a view where the move already happened is a no-op
    // rather than a duplicate: this is how the rebase on the carrying
    // publication behaves.
    expect(
      predictWireCommand(predicted, {
        type: 'MoveCard',
        cardId: card.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: discard.id,
      })
    ).toBeNull();
    // The view is never mutated in place.
    expect(view.zones[hand.id]!.cards).toHaveLength(hand.cards.length);
  });

  it('shows a card entering prizes or the opponent hand as its back', () => {
    const card = hand.cards[0]!;
    const toPrizes = predictWireCommand(view, {
      type: 'MoveCard',
      cardId: card.id,
      expectedSourceZoneId: hand.id,
      destinationZoneId: prizes.id,
    })!;
    const placed = toPrizes.zones[prizes.id]!.cards.at(-1)!;
    expect(placed.id).toBe(card.id);
    expect(placed.kind).toBe('concealed');
    const toOwnDeck = predictWireCommand(view, {
      type: 'MoveCardToDeckTop',
      cardId: card.id,
      expectedSourceId: hand.id,
    })!;
    // The viewer reads their own deck, so the card stays known on top.
    expect(toOwnDeck.zones[deck.id]!.cards[0]).toMatchObject({
      id: card.id,
      kind: 'known',
    });
  });

  it('plays a Pokémon as a new stack, benching the current active when the active slot is taken', () => {
    const pokemon = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Pokémon'
    )!;
    const predicted = predictWireCommand(view, {
      type: 'MoveCardToPlay',
      cardId: pokemon.id,
      expectedSourceZoneId: hand.id,
      boardPlayerId: blue,
      slot: 'active',
    })!;
    const board = predicted.boards[blue]!;
    expect(board.activeStackId).toBe(`predicted-stack:${pokemon.id}`);
    expect(board.benchStackIds.at(-1)).toBe(active.id);
    expect(predicted.stacks[active.id]!.slot).toBe('bench');
    expect(predicted.stacks[board.activeStackId!]!.evolutionCards).toEqual([
      pokemon,
    ]);
    const benched = predictWireCommand(view, {
      type: 'MoveCardToPlay',
      cardId: pokemon.id,
      expectedSourceZoneId: hand.id,
      boardPlayerId: blue,
      slot: 'bench',
      benchIndex: 0,
    })!;
    expect(benched.boards[blue]!.benchStackIds[0]).toBe(
      `predicted-stack:${pokemon.id}`
    );
    expect(benched.boards[blue]!.activeStackId).toBe(active.id);
  });

  it('attaches energies before trainers and evolves onto the top card', () => {
    const energy = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Energy'
    )!;
    const attached = predictWireCommand(view, {
      type: 'MoveCardToPlay',
      cardId: energy.id,
      expectedSourceZoneId: hand.id,
      boardPlayerId: blue,
      slot: 'active',
      targetStackId: active.id,
    })!;
    const attachments = attached.stacks[active.id]!.attachmentCards;
    expect(attachments.some((card) => card.id === energy.id)).toBe(true);
    const categories = attachments.map((card) =>
      card.kind === 'known' ? card.category : 'Unknown'
    );
    const lastEnergy = categories.lastIndexOf('Energy');
    const firstTrainer = categories.indexOf('Trainer');
    if (firstTrainer >= 0) expect(lastEnergy).toBeLessThan(firstTrainer);

    const pokemon = hand.cards.find(
      (card) => card.kind === 'known' && card.category === 'Pokémon'
    )!;
    const evolved = predictWireCommand(view, {
      type: 'PlaceCardOnPlayStack',
      cardId: pokemon.id,
      expectedSourceId: hand.id,
      targetStackId: active.id,
      expectedTargetTopCardId: active.evolutionCards.at(-1)!.id,
      mode: 'evolution',
    })!;
    expect(evolved.stacks[active.id]!.evolutionCards.at(-1)!.id).toBe(
      pokemon.id
    );
    // A stale top card means the room would refuse; so does the prediction.
    expect(
      predictWireCommand(view, {
        type: 'PlaceCardOnPlayStack',
        cardId: pokemon.id,
        expectedSourceId: hand.id,
        targetStackId: active.id,
        expectedTargetTopCardId: pokemon.id,
        mode: 'evolution',
      })
    ).toBeNull();
  });

  it('departs a stack when its top card leaves, staging the rest for resolution', () => {
    const top = active.evolutionCards.at(-1)!;
    const predicted = predictWireCommand(view, {
      type: 'MoveCardFromStack',
      cardId: top.id,
      expectedStackId: active.id,
      destinationZoneId: discard.id,
    })!;
    expect(cardIn(predicted, top.id)).toBe(discard.id);
    expect(predicted.stacks[active.id]).toBeUndefined();
    expect(predicted.boards[blue]!.activeStackId).toBeNull();
    const staged = predicted.workAreas[blue]!.attachmentResolution!;
    expect(staged.sourceStackId).toBe(active.id);
    expect(staged.cards).toHaveLength(
      active.evolutionCards.length - 1 + active.attachmentCards.length
    );
    // An attachment leaving keeps the stack in place.
    const attachment = active.attachmentCards[0]!;
    const detached = predictWireCommand(view, {
      type: 'MoveCardFromStack',
      cardId: attachment.id,
      expectedStackId: active.id,
      destinationZoneId: discard.id,
    })!;
    expect(detached.stacks[active.id]!.attachmentCards).toHaveLength(
      active.attachmentCards.length - 1
    );
    expect(cardIn(detached, attachment.id)).toBe(discard.id);
  });

  it('files a card dragged into an open popup the way the room will', () => {
    // A staged window is open once a loaded stack departs; a hand card
    // dropped into it joins the attachments, and a Pokemon the evolutions.
    const top = active.evolutionCards.at(-1)!;
    const staged = predictWireCommand(view, {
      type: 'MoveCardFromStack',
      cardId: top.id,
      expectedStackId: active.id,
      destinationZoneId: discard.id,
    })!;
    const area = staged.workAreas[blue]!.attachmentResolution!;
    const handCard = staged.zones[hand.id]!.cards[0]!;
    const predicted = predictWireCommand(staged, {
      type: 'MoveCardToWorkArea',
      cardId: handCard.id,
      expectedWorkAreaId: area.id,
    })!;
    const filed = predicted.workAreas[blue]!.attachmentResolution!;
    expect(cardIn(predicted, handCard.id)).toBe(area.id);
    expect(predicted.zones[hand.id]!.cards).toHaveLength(
      staged.zones[hand.id]!.cards.length - 1
    );
    const pokemon =
      handCard.kind === 'known' && handCard.category === 'Pokémon';
    expect(filed.evolutionCards).toHaveLength(
      area.evolutionCards.length + (pokemon ? 1 : 0)
    );
    expect(filed.attachmentCards).toHaveLength(
      area.attachmentCards.length + (pokemon ? 0 : 1)
    );
    // The card is out of play: face up, upright, with its marker cleared.
    expect(filed.cards.at(-1)).toMatchObject({
      id: handCard.id,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    // A popup that is not open, and a card that is nowhere, predict nothing.
    expect(
      predictWireCommand(staged, {
        type: 'MoveCardToWorkArea',
        cardId: handCard.id,
        expectedWorkAreaId: 'closed-work-area',
      })
    ).toBeNull();
    expect(
      predictWireCommand(staged, {
        type: 'MoveCardToWorkArea',
        cardId: 'missing-card',
        expectedWorkAreaId: area.id,
      })
    ).toBeNull();
  });

  it('drags a loaded host into the deck viewer and stages its dependents', () => {
    // v1's relocateAttachedCards, predicted: the host joins the open popup
    // and the rest of its stack opens the attached-card window.
    const inspectionView: MatchViewState = {
      ...view,
      workAreas: {
        ...view.workAreas,
        [blue]: {
          ...view.workAreas[blue]!,
          inspection: {
            id: 'predicted-inspection',
            sourceZoneId: deck.id,
            cards: [deck.cards[0]!],
          },
        },
      },
      zones: {
        ...view.zones,
        [deck.id]: { ...deck, cards: deck.cards.slice(1) },
      },
    };
    const host = active.evolutionCards.at(-1)!;
    const predicted = predictWireCommand(inspectionView, {
      type: 'MoveCardToWorkArea',
      cardId: host.id,
      expectedWorkAreaId: 'predicted-inspection',
    })!;
    expect(predicted.stacks[active.id]).toBeUndefined();
    expect(predicted.boards[blue]!.activeStackId).toBeNull();
    expect(
      predicted.workAreas[blue]!.inspection!.cards.map((card) => card.id)
    ).toEqual([deck.cards[0]!.id, host.id]);
    expect(predicted.workAreas[blue]!.attachmentResolution!.cards).toHaveLength(
      active.evolutionCards.length - 1 + active.attachmentCards.length
    );
  });

  it('swaps with a deck top only where the old top stays a back', () => {
    const redHand = view.zones[`zone:${red}:hand`]!;
    const redDeck = view.zones[`zone:${red}:deck`]!;
    const redDiscard = view.zones[`zone:${red}:discard`]!;
    const intoHiddenHand = predictWireCommand(view, {
      type: 'SwapCardWithDeckTop',
      cardId: redHand.cards[0]!.id,
      expectedSourceId: redHand.id,
    })!;
    expect(intoHiddenHand.zones[redHand.id]!.cards[0]).toMatchObject({
      id: redDeck.cards[0]!.id,
      kind: 'concealed',
    });
    expect(intoHiddenHand.zones[redDeck.id]!.cards[0]!.id).toBe(
      redHand.cards[0]!.id
    );
    // The room publishes the old top's face in a readable zone, and only the
    // room knows it, so the swap is not guessed as a card back.
    for (const source of [hand, redDiscard]) {
      expect(
        predictWireCommand(view, {
          type: 'SwapCardWithDeckTop',
          cardId: source.cards[0]!.id,
          expectedSourceId: source.id,
        })
      ).toBeNull();
    }
  });

  it('draws from the top of the viewer own deck and updates counters', () => {
    const drawn = predictWireCommand(view, { type: 'DrawCards', count: 2 })!;
    expect(drawn.zones[hand.id]!.cards).toHaveLength(hand.cards.length + 2);
    expect(
      drawn.zones[hand.id]!.cards.slice(-2).map((card) => card.id)
    ).toEqual(deck.cards.slice(0, 2).map((card) => card.id));
    const damaged = predictWireCommand(view, {
      type: 'SetDamage',
      stackId: active.id,
      damage: 60,
    })!;
    expect(damaged.stacks[active.id]!.damage).toBe(60);
  });

  it('draws for the seat a flipped board names, showing cards it cannot read as backs', () => {
    const redDeck = view.zones[`zone:${red}:deck`]!;
    const redHand = view.zones[`zone:${red}:hand`]!;
    const drawn = predictWireCommand(view, {
      type: 'DrawCards',
      count: 1,
      targetPlayerId: red,
    })!;
    expect(drawn.zones[redDeck.id]!.cards).toHaveLength(
      redDeck.cards.length - 1
    );
    const arrived = drawn.zones[redHand.id]!.cards.at(-1)!;
    expect(arrived.id).toBe(redDeck.cards[0]!.id);
    // The spike viewer is Blue; Red's hand is not readable, so the card
    // arrives as a back, exactly as the room will publish it.
    expect(arrived.kind).toBe('concealed');
    expect(drawn.zones[hand.id]!.cards).toHaveLength(hand.cards.length);
    expect(
      predictWireCommand(view, {
        type: 'DrawCards',
        count: 1,
        targetPlayerId: 'not-a-seat',
      })
    ).toBeNull();
  });

  it("returns the prizes of the seat a flipped board names, not the viewer's", () => {
    const redPrizes = view.zones[`zone:${red}:prizes`]!;
    const redDeck = view.zones[`zone:${red}:deck`]!;
    expect(redPrizes.cards.length).toBeGreaterThan(0);
    const returned = predictWireCommand(view, {
      type: 'MovePrizesToDeckBottom',
      targetPlayerId: red,
    })!;
    expect(returned.zones[redPrizes.id]!.cards).toHaveLength(0);
    expect(returned.zones[redDeck.id]!.cards).toHaveLength(
      redDeck.cards.length + redPrizes.cards.length
    );
    expect(returned.zones[prizes.id]!.cards).toHaveLength(prizes.cards.length);
  });

  it('starts a turn optimistically: markers, loose boards, draw and counter', () => {
    const board = view.zones[`zone:${blue}:board`]!;
    const [top, ...rest] = active.evolutionCards;
    if (top?.kind !== 'known') throw new Error('known active card required');
    // A face-down card the viewer can read turns up with the turn; one it
    // cannot read waits for the room to publish its face.
    const hidden = {
      kind: 'concealed' as const,
      id: 'hidden-in-play',
      ownerId: red,
      cardBackUrl: '',
      publiclyRevealed: false as const,
    };
    const markedStack = {
      ...active,
      abilityUsed: true,
      evolutionCards: [{ ...top, face: 'down' as const }, ...rest],
      attachmentCards: [...active.attachmentCards, hidden],
    };
    const staged: MatchViewState = {
      ...view,
      stacks: { ...view.stacks, [active.id]: markedStack },
    };
    const predicted = predictWireCommand(staged, {
      type: 'StartTurn',
      targetPlayerId: blue,
    })!;
    // v1 clears every ability marker and discards both loose boards first.
    expect(predicted.stacks[active.id]!.abilityUsed).toBe(false);
    expect(predicted.zones[board.id]!.cards).toHaveLength(0);
    expect(predicted.zones[discard.id]!.cards).toHaveLength(
      discard.cards.length + board.cards.length
    );
    expect(predicted.stacks[active.id]!.evolutionCards[0]).toMatchObject({
      id: top.id,
      face: 'up',
    });
    expect(predicted.stacks[active.id]!.attachmentCards.at(-1)).toBe(hidden);
    // Then it draws for the seat and advances the shared counter.
    expect(predicted.zones[hand.id]!.cards).toHaveLength(hand.cards.length + 1);
    expect(predicted.zones[hand.id]!.cards.at(-1)!.id).toBe(deck.cards[0]!.id);
    expect(predicted.turn).toEqual({
      number: view.turn.number + 1,
      currentPlayerId: blue,
    });

    // An empty deck commits the cleanup and stops, as v1's take-turn does.
    const emptyDeck: MatchViewState = {
      ...staged,
      zones: { ...staged.zones, [deck.id]: { ...deck, cards: [] } },
    };
    const stalled = predictWireCommand(emptyDeck, {
      type: 'StartTurn',
      targetPlayerId: blue,
    })!;
    expect(stalled.turn).toEqual(view.turn);
    expect(stalled.zones[board.id]!.cards).toHaveLength(0);
    // The engine reveals nothing on an empty deck either.
    expect(stalled.stacks[active.id]!.evolutionCards[0]).toMatchObject({
      face: 'down',
    });

    // Attack and pass clear the acting seat's board only, and never draw.
    const passed = predictWireCommand(staged, {
      type: 'PassTurn',
      targetPlayerId: blue,
    })!;
    expect(passed.zones[hand.id]!.cards).toHaveLength(hand.cards.length);
    expect(passed.turn).toEqual(view.turn);
    expect(passed.zones[`zone:${red}:board`]!.cards).toEqual(
      view.zones[`zone:${red}:board`]!.cards
    );
  });

  it('predicts nothing for spectators or for commands it does not model', () => {
    expect(
      predictWireCommand(
        { ...view, viewer: { kind: 'spectator' } },
        { type: 'DrawCards', count: 1 }
      )
    ).toBeNull();
    expect(
      predictWireCommand(view, { type: 'ShuffleZone', zoneId: deck.id })
    ).toBeNull();
    // The coin is deliberately never predicted: the room rolls it, and a
    // guessed face would have to be taken back half the time.
    expect(
      predictWireCommand(view, { type: 'FlipCoin', targetPlayerId: blue })
    ).toBeNull();
  });
});

it('predicts a paired Stadium add/replacement without losing either old piece', () => {
  const stadium = Object.values(view.zones).find(
    (zone) => zone.kind === 'stadium'
  )!;
  const first = hand.cards[0]!;
  const second = hand.cards[1]!;
  const third = hand.cards[2]!;
  const occupants = stadium.cards.map((card) => card.id);
  const one = predictWireCommand(view, {
    type: 'MoveCardToStadium',
    cardId: first.id,
    expectedSourceId: hand.id,
    expectedStadiumCardId: occupants[0] ?? null,
    expectedStadiumCardIds: occupants,
  })!;
  const two = predictWireCommand(one, {
    type: 'MoveCardToStadium',
    cardId: second.id,
    expectedSourceId: hand.id,
    expectedStadiumCardId: first.id,
    expectedStadiumCardIds: [first.id],
    placement: 'add',
  })!;
  expect(two.zones[stadium.id]!.cards.map((card) => card.id)).toEqual([
    first.id,
    second.id,
  ]);
  expect(
    predictWireCommand(two, {
      type: 'MoveCardToStadium',
      cardId: third.id,
      expectedSourceId: hand.id,
      expectedStadiumCardId: first.id,
      expectedStadiumCardIds: [first.id],
    })
  ).toBeNull();
  const replaced = predictWireCommand(two, {
    type: 'MoveCardToStadium',
    cardId: third.id,
    expectedSourceId: hand.id,
    expectedStadiumCardId: first.id,
    expectedStadiumCardIds: [first.id, second.id],
  })!;
  expect(replaced.zones[stadium.id]!.cards.map((card) => card.id)).toEqual([
    third.id,
  ]);
  expect(cardIn(replaced, first.id)).toBe(discard.id);
  expect(cardIn(replaced, second.id)).toBe(discard.id);
});

it('predicts bulk removal into each card owner’s pile', () => {
  const foreign = { ...active.attachmentCards[0]!, ownerId: red };
  const source: MatchViewState = {
    ...view,
    stacks: {
      ...view.stacks,
      [active.id]: { ...active, attachmentCards: [foreign] },
    },
  };
  const departed = predictWireCommand(source, {
    type: 'MoveCardFromStack',
    cardId: active.evolutionCards.at(-1)!.id,
    expectedStackId: active.id,
    destinationZoneId: discard.id,
  })!;
  const area = departed.workAreas[blue]!.attachmentResolution!;
  const resolved = predictWireCommand(departed, {
    type: 'ResolveStagedCards',
    expectedWorkAreaId: area.id,
    destination: 'discard',
  })!;
  expect(resolved.workAreas[blue]!.attachmentResolution).toBeNull();
  expect(cardIn(resolved, foreign.id)).toBe(`zone:${red}:discard`);
  for (const card of area.evolutionCards)
    expect(cardIn(resolved, card.id)).toBe(discard.id);
});

it('predicts nothing queued behind a shuffle until the shuffle is published', () => {
  const draw = { command: { type: 'DrawCards' as const, count: 1 } };
  const shuffle = {
    command: { type: 'ShuffleZone' as const, zoneId: deck.id },
  };
  const handSize = (next: MatchViewState) => next.zones[hand.id]!.cards.length;
  // A draw alone is shown at once.
  expect(handSize(predictQueue(view, [draw]))).toBe(hand.cards.length + 1);
  // Behind an unpublished shuffle it waits: the top card isn't known yet.
  expect(handSize(predictQueue(view, [shuffle, draw]))).toBe(hand.cards.length);
  // Once the shuffle's result is in the view, the draw is shown again.
  expect(
    handSize(predictQueue(view, [{ ...shuffle, published: true }, draw]))
  ).toBe(hand.cards.length + 1);
});

it('predicts nothing queued behind prizes returned under the deck', () => {
  // The room shuffles them on the way: which comes up isn't known yet.
  const draw = { command: { type: 'DrawCards' as const, count: 1 } };
  const empty: MatchViewState = {
    ...view,
    zones: { ...view.zones, [deck.id]: { ...deck, cards: [] } },
  };
  const handSize = (next: MatchViewState) => next.zones[hand.id]!.cards.length;
  expect(
    handSize(
      predictQueue(empty, [
        { command: { type: 'MovePrizesToDeckBottom' as const } },
        draw,
      ])
    )
  ).toBe(hand.cards.length);
});

it("returns a card to the deck of the seat it's taken from, as the room does", () => {
  // Another player's card in this seat's hand goes into this seat's deck.
  const theirs = { ...hand.cards[0]!, ownerId: red };
  const holding: MatchViewState = {
    ...view,
    zones: {
      ...view.zones,
      [hand.id]: { ...hand, cards: [theirs, ...hand.cards.slice(1)] },
    },
  };
  for (const type of ['MoveCardToDeckTop', 'MoveCardToDeckBottom'] as const) {
    const moved = predictWireCommand(holding, {
      type,
      cardId: theirs.id,
      expectedSourceId: hand.id,
    })!;
    expect(cardIn(moved, theirs.id)).toBe(deck.id);
  }
  // A swap is shown when the top card's face is known to the seat.
  const knownTop = { ...hand.cards[1]!, id: 'known-top' as never };
  const swapped = predictWireCommand(
    {
      ...holding,
      zones: {
        ...holding.zones,
        [deck.id]: { ...deck, cards: [knownTop, ...deck.cards.slice(1)] },
      },
    },
    {
      type: 'SwapCardWithDeckTop',
      cardId: theirs.id,
      expectedSourceId: hand.id,
    }
  )!;
  expect(cardIn(swapped, theirs.id)).toBe(deck.id);
});

it('marks a Pokémon promoted to the Active as the Active', () => {
  // One Pokémon benched, then the Active benched beside it: that one moves up.
  const benched = predictWireCommand(view, {
    type: 'MoveCardToPlay',
    cardId: hand.cards[0]!.id,
    expectedSourceZoneId: hand.id,
    boardPlayerId: blue,
    slot: 'bench',
  })!;
  const [only] = benched.boards[blue]!.benchStackIds;
  const swapped = predictWireCommand(benched, {
    type: 'MovePlayStack',
    stackId: active.id,
    expectedSourceSlot: 'active',
    expectedActiveStackId: active.id,
    expectedBenchStackIds: [only!],
    destinationSlot: 'bench',
  })!;
  expect(swapped.boards[blue]!.activeStackId).toBe(only);
  expect(swapped.stacks[only!]!.slot).toBe('active');
  expect(swapped.stacks[active.id]!.slot).toBe('bench');
});

it('moves a card whose category changes to the end of the loose board, upright', () => {
  const board = view.zones[`zone:${blue}:board`]!;
  const card = hand.cards[0]!;
  const changed = predictWireCommand(view, {
    type: 'ChangeCardCategory',
    cardId: card.id,
    expectedSourceId: hand.id,
    category: 'Energy',
  })!;
  expect(cardIn(changed, card.id)).toBe(board.id);
  const placed = changed.zones[board.id]!.cards.at(-1)!;
  expect(placed).toMatchObject({
    id: card.id,
    category: 'Energy',
    orientationQuarterTurns: 0,
  });
  expect(changed.zones[hand.id]!.cards).toHaveLength(hand.cards.length - 1);
});
