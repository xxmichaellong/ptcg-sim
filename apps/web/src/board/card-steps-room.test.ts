import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type GameCommand,
  type MatchViewState,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  DEFAULT_AUTHORITY_POLICY,
  emptyProjectionIdentityState,
  projectRecipient,
  resolveWireCommand,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import { predictWireCommand } from './predictWireCommand.js';
import { createProvisionalRebinder } from './rebindProvisionalReferences.js';

/**
 * A group's move (ApplyCardSteps) against the real room: what the board
 * predicts is what the room publishes, and a move queued behind it finds
 * the Pokémon it made.
 */

const blue = asPlayerId('group-blue');
const red = asPlayerId('group-red');

/**
 * A Solo table: Blue plays both seats. Red's hand holds a V-UNION's two
 * pieces, a Fire Energy and a Switch; each seat has an Active.
 */
const soloTable = (
  /** More of Red's cards: copies of one printing each. */
  redCopies: readonly { readonly name: string; readonly count: number }[] = []
) => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`card-${++next}`),
    nextStackId: () => asStackId(`stack-${++next}`),
    nextInspectionId: () => asInspectionId(`inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`area-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('group-room'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context, {
      promoteLoneBenched: true,
    });
    if (!result.accepted) throw new Error(`${result.code}: ${result.message}`);
    state = result.state;
  };
  const deck = (owner: string, names: readonly string[]) =>
    names.map((name, index) => ({
      definition: {
        id: asCardDefinitionId(`${owner}-${index}`),
        name,
        category: (name.endsWith('Energy')
          ? 'Energy'
          : name === 'Switch'
            ? 'Trainer'
            : 'Pokémon') as 'Pokémon' | 'Trainer' | 'Energy',
        imageUrl: `/${owner}-${index}.png`,
      },
      count: 1,
    }));
  run({ type: 'LoadDeck', playerId: blue, entries: deck('blue', ['Snorlax']) });
  run({
    type: 'LoadDeck',
    playerId: red,
    entries: [
      ...deck('red', [
        'Pikachu',
        'Mewtwo V-UNION',
        'Mewtwo V-UNION',
        'Fire Energy',
        'Switch',
      ]),
      ...redCopies.map(({ name, count }, index) => ({
        definition: {
          id: asCardDefinitionId(`red-copies-${index}`),
          name,
          category: 'Energy' as const,
          imageUrl: `/red-copies-${index}.png`,
        },
        count,
      })),
    ],
  });
  for (const player of [blue, red]) {
    const cards = state.zones[playerZoneId(player, 'deck')]!.cardIds.length;
    run({ type: 'DrawCards', playerId: player, count: cards });
    run({
      type: 'MoveCardToPlay',
      cardId: state.zones[playerZoneId(player, 'hand')]!.cardIds[0]!,
      expectedSourceZoneId: playerZoneId(player, 'hand'),
      boardPlayerId: player,
      slot: 'active',
    });
  }
  let identities = emptyProjectionIdentityState();
  let opaque = 0;
  const project = (): MatchViewState => {
    const result = projectRecipient(
      state,
      { kind: 'player', playerId: blue },
      identities,
      { nextOpaqueId: () => `opaque-group-alias-${++opaque}` },
      'solo'
    );
    identities = result.identities;
    return result.snapshot as MatchViewState;
  };
  const seat = {
    id: 'group-solo-seat',
    viewer: { kind: 'player' as const, playerId: blue },
    active: true,
    nextClientSequence: 1,
    recentOutcomes: [],
  };
  /** Sent to the room as a session would: read, then made. */
  const send = (command: WireGameCommand) => {
    const resolved = resolveWireCommand(
      state,
      identities,
      seat,
      command,
      DEFAULT_AUTHORITY_POLICY,
      state.revision,
      { mode: 'solo' }
    );
    if (!resolved.accepted) throw new Error(`Resolution: ${resolved.code}`);
    run(resolved.command);
  };
  return { project, send };
};

