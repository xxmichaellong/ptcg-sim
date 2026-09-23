import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { predictWireCommand } from './predictWireCommand.js';

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
    expect(
      predictWireCommand(view, { type: 'StartTurn', targetPlayerId: red })
    ).toBeNull();
  });
});
