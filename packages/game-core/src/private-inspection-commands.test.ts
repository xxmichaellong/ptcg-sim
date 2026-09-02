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