/** What a view shows, by card name: each place's cards, each Pokémon. */
const shape = (view: MatchViewState) => {
  const name = (card: MatchViewState['zones'][string]['cards'][number]) =>
    card.kind === 'known' ? view.definitions[card.definitionId]?.name : '?';
  return {
    zones: Object.fromEntries(
      Object.values(view.zones).map((zone) => [zone.id, zone.cards.map(name)])
    ),
    boards: Object.fromEntries(
      Object.entries(view.boards).map(([playerId, board]) => [
        playerId,
        [board.activeStackId, ...board.benchStackIds].map((stackId) => {
          const stack = stackId ? view.stacks[stackId] : undefined;
          return stack
            ? {
                evolution: stack.evolutionCards.map(name),
                attachments: stack.attachmentCards.map(name),
                damage: stack.damage,
              }
            : null;
        }),
      ])
    ),
  };
};

/** Red's V-UNION played whole onto Red's Bench, an Energy and a Switch discarded. */
const theGroup = (view: MatchViewState): WireGameCommand => {
  const hand = view.zones[playerZoneId(red, 'hand')]!.cards;
  const named = (wanted: string) =>
    hand.filter(
      (card) =>
        card.kind === 'known' &&
        view.definitions[card.definitionId]?.name === wanted
    );
  const [first, second] = named('Mewtwo V-UNION');
  const [energy] = named('Fire Energy');
  const [trainer] = named('Switch');
  const handId = playerZoneId(red, 'hand');
  return {
    type: 'ApplyCardSteps',
    steps: [
      {
        type: 'MoveCard',
        cardId: trainer!.id,
        expectedSourceZoneId: handId,
        destinationZoneId: playerZoneId(red, 'discard'),
      },
      {
        type: 'MoveCardToPlay',
        cardId: first!.id,
        expectedSourceZoneId: handId,
        boardPlayerId: red,
        slot: 'bench',
      },
      {
        type: 'PlaceCardOnPlayStack',
        cardId: second!.id,
        expectedSourceId: handId,
        targetStackRef: 1,
        expectedTargetTopCardId: first!.id,
        mode: 'evolution',
      },
      {
        type: 'MoveCardToPlay',
        cardId: energy!.id,
        expectedSourceZoneId: handId,
        boardPlayerId: red,
        slot: 'bench',
        targetStackRef: 1,
      },
      {
        type: 'SetDamage',
        stackId: view.boards[red]!.activeStackId!,
        damage: 20,
      },
    ],
  };
};

