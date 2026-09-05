import { describe, expect, it } from 'vitest';

import { applyEvent, applyEventBatch } from './apply-events.js';
import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import type { EventBatch } from './events.js';
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

const p1 = asPlayerId('hardening-player-one');
const p2 = asPlayerId('hardening-player-two');

const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
    asViewCardId(
      `${viewerKey}:${known ? 'known' : 'hidden'}:${visibilityGeneration}:${cardId}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(`${viewerKey}:${definitionId}`),
};

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`hardening-card-${++card}`),
    nextStackId: () => asStackId(`hardening-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`hardening-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`hardening-work-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from(
  { length: 24 },
  (_, index) => ({
    definition: {
      id: asCardDefinitionId(`hardening-definition-${index}`),
      name: `Hardening card ${index}`,
      category: (['Pokémon', 'Trainer', 'Energy'] as const)[index % 3]!,
      imageUrl: `/hardening-${index}.png`,
    },
    count: 1,
  })
);

const acceptedResult = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
) => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result;
};

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => acceptedResult(state, command, context).state;

const fixture = () => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('movement-visibility-hardening'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(state, { type: 'LoadDeck', playerId: p1, entries }, context);
  state = accepted(state, { type: 'SetupPlayer', playerId: p1 }, context);
  return { state, context };
};

const withToggledConcealment = (
  batch: EventBatch,
  eventType:
    | 'CardMoved'
    | 'CardMovedFromStack'
    | 'PlayStackDeparted'
    | 'InspectedCardMoved'
    | 'StagedCardMoved'
    | 'InspectionClosed'
): EventBatch => ({
  ...batch,
  events: batch.events.map((event) =>
    event.type === eventType
      ? { ...event, concealIdentity: !event.concealIdentity }
      : event
  ),
});

const expectForgedConcealmentRejected = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext,
  eventType: Parameters<typeof withToggledConcealment>[1]
): MatchState => {
  const result = acceptedResult(state, command, context);
  expect(() =>
    applyEventBatch(state, withToggledConcealment(result.batch, eventType))
  ).toThrow(/conceal|destination semantics|valid destination/u);
  expect(stableSerialize(applyEventBatch(state, result.batch))).toBe(
    stableSerialize(result.state)
  );
  return result.state;
};

