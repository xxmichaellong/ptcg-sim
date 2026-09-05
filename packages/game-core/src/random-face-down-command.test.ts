import { describe, expect, it, vi } from 'vitest';

import { applyEventBatch } from './apply-events.js';
import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asViewCardId,
  asViewDefinitionId,
  asWorkAreaId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';
import { stableSerialize } from './stable-hash.js';

const p1 = asPlayerId('random-face-blue');
const p2 = asPlayerId('random-face-red');

const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
    asViewCardId(
      `random-view:${viewerKey}:${known ? 'known' : 'hidden'}:${visibilityGeneration}:${cardId}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(`random-definition:${viewerKey}:${definitionId}`),
};

const createContext = (
  randomInt: CommandContext['randomInt'] = () => 2
): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`random-face-card-${++card}`),
    nextStackId: () => asStackId(`random-face-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`random-face-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`random-face-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt,
  };
};

const entries = (count = 14): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`random-face-definition-${index}`),
      name: `Random face card ${index}`,
      category: index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/random-face-${index}.png`,
    },
    count: 1,
  }));

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
) => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result;
};

const fixture = (context = createContext()) => {
  let state = createEmptyMatch(asMatchId('random-face-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries() },
    context
  ).state;
  state = accepted(state, { type: 'SetupPlayer', playerId: p1 }, context).state;
  const deckId = playerZoneId(p1, 'deck');
  const boardId = playerZoneId(p1, 'board');
  const seedCardId = state.zones[deckId]!.cardIds[0]!;
  state = accepted(
    state,
    {
      type: 'MoveCard',
      cardId: seedCardId,
      expectedSourceZoneId: deckId,
      destinationZoneId: boardId,
    },
    context
  ).state;
  return { state, context, seedCardId };
};

describe('random face-down hand play', () => {
  it('selects on the authority and appends one replay-safe face-down card', () => {
    const randomInt = vi.fn(() => 2);
    const prepared = fixture(createContext(randomInt));
    const handId = playerZoneId(p1, 'hand');
    const boardId = playerZoneId(p1, 'board');
    const handOrder = [...prepared.state.zones[handId]!.cardIds];
    const boardOrder = [...prepared.state.zones[boardId]!.cardIds];
    const selectedId = handOrder[2]!;
    const generation = prepared.state.cards[selectedId]!.visibilityGeneration;

    const result = executeCommand(
      prepared.state,
      {
        type: 'PlayRandomCardFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p1,
      },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);

    expect(randomInt).toHaveBeenCalledOnce();
    expect(randomInt).toHaveBeenCalledWith(handOrder.length);
    expect(result.batch.events).toEqual([
      {
        type: 'RandomHandCardPlayedFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p1,
        handZoneId: handId,
        boardZoneId: boardId,
        expectedHandCardIds: handOrder,
        expectedBoardCardIds: boardOrder,
        cardId: selectedId,
        destinationIndex: boardOrder.length,
      },
    ]);
    expect(result.state.zones[handId]!.cardIds).toEqual(
      handOrder.filter((cardId) => cardId !== selectedId)
    );
    expect(result.state.zones[boardId]!.cardIds).toEqual([
      ...boardOrder,
      selectedId,
    ]);
    expect(result.state.cards[selectedId]).toMatchObject({
      face: 'down',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      visibilityGeneration: generation + 1,
    });
    expect(stableSerialize(applyEventBatch(prepared.state, result.batch))).toBe(
      stableSerialize(result.state)
    );
    assertMatchInvariants(result.state);
  });

  it('rotates the concealed handle and leaks no selected identity to other viewers', () => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const boardId = playerZoneId(p1, 'board');
    const opponentBefore = projectMatch(
      prepared.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const spectatorBefore = projectMatch(
      prepared.state,
      { kind: 'spectator' },
      identities
    );
    const oldOpponentAliases = opponentBefore.zones[handId]!.cards.map(
      (card) => card.id
    );
    const oldSpectatorAliases = spectatorBefore.zones[handId]!.cards.map(
      (card) => card.id
    );
    const selectedId = prepared.state.zones[handId]!.cardIds[2]!;
    const selectedDefinition =
      prepared.state.definitions[
        prepared.state.cards[selectedId]!.definitionId
      ]!;
    const result = accepted(
      prepared.state,
      {
        type: 'PlayRandomCardFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p1,
      },
      prepared.context
    );
    const opponentAfter = projectMatch(
      result.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const spectatorAfter = projectMatch(
      result.state,
      { kind: 'spectator' },
      identities
    );
    const opponentBoardCard = opponentAfter.zones[boardId]!.cards.at(-1)!;
    const spectatorBoardCard = spectatorAfter.zones[boardId]!.cards.at(-1)!;
    expect(opponentBoardCard.kind).toBe('concealed');
    expect(spectatorBoardCard.kind).toBe('concealed');
    expect(oldOpponentAliases).not.toContain(opponentBoardCard.id);
    expect(oldSpectatorAliases).not.toContain(spectatorBoardCard.id);
    expect(JSON.stringify(opponentAfter)).not.toContain(
      selectedDefinition.name
    );
    expect(JSON.stringify(opponentAfter)).not.toContain(
      selectedDefinition.imageUrl
    );
    expect(JSON.stringify(spectatorAfter)).not.toContain(
      selectedDefinition.name
    );
    expect(JSON.stringify(spectatorAfter)).not.toContain(
      selectedDefinition.imageUrl
    );
  });

  it('revokes public and private visibility when the selected card leaves hand', () => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const boardId = playerZoneId(p1, 'board');
    const selectedId = prepared.state.zones[handId]!.cardIds[2]!;
    const inspected = accepted(
      prepared.state,
      {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p2,
        cardId: selectedId,
        expectedSourceId: handId,
      },
      prepared.context
    );
    const revealed = accepted(
      inspected.state,
      {
        type: 'SetPublicReveal',
        actorPlayerId: p1,
        playerId: p1,
        cardId: selectedId,
        expectedSourceId: handId,
        revealed: true,
      },
      prepared.context
    );
    const result = accepted(
      revealed.state,
      {
        type: 'PlayRandomCardFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p1,
      },
      prepared.context
    );
    expect(result.state.visibility.publicCardIds).not.toContain(selectedId);
    expect(result.state.visibility.inspectionGrants).toEqual({});
    const opponentView = projectMatch(
      result.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(opponentView.zones[boardId]!.cards.at(-1)?.kind).toBe('concealed');
  });

  it('rejects empty hands, full boards, and invalid randomness without mutation', () => {
    const prepared = fixture();
    const before = stableSerialize(prepared.state);
    const handLength =
      prepared.state.zones[playerZoneId(p1, 'hand')]!.cardIds.length;
    for (const randomIndex of [-1, 1.5, handLength]) {
      const result = executeCommand(
        prepared.state,
        {
          type: 'PlayRandomCardFaceDown',
          actorPlayerId: p1,
          targetPlayerId: p1,
        },
        { ...prepared.context, randomInt: () => randomIndex }
      );
      expect(result).toMatchObject({
        accepted: false,
        code: 'invalid_command',
      });
      expect(stableSerialize(prepared.state)).toBe(before);
    }
    const emptied = accepted(
      prepared.state,
      {
        type: 'MoveZoneContents',
        sourceZoneId: playerZoneId(p1, 'hand'),
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      prepared.context
    );
    expect(
      executeCommand(
        emptied.state,
        {
          type: 'PlayRandomCardFaceDown',
          actorPlayerId: p1,
          targetPlayerId: p1,
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });

    const loadedOpponent = accepted(
      prepared.state,
      { type: 'LoadDeck', playerId: p2, entries: entries(200) },
      prepared.context
    ).state;
    const handIds = new Set(
      loadedOpponent.zones[playerZoneId(p1, 'hand')]!.cardIds
    );
    const extraBoardIds = Object.keys(loadedOpponent.cards)
      .map(asCardInstanceId)
      .filter(
        (cardId) => cardId !== prepared.seedCardId && !handIds.has(cardId)
      )
      .slice(0, 199);
    const boardId = playerZoneId(p1, 'board');
    const fullBoard: MatchState = {
      ...loadedOpponent,
      zones: Object.fromEntries(
        Object.entries(loadedOpponent.zones).map(([zoneId, zone]) => [
          zoneId,
          {
            ...zone,
            cardIds:
              zone.id === boardId
                ? [prepared.seedCardId, ...extraBoardIds]
                : zone.cardIds.filter(
                    (cardId) => !extraBoardIds.includes(cardId)
                  ),
          },
        ])
      ),
    };
    assertMatchInvariants(fullBoard);
    const unusedRandom = vi.fn(() => 0);
    expect(
      executeCommand(
        fullBoard,
        {
          type: 'PlayRandomCardFaceDown',
          actorPlayerId: p1,
          targetPlayerId: p1,
        },
        { ...prepared.context, randomInt: unusedRandom }
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(unusedRandom).not.toHaveBeenCalled();
  });

  it('rejects malformed resolved events before installing their selection', () => {
    const prepared = fixture();
    const result = executeCommand(
      prepared.state,
      {
        type: 'PlayRandomCardFaceDown',
        actorPlayerId: p1,
        targetPlayerId: p1,
      },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);
    const event = result.batch.events[0];
    if (event?.type !== 'RandomHandCardPlayedFaceDown') {
      throw new Error('Missing random face-down event');
    }
    const before = stableSerialize(prepared.state);
    for (const malformed of [
      { ...event, cardId: prepared.seedCardId },
      {
        ...event,
        expectedHandCardIds: [...event.expectedHandCardIds].reverse(),
      },
      { ...event, destinationIndex: event.destinationIndex + 1 },
    ]) {
      expect(() =>
        applyEventBatch(prepared.state, {
          revision: prepared.state.revision + 1,
          events: [malformed],
        })
      ).toThrow('Random face-down play event is malformed');
      expect(stableSerialize(prepared.state)).toBe(before);
    }
  });
});
