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
  type CardInstanceId,
  type CommandContext,
  type GameCommand,
  type MatchState,
  type ViewerRole,
} from '@ptcgsim/game-core';
import { PROTOCOL_VERSION, type WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { createRoomAdmissionState } from './admission.js';
import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import {
  assertAuthorityTransactionTransition,
  validateAuthoritySnapshot,
} from './invariants.js';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_AUTHORITY_POLICY,
  type AuthorityDependencies,
  type AuthoritySession,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from './model.js';
import { processAuthorityCommand } from './process-command.js';
import { createReplayHistory, replayHistoryStates } from './replay-history.js';
import { resolveWireCommand } from './resolve-command.js';

const blue = asPlayerId('native-pile-blue');
const red = asPlayerId('native-pile-red');
const blueSession: AuthoritySession = {
  id: 'blue-session',
  viewer: { kind: 'player', playerId: blue },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const fixture = (kind: 'discard' | 'lostZone' = 'discard') => {
  let next = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`native-pile-card-${++next}`),
    nextStackId: () => asStackId(`native-pile-stack-${++next}`),
    nextInspectionId: () => asInspectionId(`native-pile-inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`native-pile-work-${++next}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('native-pile-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (!result.accepted) throw new Error(result.message);
    state = result.state;
    return result;
  };
  for (const playerId of [blue, red])
    run({
      type: 'LoadDeck',
      playerId,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('native-pile-definition'),
            name: 'Native pile card',
            category: 'Pokémon',
            imageUrl: '/card',
          },
          count: 4,
        },
      ],
    });
  const pileId = playerZoneId(blue, kind);
  const [selected, second, third, spare] =
    state.zones[playerZoneId(blue, 'deck')]!.cardIds;
  for (const cardId of [selected!, second!, third!])
    run({
      type: 'MoveCard',
      cardId,
      expectedSourceZoneId: playerZoneId(blue, 'deck'),
      destinationZoneId: pileId,
    });
  if (kind === 'discard')
    run({ type: 'SetCardAbilityUsed', cardId: selected!, used: true });
  run({
    type: 'SetPublicReveal',
    actorPlayerId: blue,
    playerId: blue,
    cardId: selected!,
    expectedSourceId: pileId,
    revealed: true,
  });
  const opaqueIds = {
    nextOpaqueId: (type: 'card' | 'definition') =>
      `native-${type}-${String(++next).padStart(12, '0')}`,
  };
  let lastIdentities = emptyProjectionIdentityState();
  const project = (
    current: MatchState,
    viewer: ViewerRole = blueSession.viewer,
    identities = lastIdentities
  ) => {
    const result = projectRecipient(
      current,
      viewer,
      identities,
      opaqueIds,
      'multiplayer'
    );
    lastIdentities = result.identities;
    const alias = (cardId: CardInstanceId) =>
      result.identities.cardAliases.find(
        (entry) =>
          entry.cardId === cardId &&
          entry.viewerKey ===
            (viewer.kind === 'player'
              ? `player:${viewer.playerId}`
              : 'spectator')
      )!.alias;
    return { ...result, alias };
  };
  return {
    state,
    context,
    pileId,
    selected: selected!,
    second: second!,
    third: third!,
    spare: spare!,
    project,
    opaqueIds,
  };
};

const wireOrder = (
  prepared: ReturnType<typeof fixture>,
  cardId: string,
  destinationIndex?: number
): WireGameCommand => ({
  type: 'MoveCard',
  cardId,
  expectedSourceZoneId: prepared.pileId,
  destinationZoneId: prepared.pileId,
  ...(destinationIndex === undefined ? {} : { destinationIndex }),
});

const resolvedMove = (
  prepared: ReturnType<typeof fixture>,
  state: MatchState,
  wire: WireGameCommand,
  observedRevision = state.revision
) => {
  const projected = prepared.project(state);
  const resolved = resolveWireCommand(
    state,
    projected.identities,
    blueSession,
    wire,
    DEFAULT_AUTHORITY_POLICY,
    observedRevision
  );
  if (!resolved.accepted) throw new Error(resolved.code);
  return resolved.command;
};

