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

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

/**
 * Solo's one player sees what the other seat holds: its hand, whoever owns
 * each card in it, and the window a Pokémon of its was taken apart into.
 * Multiplayer keeps both concealed.
 */

const blue = asPlayerId('solo-disclose-blue');
const red = asPlayerId('solo-disclose-red');
let next = 0;
const context: CommandContext = {
  nextCardId: () => asCardInstanceId(`solo-disclose-card-${++next}`),
  nextStackId: () => asStackId(`solo-disclose-stack-${++next}`),
  nextInspectionId: () => asInspectionId('solo-disclose-inspection'),
  nextWorkAreaId: () => asWorkAreaId('solo-disclose-work-area'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const session: AuthoritySession = {
  id: 'solo-disclose-session',
  viewer: { kind: 'player', playerId: blue },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const run = (state: MatchState, command: GameCommand): MatchState => {
  const executed = executeCommand(state, command, context);
  if (!executed.accepted) throw new Error(executed.message);
  return executed.state;
};

const loaded = (): MatchState => {
  let state = createEmptyMatch(asMatchId('solo-disclose-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const deck = (
    playerId: string,
    entries: [string, 'Pokémon' | 'Energy' | 'Trainer', number][]
  ) =>
    entries.map(([name, category, count]) => ({
      definition: {
        id: asCardDefinitionId(`${playerId}-${name}`),
        name,
        category,
        imageUrl: `https://cards.example/${playerId}-${count}.png`,
      },
      count,
    }));
  state = run(state, {
    type: 'LoadDeck',
    playerId: blue,
    entries: deck(blue, [['Blue card', 'Trainer', 4]]),
  });
  state = run(state, {
    type: 'LoadDeck',
    playerId: red,
    entries: deck(red, [
      ['Red Mon', 'Pokémon', 2],
      ['Red Energy', 'Energy', 2],
    ]),
  });
  return state;
};

const project = (state: MatchState, mode: 'solo' | 'multiplayer') => {
  let opaque = 0;
  return projectRecipient(
    state,
    session.viewer,
    emptyProjectionIdentityState(),
    {
      nextOpaqueId: (kind) =>
        `solo-disclose-${kind}-${String(++opaque).padStart(8, '0')}`,
    },
    mode
  ).snapshot;
};

describe("Solo's view of the other seat", () => {
  it("shows a card of Blue's that was put in Red's hand", () => {
    const start = loaded();
    const blueCard = start.zones[playerZoneId(blue, 'deck')]!.cardIds[0]!;
    const state = run(start, {
      type: 'MoveCard',
      cardId: blueCard,
      expectedSourceZoneId: playerZoneId(blue, 'deck'),
      destinationZoneId: playerZoneId(red, 'hand'),
    });
    expect(
      project(state, 'solo').zones[playerZoneId(red, 'hand')]!.cards
    ).toEqual([expect.objectContaining({ kind: 'known', ownerId: blue })]);
    expect(
      project(state, 'multiplayer').zones[playerZoneId(red, 'hand')]!.cards
    ).toEqual([expect.objectContaining({ kind: 'concealed' })]);
  });

  it("shows the cards left when a Pokémon of Red's is taken apart", () => {
    let state = loaded();
    const deck = playerZoneId(red, 'deck');
    const ids = state.zones[deck]!.cardIds;
    const kind = (cardId: string) =>
      state.definitions[state.cards[cardId]!.definitionId]!.category;
    const basic = ids.find((cardId) => kind(cardId) === 'Pokémon');
    const [energy, second] = ids.filter((cardId) => kind(cardId) === 'Energy');
    for (const cardId of [basic!, energy!, second!]) {
      state = run(state, {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: deck,
        destinationZoneId: playerZoneId(red, 'hand'),
      });
    }
    const hand = playerZoneId(red, 'hand');
    state = run(state, {
      type: 'MoveCardToPlay',
      cardId: basic!,
      expectedSourceZoneId: hand,
      boardPlayerId: red,
      slot: 'active',
    });
    const stackId = state.boards[red]!.activeStackId!;
    for (const cardId of [energy!, second!]) {
      state = run(state, {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: hand,
        boardPlayerId: red,
        slot: 'active',
        targetStackId: stackId,
      });
    }
    // The Pokémon leaves: its Energy wait in Red's attached-card window.
    state = run(state, {
      type: 'MoveCardFromStack',
      cardId: basic!,
      expectedStackId: stackId,
      destinationZoneId: hand,
    });
    expect(state.workAreas[red]?.attachmentResolution?.cardIds).toHaveLength(2);
    const solo = project(state, 'solo').workAreas[red]!.attachmentResolution!;
    expect([
      ...solo.cards,
      ...solo.evolutionCards,
      ...solo.attachmentCards,
    ]).toSatisfy((cards: readonly { kind: string }[]) =>
      cards.every((card) => card.kind === 'known')
    );
    const room = project(state, 'multiplayer').workAreas[red]!
      .attachmentResolution!;
    expect(room.cards.every((card) => card.kind === 'concealed')).toBe(true);
  });

  it('keeps both seats consenting to each other: Solo cannot take it back', () => {
    expect(
      resolveWireCommand(
        loaded(),
        emptyProjectionIdentityState(),
        session,
        { type: 'SetCoachingConsent', consent: false },
        DEFAULT_AUTHORITY_POLICY,
        loaded().revision,
        { mode: 'solo' }
      )
    ).toEqual({ accepted: false, code: 'precondition_failed' });
  });
});
