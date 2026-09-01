import { describe, expect, it } from 'vitest';

import type {
  CommandContext,
  DeckEntry,
  GameCommand,
  WorkAreaCardsDestination,
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

const p1 = asPlayerId('inspection-bulk-player-one');
const p2 = asPlayerId('inspection-bulk-player-two');

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
    nextCardId: () => asCardInstanceId(`inspection-bulk-card-${++card}`),
    nextStackId: () => asStackId(`inspection-bulk-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`inspection-bulk-session-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`inspection-bulk-work-${++workArea}`),
    shuffle,
    randomInt: () => 0,
  };
};

const deckEntries = (): readonly DeckEntry[] =>
  Array.from({ length: 8 }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`inspection-bulk-definition-${index}`),
      name: `Inspection bulk card ${index}`,
      category: index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/inspection-bulk-${index}.png`,
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

const prepareInspection = (
  shuffle?: CommandContext['shuffle']
): {
  readonly state: MatchState;
  readonly context: CommandContext;
  readonly workAreaId: ReturnType<typeof asWorkAreaId>;
  readonly inspectionId: ReturnType<typeof asInspectionId>;
  readonly cardIds: readonly CardInstanceId[];
  readonly normalizedCardId: CardInstanceId;
} => {
  const context = createContext(shuffle);
  let state = createEmptyMatch(asMatchId('inspection-bulk-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: deckEntries() },
    context
  );
  state = accepted(
    state,
    {
      type: 'ExtractDeckCardsForInspection',
      playerId: p1,
      viewerIds: [p1, p2],
      count: 3,
      edge: 'top',
    },
    context
  );
  const inspection = state.workAreas[p1]!.inspection!;
  const normalizedCardId = inspection.cardIds[1]!;
  state = accepted(
    state,
    {
      type: 'SetCardCategory',
      cardId: normalizedCardId,
      category: 'Energy',
    },
    context
  );
  state = accepted(
    state,
    { type: 'SetCardFace', cardId: normalizedCardId, face: 'down' },
    context
  );
  state = accepted(
    state,
    {
      type: 'SetPublicReveal',
      cardId: normalizedCardId,
      revealed: true,
    },
    context
  );
  state = {
    ...state,
    visibility: {
      ...state.visibility,
      inspectionGrants: {
        ...state.visibility.inspectionGrants,
        [inspection.inspectionId]: {
          inspectionId: inspection.inspectionId,
          cardIds: [...inspection.cardIds],
          viewerIds: [...inspection.viewerIds],
        },
      },
    },
  };
  assertMatchInvariants(state);
  return {
    state,
    context,
    workAreaId: inspection.id,
    inspectionId: inspection.inspectionId,
    cardIds: [...inspection.cardIds],
    normalizedCardId,
  };
};

const resolve = (
  prepared: ReturnType<typeof prepareInspection>,
  destination: WorkAreaCardsDestination
) =>
  executeCommand(
    prepared.state,
    {
      type: 'ResolveInspectionCards',
      playerId: p1,
      expectedWorkAreaId: prepared.workAreaId,
      destination,
    },
    prepared.context
  );

describe('atomic inspection-card bulk resolution', () => {
  it.each([
    ['discard', 'discard'],
    ['lostZone', 'lostZone'],
  ] as const)('appends inspected cards in order to %s', (destination, kind) => {
    const prepared = prepareInspection();
    const zoneId = playerZoneId(p1, kind);
    const result = resolve(prepared, destination);
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[zoneId]?.cardIds).toEqual(prepared.cardIds);
    expect(result.state.workAreas[p1]?.inspection).toBeNull();
    expect(
      result.state.visibility.inspectionGrants[prepared.inspectionId]
    ).toBeUndefined();
    expect(
      result.state.visibility.publicCardIds.includes(prepared.normalizedCardId)
    ).toBe(false);
    expect(result.state.cards[prepared.normalizedCardId]).toMatchObject({
      currentCategory: 'Trainer',
      face: 'up',
    });
    assertMatchInvariants(result.state);
  });

  it('moves inspected cards to hand and closes every opponent visibility path', () => {
    const prepared = prepareInspection();
    const result = resolve(prepared, 'hand');
    if (!result.accepted) throw new Error(result.message);
    const handId = playerZoneId(p1, 'hand');
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
    expect(
      result.state.visibility.inspectionGrants[prepared.inspectionId]
    ).toBeUndefined();
    assertMatchInvariants(result.state);
  });

  it('shuffles the complete deck together with inspected cards', () => {
    const prepared = prepareInspection();
    const deckId = playerZoneId(p1, 'deck');
    const oldDeck = [...prepared.state.zones[deckId]!.cardIds];
    const result = resolve(prepared, 'shuffleIntoDeck');
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[deckId]?.cardIds).toEqual(
      [...oldDeck, ...prepared.cardIds].reverse()
    );
    assertMatchInvariants(result.state);
  });

  it('shuffles only inspected cards onto the existing deck bottom', () => {
    const prepared = prepareInspection();
    const deckId = playerZoneId(p1, 'deck');
    const oldDeck = [...prepared.state.zones[deckId]!.cardIds];
    const oldTopGeneration =
      prepared.state.cards[oldDeck[0]!]!.visibilityGeneration;
    const result = resolve(prepared, 'shuffleToDeckBottom');
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[deckId]?.cardIds).toEqual([
      ...oldDeck,
      ...[...prepared.cardIds].reverse(),
    ]);
    expect(result.state.cards[oldDeck[0]!]!.visibilityGeneration).toBe(
      oldTopGeneration
    );
    assertMatchInvariants(result.state);
  });

  it('rejects stale work-area references and invalid shuffles without mutation', () => {
    const prepared = prepareInspection();
    const before = stableSerialize(prepared.state);
    expect(
      executeCommand(
        prepared.state,
        {
          type: 'ResolveInspectionCards',
          playerId: p1,
          expectedWorkAreaId: asWorkAreaId('stale-inspection-work-area'),
          destination: 'discard',
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(stableSerialize(prepared.state)).toBe(before);

    const invalid = prepareInspection((values) => values.slice(1));
    const invalidBefore = stableSerialize(invalid.state);
    expect(resolve(invalid, 'shuffleIntoDeck')).toMatchObject({
      accepted: false,
      code: 'invalid_command',
    });
    expect(stableSerialize(invalid.state)).toBe(invalidBefore);
  });

  it('ordinary close also retires grants, reveals, and temporary card state', () => {
    const prepared = prepareInspection();
    const result = executeCommand(
      prepared.state,
      {
        type: 'CloseInspection',
        playerId: p1,
        inspectionId: prepared.inspectionId,
        returnTo: 'top',
      },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.workAreas[p1]?.inspection).toBeNull();
    expect(
      result.state.visibility.inspectionGrants[prepared.inspectionId]
    ).toBeUndefined();
    expect(
      result.state.visibility.publicCardIds.includes(prepared.normalizedCardId)
    ).toBe(false);
    expect(result.state.cards[prepared.normalizedCardId]).toMatchObject({
      currentCategory: 'Trainer',
      face: 'up',
    });
    assertMatchInvariants(result.state);
  });
});