describe('native public-pile ordering authority', () => {
  it.each(['discard', 'lostZone'] as const)(
    'maps only native same-zone %s moves to order-only semantics and retains aliases',
    (kind) => {
      const prepared = fixture(kind);
      const projected = prepared.project(prepared.state);
      const alias = projected.alias(prepared.selected);
      const command = resolvedMove(
        prepared,
        prepared.state,
        wireOrder(prepared, alias)
      );
      expect(command).toMatchObject({
        type: 'MoveCard',
        cardId: prepared.selected,
        publicPileOrderVersion: 1,
      });
      const result = executeCommand(prepared.state, command, prepared.context);
      if (!result.accepted) throw new Error(result.message);
      const after = prepared.project(
        result.state,
        blueSession.viewer,
        projected.identities
      );
      expect(after.alias(prepared.selected)).toBe(alias);
      expect(after.snapshot.zones[prepared.pileId]!.cards.at(-1)).toEqual(
        projected.snapshot.zones[prepared.pileId]!.cards[0]
      );
      expect(result.state.cards).toEqual(prepared.state.cards);
      expect(result.state.visibility).toEqual(prepared.state.visibility);

      const crossZone = resolvedMove(prepared, prepared.state, {
        ...wireOrder(prepared, alias),
        destinationZoneId: playerZoneId(blue, 'hand'),
      });
      expect(crossZone).not.toHaveProperty('publicPileOrderVersion');
      const deckId = playerZoneId(blue, 'deck');
      const deckMove = resolvedMove(prepared, prepared.state, {
        type: 'MoveCard',
        cardId: projected.alias(prepared.spare),
        expectedSourceZoneId: deckId,
        destinationZoneId: deckId,
        destinationIndex: 0,
      });
      expect(deckMove).not.toHaveProperty('publicPileOrderVersion');
    }
  );

  it('keeps top and bottom meaningful when peers append or remove cards after the observed revision', () => {
    const prepared = fixture();
    const projected = prepared.project(prepared.state);
    const alias = projected.alias(prepared.selected);
    const peerArrival =
      prepared.state.zones[playerZoneId(red, 'deck')]!.cardIds[0]!;
    const appended = executeCommand(
      prepared.state,
      {
        type: 'MoveCard',
        cardId: peerArrival,
        expectedSourceZoneId: playerZoneId(red, 'deck'),
        destinationZoneId: prepared.pileId,
      },
      prepared.context
    );
    if (!appended.accepted) throw new Error(appended.message);
    const top = executeCommand(
      appended.state,
      resolvedMove(
        prepared,
        appended.state,
        wireOrder(prepared, alias),
        prepared.state.revision
      ),
      prepared.context
    );
    if (!top.accepted) throw new Error(top.message);
    expect(top.state.zones[prepared.pileId]!.cardIds).toEqual([
      prepared.second,
      prepared.third,
      peerArrival,
      prepared.selected,
    ]);
    const bottom = executeCommand(
      appended.state,
      resolvedMove(
        prepared,
        appended.state,
        wireOrder(prepared, alias, 0),
        prepared.state.revision
      ),
      prepared.context
    );
    if (!bottom.accepted) throw new Error(bottom.message);
    expect(bottom.state.zones[prepared.pileId]!.cardIds).toEqual([
      prepared.selected,
      prepared.second,
      prepared.third,
      peerArrival,
    ]);

    const departed = executeCommand(
      prepared.state,
      {
        type: 'MoveCard',
        cardId: prepared.third,
        expectedSourceZoneId: prepared.pileId,
        destinationZoneId: playerZoneId(blue, 'hand'),
      },
      prepared.context
    );
    if (!departed.accepted) throw new Error(departed.message);
    const afterDeparture = executeCommand(
      departed.state,
      resolvedMove(
        prepared,
        departed.state,
        wireOrder(prepared, alias),
        prepared.state.revision
      ),
      prepared.context
    );
    if (!afterDeparture.accepted) throw new Error(afterDeparture.message);
    expect(afterDeparture.state.zones[prepared.pileId]!.cardIds).toEqual([
      prepared.second,
      prepared.selected,
    ]);
  });

  it('refuses a selected card that departed its expected source, without undoing the peer move', () => {
    const prepared = fixture();
    const projected = prepared.project(prepared.state);
    const wire = wireOrder(prepared, projected.alias(prepared.selected));
    const departed = executeCommand(
      prepared.state,
      {
        type: 'MoveCard',
        cardId: prepared.selected,
        expectedSourceZoneId: prepared.pileId,
        destinationZoneId: playerZoneId(blue, 'lostZone'),
      },
      prepared.context
    );
    if (!departed.accepted) throw new Error(departed.message);
    const before = structuredClone(departed.state);
    expect(
      executeCommand(
        departed.state,
        resolvedMove(prepared, departed.state, wire, prepared.state.revision),
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(departed.state).toEqual(before);
  });

  it('keeps spectator and opponent-card visibility policy in force', () => {
    const prepared = fixture();
    const redCard =
      prepared.state.zones[playerZoneId(red, 'deck')]!.cardIds[0]!;
    const redPile = playerZoneId(red, 'discard');
    const moved = executeCommand(
      prepared.state,
      {
        type: 'MoveCard',
        cardId: redCard,
        expectedSourceZoneId: playerZoneId(red, 'deck'),
        destinationZoneId: redPile,
      },
      prepared.context
    );
    if (!moved.accepted) throw new Error(moved.message);
    const projected = prepared.project(moved.state);
    const wire: WireGameCommand = {
      type: 'MoveCard',
      cardId: projected.alias(redCard),
      expectedSourceZoneId: redPile,
      destinationZoneId: redPile,
      destinationIndex: 0,
    };
    expect(
      resolveWireCommand(
        moved.state,
        projected.identities,
        blueSession,
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toMatchObject({ accepted: true, command: { publicPileOrderVersion: 1 } });
    expect(
      resolveWireCommand(moved.state, projected.identities, blueSession, wire, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const hidden = executeCommand(
      moved.state,
      { type: 'SetCardFace', cardId: redCard, face: 'down' },
      prepared.context
    );
    if (!hidden.accepted) throw new Error(hidden.message);
    const hiddenView = prepared.project(hidden.state);
    expect(
      resolveWireCommand(
        hidden.state,
        hiddenView.identities,
        blueSession,
        { ...wire, cardId: hiddenView.alias(redCard) },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const spectator = prepared.project(moved.state, { kind: 'spectator' });
    expect(
      resolveWireCommand(
        moved.state,
        spectator.identities,
        { ...blueSession, viewer: { kind: 'spectator' } },
        { ...wire, cardId: spectator.alias(redCard) },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('persists the versioned event, retries idempotently after reload, and undoes the exact order and markers', async () => {
    const prepared = fixture();
    const projected = prepared.project(prepared.state);
    const admission = createRoomAdmissionState({
      playerSeatLimit: 2,
      playerIds: [blue, red],
      seatCapabilityDigests: { [blue]: 'a'.repeat(32), [red]: 'b'.repeat(32) },
    });
    let current: RoomAuthoritySnapshot = {
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      authorityVersion: 0,
      mode: 'multiplayer',
      state: prepared.state,
      replayHistory: createReplayHistory(prepared.state),
      identities: projected.identities,
      sessions: { [blueSession.id]: blueSession },
      admission: {
        ...admission,
        seats: {
          ...admission.seats,
          [blue]: {
            ...admission.seats[blue]!,
            claimedSessionId: blueSession.id,
          },
        },
      },
    };
    const transactions: PersistedAuthorityTransaction[] = [];
    const dependencies: AuthorityDependencies = {
      commandContext: prepared.context,
      opaqueIds: prepared.opaqueIds,
      policy: DEFAULT_AUTHORITY_POLICY,
      persistence: {
        commit: async (transaction) => {
          assertAuthorityTransactionTransition(current, transaction);
          transactions.push(
            structuredClone({ ...transaction, snapshotValidation: undefined })
          );
        },
      },
    };
    const envelope = {
      type: 'Command' as const,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: blueSession.id,
      clientSequence: 1,
      commandId: 'native-pile-order',
      lastSeenRevision: prepared.state.revision,
      command: wireOrder(prepared, projected.alias(prepared.selected)),
    };
    const ordered = await processAuthorityCommand(
      current,
      envelope,
      dependencies
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.eventBatch!.events[0]).toMatchObject({
      type: 'CardMoved',
      publicPileOrderVersion: 1,
    });
    current = JSON.parse(
      JSON.stringify(ordered.snapshot)
    ) as RoomAuthoritySnapshot;
    expect(() => validateAuthoritySnapshot(current)).not.toThrow();
    expect(replayHistoryStates(current.replayHistory).at(-1)).toEqual(
      current.state
    );
    expect(current.state.cards).toEqual(prepared.state.cards);
    expect(current.state.visibility).toEqual(prepared.state.visibility);
    const retry = await processAuthorityCommand(
      current,
      envelope,
      dependencies
    );
    expect(retry.committed).toBe(false);
    expect(retry.snapshot).toBe(current);
    expect(transactions).toHaveLength(1);

    const undone = await processAuthorityCommand(
      current,
      {
        ...envelope,
        clientSequence: 2,
        commandId: 'native-pile-undo',
        lastSeenRevision: current.state.revision,
        command: { type: 'ApplySoloUndo', targetPlayerId: blue },
      },
      dependencies
    );
    expect(transactions).toHaveLength(2);
    expect(undone.snapshot.state).toEqual({
      ...prepared.state,
      revision: current.state.revision + 1,
    });
    expect(() =>
      validateAuthoritySnapshot(
        JSON.parse(JSON.stringify(undone.snapshot)) as RoomAuthoritySnapshot
      )
    ).not.toThrow();
  });
});
