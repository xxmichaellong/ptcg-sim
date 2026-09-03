import {
  type RoomCreationResponse,
  type SerializedMatchViewState,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';

import {
  admissionHelloFrame,
  commandFrame,
  connect,
  createRoom,
  issueAdmissionTicket,
  nextServerFrames,
  type RuntimeAdmissionIdentity,
  type RuntimeServerFrame,
  type RuntimeWelcome,
  utf8Bytes,
} from './runtime-harness.js';

export interface RuntimeSessionDriver {
  readonly label: 'player_one' | 'player_two' | 'spectator';
  readonly socket: WebSocket;
  readonly welcome: RuntimeWelcome;
  nextClientSequence: number;
  snapshot: SerializedMatchViewState;
}

export interface RuntimeCommandMeasurement {
  readonly label: string;
  readonly commandType: WireGameCommand['type'];
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly requestCodeUnits: number;
  readonly resultBytes: number;
  readonly publicationBytesByRecipient: Readonly<Record<string, number>>;
  readonly aggregatePublicationBytes: number;
  readonly maximumFrameBytes: number;
  readonly maximumFrameCodeUnits: number;
  readonly deliveredFrameCount: number;
  readonly revision: number;
}

export interface RepresentativeRuntime {
  readonly created: RoomCreationResponse;
  readonly sessions: readonly RuntimeSessionDriver[];
  readonly fixtureCommands: readonly RuntimeCommandMeasurement[];
  readonly playerOneId: string;
  readonly playerTwoId: string;
  dispose(): void;
}

const categories = ['Pokémon', 'Trainer', 'Energy'] as const;

const deckEntries = (owner: 'one' | 'two') =>
  Array.from({ length: 60 }, (_, index) => {
    const serial = String(index + 1).padStart(3, '0');
    const asset = `https://assets.example/performance/${owner}/${serial}`;
    return {
      definition: {
        id: `performance-${owner}-definition-${serial}`,
        name: `Performance ${owner} card ${serial}`,
        category: categories[index % categories.length]!,
        imageUrl: `${asset}.webp`,
        imageUrlSmall: `${asset}-small.webp`,
      },
      count: 1,
    };
  });

const commandResult = (
  frames: readonly RuntimeServerFrame[],
  commandId: string
): Extract<ServerMessage, { readonly type: 'CommandResult' }> => {
  const result = frames.find(
    (frame) =>
      frame.message.type === 'CommandResult' &&
      frame.message.commandId === commandId
  )?.message;
  if (!result || result.type !== 'CommandResult') {
    throw new Error(`Command ${commandId} did not return a CommandResult`);
  }
  return result;
};

const publication = (
  frames: readonly RuntimeServerFrame[],
  commandId: string
): RuntimeServerFrame & {
  readonly message: Extract<
    ServerMessage,
    { readonly type: 'StatePublication' }
  >;
} => {
  const frame = frames.find(
    (candidate) =>
      candidate.message.type === 'StatePublication' &&
      candidate.message.coveringCommandId === commandId
  );
  if (!frame || frame.message.type !== 'StatePublication') {
    throw new Error(`Command ${commandId} did not publish state`);
  }
  return frame as RuntimeServerFrame & {
    readonly message: Extract<
      ServerMessage,
      { readonly type: 'StatePublication' }
    >;
  };
};

let commandSerial = 0;

export const executeRuntimeCommand = async (
  actor: RuntimeSessionDriver,
  sessions: readonly RuntimeSessionDriver[],
  label: string,
  command: WireGameCommand
): Promise<RuntimeCommandMeasurement> => {
  const actorIndex = sessions.indexOf(actor);
  if (actorIndex === -1) {
    throw new Error('Runtime command actor is not part of the recipient set');
  }
  commandSerial += 1;
  const commandId = `performance-command-${String(commandSerial).padStart(4, '0')}`;
  const responsePromises = sessions.map((session) =>
    nextServerFrames(session.socket, session === actor ? 2 : 1)
  );
  const rawRequest = commandFrame(
    actor.welcome,
    actor.nextClientSequence,
    actor.snapshot.revision,
    commandId,
    command
  );
  const startedAt = performance.now();
  actor.socket.send(rawRequest);
  const responses = await Promise.all(responsePromises);
  const durationMs = performance.now() - startedAt;

  const actorFrames = responses[actorIndex]!;
  const result = commandResult(actorFrames, commandId);
  if (!result.accepted) {
    throw new Error(
      `Representative command ${label} was rejected with ${result.code ?? 'unknown'}`
    );
  }

  const publicationBytesByRecipient: Record<string, number> = {};
  let maximumFrameBytes = 0;
  let maximumFrameCodeUnits = 0;
  let deliveredFrameCount = 0;
  let resultBytes = 0;

  sessions.forEach((session, index) => {
    const frames = responses[index]!;
    const stateFrame = publication(frames, commandId);
    session.snapshot = stateFrame.message.snapshot;
    publicationBytesByRecipient[session.label] = stateFrame.bytes;
    deliveredFrameCount += frames.length;
    for (const frame of frames) {
      maximumFrameBytes = Math.max(maximumFrameBytes, frame.bytes);
      maximumFrameCodeUnits = Math.max(maximumFrameCodeUnits, frame.raw.length);
      if (frame.message.type === 'CommandResult') resultBytes = frame.bytes;
    }
  });

  if (
    !sessions.every((session) => session.snapshot.revision === result.revision)
  ) {
    throw new Error(
      `Command ${commandId} produced divergent session revisions`
    );
  }
  actor.nextClientSequence += 1;

  return {
    label,
    commandType: command.type,
    durationMs,
    requestBytes: utf8Bytes(rawRequest),
    requestCodeUnits: rawRequest.length,
    resultBytes,
    publicationBytesByRecipient,
    aggregatePublicationBytes: Object.values(
      publicationBytesByRecipient
    ).reduce((total, bytes) => total + bytes, 0),
    maximumFrameBytes,
    maximumFrameCodeUnits,
    deliveredFrameCount,
    revision: result.revision,
  };
};

const admit = async (
  created: RoomCreationResponse,
  label: RuntimeSessionDriver['label'],
  capability: string,
  identity: RuntimeAdmissionIdentity
): Promise<RuntimeSessionDriver> => {
  const ticket = await issueAdmissionTicket(created, capability, identity);
  const socket = await connect(created);
  const welcomePromise = nextServerFrames(socket, 1);
  socket.send(admissionHelloFrame(created, ticket, identity));
  const message = (await welcomePromise)[0]?.message;
  if (!message || message.type !== 'Welcome') {
    socket.close(1011, 'Representative admission failed');
    throw new Error(`Expected Welcome for ${label}`);
  }
  return {
    label,
    socket,
    welcome: message,
    nextClientSequence: message.nextClientSequence,
    snapshot: message.snapshot,
  };
};

export const createRepresentativeRuntime =
  async (): Promise<RepresentativeRuntime> => {
    const created = await createRoom();
    const spectatorCapability = created.credentials.spectatorCapability;
    if (!spectatorCapability) {
      throw new Error('Representative runtime requires spectator admission');
    }

    const admittedSessions: RuntimeSessionDriver[] = [];
    try {
      const playerOne = await admit(
        created,
        'player_one',
        created.credentials.playerOneSeatCapability,
        { displayName: 'Performance Player One', requestedRole: 'player' }
      );
      admittedSessions.push(playerOne);
      const playerTwo = await admit(
        created,
        'player_two',
        created.credentials.playerTwoSeatCapability,
        { displayName: 'Performance Player Two', requestedRole: 'player' }
      );
      admittedSessions.push(playerTwo);
      const spectator = await admit(created, 'spectator', spectatorCapability, {
        displayName: 'Performance Spectator',
        requestedRole: 'spectator',
      });
      admittedSessions.push(spectator);
      const sessions = [playerOne, playerTwo, spectator] as const;
      if (!playerOne.welcome.playerId || !playerTwo.welcome.playerId) {
        throw new Error('Representative players were not assigned seats');
      }

      const fixtureCommands: RuntimeCommandMeasurement[] = [];
      fixtureCommands.push(
        await executeRuntimeCommand(playerOne, sessions, 'load_player_one', {
          type: 'LoadDeck',
          entries: deckEntries('one'),
        })
      );
      fixtureCommands.push(
        await executeRuntimeCommand(playerTwo, sessions, 'load_player_two', {
          type: 'LoadDeck',
          entries: deckEntries('two'),
        })
      );
      fixtureCommands.push(
        await executeRuntimeCommand(playerOne, sessions, 'setup_player_one', {
          type: 'SetupPlayer',
        })
      );
      fixtureCommands.push(
        await executeRuntimeCommand(playerTwo, sessions, 'setup_player_two', {
          type: 'SetupPlayer',
        })
      );
      fixtureCommands.push(
        await executeRuntimeCommand(playerOne, sessions, 'inspect_player_one', {
          type: 'ExtractDeckCardsForInspection',
          ownerPlayerId: playerOne.welcome.playerId,
          count: 47,
          edge: 'top',
          visibility: 'public',
        })
      );
      fixtureCommands.push(
        await executeRuntimeCommand(playerTwo, sessions, 'inspect_player_two', {
          type: 'ExtractDeckCardsForInspection',
          ownerPlayerId: playerTwo.welcome.playerId,
          count: 47,
          edge: 'top',
          visibility: 'public',
        })
      );

      let disposed = false;
      return {
        created,
        sessions,
        fixtureCommands,
        playerOneId: playerOne.welcome.playerId,
        playerTwoId: playerTwo.welcome.playerId,
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const session of sessions) {
            session.socket.close(1000, 'Representative runtime complete');
          }
        },
      };
    } catch (error) {
      for (const session of admittedSessions) {
        session.socket.close(1011, 'Representative runtime failed');
      }
      throw error;
    }
  };
