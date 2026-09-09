import { describe, expect, it } from 'vitest';

import { applyEventBatch } from './apply-events.js';
import { cloneMatchState } from './clone.js';
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

const p1 = asPlayerId('inspection-blue');
const p2 = asPlayerId('inspection-red');

const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
    asViewCardId(
      `inspection-view:${viewerKey}:${known ? 'known' : 'hidden'}:${visibilityGeneration}:${cardId}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(`inspection-definition:${viewerKey}:${definitionId}`),
};

const createContext = (): CommandContext => {
  let card = 0;
  let inspection = 0;
  return {
    nextCardId: () => asCardInstanceId(`inspection-card-${++card}`),
    nextStackId: () => asStackId('inspection-stack'),
    nextInspectionId: () => asInspectionId(`inspection-grant-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId('inspection-work-area'),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries = (prefix: string, count = 14): readonly DeckEntry[] => [
  {
    definition: {
      id: asCardDefinitionId(`${prefix}-inspection-definition`),
      name: `${prefix} inspection card`,
      category: 'Pokémon',
      imageUrl: `/${prefix}-inspection.png`,
    },
    count,
  },
];

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
  let state = createEmptyMatch(asMatchId('private-inspection-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue') },
    context
  ).state;
  state = accepted(state, { type: 'SetupPlayer', playerId: p1 }, context).state;
  return { state, context };
};