describe('a group move against the room', () => {
  it('is predicted as the room publishes it', () => {
    const table = soloTable();
    const view = table.project();
    const group = theGroup(view);
    const predicted = predictWireCommand(view, group, {
      readsEveryHand: true,
    });
    expect(predicted).not.toBeNull();
    table.send(group);
    const published = table.project();
    expect(shape(predicted!)).toEqual(shape(published));
    expect(shape(published).boards[red]![1]).toEqual({
      evolution: ['Mewtwo V-UNION', 'Mewtwo V-UNION'],
      attachments: ['Fire Energy'],
      damage: null,
    });
  });

  it("rebinds a move queued behind it to the other seat's cards it put in the discard pile", () => {
    const table = soloTable();
    const rebind = createProvisionalRebinder();
    const view = table.project();
    const hand = view.zones[playerZoneId(red, 'hand')]!.cards;
    const named = (wanted: string) =>
      hand.find(
        (card) =>
          card.kind === 'known' &&
          view.definitions[card.definitionId]?.name === wanted
      )!.id;
    const handId = playerZoneId(red, 'hand');
    const discardId = playerZoneId(red, 'discard');
    // Red's Energy and Switch discarded as a group: public now, they come
    // back from the room under aliases of their own.
    const group = rebind(
      {
        type: 'ApplyCardSteps',
        steps: ['Fire Energy', 'Switch'].map((name) => ({
          type: 'MoveCard' as const,
          cardId: named(name),
          expectedSourceZoneId: handId,
          destinationZoneId: discardId,
        })),
      },
      view
    );
    // The Switch taken back, queued on the card as the board shows it.
    const queued: WireGameCommand = {
      type: 'MoveCard',
      cardId: named('Switch'),
      expectedSourceZoneId: discardId,
      destinationZoneId: handId,
    };
    table.send(group);
    const published = table.project();
    rebind.accepted(group, published.revision, published);
    const sent = rebind(queued, published);
    const switchNow = published.zones[discardId]!.cards.find(
      (card) =>
        card.kind === 'known' &&
        published.definitions[card.definitionId]?.name === 'Switch'
    )!.id;
    expect(sent).toEqual({ ...queued, cardId: switchNow });
    table.send(sent);
    expect(shape(table.project()).zones[discardId]).toEqual(['Fire Energy']);
  });

  it('rebinds a move queued behind it to the right one of two copies it discarded together', () => {
    const table = soloTable([{ name: 'Water Energy', count: 2 }]);
    const rebind = createProvisionalRebinder();
    const view = table.project();
    const handId = playerZoneId(red, 'hand');
    const discardId = playerZoneId(red, 'discard');
    const waters = view.zones[handId]!.cards.filter(
      (card) =>
        card.kind === 'known' &&
        view.definitions[card.definitionId]?.name === 'Water Energy'
    );
    expect(waters).toHaveLength(2);
    const group = rebind(
      {
        type: 'ApplyCardSteps',
        steps: waters.map((card) => ({
          type: 'MoveCard' as const,
          cardId: card.id,
          expectedSourceZoneId: handId,
          destinationZoneId: discardId,
        })),
      },
      view
    );
    // The second copy taken back, queued on it as the board shows it.
    const queued: WireGameCommand = {
      type: 'MoveCard',
      cardId: waters[1]!.id,
      expectedSourceZoneId: discardId,
      destinationZoneId: handId,
    };
    table.send(group);
    const published = table.project();
    rebind.accepted(group, published.revision, published);
    const sent = rebind(queued, published);
    expect(sent).toEqual({
      ...queued,
      cardId: published.zones[discardId]!.cards[1]!.id,
    });
    table.send(sent);
    expect(shape(table.project()).zones[discardId]).toEqual(['Water Energy']);
  });

  it('rebinds a move queued behind a draw to a card a group put under the top of the deck', () => {
    const table = soloTable();
    const rebind = createProvisionalRebinder();
    const view = table.project();
    const handId = playerZoneId(red, 'hand');
    const hand = view.zones[handId]!.cards;
    // Three of Red's cards on top of the deck, as one group.
    const group = rebind(
      {
        type: 'ApplyCardSteps',
        steps: hand.slice(0, 3).map((card) => ({
          type: 'MoveCardToDeckTop' as const,
          cardId: card.id,
          expectedSourceId: handId,
        })),
      },
      view
    );
    const afterGroup = predictWireCommand(view, group, {
      readsEveryHand: true,
    })!;
    // Two drawn back, and the second of them discarded, queued as the board
    // shows them.
    const draw: WireGameCommand = {
      type: 'DrawCards',
      count: 2,
      targetPlayerId: red,
    };
    const afterDraw = predictWireCommand(afterGroup, draw, {
      readsEveryHand: true,
    })!;
    const before = new Set(
      afterGroup.zones[handId]!.cards.map((card) => card.id)
    );
    const drawn = afterDraw.zones[handId]!.cards.filter(
      (card) => !before.has(card.id)
    );
    expect(drawn).toHaveLength(2);
    const queued: WireGameCommand = {
      type: 'MoveCard',
      cardId: drawn[1]!.id,
      expectedSourceZoneId: handId,
      destinationZoneId: playerZoneId(red, 'discard'),
    };
    table.send(group);
    let published = table.project();
    rebind.accepted(group, published.revision, published);
    const drawSent = rebind(draw, published);
    table.send(drawSent);
    published = table.project();
    rebind.accepted(drawSent, published.revision, published);
    const sent = rebind(queued, published);
    expect(
      published.zones[handId]!.cards.some(
        (card) => sent.type === 'MoveCard' && card.id === sent.cardId
      )
    ).toBe(true);
    table.send(sent);
  });

  it('rebinds a move queued behind a draw to a card of a Pokémon a group put on the deck whole', () => {
    const table = soloTable();
    const rebind = createProvisionalRebinder();
    const handId = playerZoneId(red, 'hand');
    const deckId = playerZoneId(red, 'deck');
    const first = table.project();
    const [mewtwo] = first.zones[handId]!.cards.filter(
      (card) =>
        card.kind === 'known' &&
        first.definitions[card.definitionId]?.name === 'Mewtwo V-UNION'
    );
    table.send({
      type: 'MoveCardToPlay',
      cardId: mewtwo!.id,
      expectedSourceZoneId: handId,
      boardPlayerId: red,
      slot: 'bench',
    });
    const view = table.project();
    const board = view.boards[red]!;
    // Red's Active and Benched Pokémon put on top of the deck, whole.
    const group = rebind(
      {
        type: 'ApplyCardSteps',
        steps: [board.activeStackId!, board.benchStackIds[0]!].map(
          (stackId) => {
            const stack = view.stacks[stackId]!;
            return {
              type: 'MovePlayStackToZone' as const,
              stackId,
              expectedEvolutionCardIds: stack.evolutionCards.map(
                (card) => card.id
              ),
              expectedAttachmentCardIds: stack.attachmentCards.map(
                (card) => card.id
              ),
              destinationZoneId: deckId,
              destinationIndex: 0,
            };
          }
        ),
      },
      view
    );
    const afterGroup = predictWireCommand(view, group, {
      readsEveryHand: true,
    })!;
    // Both drawn back, and the second discarded, queued as the board shows
    // them before the room answers.
    const draw: WireGameCommand = {
      type: 'DrawCards',
      count: 2,
      targetPlayerId: red,
    };
    const afterDraw = predictWireCommand(afterGroup, draw, {
      readsEveryHand: true,
    })!;
    const before = new Set(
      afterGroup.zones[handId]!.cards.map((card) => card.id)
    );
    const drawn = afterDraw.zones[handId]!.cards.filter(
      (card) => !before.has(card.id)
    );
    expect(drawn).toHaveLength(2);
    const queued: WireGameCommand = {
      type: 'MoveCard',
      cardId: drawn[1]!.id,
      expectedSourceZoneId: handId,
      destinationZoneId: playerZoneId(red, 'discard'),
    };
    table.send(group);
    let published = table.project();
    rebind.accepted(group, published.revision, published);
    const drawSent = rebind(draw, published);
    table.send(drawSent);
    published = table.project();
    rebind.accepted(drawSent, published.revision, published);
    const sent = rebind(queued, published);
    expect(
      published.zones[handId]!.cards.some(
        (card) => sent.type === 'MoveCard' && card.id === sent.cardId
      )
    ).toBe(true);
    table.send(sent);
  });

  it("rebinds a move queued behind a group's reveal to the cards it showed", () => {
    const table = soloTable();
    const rebind = createProvisionalRebinder();
    const view = table.project();
    const hand = view.zones[playerZoneId(red, 'hand')]!.cards;
    const named = (wanted: string) =>
      hand.find(
        (card) =>
          card.kind === 'known' &&
          view.definitions[card.definitionId]?.name === wanted
      )!.id;
    const handId = playerZoneId(red, 'hand');
    const group = rebind(
      {
        type: 'ApplyCardSteps',
        steps: ['Fire Energy', 'Switch'].map((name) => ({
          type: 'SetPublicReveal' as const,
          cardId: named(name),
          expectedSourceId: handId,
          revealed: true,
        })),
      },
      view
    );
    const queued: WireGameCommand = {
      type: 'MoveCard',
      cardId: named('Switch'),
      expectedSourceZoneId: handId,
      destinationZoneId: playerZoneId(red, 'discard'),
    };
    table.send(group);
    const published = table.project();
    rebind.accepted(group, published.revision, published);
    const sent = rebind(queued, published);
    const switchNow = published.zones[handId]!.cards.find(
      (card) =>
        card.kind === 'known' &&
        published.definitions[card.definitionId]?.name === 'Switch'
    )!.id;
    expect(sent).toEqual({ ...queued, cardId: switchNow });
    table.send(sent);
  });

  it('rebinds a move queued behind it to the Pokémon it made', () => {
    const table = soloTable();
    const rebind = createProvisionalRebinder();
    const view = table.project();
    const group = rebind(theGroup(view), view);
    const predicted = predictWireCommand(view, group, {
      readsEveryHand: true,
    })!;
    // The V-UNION as the board shows it until the room answers.
    const made = predicted.boards[red]!.benchStackIds.at(-1)!;
    expect(made).toMatch(/^predicted-stack:/u);
    const queued: WireGameCommand = {
      type: 'SetDamage',
      stackId: made,
      damage: 30,
    };
    table.send(group);
    const published = table.project();
    rebind.accepted(group, published.revision, published);
    const sent = rebind(queued, published);
    expect(sent).toEqual({
      ...queued,
      stackId: published.boards[red]!.benchStackIds.at(-1),
    });
    table.send(sent);
    expect(
      table.project().stacks[sent.type === 'SetDamage' ? sent.stackId : '']!
        .damage
    ).toBe(30);
  });
});
