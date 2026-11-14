import type { SessionSocketHandlers } from '@ptcgsim/client-session';
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
  type MatchViewState,
} from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import {
  DEFAULT_AUTHORITY_POLICY,
  emptyProjectionIdentityState,
  projectRecipient,
  resolveWireCommand,
  type AuthorityMode,
  type AuthoritySession,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import { predictWireCommand } from '../board/predictWireCommand.js';
import { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

type PublicZone = 'board' | 'discard' | 'lostZone';
type Envelope = Extract<ClientMessage, { type: 'Command' }>;
const blue = asPlayerId('arrival-blue');
const red = asPlayerId('arrival-red');
const fixture = (
  destination: PublicZone,
  mode: AuthorityMode = 'solo',
  otherSeat = true
) => {
  const owner = otherSeat ? red : blue;
  let id = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`card-${++id}`),
    nextStackId: () => asStackId(`stack-${++id}`),
    nextInspectionId: () => asInspectionId(`inspection-${++id}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${++id}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('public-arrival-runtime'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (!result.accepted) throw new Error(`${result.code}: ${result.message}`);
    state = result.state;
    return result;
  };
  run({
    type: 'LoadDeck',
    playerId: owner,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('identical'),
          name: 'Identical copy',
          category: 'Pokémon',
          imageUrl: '/identical.png',
        },
        count: 3,
      },
    ],
  });
  const deck = playerZoneId(owner, 'deck');
  const hand = playerZoneId(owner, 'hand');
  const target = playerZoneId(owner, destination);
  const reserve = playerZoneId(
    owner,
    destination === 'lostZone' ? 'discard' : 'lostZone'
  );
  const [original, other] = state.zones[deck]!.cardIds;
  run({
    type: 'MoveCard',
    cardId: original!,
    expectedSourceZoneId: deck,
    destinationZoneId: hand,
  });
  run({
    type: 'MoveCard',
    cardId: other!,
    expectedSourceZoneId: deck,
    destinationZoneId: reserve,
  });
  let identities = emptyProjectionIdentityState();
  const project = () => {
    const result = projectRecipient(
      state,
      { kind: 'player', playerId: blue },
      identities,
      { nextOpaqueId: () => `public-arrival-alias-${++id}` },
      mode
    );
    identities = result.identities;
    return result.snapshot;
  };
  const seat: AuthoritySession = {
    id: 'arrival-session',
    viewer: { kind: 'player', playerId: blue },
    active: true,
    nextClientSequence: 1,
    recentOutcomes: [],
  };
  const resolve = (command: WireGameCommand, revision = state.revision) =>
    resolveWireCommand(
      state,
      identities,
      seat,
      command,
      DEFAULT_AUTHORITY_POLICY,
      revision,
      { mode }
    );
  const execute = (envelope: Envelope) => {
    const result = resolve(envelope.command, envelope.lastSeenRevision);
    if (!result.accepted) throw new Error(`Native resolution: ${result.code}`);
    run(result.command);
    return result.command;
  };
  const attempt = (envelope: Envelope) => {
    const result = resolve(envelope.command, envelope.lastSeenRevision);
    return result.accepted
      ? executeCommand(state, result.command, context)
      : result;
  };
  const before = project();
  const originalAlias = before.zones[hand]!.cards[0]!.id;
  const move: WireGameCommand = {
    type: 'MoveCard',
    cardId: originalAlias,
    expectedSourceZoneId: hand,
    destinationZoneId: target,
  };
  const follow: WireGameCommand = {
    type: 'SetPublicReveal',
    cardId: originalAlias,
    expectedSourceId: target,
    revealed: false,
  };
  return {
    before,
    move,
    follow,
    project,
    execute,
    attempt,
    resolve,
    run,
    state: () => state,
    original: original!,
    other: other!,
    originalAlias,
    deck,
    hand,
    target,
    reserve,
  };
};

const connect = (view: MatchViewState) => {
  let handlers!: SessionSocketHandlers;
  const sent: ClientMessage[] = [];
  let id = 0;
  const runtime = new RemoteRoomRuntime({
    connection: {
      url: 'wss://example.test/connect',
      buildId: 'arrival-test',
      roomCode: 'ABCDEFGH2345',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket: 'arrival-private-admission-capability',
      resumeToken: 'arrival-private-resume-capability',
    },
    session: {
      socketFactory: {
        open: (_url, callbacks) => {
          handlers = callbacks;
          return {
            send: (frame) => sent.push(JSON.parse(frame) as ClientMessage),
            close: () => {},
          };
        },
      },
      scheduler: { schedule: () => 1, cancel: () => {} },
      createCommandId: () => `arrival-command-${++id}`,
      policy: { idleHeartbeatMs: 0 },
    },
  });
  const receive = (message: ServerMessage) =>
    handlers.message(JSON.stringify(message));
  handlers.open();
  receive({
    type: 'Welcome',
    protocolVersion: PROTOCOL_VERSION,
    buildId: 'arrival-test',
    role: 'player',
    playerId: blue,
    sessionId: 'arrival-session',
    resumeToken: 'arrival-private-resume-capability',
    nextClientSequence: 1,
    snapshot: serializeMatchViewState(view),
  });
  const envelope = (index: number): Envelope => {
    const message = sent[index];
    if (message?.type !== 'Command') throw new Error('Native Command required');
    return message;
  };
  const accepted = (
    command: Envelope,
    snapshot: MatchViewState,
    revision = snapshot.revision
  ) => {
    receive({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      coveringCommandId: command.commandId,
      executedClientSequence: command.clientSequence,
      snapshot: serializeMatchViewState(snapshot),
    });
    receive({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: command.commandId,
      clientSequence: command.clientSequence,
      accepted: true,
      revision,
    });
  };
  return { runtime, sent, receive, envelope, accepted };
};

const destinations: readonly PublicZone[] = ['board', 'discard', 'lostZone'];
describe('native public-zone arrival aliases', () => {
  it('matches the intended owner when a fresh foreign identical copy also arrives', () => {
    const native = fixture('board');
    native.run({
      type: 'LoadDeck',
      playerId: blue,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('identical'),
            name: 'Identical copy',
            category: 'Pokémon',
            imageUrl: '/identical.png',
          },
          count: 1,
        },
      ],
    });
    const foreign =
      native.state().zones[playerZoneId(blue, 'deck')]!.cardIds[0]!;
    const before = native.project();
    const connection = connect(before);
    try {
      expect(connection.runtime.session.submit(native.move).queued).toBe(true);
      expect(
        connection.runtime.session.submit({
          type: 'MoveCard',
          cardId: native.originalAlias,
          expectedSourceZoneId: native.target,
          destinationZoneId: native.reserve,
        }).queued
      ).toBe(true);
      native.run({
        type: 'MoveCard',
        cardId: foreign,
        expectedSourceZoneId: playerZoneId(blue, 'deck'),
        destinationZoneId: native.target,
      });
      native.execute(connection.envelope(1));
      const landed = native.project();
      connection.accepted(connection.envelope(1), landed);
      expect(native.execute(connection.envelope(2))).toMatchObject({
        cardId: native.original,
      });
      expect(native.state().zones[native.target]!.cardIds).toEqual([foreign]);
    } finally {
      connection.runtime.dispose();
    }
  });

  it.each(destinations)(
    'sends a queued Solo other-seat %s action under the exact accepted identity',
    (destination) => {
      const native = fixture(destination);
      const connection = connect(native.before);
      try {
        const predicted = predictWireCommand(native.before, native.move, {
          readsEveryHand: true,
        })!;
        expect(predicted.zones[native.target]!.cards[0]!.id).toBe(
          native.originalAlias
        );
        expect(connection.runtime.session.submit(native.move).queued).toBe(
          true
        );
        expect(connection.runtime.session.submit(native.follow).queued).toBe(
          true
        );
        expect(connection.sent).toHaveLength(2);
        native.execute(connection.envelope(1));
        const landed = native.project();
        expect(landed.zones[native.target]!.cards[0]!.id).not.toBe(
          native.originalAlias
        );
        connection.accepted(connection.envelope(1), landed);
        const sent = connection.envelope(2);
        expect(sent.command).toMatchObject({
          cardId: landed.zones[native.target]!.cards[0]!.id,
        });
        const executed = native.execute(sent);
        expect(executed).toMatchObject({ cardId: native.original });
        connection.accepted(sent, native.project());
        expect(
          connection.runtime.session
            .getSnapshot()
            .completedCommands.map((command) => command.accepted)
        ).toEqual([true, true]);
        expect(
          connection.runtime.session.getSnapshot().pendingCommands
        ).toHaveLength(0);
      } finally {
        connection.runtime.dispose();
      }
    }
  );

  it.each(destinations)(
    'binds original and rebound/sent aliases through hand then %s',
    (destination) => {
      const native = fixture(destination);
      native.run({
        type: 'MoveCard',
        cardId: native.original,
        expectedSourceZoneId: native.hand,
        destinationZoneId: native.reserve,
      });
      native.run({
        type: 'MoveCard',
        cardId: native.other,
        expectedSourceZoneId: native.reserve,
        destinationZoneId: native.target,
      });
      const before = native.project();
      const originalAlias = before.zones[native.reserve]!.cards[0]!.id;
      const connection = connect(before);
      try {
        expect(
          connection.runtime.session.submit({
            type: 'MoveCard',
            cardId: originalAlias,
            expectedSourceZoneId: native.reserve,
            destinationZoneId: native.hand,
          }).queued
        ).toBe(true);
        expect(
          connection.runtime.session.submit({
            ...native.move,
            cardId: originalAlias,
          }).queued
        ).toBe(true);
        native.execute(connection.envelope(1));
        const inHand = native.project();
        connection.accepted(connection.envelope(1), inHand);
        const producer = connection.envelope(2);
        if (producer.command.type !== 'MoveCard')
          throw new Error('Move producer required');
        expect(producer.command.cardId).not.toBe(originalAlias);
        expect(
          connection.runtime.session.submit({
            type: 'MoveCard',
            cardId: producer.command.cardId,
            expectedSourceZoneId: native.target,
            destinationZoneId: native.target,
            destinationIndex: 0,
          }).queued
        ).toBe(true);
        expect(
          connection.runtime.session.submit({
            ...native.follow,
            cardId: originalAlias,
          }).queued
        ).toBe(true);
        native.execute(producer);
        const landed = native.project();
        connection.accepted(producer, landed);
        for (const index of [3, 4]) {
          const sent = connection.envelope(index);
          expect(native.execute(sent)).toMatchObject({
            cardId: native.original,
          });
          connection.accepted(sent, native.project());
        }
        expect(
          connection.runtime.session
            .getSnapshot()
            .completedCommands.map((command) => command.accepted)
        ).toEqual([true, true, true, true]);
        expect(native.state().cards[native.original]!.face).toBe('down');
      } finally {
        connection.runtime.dispose();
      }
    }
  );

  it.each(
    destinations.flatMap((destination) =>
      ['newer', 'idle', 'identical', 'refused'].map((timing) => ({
        destination,
        timing,
      }))
    )
  )(
    'leaves $destination aliases stale after $timing completion',
    ({ destination, timing }) => {
      const native = fixture(destination);
      const connection = connect(native.before);
      const follow: WireGameCommand = {
        type: 'MoveCard',
        cardId: native.originalAlias,
        expectedSourceZoneId: native.target,
        destinationZoneId: native.reserve,
      };
      try {
        expect(connection.runtime.session.submit(native.move).queued).toBe(
          true
        );
        if (timing !== 'idle')
          expect(connection.runtime.session.submit(follow).queued).toBe(true);
        const producer = connection.envelope(1);
        if (timing === 'identical') {
          native.run({
            type: 'MoveCard',
            cardId: native.other,
            expectedSourceZoneId: native.reserve,
            destinationZoneId: native.hand,
          });
          native.run({
            type: 'MoveCard',
            cardId: native.other,
            expectedSourceZoneId: native.hand,
            destinationZoneId: native.target,
          });
        }
        let revision = native.state().revision;
        if (timing !== 'refused') native.execute(producer);
        revision = native.state().revision;
        const landed = native.project();
        if (timing === 'idle') connection.accepted(producer, landed);
        if (timing === 'newer' || timing === 'idle') {
          native.run({
            type: 'MoveCard',
            cardId: native.original,
            expectedSourceZoneId: native.target,
            destinationZoneId: native.deck,
          });
          native.run({
            type: 'MoveCard',
            cardId: native.other,
            expectedSourceZoneId: native.reserve,
            destinationZoneId: native.target,
          });
        }
        if (timing === 'refused') {
          native.run({
            type: 'MoveCard',
            cardId: native.other,
            expectedSourceZoneId: native.reserve,
            destinationZoneId: native.target,
          });
          const latest = native.project();
          connection.receive({
            type: 'StatePublication',
            protocolVersion: PROTOCOL_VERSION,
            coveringCommandId: producer.commandId,
            executedClientSequence: 1,
            snapshot: serializeMatchViewState(latest),
          });
          connection.receive({
            type: 'CommandResult',
            protocolVersion: PROTOCOL_VERSION,
            commandId: producer.commandId,
            clientSequence: 1,
            accepted: false,
            revision: latest.revision,
            code: 'stale_reference',
          });
        } else if (timing === 'idle') {
          connection.receive({
            type: 'StatePublication',
            protocolVersion: PROTOCOL_VERSION,
            executedClientSequence: 1,
            snapshot: serializeMatchViewState(native.project()),
          });
          expect(connection.runtime.session.submit(follow).queued).toBe(true);
        } else connection.accepted(producer, native.project(), revision);
        expect(connection.envelope(2).command).toMatchObject({
          cardId:
            timing === 'idle'
              ? landed.zones[native.target]!.cards[0]!.id
              : native.originalAlias,
        });
        expect(native.attempt(connection.envelope(2))).toMatchObject({
          accepted: false,
          code: 'stale_reference',
        });
        expect(native.state().cards[native.other]!.face).toBe('up');
      } finally {
        connection.runtime.dispose();
      }
    }
  );

  it.each(['multiplayer', 'solo'] as const)(
    'preserves the own-seat alias with a fresh identical peer arrival in %s',
    (mode) => {
      const native = fixture('board', mode, false);
      const connection = connect(native.before);
      try {
        expect(connection.runtime.session.submit(native.move).queued).toBe(
          true
        );
        expect(
          connection.runtime.session.submit({
            type: 'MoveCard',
            cardId: native.originalAlias,
            expectedSourceZoneId: native.target,
            destinationZoneId: native.reserve,
          }).queued
        ).toBe(true);
        native.run({
          type: 'MoveCard',
          cardId: native.other,
          expectedSourceZoneId: native.reserve,
          destinationZoneId: native.hand,
        });
        native.run({
          type: 'MoveCard',
          cardId: native.other,
          expectedSourceZoneId: native.hand,
          destinationZoneId: native.target,
        });
        native.execute(connection.envelope(1));
        connection.accepted(connection.envelope(1), native.project());
        expect(connection.envelope(2).command).toMatchObject({
          cardId: native.originalAlias,
        });
        expect(native.execute(connection.envelope(2))).toMatchObject({
          cardId: native.original,
        });
        expect(native.state().cards[native.other]!.face).toBe('up');
      } finally {
        connection.runtime.dispose();
      }
    }
  );
});
