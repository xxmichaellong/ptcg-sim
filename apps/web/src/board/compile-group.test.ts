import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import {
  parseClientFrame,
  PROTOCOL_VERSION,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { compileGroup, type GroupAction } from './compile-group.js';
import { BLUE, RED, groupTable, piece } from './group-table.test-support.js';
import { predictCardSteps, predictWireCommand } from './predictWireCommand.js';
import { resolveBoardDrop } from './resolveBoardDrop.js';
import { resolveLegacyBoardShortcutAction } from './resolveLegacyBoardShortcutAction.js';
import type { SelectionContext } from './selection.js';

const MORPEKO = 'swshp:155:Morpeko V-UNION';
const LUGIA = 'hgss2:90:Lugia LEGEND';
const PYRODUCT = 'me3:94:Legendary Pyroduct';

const union = (part: number) => ({
  name: 'Morpeko V-UNION',
  presentation: piece(MORPEKO, part),
});
const legend = (part: number) => ({
  name: 'Lugia LEGEND',
  presentation: piece(LUGIA, part, 1, 2),
});
const stadiumHalf = (part: number) => ({
  name: 'Legendary Pyroduct',
  category: 'Trainer' as const,
  presentation: piece(PYRODUCT, part, 2, 1),
});
const energy = { category: 'Energy' as const, name: 'Fire Energy' };

/** The group's move compiled, sent as one command the wire accepts. */
const compiled = (
  context: SelectionContext,
  selection: readonly ViewCardId[],
  action: GroupAction
): WireGameCommand => {
  const result = compileGroup(context, selection, action);
  if (!result.ok) throw new Error(`Refused: ${result.reason}`);
  const frame = parseClientFrame(
    JSON.stringify({
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session',
      clientSequence: 1,
      commandId: 'command',
      lastSeenRevision: 0,
      command: result.command,
    })
  );
  expect(frame.ok).toBe(true);
  return result.command;
};

/** The table the move leaves, as the client predicts it step by step. */
const after = (view: MatchViewState, command: WireGameCommand) => {
  const next =
    command.type === 'ApplyCardSteps'
      ? predictCardSteps(view, command.steps)
      : predictWireCommand(view, command);
  expect(next).not.toBeNull();
  return next!;
};

const ids = (cards: readonly { readonly id: string }[]) =>
  cards.map((card) => card.id);

describe('one item', () => {
  it('sends the single command it sends today, for every key', () => {
    const table = groupTable();
    const [card] = table.put(BLUE, 'hand', {}) as [ViewCardId];
    const active = table.pokemon(BLUE, 'active', [{}, {}], [energy], {
      damage: 30,
    });
    const context = table.context();
    const cases: [
      GroupAction,
      Parameters<typeof resolveLegacyBoardShortcutAction>[1],
    ][] = [
      [
        { kind: 'send', to: 'discard' },
        { action: 'moveCardToZone', cardId: card, destination: 'discard' },
      ],
      [
        { kind: 'send', to: 'deckShuffled' },
        {
          action: 'moveCardRelativeToDeck',
          cardId: card,
          deckAction: 'shuffleIntoDeck',
        },
      ],
      [
        { kind: 'play', slot: 'bench' },
        { action: 'moveCardToPlay', cardId: card, slot: 'bench' },
      ],
      [{ kind: 'stadium' }, { action: 'moveCardToStadium', cardId: card }],
      [
        { kind: 'send', to: 'discard' },
        {
          action: 'moveCardToZone',
          cardId: active.top,
          destination: 'discard',
        },
      ],
      [
        { kind: 'damage', delta: -50 },
        { action: 'adjustDamage', cardId: active.top, delta: -50 },
      ],
      [
        { kind: 'condition', remove: true },
        { action: 'cycleSpecialCondition', cardId: active.top, remove: true },
      ],
      [{ kind: 'ability' }, { action: 'toggleAbility', cardId: active.top }],
      [
        { kind: 'rotate', single: false },
        { action: 'rotateSelectedCard', cardId: active.top, single: false },
      ],
    ];
    for (const [action, request] of cases) {
      const single = resolveLegacyBoardShortcutAction(table.view, request);
      if (!single.ok || !('command' in single)) throw new Error('no command');
      const selected = 'cardId' in request ? request.cardId : card;
      expect(compileGroup(context, [selected], action)).toEqual({
        ok: true,
        command: single.command,
        skipped: [],
      });
    }
    // `d` on one Pokémon keeps v1's: its top card goes, the rest wait.
    expect(
      compiled(context, [active.top], { kind: 'send', to: 'discard' }).type
    ).toBe('MoveCardFromStack');
  });

  it('sends the single command a drag sends today', () => {
    const table = groupTable();
    const [card] = table.put(BLUE, 'hand', {}, {}) as [ViewCardId];
    const context = table.context();
    const bench = context.scene.zones.find(
      (zone) => zone.kind === 'bench' && zone.playerId === BLUE
    )!;
    const single = resolveBoardDrop(table.view, context.scene, {
      kind: 'CardDropRequested',
      cardId: card,
      targetId: bench.id,
      x: 0,
      y: 0,
    });
    expect(
      compileGroup(context, [card], { kind: 'drop', targetId: bench.id })
    ).toEqual({ ok: true, ...single, skipped: [] });
  });

  it('refuses as the single key does, naming the card', () => {
    const table = groupTable();
    const [card] = table.put(BLUE, 'hand', {}) as [ViewCardId];
    expect(
      compileGroup(table.context(), [card], { kind: 'send', to: 'hand' })
    ).toEqual({ ok: false, reason: 'no_op', cardId: card });
  });
});

describe('a group moved by a key', () => {
  it('lands item 1 first: the last ends on top of the discard pile', () => {
    const table = groupTable();
    const [a, b, c] = table.put(BLUE, 'hand', {}, {}, {}) as ViewCardId[];
    const command = compiled(table.context(), [c!, a!, b!], {
      kind: 'send',
      to: 'discard',
    });
    expect(command).toEqual({
      type: 'ApplyCardSteps',
      steps: [c, a, b].map((cardId) => ({
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: table.zoneId(BLUE, 'hand'),
        destinationZoneId: table.zoneId(BLUE, 'discard'),
      })),
    });
    expect(
      ids(
        after(table.view, command).zones[table.zoneId(BLUE, 'discard')]!.cards
      )
    ).toEqual([c, a, b]);
  });

  it("sends each card to its own owner's pile, as each goes alone", () => {
    const table = groupTable();
    const [blue] = table.put(BLUE, 'hand', {}) as ViewCardId[];
    const [red] = table.put(RED, 'board', {}) as ViewCardId[];
    const command = compiled(
      table.context({ controlsEverySeat: true }),
      [blue!, red!],
      { kind: 'send', to: 'lostZone' }
    );
    const next = after(table.view, command);
    expect(ids(next.zones[table.zoneId(BLUE, 'lostZone')]!.cards)).toEqual([
      blue,
    ]);
    expect(ids(next.zones[table.zoneId(RED, 'lostZone')]!.cards)).toEqual([
      red,
    ]);
  });

  it('leaves out cards already there, and says so when every one is', () => {
    const table = groupTable();
    const discard = table.zoneId(BLUE, 'discard');
    const [there] = table.put(BLUE, 'discard', {}) as ViewCardId[];
    const [held] = table.put(BLUE, 'hand', {}) as ViewCardId[];
    const context = table.context({ openedZoneId: discard });
    expect(
      compileGroup(context, [there!, held!], { kind: 'send', to: 'discard' })
    ).toEqual({
      ok: true,
      command: {
        type: 'MoveCard',
        cardId: held,
        expectedSourceZoneId: table.zoneId(BLUE, 'hand'),
        destinationZoneId: discard,
      },
      skipped: [there],
    });
    const [also] = table.put(BLUE, 'discard', {}) as ViewCardId[];
    expect(
      compileGroup(table.context({ openedZoneId: discard }), [there!, also!], {
        kind: 'send',
        to: 'discard',
      })
    ).toEqual({ ok: false, reason: 'no_op' });
  });

  it('moves each of several Pokémon whole, with what is attached', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}, {}], [energy]);
    const benched = table.pokemon(BLUE, 'bench', [{}], [energy, energy]);
    const command = compiled(table.context(), [active.top, benched.top], {
      kind: 'send',
      to: 'discard',
    });
    expect(command).toEqual({
      type: 'ApplyCardSteps',
      steps: [active, benched].map((pokemon) => ({
        type: 'MovePlayStackToZone',
        stackId: pokemon.stackId,
        expectedEvolutionCardIds: pokemon.line,
        expectedAttachmentCardIds: pokemon.attached,
        destinationZoneId: table.zoneId(BLUE, 'discard'),
      })),
    });
    const next = after(table.view, command);
    expect(next.zones[table.zoneId(BLUE, 'discard')]!.cards).toHaveLength(6);
    expect(next.boards[BLUE]).toEqual({
      activeStackId: null,
      benchStackIds: [],
    });
  });

  it('puts cards from the hand and the open discard on the deck, the last on top', () => {
    const table = groupTable();
    const deck = table.zoneId(BLUE, 'deck');
    const discard = table.zoneId(BLUE, 'discard');
    const [under] = table.put(BLUE, 'deck', { concealed: true });
    const [h1, h2] = table.put(BLUE, 'hand', {}, {}) as ViewCardId[];
    const [d1] = table.put(BLUE, 'discard', {}, {}) as ViewCardId[];
    const command = compiled(
      table.context({ openedZoneId: discard }),
      [h1!, d1!, h2!],
      { kind: 'send', to: 'deckTop' }
    );
    expect(command).toEqual({
      type: 'ApplyCardSteps',
      steps: [
        [h1, table.zoneId(BLUE, 'hand')],
        [d1, discard],
        [h2, table.zoneId(BLUE, 'hand')],
      ].map(([cardId, expectedSourceId]) => ({
        type: 'MoveCardToDeckTop',
        cardId,
        expectedSourceId,
      })),
    });
    expect(ids(after(table.view, command).zones[deck]!.cards)).toEqual([
      h2,
      d1,
      h1,
      under,
    ]);
  });

  it('puts each on the deck, then shuffles each deck once', () => {
    const table = groupTable();
    table.put(BLUE, 'deck', { concealed: true });
    table.put(RED, 'deck', { concealed: true });
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as ViewCardId[];
    const [red] = table.put(RED, 'board', {}) as ViewCardId[];
    const command = compiled(
      table.context({ controlsEverySeat: true }),
      [a!, red!, b!],
      { kind: 'send', to: 'deckShuffled' }
    );
    if (command.type !== 'ApplyCardSteps') throw new Error('one step');
    expect(command.steps.map((step) => step.type)).toEqual([
      'MoveCardToDeckTop',
      'MoveCardToDeckTop',
      'MoveCardToDeckTop',
      'ShuffleZone',
      'ShuffleZone',
    ]);
    expect(command.steps.slice(3)).toEqual([
      { type: 'ShuffleZone', zoneId: table.zoneId(BLUE, 'deck') },
      { type: 'ShuffleZone', zoneId: table.zoneId(RED, 'deck') },
    ]);
  });

  it('plays several Basics onto the Bench, item 1 leftmost', () => {
    const table = groupTable();
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as ViewCardId[];
    const command = compiled(table.context(), [b!, a!], {
      kind: 'play',
      slot: 'bench',
    });
    const next = after(table.view, command);
    expect(
      next.boards[BLUE]!.benchStackIds.map(
        (id) => next.stacks[id]!.evolutionCards[0]!.id
      )
    ).toEqual([b, a]);
  });

  it('refuses a Pokémon in play going into play, and two going to the Active', () => {
    const table = groupTable();
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as ViewCardId[];
    const active = table.pokemon(BLUE, 'active', [{}]);
    const context = table.context();
    expect(
      compileGroup(context, [a!, active.top], { kind: 'play', slot: 'bench' })
    ).toEqual({ ok: false, reason: 'pokemon_to_play', cardId: active.top });
    expect(
      compileGroup(context, [a!, b!], { kind: 'play', slot: 'active' })
    ).toEqual({ ok: false, reason: 'one_active' });
  });
});

