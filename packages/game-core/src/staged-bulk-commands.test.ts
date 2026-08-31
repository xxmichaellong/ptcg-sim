import { describe, expect, it } from 'vitest';

import type {
  CommandContext,
  DeckEntry,
  GameCommand,
  StagedCardsDestination,
} from './commands.js';
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
  type CardInstanceId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';
import { stableSerialize } from './stable-hash.js';

const p1 = asPlayerId('bulk-player-one');
const p2 = asPlayerId('bulk-player-two');

const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
    asViewCardId(
      `${viewerKey}:${known ? 'known' : 'concealed'}:${visibilityGeneration}:${cardId}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(`${viewerKey}:${definitionId}`),
};

const createContext = (
  shuffle: CommandContext['shuffle'] = (values) => [...values].reverse()
): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`bulk-card-${++card}`),
    nextStackId: () => asStackId(`bulk-stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`bulk-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`bulk-work-${++workArea}`),
    shuffle,
    randomInt: () => 0,
  };
};

const entries = (
  prefix: string,
  ...categories: readonly ('Pokémon' | 'Trainer' | 'Energy')[]
): readonly DeckEntry[] =>
  categories.map((category, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} ${category} ${index}`,
      category,
      imageUrl: `/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const prepareStagedCards = (
  shuffle?: CommandContext['shuffle'],
  crossOwnerDeckCount = 1
): {
  readonly state: MatchState;
  readonly context: CommandContext;
  readonly workAreaId: ReturnType<typeof asWorkAreaId>;
  readonly stagedCardIds: readonly CardInstanceId[];
  readonly crossOwnerCardId: CardInstanceId;
  readonly normalizedTrainerId: CardInstanceId;
} => {
  const context = createContext(shuffle);
  let state = createEmptyMatch(asMatchId('bulk-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    {
      type: 'LoadDeck',
      playerId: p1,
      entries: entries(
        'blue',
        'Pokémon',
        'Pokémon',
        'Pokémon',
        'Trainer',
        'Energy',
        'Trainer'
      ),
    },
    context
  );
  state = accepted(
    state,
    {
      type: 'LoadDeck',
      playerId: p2,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('red-cross-owner-definition'),
            name: 'Red cross-owner Trainer',
            category: 'Trainer',
            imageUrl: '/red-cross-owner.png',
          },
          count: crossOwnerDeckCount,
        },
      ],
    },
    context
  );
  const blueDeckId = playerZoneId(p1, 'deck');
  const redDeckId = playerZoneId(p2, 'deck');
  const [baseId, middleId, topId, trainerId, energyId] =
    state.zones[blueDeckId]!.cardIds;
  const crossOwnerCardId = state.zones[redDeckId]!.cardIds[0]!;
  state = accepted(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: baseId!,
      expectedSourceZoneId: blueDeckId,
      boardPlayerId: p1,
      slot: 'active',
    },
    context
  );
  const stackId = state.boards[p1]!.activeStackId!;
  for (const [cardId, sourceZoneId] of [
    [middleId!, blueDeckId],
    [topId!, blueDeckId],
    [trainerId!, blueDeckId],
    [energyId!, blueDeckId],
    [crossOwnerCardId, redDeckId],
  ] as const) {
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: sourceZoneId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      context
    );
  }
  state = accepted(
    state,
    {
      type: 'SetCardCategory',
      cardId: trainerId!,
      category: 'Energy',
    },
    context
  );
  state = accepted(
    state,
    { type: 'SetCardFace', cardId: trainerId!, face: 'down' },
    context
  );
  state = accepted(
    state,
    {
      type: 'MoveCardFromStack',
      cardId: topId!,
      expectedStackId: stackId,
      destinationZoneId: playerZoneId(p1, 'discard'),
    },
    context
  );
  const resolution = state.workAreas[p1]!.attachmentResolution!;
  return {
    state,
    context,
    workAreaId: resolution.id,
    stagedCardIds: [
      ...resolution.evolutionCardIds,
      ...resolution.attachmentCardIds,
    ],
    crossOwnerCardId,
    normalizedTrainerId: trainerId!,
  };
};

const resolve = (
  prepared: ReturnType<typeof prepareStagedCards>,
  destination: StagedCardsDestination
) =>
  executeCommand(
    prepared.state,
    {
      type: 'ResolveStagedCards',
      playerId: p1,
      expectedWorkAreaId: prepared.workAreaId,
      destination,
    },
    prepared.context
  );

describe('atomic staged-card bulk resolution', () => {
  it.each([
    ['discard', 'discard'],
    ['lostZone', 'lostZone'],
  ] as const)(
    'appends ordered cards to %s and preserves immutable ownership',
    (destination, zoneKind) => {
      const prepared = prepareStagedCards();
      const zoneId = playerZoneId(p1, zoneKind);
      const before = prepared.state.zones[zoneId]!.cardIds;
      const result = resolve(prepared, destination);
      if (!result.accepted) throw new Error(result.message);
      expect(result.state.zones[zoneId]?.cardIds).toEqual([
        ...before,
        ...prepared.stagedCardIds,
      ]);
      expect(result.state.workAreas[p1]?.attachmentResolution).toBeNull();
      expect(result.state.cards[prepared.crossOwnerCardId]?.ownerId).toBe(p2);
      expect(
        result.state.zones[zoneId]?.cardIds.includes(prepared.crossOwnerCardId)
      ).toBe(true);
      expect(result.state.cards[prepared.normalizedTrainerId]).toMatchObject({
        currentCategory: 'Trainer',
        face: 'up',
      });
      assertMatchInvariants(result.state);
    }
  );

  it('moves all staged cards to hand and conceals them from the opponent', () => {
    const prepared = prepareStagedCards();
    const generations = new Map(
      prepared.stagedCardIds.map((cardId) => [
        cardId,
        prepared.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const result = resolve(prepared, 'hand');
    if (!result.accepted) throw new Error(result.message);
    const handId = playerZoneId(p1, 'hand');
    expect(result.state.zones[handId]?.cardIds).toEqual(prepared.stagedCardIds);
    for (const cardId of prepared.stagedCardIds) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
        generations.get(cardId)! + 1
      );
    }
    const ownerView = projectMatch(
      result.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    const opponentView = projectMatch(
      result.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(
      ownerView.zones[handId]?.cards.every((card) => card.kind === 'known')
    ).toBe(true);
    expect(
      opponentView.zones[handId]?.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    assertMatchInvariants(result.state);
  });

  it('shuffles the complete combined deck and rotates every concealed identity', () => {
    const prepared = prepareStagedCards();
    const deckId = playerZoneId(p1, 'deck');
    const oldDeck = [...prepared.state.zones[deckId]!.cardIds];
    const beforeGenerations = new Map(
      [...oldDeck, ...prepared.stagedCardIds].map((cardId) => [
        cardId,
        prepared.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const result = resolve(prepared, 'shuffleIntoDeck');
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[deckId]?.cardIds).toEqual(
      [...oldDeck, ...prepared.stagedCardIds].reverse()
    );
    for (const cardId of [...oldDeck, ...prepared.stagedCardIds]) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
        beforeGenerations.get(cardId)! + 1
      );
    }
    assertMatchInvariants(result.state);
  });

  it('shuffles only staged cards onto the bottom without rotating the old deck', () => {
    const prepared = prepareStagedCards();
    const deckId = playerZoneId(p1, 'deck');
    const oldDeck = [...prepared.state.zones[deckId]!.cardIds];
    const oldDeckGenerations = oldDeck.map(
      (cardId) => prepared.state.cards[cardId]!.visibilityGeneration
    );
    const result = resolve(prepared, 'shuffleToDeckBottom');
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[deckId]?.cardIds).toEqual([
      ...oldDeck,
      ...[...prepared.stagedCardIds].reverse(),
    ]);
    expect(
      oldDeck.map((cardId) => result.state.cards[cardId]!.visibilityGeneration)
    ).toEqual(oldDeckGenerations);
    for (const cardId of prepared.stagedCardIds) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
        prepared.state.cards[cardId]!.visibilityGeneration + 1
      );
    }
    assertMatchInvariants(result.state);
  });

  it('rejects stale work areas and invalid shuffle adapters without mutation', () => {
    const prepared = prepareStagedCards();
    const before = stableSerialize(prepared.state);
    expect(
      executeCommand(
        prepared.state,
        {
          type: 'ResolveStagedCards',
          playerId: p1,
          expectedWorkAreaId: asWorkAreaId('stale-work-area'),
          destination: 'discard',
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(stableSerialize(prepared.state)).toBe(before);

    const invalidShuffle = prepareStagedCards((values) => values.slice(1));
    const invalidBefore = stableSerialize(invalidShuffle.state);
    expect(resolve(invalidShuffle, 'shuffleIntoDeck')).toMatchObject({
      accepted: false,
      code: 'invalid_command',
    });
    expect(stableSerialize(invalidShuffle.state)).toBe(invalidBefore);
  });

  it('rejects a bulk result that would exceed the bounded wire zone size', () => {
    const prepared = prepareStagedCards(undefined, 200);
    const redDeckId = playerZoneId(p2, 'deck');
    const handId = playerZoneId(p1, 'hand');
    const extraCards = prepared.state.zones[redDeckId]!.cardIds.slice(0, 196);
    const state: MatchState = {
      ...prepared.state,
      zones: {
        ...prepared.state.zones,
        [redDeckId]: {
          ...prepared.state.zones[redDeckId]!,
          cardIds: prepared.state.zones[redDeckId]!.cardIds.slice(196),
        },
        [handId]: {
          ...prepared.state.zones[handId]!,
          cardIds: extraCards,
        },
      },
    };
    assertMatchInvariants(state);
    const before = stableSerialize(state);
    expect(
      executeCommand(
        state,
        {
          type: 'ResolveStagedCards',
          playerId: p1,
          expectedWorkAreaId: prepared.workAreaId,
          destination: 'hand',
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(stableSerialize(state)).toBe(before);
  });
});
