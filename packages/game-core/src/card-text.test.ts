import { describe, expect, it } from 'vitest';

import {
  CARD_TEXT_LIMITS,
  canonicalCardText,
  isCardPrint,
  isCardText,
  isMoveName,
  sameCardText,
  type CardText,
} from './card-text.js';
import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { applyEvent } from './apply-events.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';
import {
  assertMatchInvariants,
  collectInvariantProblems,
} from './invariants.js';
import type { MatchState } from './model.js';
import { projectMatch } from './projection.js';

const CHARIZARD: CardText = {
  hp: 330,
  types: ['Darkness'],
  stage: 'Stage 2',
  evolvesFrom: 'Charmeleon',
  abilities: [
    {
      name: 'Infernal Reign',
      kind: 'Ability',
      text: 'Search your deck for up to 3 Basic {R} Energy.',
    },
  ],
  attacks: [
    {
      name: 'Burning Darkness',
      cost: ['Fire', 'Fire'],
      damage: '180+',
      text: 'This attack does 30 more damage for each Prize card taken.',
    },
  ],
  weakness: 'Grass',
  weaknessValue: '×2',
  retreat: 2,
};

describe('card text (ADR-043)', () => {
  it('takes a card’s text whole and in bounds, and nothing else', () => {
    expect(isCardText(CHARIZARD)).toBe(true);
    expect(isCardText({ rules: 'Draw 3 cards.' })).toBe(true);
    expect(isCardText({})).toBe(false);
    expect(isCardText({ hp: 330, extra: true })).toBe(false);
    expect(isCardText({ hp: -10 })).toBe(false);
    expect(isCardText({ hp: CARD_TEXT_LIMITS.hp + 1 })).toBe(false);
    expect(isCardText({ types: ['Plasma'] })).toBe(false);
    expect(
      isCardText({
        attacks: [{ name: 'Gust', cost: ['Colorless'], damage: '20' }],
      })
    ).toBe(true);
    expect(isCardText({ attacks: [{ name: ' ', cost: [], damage: '' }] })).toBe(
      false
    );
    expect(
      isCardText({
        attacks: [{ name: 'Gust', cost: ['Colorless'], damage: '20', x: 1 }],
      })
    ).toBe(false);
    expect(
      isCardText({
        abilities: Array.from(
          { length: CARD_TEXT_LIMITS.abilities + 1 },
          () => ({
            name: 'Too many',
            kind: 'Ability',
            text: '',
          })
        ),
      })
    ).toBe(false);
    expect(isCardText({ rules: 'x'.repeat(CARD_TEXT_LIMITS.rules + 1) })).toBe(
      false
    );
  });

  it('names moves on one line, and prints by a set and a number', () => {
    expect(isMoveName('Burning Darkness')).toBe(true);
    expect(isMoveName('Two\nlines')).toBe(false);
    expect(isMoveName('   ')).toBe(false);
    expect(isMoveName('x'.repeat(CARD_TEXT_LIMITS.name + 1))).toBe(false);
    expect(isCardPrint('PAL 185')).toBe(true);
    expect(isCardPrint('sv03.5 TG01')).toBe(true);
    expect(isCardPrint('PAL185')).toBe(false);
    expect(isCardPrint('PAL 185 extra')).toBe(false);
  });

  it('compares text by what it says, not the order its fields were written in', () => {
    const reordered = JSON.parse(
      JSON.stringify({ retreat: 2, ...CHARIZARD })
    ) as CardText;
    expect(sameCardText(CHARIZARD, reordered)).toBe(true);
    expect(canonicalCardText(CHARIZARD)).toBe(canonicalCardText(reordered));
    expect(sameCardText(CHARIZARD, { ...CHARIZARD, hp: 320 })).toBe(false);
    expect(sameCardText(undefined, undefined)).toBe(true);
    expect(sameCardText(CHARIZARD, undefined)).toBe(false);
  });
});