describe('cards printed in pieces', () => {
  it("plays a V-UNION's four pieces as one Pokémon, each on the last", () => {
    const table = groupTable();
    const discard = table.zoneId(BLUE, 'discard');
    const pieces = table.put(
      BLUE,
      'discard',
      union(2),
      union(0),
      union(3),
      union(1)
    ) as ViewCardId[];
    const [p2, p0, p3, p1] = pieces;
    const command = compiled(table.context({ openedZoneId: discard }), pieces, {
      kind: 'play',
      slot: 'bench',
    });
    expect(command).toEqual({
      type: 'ApplyCardSteps',
      steps: [
        {
          type: 'MoveCardToPlay',
          cardId: p0,
          expectedSourceZoneId: discard,
          boardPlayerId: BLUE,
          slot: 'bench',
        },
        ...[
          [p1, p0],
          [p2, p1],
          [p3, p2],
        ].map(([cardId, onTopOf]) => ({
          type: 'PlaceCardOnPlayStack',
          cardId,
          expectedSourceId: discard,
          targetStackRef: 0,
          expectedTargetTopCardId: onTopOf,
          mode: 'evolution',
        })),
      ],
    });
    const next = after(table.view, command);
    const [benched] = next.boards[BLUE]!.benchStackIds;
    expect(ids(next.stacks[benched!]!.evolutionCards)).toEqual([
      p0,
      p1,
      p2,
      p3,
    ]);
    expect(next.zones[discard]!.cards).toEqual([]);
  });

  it("makes two Pokémon of two LEGENDs' halves, and two of two V-UNIONs", () => {
    const table = groupTable();
    const halves = table.put(
      BLUE,
      'hand',
      legend(0),
      legend(0),
      legend(1),
      legend(1)
    ) as ViewCardId[];
    const command = compiled(table.context(), halves, {
      kind: 'play',
      slot: 'bench',
    });
    if (command.type !== 'ApplyCardSteps') throw new Error('one step');
    expect(
      command.steps.map((step) =>
        'targetStackRef' in step ? step.targetStackRef : step.type
      )
    ).toEqual(['MoveCardToPlay', 0, 'MoveCardToPlay', 2]);
    const next = after(table.view, command);
    expect(
      next.boards[BLUE]!.benchStackIds.map((id) =>
        ids(next.stacks[id]!.evolutionCards)
      )
    ).toEqual([
      [halves[0], halves[2]],
      [halves[1], halves[3]],
    ]);
  });

  it('joins a lone piece, or the rest of a set, to its unfinished Pokémon on `b`', () => {
    const table = groupTable();
    const started = table.pokemon(BLUE, 'bench', [union(0), union(1)]);
    const [p3, p2] = table.put(
      BLUE,
      'hand',
      union(3),
      union(2)
    ) as ViewCardId[];
    const context = table.context();
    expect(compiled(context, [p2!], { kind: 'play', slot: 'bench' })).toEqual({
      type: 'PlaceCardOnPlayStack',
      cardId: p2,
      expectedSourceId: table.zoneId(BLUE, 'hand'),
      targetStackId: started.stackId,
      expectedTargetTopCardId: started.top,
      mode: 'evolution',
    });
    const command = compiled(context, [p3!, p2!], {
      kind: 'play',
      slot: 'bench',
    });
    expect(
      ids(after(table.view, command).stacks[started.stackId]!.evolutionCards)
    ).toEqual([...started.line, p2, p3]);
  });

  it("plays a split Stadium's halves as one Stadium, replacing the one there", () => {
    const table = groupTable();
    const [old] = table.put(null, 'stadium', { category: 'Trainer' });
    const halves = table.put(
      BLUE,
      'hand',
      stadiumHalf(1),
      stadiumHalf(0)
    ) as ViewCardId[];
    const command = compiled(table.context(), halves, { kind: 'stadium' });
    if (command.type !== 'ApplyCardSteps') throw new Error('one step');
    expect(command.steps).toEqual([
      expect.objectContaining({
        type: 'MoveCardToStadium',
        cardId: halves[1],
        expectedStadiumCardId: old,
      }),
      expect.objectContaining({
        type: 'MoveCardToStadium',
        cardId: halves[0],
        expectedStadiumCardId: halves[1],
        placement: 'add',
      }),
    ]);
    const next = after(table.view, command);
    expect(ids(next.zones['zone:shared:stadium']!.cards)).toEqual([
      halves[1],
      halves[0],
    ]);
  });

  it('takes one card, or one Stadium, into the Stadium', () => {
    const table = groupTable();
    const halves = table.put(BLUE, 'hand', stadiumHalf(0), stadiumHalf(1), {
      category: 'Trainer',
    }) as ViewCardId[];
    expect(compileGroup(table.context(), halves, { kind: 'stadium' })).toEqual({
      ok: false,
      reason: 'one_stadium',
    });
  });
});