describe('movement visibility hardening', () => {
  it.each([
    'move-zone-contents',
    'move-card-to-deck-top',
    'move-card-to-deck-bottom',
    'move-prizes-to-deck-bottom',
    'shuffle-zone-into-deck',
    'shuffle-zone-to-deck-bottom',
    'discard-hand-and-draw',
    'shuffle-hand-into-deck-and-draw',
    'shuffle-hand-to-deck-bottom-and-draw',
  ] as const)('derives exact concealment and one rotation for %s', (reason) => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const command: GameCommand = (() => {
      switch (reason) {
        case 'move-zone-contents':
          return {
            type: 'MoveZoneContents',
            sourceZoneId: handId,
            destinationZoneId: deckId,
          };
        case 'move-card-to-deck-top':
          return {
            type: 'MoveCardToDeckTop',
            playerId: p1,
            cardId: prepared.state.zones[deckId]!.cardIds.at(-1)!,
            expectedSourceId: deckId,
          };
        case 'move-card-to-deck-bottom':
          return {
            type: 'MoveCardToDeckBottom',
            playerId: p1,
            cardId: prepared.state.zones[deckId]!.cardIds[0]!,
            expectedSourceId: deckId,
          };
        case 'move-prizes-to-deck-bottom':
          return { type: 'MovePrizesToDeckBottom', playerId: p1 };
        case 'shuffle-zone-into-deck':
          return {
            type: 'ShuffleZoneIntoDeck',
            playerId: p1,
            sourceZoneId: handId,
          };
        case 'shuffle-zone-to-deck-bottom':
          return {
            type: 'ShuffleZoneToDeckBottom',
            playerId: p1,
            sourceZoneId: handId,
          };
        case 'discard-hand-and-draw':
          return { type: 'DiscardHandAndDraw', playerId: p1, count: 2 };
        case 'shuffle-hand-into-deck-and-draw':
          return {
            type: 'ShuffleHandIntoDeckAndDraw',
            playerId: p1,
            count: 2,
          };
        case 'shuffle-hand-to-deck-bottom-and-draw':
          return {
            type: 'ShuffleHandToDeckBottomAndDraw',
            playerId: p1,
            count: 2,
          };
      }
    })();
    const result = acceptedResult(prepared.state, command, prepared.context);
    const zoneEvent = result.batch.events.find(
      (event) => event.type === 'ZoneOrdersSet'
    );
    if (!zoneEvent || zoneEvent.concealedCardIds.length === 0) {
      throw new Error(`Missing ${reason} zone-order concealment`);
    }
    expect(zoneEvent.reason).toBe(reason);
    const concealed = new Set(zoneEvent.concealedCardIds);
    for (const card of Object.values(prepared.state.cards)) {
      expect(result.state.cards[card.id]!.visibilityGeneration).toBe(
        card.visibilityGeneration + (concealed.has(card.id) ? 1 : 0)
      );
    }
    const missing = {
      ...result.batch,
      events: result.batch.events.map((event) =>
        event.type === 'ZoneOrdersSet'
          ? {
              ...event,
              concealedCardIds: event.concealedCardIds.slice(1),
            }
          : event
      ),
    } satisfies EventBatch;
    const duplicated = {
      ...result.batch,
      events: result.batch.events.map((event) =>
        event.type === 'ZoneOrdersSet'
          ? {
              ...event,
              concealedCardIds: [
                ...event.concealedCardIds,
                event.concealedCardIds[0]!,
              ],
            }
          : event
      ),
    } satisfies EventBatch;
    expect(() => applyEventBatch(prepared.state, missing)).toThrow(
      /concealed cards/u
    );
    expect(() => applyEventBatch(prepared.state, duplicated)).toThrow(
      /concealed cards/u
    );
    assertMatchInvariants(result.state);
  });

  it('retires shuffled pools while preserving grants outside ordinary movement', () => {
    const prepared = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const handId = playerZoneId(p1, 'hand');
    const deckCardId = prepared.state.zones[deckId]!.cardIds[0]!;
    const handCardId = prepared.state.zones[handId]!.cardIds[0]!;
    const withGrants: MatchState = {
      ...prepared.state,
      visibility: {
        ...prepared.state.visibility,
        inspectionGrants: {
          'shuffle-deck-grant': {
            inspectionId: asInspectionId('shuffle-deck-grant'),
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: deckId,
            cardIds: [deckCardId],
            viewerIds: [p2],
          },
          'destination-deck-grant': {
            inspectionId: asInspectionId('destination-deck-grant'),
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: deckId,
            cardIds: [prepared.state.zones[deckId]!.cardIds[1]!],
            viewerIds: [p2],
          },
          'source-hand-grant': {
            inspectionId: asInspectionId('source-hand-grant'),
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: handId,
            cardIds: [handCardId],
            viewerIds: [p2],
          },
        },
      },
    };
    const shuffled = accepted(
      withGrants,
      { type: 'ShuffleZone', zoneId: deckId },
      prepared.context
    );
    expect(Object.keys(shuffled.visibility.inspectionGrants)).toEqual([
      'source-hand-grant',
    ]);

    const movedWithGrants: MatchState = {
      ...prepared.state,
      visibility: {
        ...prepared.state.visibility,
        inspectionGrants: withGrants.visibility.inspectionGrants,
      },
    };
    const moved = accepted(
      movedWithGrants,
      {
        type: 'MoveZoneContents',
        sourceZoneId: handId,
        destinationZoneId: deckId,
      },
      prepared.context
    );
    expect(Object.keys(moved.visibility.inspectionGrants).sort()).toEqual([
      'destination-deck-grant',
      'shuffle-deck-grant',
    ]);

    const shuffledTogether = accepted(
      movedWithGrants,
      {
        type: 'ShuffleZoneIntoDeck',
        playerId: p1,
        sourceZoneId: handId,
      },
      prepared.context
    );
    expect(shuffledTogether.visibility.inspectionGrants).toEqual({});
  });

  it('normalizes same-deck edge moves and old-hand cards redrawn after shuffling', () => {
    const prepared = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const handId = playerZoneId(p1, 'hand');
    const deckCardId = prepared.state.zones[deckId]!.cardIds[0]!;
    const deckCard = prepared.state.cards[deckCardId]!;
    const annotatedDeckState: MatchState = {
      ...prepared.state,
      cards: {
        ...prepared.state.cards,
        [deckCardId]: {
          ...deckCard,
          currentCategory:
            deckCard.originalCategory === 'Energy' ? 'Trainer' : 'Energy',
          face: 'down',
          orientationQuarterTurns: 3,
          abilityUsed: true,
        },
      },
    };
    const movedToBottomBatch = acceptedResult(
      prepared.state,
      {
        type: 'MoveCardToDeckBottom',
        playerId: p1,
        cardId: deckCardId,
        expectedSourceId: deckId,
      },
      prepared.context
    ).batch;
    const movedToBottom = applyEventBatch(
      annotatedDeckState,
      movedToBottomBatch
    );
    expect(movedToBottom.cards[deckCardId]).toMatchObject({
      currentCategory: deckCard.originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });

    const oldHandCardId = prepared.state.zones[handId]!.cardIds.at(-1)!;
    const oldHandCard = prepared.state.cards[oldHandCardId]!;
    const annotatedHandState: MatchState = {
      ...prepared.state,
      cards: {
        ...prepared.state.cards,
        [oldHandCardId]: {
          ...oldHandCard,
          currentCategory:
            oldHandCard.originalCategory === 'Energy' ? 'Trainer' : 'Energy',
          face: 'down',
          orientationQuarterTurns: 2,
          abilityUsed: true,
        },
      },
    };
    const redrawnBatch = acceptedResult(
      prepared.state,
      { type: 'ShuffleHandIntoDeckAndDraw', playerId: p1, count: 1 },
      prepared.context
    ).batch;
    const redrawn = applyEventBatch(annotatedHandState, redrawnBatch);
    expect(redrawn.zones[handId]!.cardIds).toEqual([oldHandCardId]);
    expect(redrawn.cards[oldHandCardId]).toMatchObject({
      currentCategory: oldHandCard.originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    assertMatchInvariants(movedToBottom);
    assertMatchInvariants(redrawn);
  });

  it('retires prior card visibility when a card enters play or an inspection work area', () => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const handCardId = prepared.state.zones[handId]!.cardIds[0]!;
    let playState = accepted(
      prepared.state,
      {
        type: 'SetPublicReveal',
        actorPlayerId: p1,
        playerId: p1,
        cardId: handCardId,
        expectedSourceId: handId,
        revealed: true,
      },
      prepared.context
    );
    playState = {
      ...playState,
      visibility: {
        ...playState.visibility,
        inspectionGrants: {
          'play-grant': {
            inspectionId: asInspectionId('play-grant'),
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: handId,
            cardIds: [handCardId],
            viewerIds: [p2],
          },
        },
      },
    };
    const played = accepted(
      playState,
      {
        type: 'MoveCardToPlay',
        cardId: handCardId,
        expectedSourceZoneId: handId,
        boardPlayerId: p1,
        slot: 'active',
      },
      prepared.context
    );
    expect(played.visibility.publicCardIds).not.toContain(handCardId);
    expect(played.visibility.inspectionGrants).toEqual({});

    const deckCardId = prepared.state.zones[deckId]!.cardIds[0]!;
    let inspectionState = accepted(
      prepared.state,
      {
        type: 'SetPublicReveal',
        actorPlayerId: p1,
        playerId: p1,
        cardId: deckCardId,
        expectedSourceId: deckId,
        revealed: true,
      },
      prepared.context
    );
    inspectionState = {
      ...inspectionState,
      visibility: {
        ...inspectionState.visibility,
        inspectionGrants: {
          'inspection-open-grant': {
            inspectionId: asInspectionId('inspection-open-grant'),
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: deckId,
            cardIds: [deckCardId],
            viewerIds: [p2],
          },
        },
      },
    };
    const inspected = accepted(
      inspectionState,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'top',
      },
      prepared.context
    );
    expect(inspected.visibility.publicCardIds).not.toContain(deckCardId);
    expect(inspected.visibility.inspectionGrants).toEqual({});
    assertMatchInvariants(inspected);
  });

  it('normalizes and retires public metadata for an attachment orphaned by reset', () => {
    const prepared = fixture();
    let state = accepted(
      prepared.state,
      { type: 'LoadDeck', playerId: p2, entries },
      prepared.context
    );
    state = accepted(
      state,
      { type: 'SetupPlayer', playerId: p2 },
      prepared.context
    );
    const p1HandId = playerZoneId(p1, 'hand');
    const p2HandId = playerZoneId(p2, 'hand');
    const p1BaseId = state.zones[p1HandId]!.cardIds.find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    const p2AttachmentId = state.zones[p2HandId]!.cardIds.find(
      (cardId) => state.cards[cardId]!.currentCategory !== 'Pokémon'
    )!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: p1BaseId,
        expectedSourceZoneId: p1HandId,
        boardPlayerId: p2,
        slot: 'active',
      },
      prepared.context
    );
    const stackId = state.boards[p2]!.activeStackId!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: p2AttachmentId,
        expectedSourceZoneId: p2HandId,
        boardPlayerId: p2,
        slot: 'active',
        targetStackId: stackId,
      },
      prepared.context
    );
    state = accepted(
      state,
      {
        type: 'SetCardOrientation',
        cardId: p2AttachmentId,
        orientationQuarterTurns: 2,
      },
      prepared.context
    );
    state = accepted(
      state,
      { type: 'SetCardAbilityUsed', cardId: p2AttachmentId, used: true },
      prepared.context
    );
    state = accepted(
      state,
      {
        type: 'SetPublicReveal',
        actorPlayerId: p2,
        playerId: p2,
        cardId: p2AttachmentId,
        expectedSourceId: stackId,
        revealed: true,
      },
      prepared.context
    );

    const reset = accepted(
      state,
      { type: 'ResetPlayer', playerId: p1 },
      prepared.context
    );

    expect(reset.zones[playerZoneId(p2, 'discard')]!.cardIds).toContain(
      p2AttachmentId
    );
    expect(reset.cards[p2AttachmentId]).toMatchObject({
      currentCategory: reset.cards[p2AttachmentId]!.originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    expect(reset.visibility.publicCardIds).not.toContain(p2AttachmentId);
    assertMatchInvariants(reset);
  });

  it.each(['DrawCards', 'StartTurn'] as const)(
    '%s retires public reveal and only the drawn-card grant with one identity rotation',
    (type) => {
      const prepared = fixture();
      const deckId = playerZoneId(p1, 'deck');
      const handId = playerZoneId(p1, 'hand');
      const [drawnCardId, untouchedDeckCardId] =
        prepared.state.zones[deckId]!.cardIds;
      const untouchedHandCardId = prepared.state.zones[handId]!.cardIds[0]!;
      let state = accepted(
        prepared.state,
        {
          type: 'SetPublicReveal',
          actorPlayerId: p1,
          playerId: p1,
          cardId: drawnCardId!,
          expectedSourceId: deckId,
          revealed: true,
        },
        prepared.context
      );
      state = accepted(
        state,
        {
          type: 'SetCardCategory',
          cardId: drawnCardId!,
          category: 'Energy',
        },
        prepared.context
      );
      state = {
        ...state,
        visibility: {
          ...state.visibility,
          inspectionGrants: Object.fromEntries(
            [
              ['drawn', drawnCardId!, deckId],
              ['deck', untouchedDeckCardId!, deckId],
              ['hand', untouchedHandCardId, handId],
            ].map(([suffix, cardId, sourceId]) => [
              `hardening-grant-${suffix}`,
              {
                inspectionId: asInspectionId(`hardening-grant-${suffix}`),
                scope: 'card' as const,
                sourcePlayerId: p1,
                sourceId,
                cardIds: [cardId],
                viewerIds: [p2],
              },
            ])
          ),
        },
      };
      const beforeGenerations = Object.fromEntries(
        Object.values(state.cards).map((card) => [
          card.id,
          card.visibilityGeneration,
        ])
      );
      const command: GameCommand =
        type === 'DrawCards'
          ? { type, playerId: p1, count: 1 }
          : { type, playerId: p1 };

      const next = accepted(state, command, prepared.context);

      expect(next.visibility.publicCardIds).not.toContain(drawnCardId);
      expect(Object.keys(next.visibility.inspectionGrants).sort()).toEqual([
        'hardening-grant-deck',
        'hardening-grant-hand',
      ]);
      expect(next.cards[drawnCardId!]).toMatchObject({
        currentCategory: next.cards[drawnCardId!]!.originalCategory,
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
        visibilityGeneration: beforeGenerations[drawnCardId!]! + 1,
      });
      for (const cardId of [untouchedDeckCardId!, untouchedHandCardId]) {
        expect(next.cards[cardId]!.visibilityGeneration).toBe(
          beforeGenerations[cardId]
        );
      }
      assertMatchInvariants(next);
    }
  );

  it('rotates only face-down aliases when a mixed loose board is shuffled', () => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const boardId = playerZoneId(p1, 'board');
    const cardIds = prepared.state.zones[handId]!.cardIds.slice(0, 3);
    let state = prepared.state;
    for (const cardId of cardIds) {
      state = accepted(
        state,
        {
          type: 'MoveCard',
          cardId,
          expectedSourceZoneId: handId,
          destinationZoneId: boardId,
        },
        prepared.context
      );
    }
    for (const cardId of cardIds.slice(0, 2)) {
      state = accepted(
        state,
        { type: 'SetCardFace', cardId, face: 'down' },
        prepared.context
      );
    }
    const before = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const beforeCards = before.zones[boardId]!.cards;
    const hiddenAliases = beforeCards
      .filter((card) => card.kind === 'concealed')
      .map((card) => card.id);
    const publicCard = beforeCards.find((card) => card.kind === 'known')!;
    const generations = Object.fromEntries(
      cardIds.map((cardId) => [
        cardId,
        state.cards[cardId]!.visibilityGeneration,
      ])
    );

    const shuffled = accepted(
      state,
      { type: 'ShuffleZone', zoneId: boardId },
      prepared.context
    );
    const after = projectMatch(
      shuffled,
      { kind: 'player', playerId: p2 },
      identities
    );
    const afterCards = after.zones[boardId]!.cards;

    expect(
      cardIds.slice(0, 2).map((cardId) => shuffled.cards[cardId]!.face)
    ).toEqual(['down', 'down']);
    for (const cardId of cardIds.slice(0, 2)) {
      expect(shuffled.cards[cardId]!.visibilityGeneration).toBe(
        generations[cardId]! + 1
      );
    }
    expect(shuffled.cards[cardIds[2]!]!.visibilityGeneration).toBe(
      generations[cardIds[2]!]!
    );
    const afterAliases = afterCards.map((card) => card.id);
    for (const oldAlias of hiddenAliases)
      expect(afterAliases).not.toContain(oldAlias);
    expect(afterAliases).toContain(publicCard.id);
    assertMatchInvariants(shuffled);
  });

  it('rejects forged concealment across every ordinary departure family', () => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const firstCard = prepared.state.zones[handId]!.cardIds[0]!;
    expectForgedConcealmentRejected(
      prepared.state,
      {
        type: 'MoveCard',
        cardId: firstCard,
        expectedSourceZoneId: handId,
        destinationZoneId: deckId,
      },
      prepared.context,
      'CardMoved'
    );

    let state = prepared.state;
    const knownHandCards = () => state.zones[handId]!.cardIds;
    const base = knownHandCards().find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: base,
        expectedSourceZoneId: handId,
        boardPlayerId: p1,
        slot: 'active',
      },
      prepared.context
    );
    const stackId = state.boards[p1]!.activeStackId!;
    const attachment = knownHandCards().find(
      (cardId) => state.cards[cardId]!.currentCategory !== 'Pokémon'
    )!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: attachment,
        expectedSourceZoneId: handId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      prepared.context
    );
    expectForgedConcealmentRejected(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: attachment,
        expectedStackId: stackId,
        destinationZoneId: handId,
      },
      prepared.context,
      'CardMovedFromStack'
    );

    const evolution = knownHandCards().find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: evolution,
        expectedSourceZoneId: handId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      prepared.context
    );
    const departed = acceptedResult(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: evolution,
        expectedStackId: stackId,
        destinationZoneId: handId,
      },
      prepared.context
    );
    expect(() =>
      applyEventBatch(
        state,
        withToggledConcealment(departed.batch, 'PlayStackDeparted')
      )
    ).toThrow(/destination semantics/u);
    state = departed.state;
    const staged = state.workAreas[p1]!.attachmentResolution!;
    expectForgedConcealmentRejected(
      state,
      {
        type: 'MoveStagedCard',
        playerId: p1,
        cardId: staged.evolutionCardIds[0]!,
        expectedWorkAreaId: staged.id,
        destinationZoneId: handId,
      },
      prepared.context,
      'StagedCardMoved'
    );

    const inspectionState = accepted(
      prepared.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      prepared.context
    );
    const inspection = inspectionState.workAreas[p1]!.inspection!;
    expectForgedConcealmentRejected(
      inspectionState,
      {
        type: 'MoveInspectedCard',
        playerId: p1,
        cardId: inspection.cardIds[0]!,
        expectedWorkAreaId: inspection.id,
        destinationZoneId: handId,
      },
      prepared.context,
      'InspectedCardMoved'
    );
    expectForgedConcealmentRejected(
      inspectionState,
      {
        type: 'CloseInspection',
        playerId: p1,
        inspectionId: inspection.inspectionId,
        returnTo: 'bottom',
      },
      prepared.context,
      'InspectionClosed'
    );
  });

  it('allows deferred shuffle concealment exactly once and rejects either incomplete half', () => {
    const prepared = fixture();
    const handId = playerZoneId(p1, 'hand');
    const cardId = prepared.state.zones[handId]!.cardIds[0]!;
    const result = acceptedResult(
      prepared.state,
      {
        type: 'ShuffleCardIntoDeck',
        playerId: p1,
        cardId,
        expectedSourceId: handId,
      },
      prepared.context
    );
    const generation = prepared.state.cards[cardId]!.visibilityGeneration;
    expect(result.state.cards[cardId]!.visibilityGeneration).toBe(
      generation + 1
    );
    const [moveEvent, shuffleEvent] = result.batch.events;
    if (
      moveEvent?.type !== 'CardMoved' ||
      shuffleEvent?.type !== 'ZoneShuffled'
    ) {
      throw new Error('Missing deferred shuffle event pair');
    }
    expect(() => applyEvent(prepared.state, moveEvent)).toThrow(
      /destination semantics/u
    );
    expect(() =>
      applyEventBatch(prepared.state, {
        ...result.batch,
        events: result.batch.events.slice(0, 1),
      })
    ).toThrow(/destination semantics/u);
    expect(() =>
      applyEventBatch(prepared.state, {
        ...result.batch,
        events: result.batch.events.map((event) =>
          event.type === 'CardMoved'
            ? { ...event, concealIdentity: true }
            : event
        ),
      })
    ).toThrow(/destination semantics/u);
    expect(() =>
      applyEventBatch(prepared.state, {
        ...result.batch,
        events: [shuffleEvent, moveEvent],
      })
    ).toThrow(/permutation|card set/u);
    expect(() =>
      applyEventBatch(prepared.state, {
        ...result.batch,
        events: [moveEvent, { ...shuffleEvent, zoneId: handId }],
      })
    ).toThrow(/destination semantics/u);
    expect(() =>
      applyEventBatch(prepared.state, {
        ...result.batch,
        events: [
          moveEvent,
          {
            ...shuffleEvent,
            concealedCardIds: shuffleEvent.concealedCardIds.filter(
              (concealedCardId) => concealedCardId !== cardId
            ),
          },
        ],
      })
    ).toThrow(/destination semantics/u);
    expect(() =>
      applyEventBatch(prepared.state, {
        ...result.batch,
        events: [
          moveEvent,
          { ...shuffleEvent, cardOrder: shuffleEvent.cardOrder.slice(1) },
        ],
      })
    ).toThrow(/permutation|card set/u);
  });
});