describe('private inspection grants', () => {
  it('opens and closes an exact prize-zone grant for only the viewer', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const prizeCards = [...prepared.state.zones[prizeId]!.cardIds];
    const before = projectMatch(
      prepared.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    expect(
      before.zones[prizeId]!.cards.every((card) => card.kind === 'concealed')
    ).toBe(true);

    const opened = accepted(
      prepared.state,
      {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p1,
        sourceZoneId: prizeId,
        expectedCardIds: prizeCards,
      },
      prepared.context
    );
    const event = opened.batch.events[0];
    expect(event).toEqual({
      type: 'InspectionGrantOpened',
      scope: 'zone',
      inspectionId: asInspectionId('inspection-grant-1'),
      sourcePlayerId: p1,
      sourceId: prizeId,
      expectedSourceCardIds: prizeCards,
      cardIds: prizeCards,
      viewerIds: [p1],
    });
    expect(stableSerialize(applyEventBatch(prepared.state, opened.batch))).toBe(
      stableSerialize(opened.state)
    );
    const ownerView = projectMatch(
      opened.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    const opponentView = projectMatch(
      opened.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const spectatorView = projectMatch(
      opened.state,
      { kind: 'spectator' },
      identities
    );
    expect(
      ownerView.zones[prizeId]!.cards.every((card) => card.kind === 'known')
    ).toBe(true);
    expect(ownerView.privateInspections).toEqual([
      {
        id: 'inspection-grant-1',
        sourcePlayerId: p1,
        sourceId: prizeId,
        cardIds: ownerView.zones[prizeId]!.cards.map((card) => card.id),
      },
    ]);
    expect(
      opponentView.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(opponentView.privateInspections).toEqual([]);
    expect(spectatorView.privateInspections).toEqual([]);
    expect(JSON.stringify(opponentView)).not.toContain('blue inspection card');

    if (event?.type !== 'InspectionGrantOpened') {
      throw new Error('missing inspection open event');
    }
    const knownAliases = ownerView.zones[prizeId]!.cards.map((card) => card.id);
    const closed = accepted(
      opened.state,
      {
        type: 'EndPrivateInspection',
        viewerPlayerId: p1,
        inspectionId: event.inspectionId,
      },
      prepared.context
    );
    expect(closed.batch.events).toEqual([
      {
        type: 'InspectionGrantClosed',
        scope: 'zone',
        inspectionId: event.inspectionId,
        sourcePlayerId: p1,
        sourceId: prizeId,
        expectedCardIds: prizeCards,
        expectedViewerIds: [p1],
        viewerId: p1,
      },
    ]);
    expect(closed.state.visibility.inspectionGrants).toEqual({});
    const closedView = projectMatch(
      closed.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    expect(closedView.privateInspections).toEqual([]);
    expect(
      closedView.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(closedView.zones[prizeId]!.cards.map((card) => card.id)).not.toEqual(
      knownAliases
    );
    expect(stableSerialize(applyEventBatch(opened.state, closed.batch))).toBe(
      stableSerialize(closed.state)
    );
    assertMatchInvariants(closed.state);
  });

  it('grants one card without revealing its concealed neighbors', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const [selected] = prepared.state.zones[prizeId]!.cardIds;
    const opened = accepted(
      prepared.state,
      {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p1,
        cardId: selected!,
        expectedSourceId: prizeId,
      },
      prepared.context
    );
    const view = projectMatch(
      opened.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    expect(view.zones[prizeId]!.cards[0]?.kind).toBe('known');
    expect(
      view.zones[prizeId]!.cards.slice(1).every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(view.privateInspections[0]?.cardIds).toEqual([
      view.zones[prizeId]!.cards[0]!.id,
    ]);
  });

  it('automatically retires a grant when its card leaves the exact source', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const discardId = playerZoneId(p1, 'discard');
    const cardId = prepared.state.zones[prizeId]!.cardIds[0]!;
    const opened = accepted(
      prepared.state,
      {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p1,
        cardId,
        expectedSourceId: prizeId,
      },
      prepared.context
    );
    const moved = accepted(
      opened.state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: prizeId,
        destinationZoneId: discardId,
      },
      prepared.context
    );
    expect(moved.state.visibility.inspectionGrants).toEqual({});
    expect(
      projectMatch(moved.state, { kind: 'player', playerId: p1 }, identities)
        .privateInspections
    ).toEqual([]);
    assertMatchInvariants(moved.state);
  });

  it('rejects stale sources, unsupported zones, known cards, and stale closes immutably', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const prizeCards = [...prepared.state.zones[prizeId]!.cardIds];
    const before = stableSerialize(prepared.state);
    const commands: GameCommand[] = [
      {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p1,
        sourceZoneId: prizeId,
        expectedCardIds: [...prizeCards].reverse(),
      },
      {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p1,
        sourceZoneId: playerZoneId(p1, 'deck'),
        expectedCardIds:
          prepared.state.zones[playerZoneId(p1, 'deck')]!.cardIds,
      },
      {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p1,
        sourceZoneId: playerZoneId(p1, 'hand'),
        expectedCardIds:
          prepared.state.zones[playerZoneId(p1, 'hand')]!.cardIds,
      },
      {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p1,
        cardId: prizeCards[0]!,
        expectedSourceId: playerZoneId(p1, 'deck'),
      },
      {
        type: 'EndPrivateInspection',
        viewerPlayerId: p1,
        inspectionId: asInspectionId('missing-inspection'),
      },
    ];
    for (const command of commands) {
      expect(
        executeCommand(prepared.state, command, prepared.context).accepted
      ).toBe(false);
      expect(stableSerialize(prepared.state)).toBe(before);
    }
  });

  it('extracts bottom cards edge-first while retaining prior event replay compatibility', () => {
    const context = createContext();
    const initial = createEmptyMatch(asMatchId('bottom-inspection-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = accepted(
      initial,
      { type: 'LoadDeck', playerId: p1, entries: entries('bottom', 5) },
      context
    );
    const deckId = playerZoneId(p1, 'deck');
    const oldDeck = [...loaded.state.zones[deckId]!.cardIds];
    const opened = accepted(
      loaded.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p2],
        count: 3,
        edge: 'bottom',
      },
      context
    );
    const expectedEdgeFirst = oldDeck.slice(-3).reverse();
    expect(opened.state.workAreas[p1]?.inspection?.cardIds).toEqual(
      expectedEdgeFirst
    );
    expect(opened.state.zones[deckId]?.cardIds).toEqual(oldDeck.slice(0, 2));
    expect(opened.batch.events).toEqual([
      {
        type: 'InspectionOpened',
        playerId: p1,
        workAreaId: 'work:inspection-blue:inspection:inspection-grant-1',
        inspectionId: 'inspection-grant-1',
        sourceZoneId: deckId,
        cardIds: expectedEdgeFirst,
        viewerIds: [p2],
      },
    ]);
    const ownerView = projectMatch(
      opened.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    const viewerView = projectMatch(
      opened.state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(
      ownerView.workAreas[p1]?.inspection?.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(
      viewerView.workAreas[p1]?.inspection?.cards.every(
        (card) => card.kind === 'known'
      )
    ).toBe(true);
    expect(stableSerialize(applyEventBatch(loaded.state, opened.batch))).toBe(
      stableSerialize(opened.state)
    );

    const event = opened.batch.events[0];
    if (event?.type !== 'InspectionOpened') {
      throw new Error('missing bottom inspection open event');
    }
    const priorSourceOrderState = applyEventBatch(loaded.state, {
      revision: opened.batch.revision,
      events: [{ ...event, cardIds: oldDeck.slice(-3) }],
    });
    expect(priorSourceOrderState.workAreas[p1]?.inspection?.cardIds).toEqual(
      oldDeck.slice(-3)
    );
    expect(() =>
      applyEventBatch(loaded.state, {
        revision: opened.batch.revision,
        events: [
          {
            ...event,
            cardIds: [oldDeck[2]!, oldDeck[4]!, oldDeck[3]!],
          },
        ],
      })
    ).toThrow('Inspection open event is malformed');
    assertMatchInvariants(opened.state);
    assertMatchInvariants(priorSourceOrderState);
  });

  it('extends an exact same-viewer inspection in V1 append order', () => {
    const context = createContext();
    const initial = createEmptyMatch(asMatchId('extended-inspection-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = accepted(
      initial,
      { type: 'LoadDeck', playerId: p1, entries: entries('extended', 6) },
      context
    );
    const deckId = playerZoneId(p1, 'deck');
    const originalDeck = [...loaded.state.zones[deckId]!.cardIds];
    const opened = accepted(
      loaded.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      context
    );
    const inspection = opened.state.workAreas[p1]!.inspection!;
    const extended = accepted(
      opened.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'bottom',
        expectedInspection: {
          inspectionId: inspection.inspectionId,
          workAreaId: inspection.id,
          cardIds: [...inspection.cardIds],
          viewerIdsByCardId: structuredClone(inspection.viewerIdsByCardId),
        },
      },
      context
    );
    const appendedCardIds = originalDeck.slice(-2).reverse();
    expect(extended.batch.events).toEqual([
      {
        type: 'InspectionExtended',
        playerId: p1,
        expectedWorkAreaId: inspection.id,
        inspectionId: inspection.inspectionId,
        sourceZoneId: deckId,
        expectedCardIds: originalDeck.slice(0, 2),
        cardIds: appendedCardIds,
        expectedViewerIdsByCardId: {
          [originalDeck[0]!]: [p1],
          [originalDeck[1]!]: [p1],
        },
        viewerIds: [p1],
      },
    ]);
    expect(extended.state.zones[deckId]?.cardIds).toEqual(
      originalDeck.slice(2, -2)
    );
    expect(extended.state.workAreas[p1]?.inspection).toEqual({
      ...inspection,
      cardIds: [...originalDeck.slice(0, 2), ...appendedCardIds],
      viewerIdsByCardId: Object.fromEntries(
        [...originalDeck.slice(0, 2), ...appendedCardIds].map((cardId) => [
          cardId,
          [p1],
        ])
      ),
    });
    expect(
      projectMatch(
        extended.state,
        { kind: 'player', playerId: p1 },
        identities
      ).workAreas[p1]?.inspection?.cards.every((card) => card.kind === 'known')
    ).toBe(true);
    expect(
      projectMatch(
        extended.state,
        { kind: 'player', playerId: p2 },
        identities
      ).workAreas[p1]?.inspection?.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(stableSerialize(applyEventBatch(opened.state, extended.batch))).toBe(
      stableSerialize(extended.state)
    );
    expect(
      stableSerialize(
        applyEventBatch(
          applyEventBatch(loaded.state, opened.batch),
          extended.batch
        )
      )
    ).toBe(stableSerialize(extended.state));

    const before = stableSerialize(opened.state);
    const rejectedExtensions: GameCommand[] = [
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'top',
      },
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'top',
        expectedInspection: {
          inspectionId: inspection.inspectionId,
          workAreaId: inspection.id,
          cardIds: [...inspection.cardIds].reverse(),
          viewerIdsByCardId: structuredClone(inspection.viewerIdsByCardId),
        },
      },
    ];
    for (const command of rejectedExtensions) {
      expect(executeCommand(opened.state, command, context).accepted).toBe(
        false
      );
      expect(stableSerialize(opened.state)).toBe(before);
    }
    expect(() =>
      applyEventBatch(opened.state, {
        ...extended.batch,
        events: [
          {
            ...extended.batch.events[0]!,
            cardIds: [originalDeck[2]!, originalDeck[4]!],
          },
        ],
      })
    ).toThrow('Inspection extension event is malformed');
    assertMatchInvariants(extended.state);
  });

  it('tracks V1 cross-viewer extensions and zero-card concealment per card', () => {
    const context = createContext();
    const initial = createEmptyMatch(asMatchId('cross-viewer-inspection'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = accepted(
      initial,
      { type: 'LoadDeck', playerId: p1, entries: entries('cross-viewer', 6) },
      context
    );
    const originalDeck = [
      ...loaded.state.zones[playerZoneId(p1, 'deck')]!.cardIds,
    ];
    const opened = accepted(
      loaded.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      context
    );
    const firstInspection = opened.state.workAreas[p1]!.inspection!;
    const beforeSameViewerZero = stableSerialize(opened.state);
    const sameViewerZero = executeCommand(
      opened.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 0,
        edge: 'top',
        expectedInspection: {
          inspectionId: firstInspection.inspectionId,
          workAreaId: firstInspection.id,
          cardIds: [...firstInspection.cardIds],
          viewerIdsByCardId: structuredClone(firstInspection.viewerIdsByCardId),
        },
      },
      context
    );
    expect(sameViewerZero).toMatchObject({
      accepted: false,
      code: 'invalid_command',
    });
    expect(stableSerialize(opened.state)).toBe(beforeSameViewerZero);
    const crossViewer = accepted(
      opened.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p2],
        count: 2,
        edge: 'bottom',
        expectedInspection: {
          inspectionId: firstInspection.inspectionId,
          workAreaId: firstInspection.id,
          cardIds: [...firstInspection.cardIds],
          viewerIdsByCardId: structuredClone(firstInspection.viewerIdsByCardId),
        },
      },
      context
    );
    const crossInspection = crossViewer.state.workAreas[p1]!.inspection!;
    const appended = originalDeck.slice(-2).reverse();
    expect(crossInspection.viewerIdsByCardId).toEqual({
      [originalDeck[0]!]: [],
      [originalDeck[1]!]: [],
      [appended[0]!]: [p2],
      [appended[1]!]: [p2],
    });
    expect(
      crossViewer.state.cards[originalDeck[0]!]!.visibilityGeneration
    ).toBe(1);
    expect(crossViewer.state.cards[appended[0]!]!.visibilityGeneration).toBe(0);
    expect(
      projectMatch(
        crossViewer.state,
        { kind: 'player', playerId: p1 },
        identities
      ).workAreas[p1]?.inspection?.cards.map((card) => card.kind)
    ).toEqual(['concealed', 'concealed', 'concealed', 'concealed']);
    expect(
      projectMatch(
        crossViewer.state,
        { kind: 'player', playerId: p2 },
        identities
      ).workAreas[p1]?.inspection?.cards.map((card) => card.kind)
    ).toEqual(['concealed', 'concealed', 'known', 'known']);

    const sameViewer = accepted(
      crossViewer.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p2],
        count: 1,
        edge: 'top',
        expectedInspection: {
          inspectionId: crossInspection.inspectionId,
          workAreaId: crossInspection.id,
          cardIds: [...crossInspection.cardIds],
          viewerIdsByCardId: structuredClone(crossInspection.viewerIdsByCardId),
        },
      },
      context
    );
    const sameInspection = sameViewer.state.workAreas[p1]!.inspection!;
    expect(sameInspection.viewerIdsByCardId[originalDeck[0]!]).toEqual([]);
    expect(sameInspection.viewerIdsByCardId[appended[0]!]).toEqual([p2]);
    expect(
      sameInspection.viewerIdsByCardId[
        sameInspection.cardIds[sameInspection.cardIds.length - 1]!
      ]
    ).toEqual([p2]);

    const cleared = accepted(
      sameViewer.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 0,
        edge: 'bottom',
        expectedInspection: {
          inspectionId: sameInspection.inspectionId,
          workAreaId: sameInspection.id,
          cardIds: [...sameInspection.cardIds],
          viewerIdsByCardId: structuredClone(sameInspection.viewerIdsByCardId),
        },
      },
      context
    );
    expect(cleared.batch.events).toEqual([
      {
        type: 'InspectionVisibilityCleared',
        playerId: p1,
        expectedWorkAreaId: sameInspection.id,
        inspectionId: sameInspection.inspectionId,
        expectedCardIds: [...sameInspection.cardIds],
        expectedViewerIdsByCardId: structuredClone(
          sameInspection.viewerIdsByCardId
        ),
        replacementViewerIds: [p1],
      },
    ]);
    expect(
      Object.values(
        cleared.state.workAreas[p1]!.inspection!.viewerIdsByCardId
      ).every((viewerIds) => viewerIds.length === 0)
    ).toBe(true);
    expect(cleared.state.cards[originalDeck[0]!]!.visibilityGeneration).toBe(1);
    expect(cleared.state.cards[appended[0]!]!.visibilityGeneration).toBe(1);
    for (const viewerId of [p1, p2]) {
      expect(
        projectMatch(
          cleared.state,
          { kind: 'player', playerId: viewerId },
          identities
        ).workAreas[p1]?.inspection?.cards.every(
          (card) => card.kind === 'concealed'
        )
      ).toBe(true);
    }

    const replayed = [
      loaded.batch,
      opened.batch,
      crossViewer.batch,
      sameViewer.batch,
      cleared.batch,
    ].reduce(applyEventBatch, initial);
    expect(stableSerialize(replayed)).toBe(stableSerialize(cleared.state));
    const cloned = cloneMatchState(crossViewer.state);
    expect(cloned.workAreas[p1]!.inspection!.viewerIdsByCardId).not.toBe(
      crossInspection.viewerIdsByCardId
    );
    for (const cardId of crossInspection.cardIds) {
      expect(
        cloned.workAreas[p1]!.inspection!.viewerIdsByCardId[cardId]
      ).not.toBe(crossInspection.viewerIdsByCardId[cardId]);
    }
    expect(() =>
      applyEventBatch(opened.state, {
        ...crossViewer.batch,
        events: [
          {
            ...crossViewer.batch.events[0]!,
            expectedViewerIdsByCardId: {
              [originalDeck[0]!]: [],
              [originalDeck[1]!]: [],
            },
          },
        ],
      })
    ).toThrow('Inspection extension event is malformed');
    expect(() =>
      applyEventBatch(sameViewer.state, {
        ...cleared.batch,
        events: [
          {
            ...cleared.batch.events[0]!,
            replacementViewerIds: [p2],
          },
        ],
      })
    ).toThrow('Inspection visibility-clear event is malformed');
    const malformed = structuredClone(crossViewer.state);
    delete (
      malformed.workAreas[p1]!.inspection!.viewerIdsByCardId as Record<
        string,
        readonly (typeof p1)[]
      >
    )[originalDeck[0]!];
    expect(() => assertMatchInvariants(malformed)).toThrow(
      'invalid per-card visibility keys'
    );
    assertMatchInvariants(cleared.state);
  });

  it('rejects malformed open and close replay events before mutation', () => {
    const prepared = fixture();
    const prizeId = playerZoneId(p1, 'prizes');
    const prizeCards = [...prepared.state.zones[prizeId]!.cardIds];
    const before = stableSerialize(prepared.state);
    expect(() =>
      applyEventBatch(prepared.state, {
        revision: prepared.state.revision + 1,
        events: [
          {
            type: 'InspectionGrantOpened',
            scope: 'card',
            inspectionId: asInspectionId('malformed-inspection'),
            sourcePlayerId: p1,
            sourceId: prizeId,
            expectedSourceCardIds: [...prizeCards].reverse(),
            cardIds: [prizeCards[0]!],
            viewerIds: [p1],
          },
        ],
      })
    ).toThrow('Private inspection grant event is malformed');
    expect(() =>
      applyEventBatch(prepared.state, {
        revision: prepared.state.revision + 1,
        events: [
          {
            type: 'InspectionGrantOpened',
            scope: 'invalid' as never,
            inspectionId: asInspectionId('malformed-scope-inspection'),
            sourcePlayerId: p1,
            sourceId: prizeId,
            expectedSourceCardIds: prizeCards,
            cardIds: [prizeCards[0]!],
            viewerIds: [p1],
          },
        ],
      })
    ).toThrow('Private inspection grant event is malformed');
    expect(stableSerialize(prepared.state)).toBe(before);

    const opened = accepted(
      prepared.state,
      {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p1,
        cardId: prizeCards[0]!,
        expectedSourceId: prizeId,
      },
      prepared.context
    );
    const inspectionId = Object.values(
      opened.state.visibility.inspectionGrants
    )[0]!.inspectionId;
    expect(() =>
      applyEventBatch(opened.state, {
        revision: opened.state.revision + 1,
        events: [
          {
            type: 'InspectionGrantClosed',
            scope: 'card',
            inspectionId,
            sourcePlayerId: p1,
            sourceId: prizeId,
            expectedCardIds: [prizeCards[1]!],
            expectedViewerIds: [p1],
            viewerId: p1,
          },
        ],
      })
    ).toThrow('Private inspection close event is malformed');
  });
});
