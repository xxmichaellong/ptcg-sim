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
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { presentationEventsForBatch } from './presentation-events.js';
import { resolveWireCommand } from './resolve-command.js';

/**
 * An Ability or attack picked from a Pokémon's text (ADR-043): the room
 * resolves it for the attacker's own Pokémon, and the log names it with
 * the Pokémon -- only when everyone can see that Pokémon.
 */

const blue = asPlayerId('moves-blue');
const red = asPlayerId('moves-red');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  return {
    nextCardId: () => asCardInstanceId(`moves-card-${++card}`),
    nextStackId: () => asStackId(`moves-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('moves-inspection'),
    nextWorkAreaId: () => asWorkAreaId('moves-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const run = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
) => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result;
};

const table = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('moves-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const playerId of [blue, red]) {
    state = run(
      state,
      {
        type: 'LoadDeck',
        playerId,
        entries: [
          {
            definition: {
              id: asCardDefinitionId(`${playerId}-charizard`),
              name: 'Charizard ex',
              category: 'Pokémon',
              imageUrl: `/${playerId}.png`,
              print: 'OBF 125',
            },
            count: 1,
          },
        ],
      },
      commandContext
    ).state;
    state = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: state.zones[playerZoneId(playerId, 'deck')]!.cardIds[0]!,
        expectedSourceZoneId: playerZoneId(playerId, 'deck'),
        boardPlayerId: playerId,
        slot: 'active',
      },
      commandContext
    ).state;
  }
  return {
    state,
    commandContext,
    blueStack: state.boards[blue]!.activeStackId!,
    redStack: state.boards[red]!.activeStackId!,
  };
};

const session: AuthoritySession = {
  id: 'moves-session',
  viewer: { kind: 'player', playerId: blue },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const aliases = { cardAliases: [], definitionAliases: [] };

describe('named moves in the room (ADR-043)', () => {
  it('resolves an attack picked from the attacker’s own Pokémon, and no other', () => {
    const { state, blueStack, redStack } = table();
    expect(
      resolveWireCommand(
        state,
        aliases,
        session,
        {
          type: 'DeclareAttack',
          targetPlayerId: blue,
          attack: { stackId: blueStack, name: 'Burning Darkness' },
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'DeclareAttack',
        playerId: blue,
        attack: { stackId: blueStack, name: 'Burning Darkness' },
      },
    });
    // Blue can't say Red attacked with Blue's Pokémon, nor Blue with Red's.
    expect(
      resolveWireCommand(
        state,
        aliases,
        session,
        {
          type: 'DeclareAttack',
          targetPlayerId: blue,
          attack: { stackId: redStack, name: 'Burning Darkness' },
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        state,
        aliases,
        session,
        {
          type: 'DeclareAttack',
          targetPlayerId: blue,
          attack: { stackId: 'missing-stack', name: 'Burning Darkness' },
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        state,
        aliases,
        session,
        {
          type: 'SetAbilityUsed',
          stackId: blueStack,
          used: true,
          ability: 'Infernal Reign',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
    });
  });

  it('tells an Ability and an attack by name with their Pokémon', () => {
    const { state, commandContext, blueStack } = table();
    const used = run(
      state,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
      commandContext
    );
    expect(
      presentationEventsForBatch(used.batch, used.state, state)
    ).toContainEqual(
      expect.objectContaining({
        type: 'AbilityUsed',
        playerId: blue,
        cardName: 'Charizard ex',
        abilityName: 'Infernal Reign',
      })
    );
    const attacked = run(
      used.state,
      {
        type: 'DeclareAttack',
        playerId: blue,
        attack: { stackId: blueStack, name: 'Burning Darkness' },
      },
      commandContext
    );
    expect(
      presentationEventsForBatch(attacked.batch, attacked.state, used.state)
    ).toContainEqual(
      expect.objectContaining({
        type: 'AttackDeclared',
        playerId: blue,
        cardName: 'Charizard ex',
        attackName: 'Burning Darkness',
      })
    );
  });

  it('names no move of a Pokémon lying face down', () => {
    const { state, commandContext, blueStack } = table();
    const top = state.stacks[blueStack]!.evolutionCardIds.at(-1)!;
    const hidden: MatchState = {
      ...state,
      cards: { ...state.cards, [top]: { ...state.cards[top]!, face: 'down' } },
    };
    const used = run(
      hidden,
      {
        type: 'SetAbilityUsed',
        stackId: blueStack,
        used: true,
        ability: 'Infernal Reign',
      },
      commandContext
    );
    const ability = presentationEventsForBatch(
      used.batch,
      used.state,
      hidden
    ).find((event) => event.type === 'AbilityUsed');
    expect(ability).toBeDefined();
    expect(ability).not.toHaveProperty('abilityName');
    const attacked = run(
      hidden,
      {
        type: 'DeclareAttack',
        playerId: blue,
        attack: { stackId: blueStack, name: 'Burning Darkness' },
      },
      commandContext
    );
    const attack = presentationEventsForBatch(
      attacked.batch,
      attacked.state,
      hidden
    ).find((event) => event.type === 'AttackDeclared');
    expect(attack).toBeDefined();
    expect(attack).not.toHaveProperty('attackName');
    expect(attack).not.toHaveProperty('cardName');
  });
});