describe('a group dropped', () => {
  it('lies in the hand where it was let go, in its order, among the cards that stay', () => {
    const table = groupTable();
    const hand = table.zoneId(BLUE, 'hand');
    const [s0, g0, s1, s2] = table.put(
      BLUE,
      'hand',
      {},
      {},
      {},
      {}
    ) as ViewCardId[];
    const [g1] = table.put(BLUE, 'board', {}) as ViewCardId[];
    // Dropped between the first two cards that stay.
    const command = compiled(table.context(), [g1!, g0!], {
      kind: 'drop',
      targetId: hand,
      index: 1,
    });
    expect(ids(after(table.view, command).zones[hand]!.cards)).toEqual([
      s0,
      g1,
      g0,
      s1,
      s2,
    ]);
  });

  it('opens the Bench where it was let go, each new Pokémon after the last', () => {
    const table = groupTable();
    const first = table.pokemon(BLUE, 'bench', [{}]);
    const last = table.pokemon(BLUE, 'bench', [{}]);
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as ViewCardId[];
    const context = table.context();
    const bench = context.scene.zones.find(
      (zone) => zone.kind === 'bench' && zone.playerId === BLUE
    )!;
    const command = compiled(context, [a!, b!], {
      kind: 'drop',
      targetId: bench.id,
      index: 1,
    });
    const next = after(table.view, command);
    expect(
      next.boards[BLUE]!.benchStackIds.map(
        (id) => next.stacks[id]!.evolutionCards[0]!.id
      )
    ).toEqual([first.top, a, b, last.top]);
  });

  it('puts cards to attach on a Pokémon, and its own missing pieces, but nothing else', () => {
    const table = groupTable();
    const started = table.pokemon(BLUE, 'active', [union(0)]);
    const [fire, p1] = table.put(
      BLUE,
      'hand',
      energy,
      union(1)
    ) as ViewCardId[];
    const [basic] = table.put(BLUE, 'hand', {}) as ViewCardId[];
    const context = table.context();
    const command = compiled(context, [fire!, p1!], {
      kind: 'drop',
      targetId: started.stackId,
    });
    const next = after(table.view, command).stacks[started.stackId]!;
    expect(ids(next.evolutionCards)).toEqual([started.top, p1]);
    expect(ids(next.attachmentCards)).toEqual([fire]);
    expect(
      compileGroup(context, [fire!, basic!], {
        kind: 'drop',
        targetId: started.stackId,
      })
    ).toEqual({ ok: false, reason: 'attachments_only', cardId: basic });
  });
});