const blue = asPlayerId('text-blue');
const red = asPlayerId('text-red');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  return {
    nextCardId: () => asCardInstanceId(`text-card-${++card}`),
    nextStackId: () => asStackId(`text-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('text-inspection'),
    nextWorkAreaId: () => asWorkAreaId('text-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries = (prefix: string): readonly DeckEntry[] => [
  {
    definition: {
      id: asCardDefinitionId(`${prefix}-charizard`),
      name: 'Charizard ex',
      category: 'Pokémon',
      imageUrl: `/${prefix}-charizard.png`,
      print: 'OBF 125',
    },
    count: 1,
  },
  {
    definition: {
      id: asCardDefinitionId(`${prefix}-custom`),
      name: 'Homebrew',
      category: 'Pokémon',
      imageUrl: `/${prefix}-custom.png`,
      text: CHARIZARD,
    },
    count: 1,
  },
];

const run = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): MatchState => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const fixture = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('text-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(
    state,
    { type: 'LoadDeck', playerId: blue, entries: entries('blue') },
    commandContext
  );
  state = run(
    state,
    { type: 'LoadDeck', playerId: red, entries: entries('red') },
    commandContext
  );
  const blueDeck = state.zones[playerZoneId(blue, 'deck')]!.cardIds;
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: blueDeck[0]!,
      expectedSourceZoneId: playerZoneId(blue, 'deck'),
      boardPlayerId: blue,
      slot: 'active',
    },
    commandContext
  );
  const redDeck = state.zones[playerZoneId(red, 'deck')]!.cardIds;
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: redDeck[0]!,
      expectedSourceZoneId: playerZoneId(red, 'deck'),
      boardPlayerId: red,
      slot: 'active',
    },
    commandContext
  );
  return {
    state,
    commandContext,
    blueStack: state.boards[blue]!.activeStackId!,
    redStack: state.boards[red]!.activeStackId!,
  };
};

describe('a card’s print and text on the table (ADR-043)', () => {
  it('keeps a definition’s print and own text, and shows them to who can see the card', () => {
    const { state } = fixture();
    assertMatchInvariants(state);
    const view = projectMatch(
      state,
      { kind: 'player', playerId: red },
      {
        viewCardId: ({ cardId }) => cardId as never,
        viewDefinitionId: ({ definitionId }) => definitionId as never,
      }
    );
    // The opponent sees the Pokémon in play, and its print with it.
    expect(view.definitions['blue-charizard']).toMatchObject({
      print: 'OBF 125',
    });
    // A card still in the deck says nothing of itself, its text included.
    expect(view.definitions['blue-custom']).toBeUndefined();
  });

  it('refuses a definition whose print or text is out of bounds', () => {
    const { state } = fixture();
    const broken: MatchState = {
      ...state,
      definitions: {
        ...state.definitions,
        'blue-charizard': {
          ...state.definitions['blue-charizard']!,
          print: 'no-space',
          text: { hp: -1 } as CardText,
        },
      },
    };
    const problems = collectInvariantProblems(broken);
    expect(problems).toContain('definition blue-charizard has invalid print');
    expect(problems).toContain(
      'definition blue-charizard has invalid card text'
    );
  });

  it('replays a named Ability event from before marks were by name as it was: the marker alone', () => {
    const { state, blueStack } = fixture();
    // Kept in a room's history from before 2026-11-05: no `named`.
    const legacy = applyEvent(state, {
      type: 'StackAbilitySet',
      stackId: blueStack,
      used: true,
      ability: 'Infernal Reign',
    });
    // Exactly what that history's hash was taken over.
    expect(legacy.stacks[blueStack]).toEqual({
      ...state.stacks[blueStack]!,
      abilityUsed: true,
    });
  });

  it('tells an Ability by name, and marks the Pokémon used, already marked or not', () => {
    const { state, commandContext, blueStack } = fixture();
    const first = executeCommand(
      state,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
      commandContext
    );
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.batch.events).toEqual([
      {
        type: 'StackAbilitySet',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
        named: true,
      },
    ]);
    expect(first.state.stacks[blueStack]!.abilityUsed).toBe(true);
    expect(first.state.stacks[blueStack]!.abilitiesUsed).toEqual([
      'Infernal Reign',
    ]);
    // Some Abilities are used more than once a turn: told again.
    const again = executeCommand(
      first.state,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
      commandContext
    );
    expect(again.accepted).toBe(true);
    // The plain marker is still a no-op when it is already on.
    expect(
      executeCommand(
        first.state,
        { type: 'SetAbilityUsed', stackId: blueStack, used: true },
        commandContext
      ).accepted
    ).toBe(false);
    for (const ability of ['', 'Two\nlines']) {
      expect(
        executeCommand(
          state,
          { type: 'SetAbilityUsed', stackId: blueStack, used: true, ability },
          commandContext
        ).accepted
      ).toBe(false);
    }
    expect(
      executeCommand(
        state,
        {
          type: 'SetAbilityUsed',
          stackId: blueStack,
          used: false,
          ability: 'Infernal Reign',
        },
        commandContext
      ).accepted
    ).toBe(false);
  });

  it('marks each Ability used apart, takes one mark off on its own, and forgets the names once the marker goes off', () => {
    const { state, commandContext, blueStack } = fixture();
    const use = (from: MatchState, ability: string, used = true) =>
      executeCommand(
        from,
        { type: 'SetAbilityUsed', stackId: blueStack, used, ability },
        commandContext
      );
    const viewed = (from: MatchState) =>
      projectMatch(
        from,
        { kind: 'player', playerId: red },
        {
          viewCardId: ({ cardId }) => cardId as never,
          viewDefinitionId: ({ definitionId }) => definitionId as never,
        }
      ).stacks[blueStack]!;
    // Two Abilities (a Poké-Power and a Poké-Body, say): each its own mark.
    let next = run(
      state,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
      commandContext
    );
    next = run(
      next,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Second Wind',
      },
      commandContext
    );
    assertMatchInvariants(next);
    expect(next.stacks[blueStack]).toMatchObject({
      abilityUsed: true,
      abilitiesUsed: ['Infernal Reign', 'Second Wind'],
    });
    expect(viewed(next).abilitiesUsed).toEqual([
      'Infernal Reign',
      'Second Wind',
    ]);
    // One taken off: the other stays, and the Pokémon is still marked.
    const off = use(next, 'Infernal Reign', false);
    expect(off.accepted).toBe(true);
    if (!off.accepted) return;
    expect(off.state.stacks[blueStack]).toMatchObject({
      abilityUsed: true,
      abilitiesUsed: ['Second Wind'],
    });
    // Only a mark that is on comes off.
    expect(use(off.state, 'Infernal Reign', false).accepted).toBe(false);
    // The last one off: the Pokémon's marker too.
    const none = use(off.state, 'Second Wind', false);
    expect(none.accepted).toBe(true);
    if (!none.accepted) return;
    expect(none.state.stacks[blueStack]!.abilityUsed).toBe(false);
    expect(none.state.stacks[blueStack]!.abilitiesUsed).toBeUndefined();
    expect(viewed(none.state).abilitiesUsed).toBeUndefined();
    // The marker turned off by anything else forgets the names: marked
    // again, only the new one is used.
    const cleared = run(
      next,
      { type: 'SetAbilityUsed', stackId: blueStack, used: false },
      commandContext
    );
    expect(viewed(cleared).abilitiesUsed).toBeUndefined();
    const again = run(
      cleared,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Second Wind',
      },
      commandContext
    );
    expect(again.stacks[blueStack]!.abilitiesUsed).toEqual(['Second Wind']);
  });

  it('names a face-down Pokémon’s used Abilities to no one who cannot read it', () => {
    const { state, commandContext, blueStack } = fixture();
    const marked = run(
      state,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
      commandContext
    );
    const topId = marked.stacks[blueStack]!.evolutionCardIds.at(-1)!;
    const down = run(
      marked,
      { type: 'SetCardFace', cardId: topId, face: 'down' },
      commandContext
    );
    const viewedBy = (playerId: typeof red) =>
      projectMatch(
        down,
        { kind: 'player', playerId },
        {
          viewCardId: ({ cardId }) => cardId as never,
          viewDefinitionId: ({ definitionId }) => definitionId as never,
        }
      ).stacks[blueStack]!;
    // The other player sees a marker on a card they cannot read: no name.
    expect(viewedBy(red).evolutionCards.at(-1)?.kind).toBe('concealed');
    expect(viewedBy(red)).toMatchObject({ abilityUsed: true });
    expect(viewedBy(red).abilitiesUsed).toBeUndefined();
    // Its own player still reads it, and the name.
    expect(viewedBy(blue).abilitiesUsed).toEqual(['Infernal Reign']);
  });

  it('changes what an effect adds to a Pokémon’s HP, in tens, and refuses the rest', () => {
    const { state, commandContext, blueStack } = fixture();
    const set = (from: MatchState, modifier: number) =>
      executeCommand(
        from,
        { type: 'SetHpModifier', stackId: blueStack, modifier },
        commandContext
      );
    const up = set(state, 30);
    expect(up.accepted).toBe(true);
    if (!up.accepted) return;
    expect(up.batch.events).toEqual([
      { type: 'StackHpModifierSet', stackId: blueStack, modifier: 30 },
    ]);
    assertMatchInvariants(up.state);
    expect(up.state.stacks[blueStack]!.hpModifier).toBe(30);
    expect(
      projectMatch(
        up.state,
        { kind: 'player', playerId: red },
        {
          viewCardId: ({ cardId }) => cardId as never,
          viewDefinitionId: ({ definitionId }) => definitionId as never,
        }
      ).stacks[blueStack]!.hpModifier
    ).toBe(30);
    const down = set(up.state, -50);
    expect(down.accepted && down.state.stacks[blueStack]!.hpModifier).toBe(-50);
    // Back to none: the field goes.
    const back = set(up.state, 0);
    expect(back.accepted).toBe(true);
    if (!back.accepted) return;
    expect('hpModifier' in back.state.stacks[blueStack]!).toBe(false);
    // Not in tens, past the limit, or no change: refused.
    for (const modifier of [35, 1000, -1000, Number.NaN]) {
      expect(set(state, modifier).accepted).toBe(false);
    }
    expect(set(up.state, 30).accepted).toBe(false);
    expect(set(state, 0).accepted).toBe(false);
    expect(
      executeCommand(
        state,
        {
          type: 'SetHpModifier',
          stackId: asStackId('no-such-stack'),
          modifier: 10,
        },
        commandContext
      ).accepted
    ).toBe(false);
  });

  it('refuses a Pokémon whose Abilities marked used or HP from effects are out of bounds', () => {
    const { state, blueStack } = fixture();
    const broken = (patch: object): MatchState => ({
      ...state,
      stacks: {
        ...state.stacks,
        [blueStack]: { ...state.stacks[blueStack]!, ...patch },
      },
    });
    for (const patch of [
      { abilitiesUsed: [] },
      { abilitiesUsed: ['A', 'A'] },
      { abilitiesUsed: ['Two\nlines'] },
      { abilitiesUsed: Array.from({ length: 9 }, (_, i) => `A${String(i)}`) },
    ]) {
      expect(collectInvariantProblems(broken(patch))).toContain(
        `stack ${blueStack} has invalid Abilities marked used`
      );
    }
    for (const hpModifier of [0, 15, 1000]) {
      expect(collectInvariantProblems(broken({ hpModifier }))).toContain(
        `stack ${blueStack} has an invalid HP modifier`
      );
    }
  });

  it('declares an attack by name from the attacker’s own Pokémon only', () => {
    const { state, commandContext, blueStack, redStack } = fixture();
    const declared = executeCommand(
      state,
      {
        type: 'DeclareAttack',
        playerId: blue,
        attack: { stackId: blueStack, name: 'Burning Darkness' },
      },
      commandContext
    );
    expect(declared.accepted).toBe(true);
    if (!declared.accepted) return;
    expect(declared.batch.events.at(-1)).toMatchObject({
      type: 'TableActionDeclared',
      action: 'attack',
      playerId: blue,
      attack: { stackId: blueStack, name: 'Burning Darkness' },
    });
    expect(
      executeCommand(
        state,
        {
          type: 'DeclareAttack',
          playerId: blue,
          attack: { stackId: redStack, name: 'Burning Darkness' },
        },
        commandContext
      ).accepted
    ).toBe(false);
    expect(
      executeCommand(
        state,
        {
          type: 'DeclareAttack',
          playerId: blue,
          attack: { stackId: blueStack, name: '' },
        },
        commandContext
      ).accepted
    ).toBe(false);
    // The turn's plain Attack names none.
    const plain = executeCommand(
      state,
      { type: 'DeclareAttack', playerId: blue },
      commandContext
    );
    expect(plain.accepted).toBe(true);
    if (plain.accepted)
      expect(plain.batch.events.at(-1)).not.toHaveProperty('attack');
  });

  it('takes a deck whose card looks the same as one on the table but names another print, or none', () => {
    const { state, commandContext } = fixture();
    // The same definition id (the deck's id leaves the print out), another
    // print: the definition already there stands, and the deck loads.
    const again = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId: red,
        entries: entries('blue').map((entry) => ({
          ...entry,
          definition: {
            ...entry.definition,
            ...(entry.definition.print ? { print: 'PAF 54' } : {}),
          },
        })),
      },
      commandContext
    );
    expect(again.accepted).toBe(true);
    if (again.accepted)
      expect(again.state.definitions['blue-charizard']?.print).toBe('OBF 125');
    const { print: _print, ...printless } = entries('blue')[0]!.definition;
    expect(
      executeCommand(
        state,
        {
          type: 'LoadDeck',
          playerId: red,
          entries: [{ definition: printless, count: 1 }],
        },
        commandContext
      ).accepted
    ).toBe(true);
    // Other text is another card: the same id with it is refused.
    expect(
      executeCommand(
        state,
        {
          type: 'LoadDeck',
          playerId: red,
          entries: [
            {
              definition: {
                ...entries('blue')[1]!.definition,
                text: { hp: 1 },
              },
              count: 1,
            },
          ],
        },
        commandContext
      ).accepted
    ).toBe(false);
  });
});
