import {
  RemoteGameSession,
  type ClientSessionState,
  type SessionSocket,
  type SessionSocketHandlers,
} from '@ptcgsim/client-session';
import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  type CommandContext,
  type GameCommand,
  type MatchState,
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
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  DEFAULT_AUTHORITY_POLICY,
  emptyProjectionIdentityState,
  projectRecipient,
  RoomAuthorityCoordinator,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import { LegacyGamePresentationRuntime } from '../presentation/LegacyGamePresentationRuntime.js';
import { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';

export const you = asPlayerId('tutorial-you');
export const them = asPlayerId('tutorial-them');

/** Ids made in order, and shuffles that keep it: a test can read the deal. */
const orderedCommandContext = (): CommandContext => {
  let next = 0;
  return {
    nextCardId: (definitionId, copy) =>
      asCardInstanceId(`${definitionId}#${String(copy)}#${String(next++)}`),
    nextStackId: () => asStackId(`stack-${String(next++)}`),
    nextInspectionId: () => asInspectionId(`inspection-${String(next++)}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${String(next++)}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const practiceMatch = (): MatchState =>
  createEmptyMatch(asMatchId('tutorial'), [
    { playerId: you, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: them, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);

/**
 * The practice table as the player has it: a Solo room on the real room
 * authority, reached by the real client session over a socket in memory,
 * with its log as the page keeps it. The room shows cards under aliases,
 * renames one that crosses a hidden zone or comes back by an Undo, opens
 * its windows (the attached cards' when a Pokémon is taken apart) and
 * takes moves back, as in play. Shuffles keep order, so a test can read
 * the deal. Await `settle` after a move for the room's answer.
 */
export const realPracticeRoom = async () => {
  const sessionId = 'practice-session';
  const resumeToken = 'practice-room-resume-capability-000000000001';
  const viewer = { kind: 'player', playerId: you } as const;
  let opaque = 0;
  const opaqueIds = {
    nextOpaqueId: (kind: 'card' | 'definition') =>
      `practice-${kind}-${String((opaque += 1)).padStart(8, '0')}`,
  };
  const state = practiceMatch();
  const welcome = projectRecipient(
    state,
    viewer,
    emptyProjectionIdentityState(),
    opaqueIds,
    'solo'
  );
  let committed: RoomAuthoritySnapshot = {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 0,
    mode: 'solo',
    state,
    replayHistory: createReplayHistory(state),
    identities: welcome.identities,
    sessions: {
      [sessionId]: {
        id: sessionId,
        viewer,
        displayName: 'Blue',
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
  const authority = new RoomAuthorityCoordinator(
    committed,
    {
      load: async () => committed,
      commit: async (transaction) => {
        committed = transaction.snapshot;
      },
    },
    {
      commandContext: orderedCommandContext(),
      opaqueIds,
      policy: DEFAULT_AUTHORITY_POLICY,
    }
  );
  // The room's end of the socket: the handshake, then each command.
  let answering: Promise<void> = Promise.resolve();
  const socketFactory = {
    open: (_url: string, handlers: SessionSocketHandlers): SessionSocket => {
      const reply = (message: ServerMessage): void =>
        handlers.message(JSON.stringify(message));
      queueMicrotask(handlers.open);
      return {
        send: (frame) => {
          const message = JSON.parse(frame) as ClientMessage;
          if (message.type === 'Hello') {
            answering = answering.then(() =>
              reply({
                type: 'Welcome',
                protocolVersion: PROTOCOL_VERSION,
                buildId: 'practice-room',
                role: 'player',
                playerId: you,
                sessionId,
                resumeToken,
                nextClientSequence: 1,
                snapshot: serializeMatchViewState(welcome.snapshot),
              })
            );
          } else if (message.type === 'Command') {
            answering = answering.then(async () => {
              const result = await authority.submit(message);
              for (const delivery of result.deliveries) {
                if (delivery.sessionId === sessionId) reply(delivery.message);
              }
            });
          }
        },
        close: () => undefined,
      };
    },
  };
  const session = new RemoteGameSession({
    socketFactory,
    // No heartbeats, deadlines or reconnects: this room always answers.
    scheduler: { schedule: () => 0, cancel: () => undefined },
    isOnline: () => true,
  });
  const replay = new ReplaySessionCoordinator(session);
  const presentation = new LegacyGamePresentationRuntime({
    live: session,
    replay,
    scheduleAnnouncementClear: () => () => undefined,
  });
  /** Waits until the room has answered every command sent to it. */
  const settle = async (): Promise<void> => {
    for (;;) {
      const waited = answering;
      await waited;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (
        waited === answering &&
        session.getSnapshot().pendingCommands.length === 0
      ) {
        return;
      }
    }
  };
  session.connect({
    url: 'wss://practice.test/v2/rooms/PRACTICE/connect',
    buildId: 'practice-room',
    roomCode: 'PRACTICE',
    displayName: 'Blue',
    requestedRole: 'player',
    admissionTicket: 'practice-room-admission-capability-00000001',
    resumeToken,
  });
  await settle();
  return {
    session,
    presentation,
    /** The room's own record: its state, history and aliases. */
    authority: () => authority.currentSnapshot(),
    settle,
    dispose: (): void => {
      presentation.dispose();
      replay.dispose();
      session.disconnect();
    },
  };
};

/**
 * A Solo room in miniature: the real game core runs each command, and the
 * one player sees every card (Solo shows both hands), as the room would
 * answer them. Shuffles keep order, so the test can read the deal. A card
 * keeps its id wherever it goes, and there is no Undo nor any window:
 * what turns on those is tried on `realPracticeRoom`.
 */
export const fakePracticeRoom = (
  options: { readonly refuse?: string } = {}
) => {
  const context = orderedCommandContext();
  let match = practiceMatch();
  const sent: WireGameCommand[] = [];
  const completed: ClientSessionState['completedCommands'][number][] = [];
  const listeners = new Set<() => void>();
  const view = (): MatchViewState => {
    const known = (id: string) => {
      const card = match.cards[id]!;
      return {
        kind: 'known' as const,
        id,
        definitionId: card.definitionId,
        ownerId: card.ownerId,
        category: card.currentCategory,
        face: card.face,
        orientationQuarterTurns: card.orientationQuarterTurns,
        abilityUsed: false,
        publiclyRevealed: false,
      };
    };
    return {
      matchId: match.matchId,
      revision: match.revision,
      lifecycle: match.lifecycle,
      viewer: { kind: 'player', playerId: you },
      playerOrder: match.playerOrder,
      players: {},
      definitions: Object.fromEntries(
        Object.entries(match.definitions).map(([id, definition]) => [
          id,
          { ...definition, id },
        ])
      ),
      zones: Object.fromEntries(
        Object.entries(match.zones).map(([id, zone]) => [
          id,
          {
            id,
            kind: zone.kind,
            ownerId: zone.ownerId,
            cards: zone.cardIds.map(known),
          },
        ])
      ),
      boards: match.boards,
      stacks: Object.fromEntries(
        Object.entries(match.stacks).map(([id, stack]) => [
          id,
          {
            ...stack,
            evolutionCards: stack.evolutionCardIds.map(known),
            attachmentCards: stack.attachmentCardIds.map(known),
          },
        ])
      ),
      workAreas: {},
    } as unknown as MatchViewState;
  };
  const toGame = (command: WireGameCommand): GameCommand => {
    const { targetPlayerId, ...rest } = command as WireGameCommand & {
      readonly targetPlayerId?: string;
    };
    if (command.type === 'LoadDeck' || command.type === 'DrawCards') {
      return { ...rest, playerId: asPlayerId(targetPlayerId!) } as GameCommand;
    }
    if (command.type === 'PlaceCardOnPlayStack') {
      // The room acts for the seat whose hand the card leaves (Solo).
      const owner = command.expectedSourceId.split(':')[1]!;
      return { ...rest, playerId: asPlayerId(owner) } as GameCommand;
    }
    return rest as GameCommand;
  };
  let state: ClientSessionState = {
    phase: 'ready',
    role: 'player',
    playerId: you,
    view: view(),
    nextClientSequence: 1,
    pendingCommands: [],
    completedCommands: [],
    presentationEvents: [],
    chatMessages: [],
    presence: [],
    notices: [],
    replayLoading: false,
    reconnectAttempt: 0,
  };
  const publish = (): void => {
    state = { ...state, view: view(), completedCommands: [...completed] };
    for (const listener of [...listeners]) listener();
  };
  const feed = { items: [], newestItemId: null };
  return {
    sent,
    match: () => match,
    /** The session reconnecting, failed or ready again. */
    setPhase: (phase: ClientSessionState['phase']): void => {
      state = { ...state, phase };
      for (const listener of [...listeners]) listener();
    },
    // The practice table's log, as the host reads it: empty here.
    presentation: {
      activityFeed: {
        subscribe: () => () => undefined,
        getSnapshot: () => feed,
      },
      clearActivity: () => true,
    },
    session: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      submit: (command: WireGameCommand) => {
        sent.push(command);
        const commandId = `command-${String(sent.length)}`;
        // The room answers a moment later, as over the wire.
        queueMicrotask(() => {
          const refused = options.refuse === command.type;
          const executed = refused
            ? { accepted: false as const }
            : executeCommand(match, toGame(command), context);
          if (executed.accepted) match = executed.state;

          completed.push({
            commandId,
            clientSequence: sent.length,
            accepted: executed.accepted,
            revision: match.revision,
            ...(executed.accepted
              ? {}
              : { code: 'precondition_failed' as const }),
          });
          publish();
        });
        return {
          queued: true,
          commandId,
          clientSequence: sent.length,
        } as const;
      },
    },
  };
};