describe('damage, conditions and markers on a group', () => {
  it('puts damage on each Pokémon once, by its own total', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}], [energy, energy], {
      damage: 30,
    });
    const benched = table.pokemon(RED, 'bench', [{}]);
    // Two Energy on one Pokémon: that Pokémon, once.
    const [first, second] = active.attached;
    const command = compiled(table.context(), [first!, benched.top, second!], {
      kind: 'damage',
      delta: 20,
    });
    expect(command).toEqual({
      type: 'ApplyCardSteps',
      steps: [
        { type: 'SetDamage', stackId: active.stackId, damage: 50 },
        { type: 'SetDamage', stackId: benched.stackId, damage: 20 },
      ],
    });
    // Taken off, floored at none: one with none is left as it is.
    expect(
      compiled(table.context(), [active.top, benched.top], {
        kind: 'damage',
        delta: -40,
      })
    ).toEqual({ type: 'SetDamage', stackId: active.stackId, damage: null });
  });

  it('refuses damage on a card not in play, naming it', () => {
    const table = groupTable();
    const active = table.pokemon(BLUE, 'active', [{}]);
    const [card] = table.put(BLUE, 'hand', {}) as ViewCardId[];
    expect(
      compileGroup(table.context(), [active.top, card!], {
        kind: 'damage',
        delta: 10,
      })
    ).toEqual({ ok: false, reason: 'not_in_play', cardId: card });
  });

  it('puts a Special Condition only on Active Pokémon', () => {
    const table = groupTable();
    const blue = table.pokemon(BLUE, 'active', [{}]);
    const red = table.pokemon(RED, 'active', [{}]);
    const benched = table.pokemon(RED, 'bench', [{}]);
    const context = table.context();
    expect(
      compiled(context, [blue.top, red.top], {
        kind: 'condition',
        remove: false,
      })
    ).toEqual({
      type: 'ApplyCardSteps',
      steps: [blue, red].map((pokemon) => ({
        type: 'SetSpecialCondition',
        stackId: pokemon.stackId,
        condition: 'P',
      })),
    });
    expect(
      compileGroup(context, [blue.top, benched.top], {
        kind: 'condition',
        remove: false,
      })
    ).toEqual({ ok: false, reason: 'active_only', cardId: benched.top });
  });

  it('marks every ability used, or clears them when every one is', () => {
    const table = groupTable();
    const used = table.pokemon(BLUE, 'active', [{}], [], { abilityUsed: true });
    const unused = table.pokemon(BLUE, 'bench', [{}]);
    const context = table.context();
    expect(
      compiled(context, [used.top, unused.top], { kind: 'ability' })
    ).toEqual({
      type: 'SetAbilityUsed',
      stackId: unused.stackId,
      used: true,
    });
    const both = table.pokemon(BLUE, 'bench', [{}], [], { abilityUsed: true });
    expect(
      compiled(table.context(), [used.top, both.top], { kind: 'ability' })
    ).toEqual({
      type: 'ApplyCardSteps',
      steps: [used, both].map((pokemon) => ({
        type: 'SetAbilityUsed',
        stackId: pokemon.stackId,
        used: false,
      })),
    });
  });

  it('reveals each card, and turns each Pokémon', () => {
    const table = groupTable();
    const [a, b] = table.put(BLUE, 'hand', {}, {}) as ViewCardId[];
    const active = table.pokemon(BLUE, 'active', [{}]);
    const benched = table.pokemon(BLUE, 'bench', [{}]);
    const context = table.context();
    expect(
      compiled(context, [a!, b!], { kind: 'reveal', revealed: true })
    ).toEqual({
      type: 'ApplyCardSteps',
      steps: [a, b].map((cardId) => ({
        type: 'SetPublicReveal',
        cardId,
        expectedSourceId: table.zoneId(BLUE, 'hand'),
        revealed: true,
      })),
    });
    expect(
      compiled(context, [active.top, benched.top], {
        kind: 'rotate',
        single: false,
      })
    ).toEqual({
      type: 'ApplyCardSteps',
      steps: [active, benched].map((pokemon) => ({
        type: 'RotateStack',
        stackId: pokemon.stackId,
        rotationQuarterTurns: 1,
      })),
    });
  });

  it('turns a Pokémon once for the cards picked on it, and each card with Alt', () => {
    const table = groupTable();
    const charged = table.pokemon(BLUE, 'active', [{}], [{}, {}]);
    const context = table.context();
    // Two Energy on it: one turn, not two.
    expect(
      compiled(context, charged.attached, { kind: 'rotate', single: false })
    ).toEqual({
      type: 'RotateStack',
      stackId: charged.stackId,
      rotationQuarterTurns: 1,
    });
    // Alt+`r` turns each card on its own.
    const each = compiled(context, charged.attached, {
      kind: 'rotate',
      single: true,
    });
    expect(each.type).toBe('ApplyCardSteps');
    expect(each.type === 'ApplyCardSteps' && each.steps).toHaveLength(2);
  });
});

describe('what a group can hold', () => {
  it('refuses nothing selected, and a card the seat can’t move', () => {
    const table = groupTable();
    const [hidden] = table.put(RED, 'hand', { concealed: true });
    const [own] = table.put(BLUE, 'hand', {});
    const context = table.context();
    expect(compileGroup(context, [], { kind: 'send', to: 'discard' })).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(
      compileGroup(context, [own!, hidden!], { kind: 'send', to: 'discard' })
    ).toEqual({ ok: false, reason: 'uncontrolled', cardId: hidden });
  });
});
