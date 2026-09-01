import { describe, expect, it } from 'vitest';

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

const p1 = asPlayerId('visibility-blue');
const p2 = asPlayerId('visibility-red');

const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
    asViewCardId(
      `view:${viewerKey}:${known ? 'known' : 'hidden'}:${visibilityGeneration}:${cardId}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(`definition:${viewerKey}:${definitionId}`),
};

const createContext = (): CommandContext => {
  let card = 0;
  return {
    nextCardId: () => asCardInstanceId(`visibility-card-${++card}`),
    nextStackId: () => asStackId('visibility-stack'),
    nextInspectionId: () => asInspectionId('visibility-inspection'),
    nextWorkAreaId: () => asWorkAreaId('visibility-work-area'),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries = (count = 14): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`visibility-definition-${index}`),
      name: `Visibility card ${index}`,
      category: index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/visibility-${index}.png`,
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

const fixture = () => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('visibility-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries() },
    context
  ).state;
  state = accepted(state, { type: 'SetupPlayer', playerId: p1 }, context).state;
  return { state, context };
};

describe('atomic public visibility commands', () => {
  it('reveals and hides the exact prize zone with replay-safe concealment', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const prizeCards = [...prepared.state.zones[prizeId]!.cardIds];
    const beforeOpponent = projectMatch(
      prepared.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(
      beforeOpponent.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed' && !card.publiclyRevealed
      )
    ).toBe(true);

    const revealed = accepted(
      prepared.state,
      {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: prizeId,
        expectedCardIds: prizeCards,
        revealed: true,
      },
      prepared.context
    );
    expect(revealed.batch.events).toEqual([
      {
        type: 'PublicRevealSet',
        playerId: p1,
        expectedSourceId: prizeId,
        expectedSourceCardIds: prizeCards,
        cardIds: prizeCards,
        revealed: true,
      },
    ]);
    expect(revealed.state.visibility.publicCardIds).toEqual(prizeCards);
    expect(
      projectMatch(revealed.state, { kind: 'spectator' }, identities).zones[
        prizeId
      ]!.cards.every((card) => card.kind === 'known' && card.publiclyRevealed)
    ).toBe(true);
    expect(
      stableSerialize(applyEventBatch(prepared.state, revealed.batch))
    ).toBe(stableSerialize(revealed.state));

    const generations = Object.fromEntries(
      prizeCards.map((cardId) => [
        cardId,
        revealed.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const knownAliases = projectMatch(
      revealed.state,
      { kind: 'player', playerId: p2 },
      identities
    ).zones[prizeId]!.cards.map((card) => card.id);
    const hidden = accepted(
      revealed.state,
      {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: prizeId,
        expectedCardIds: prizeCards,
        revealed: false,
      },
      prepared.context
    );
    expect(hidden.state.visibility.publicCardIds).toEqual([]);
    for (const cardId of prizeCards) {
      expect(hidden.state.cards[cardId]).toMatchObject({
        face: 'up',
        visibilityGeneration: generations[cardId]! + 1,
      });
    }
    const hiddenView = projectMatch(
      hidden.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(
      hiddenView.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed' && !card.publiclyRevealed
      )
    ).toBe(true);
    expect(hiddenView.zones[prizeId]!.cards.map((card) => card.id)).not.toEqual(
      knownAliases
    );
    expect(stableSerialize(applyEventBatch(revealed.state, hidden.batch))).toBe(
      stableSerialize(hidden.state)
    );
    assertMatchInvariants(hidden.state);
  });

  it('reveals one concealed prize and rotates only that identity when hidden', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const [selected, untouched] = prepared.state.zones[prizeId]!.cardIds;
    const revealed = accepted(
      prepared.state,
      {
        type: 'SetPublicReveal',
        playerId: p1,
        cardId: selected!,
        expectedSourceId: prizeId,
        revealed: true,
      },
      prepared.context
    );
    expect(revealed.state.visibility.publicCardIds).toEqual([selected]);
    const opponent = projectMatch(
      revealed.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(opponent.zones[prizeId]!.cards[0]).toMatchObject({
      kind: 'known',
      publiclyRevealed: true,
    });
    expect(opponent.zones[prizeId]!.cards[1]).toMatchObject({
      kind: 'concealed',
      publiclyRevealed: false,
    });
    const selectedGeneration =
      revealed.state.cards[selected!]!.visibilityGeneration;
    const untouchedGeneration =
      revealed.state.cards[untouched!]!.visibilityGeneration;
    const hidden = accepted(
      revealed.state,
      {
        type: 'SetPublicReveal',
        playerId: p1,
        cardId: selected!,
        expectedSourceId: prizeId,
        revealed: false,
      },
      prepared.context
    );
    expect(hidden.state.cards[selected!]!.visibilityGeneration).toBe(
      selectedGeneration + 1
    );
    expect(hidden.state.cards[untouched!]!.visibilityGeneration).toBe(
      untouchedGeneration
    );
  });

  it('turns a public-zone card down when hidden and restores it on reveal', () => {
    const prepared = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const boardId = playerZoneId(p1, 'board');
    const cardId = prepared.state.zones[deckId]!.cardIds[0]!;
    const moved = accepted(
      prepared.state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: deckId,
        destinationZoneId: boardId,
      },
      prepared.context
    );
    const hidden = accepted(
      moved.state,
      {
        type: 'SetPublicReveal',
        playerId: p1,
        cardId,
        expectedSourceId: boardId,
        revealed: false,
      },
      prepared.context
    );
    expect(hidden.state.cards[cardId]!.face).toBe('down');
    expect(
      projectMatch(hidden.state, { kind: 'spectator' }, identities).zones[
        boardId
      ]!.cards[0]
    ).toMatchObject({ kind: 'concealed', publiclyRevealed: false });
    const revealed = accepted(
      hidden.state,
      {
        type: 'SetPublicReveal',
        playerId: p1,
        cardId,
        expectedSourceId: boardId,
        revealed: true,
      },
      prepared.context
    );
    expect(revealed.state.cards[cardId]!.face).toBe('up');
    expect(revealed.state.visibility.publicCardIds).toContain(cardId);
    const generation = revealed.state.cards[cardId]!.visibilityGeneration;
    const turnedDown = accepted(
      revealed.state,
      { type: 'SetCardFace', cardId, face: 'down' },
      prepared.context
    );
    expect(turnedDown.state.visibility.publicCardIds).not.toContain(cardId);
    expect(turnedDown.state.cards[cardId]).toMatchObject({
      face: 'down',
      visibilityGeneration: generation + 1,
    });
    assertMatchInvariants(turnedDown.state);
  });

  it('rejects stale, duplicate, unsupported, empty, and no-op requests immutably', () => {
    const prepared = fixture();
    const before = stableSerialize(prepared.state);
    const prizeId = playerZoneId(p1, 'prizes');
    const prizeCards = [...prepared.state.zones[prizeId]!.cardIds];
    const rejectedCommands: GameCommand[] = [
      {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: prizeId,
        expectedCardIds: [...prizeCards].reverse(),
        revealed: true,
      },
      {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: prizeId,
        expectedCardIds: [prizeCards[0]!, prizeCards[0]!],
        revealed: true,
      },
      {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: playerZoneId(p1, 'hand'),
        expectedCardIds:
          prepared.state.zones[playerZoneId(p1, 'hand')]!.cardIds,
        revealed: true,
      },
      {
        type: 'SetPublicReveal',
        playerId: p2,
        cardId: prizeCards[0]!,
        expectedSourceId: prizeId,
        revealed: true,
      },
      {
        type: 'SetPublicReveal',
        playerId: p1,
        cardId: prizeCards[0]!,
        expectedSourceId: playerZoneId(p1, 'deck'),
        revealed: true,
      },
    ];
    for (const command of rejectedCommands) {
      expect(
        executeCommand(prepared.state, command, prepared.context).accepted
      ).toBe(false);
      expect(stableSerialize(prepared.state)).toBe(before);
    }

    const revealed = accepted(
      prepared.state,
      {
        type: 'SetZonePublicReveal',
        playerId: p1,
        zoneId: prizeId,
        expectedCardIds: prizeCards,
        revealed: true,
      },
      prepared.context
    );
    expect(
      executeCommand(
        revealed.state,
        {
          type: 'SetZonePublicReveal',
          playerId: p1,
          zoneId: prizeId,
          expectedCardIds: prizeCards,
          revealed: true,
        },
        prepared.context
      ).accepted
    ).toBe(false);
  });

  it('rejects malformed replay facts before mutating the input', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const prizeCards = [...prepared.state.zones[prizeId]!.cardIds];
    const before = stableSerialize(prepared.state);
    expect(() =>
      applyEventBatch(prepared.state, {
        revision: prepared.state.revision + 1,
        events: [
          {
            type: 'PublicRevealSet',
            playerId: p1,
            expectedSourceId: prizeId,
            expectedSourceCardIds: [...prizeCards].reverse(),
            cardIds: [prizeCards[0]!],
            revealed: true,
          },
        ],
      })
    ).toThrow('Public visibility event source is malformed');
    expect(stableSerialize(prepared.state)).toBe(before);
  });
});
