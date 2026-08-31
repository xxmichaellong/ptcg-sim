import {
  RemoteGameSession,
  type ClientSessionScheduler,
  type SessionSocket,
  type SessionSocketFactory,
  type SessionSocketHandlers,
} from '../../packages/client-session/src/index.js';
import { submitBoardDrop } from '../../apps/web/src/board/resolveBoardDrop.js';
import {
  RoomSessionHub,
  WebCryptoAuthoritySource,
  initializeNewRoom,
  type RuntimeConnection,
} from '../../apps/server/src/index.js';
import {
  DEFAULT_AUTHORITY_POLICY,
  RoomAuthorityCoordinator,
  type AuthoritySnapshotStore,
  type PersistedAdmissionTransaction,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '../../packages/room-authority/src/index.js';
import { createBoardScene } from '../../packages/renderer-contract/src/index.js';
import { describe, expect, it } from 'vitest';

class MemoryRoomStore implements AuthoritySnapshotStore {
  snapshot?: RoomAuthoritySnapshot;
  readonly commandCommits: PersistedAuthorityTransaction[] = [];

  async initialize(snapshot: RoomAuthoritySnapshot): Promise<void> {
    if (this.snapshot) throw new Error('Room is already initialized');
    this.snapshot = snapshot;
  }

  async load(): Promise<RoomAuthoritySnapshot | undefined> {
    return this.snapshot;
  }

  async commit(transaction: PersistedAuthorityTransaction): Promise<void> {
    if (
      transaction.expectedAuthorityVersion !== this.snapshot?.authorityVersion
    ) {
      throw new Error('Authority version conflict');
    }
    this.commandCommits.push(transaction);
    this.snapshot = transaction.snapshot;
  }

  async commitAdmission(
    transaction: PersistedAdmissionTransaction
  ): Promise<void> {
    if (
      transaction.expectedAuthorityVersion !== this.snapshot?.authorityVersion
    ) {
      throw new Error('Admission version conflict');
    }
    this.snapshot = transaction.snapshot;
  }
}

class ManualScheduler implements ClientSessionScheduler {
  private nextId = 1;
  readonly tasks = new Map<number, () => void>();

  schedule = (callback: () => void): number => {
    const id = this.nextId++;
    this.tasks.set(id, callback);
    return id;
  };

  cancel = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  runNext(): void {
    const entry = this.tasks.entries().next().value;
    if (!entry) throw new Error('No reconnect is scheduled');
    this.tasks.delete(entry[0]);
    entry[1]();
  }
}

class InMemorySocketLink implements SessionSocket {
  readonly clientFrames: string[] = [];
  dropServerFrames = false;
  private disconnected = false;

  readonly connection: RuntimeConnection;

  constructor(
    id: string,
    private readonly hub: RoomSessionHub,
    private readonly handlers: SessionSocketHandlers,
    private readonly enqueue: (operation: () => Promise<void>) => void
  ) {
    this.connection = {
      id,
      send: (frame) => {
        if (!this.dropServerFrames) this.handlers.message(frame);
      },
      close: (code, reason) => {
        if (this.disconnected) return;
        this.disconnected = true;
        this.hub.disconnect(id);
        this.handlers.close({ code, reason, wasClean: code === 1000 });
      },
    };
  }

  send = (frame: string): void => {
    if (this.disconnected) throw new Error('Socket is disconnected');
    this.clientFrames.push(frame);
    this.enqueue(() => this.hub.handleFrame(this.connection, frame));
  };

  close = (): void => {
    if (this.disconnected) return;
    this.disconnected = true;
    this.hub.disconnect(this.connection.id);
  };

  open(): void {
    this.handlers.open();
  }

  networkDrop(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.hub.disconnect(this.connection.id);
    this.handlers.close({
      code: 1006,
      reason: 'simulated network loss',
      wasClean: false,
    });
  }
}

class InMemorySocketFactory implements SessionSocketFactory {
  readonly links: InMemorySocketLink[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly hub: RoomSessionHub,
    private readonly connectionPrefix: string
  ) {}

  open = (_url: string, handlers: SessionSocketHandlers): SessionSocket => {
    const link = new InMemorySocketLink(
      `${this.connectionPrefix}-${this.links.length + 1}`,
      this.hub,
      handlers,
      (operation) => {
        this.tail = this.tail.then(operation);
      }
    );
    this.links.push(link);
    return link;
  };

  latest(): InMemorySocketLink {
    const link = this.links.at(-1);
    if (!link) throw new Error('No socket link exists');
    return link;
  }

  async flush(): Promise<void> {
    for (;;) {
      const current = this.tail;
      await current;
      if (current === this.tail) return;
    }
  }
}

const fixture = async () => {
  const cryptoSource = new WebCryptoAuthoritySource();
  const store = new MemoryRoomStore();
  const initialized = await initializeNewRoom(
    {
      matchId: 'multiplayer-client-contract',
      playerOneCardBackUrl: '/blue.png',
      playerTwoCardBackUrl: '/red.png',
      spectatorsAllowed: true,
    },
    store,
    cryptoSource
  );
  const coordinator = new RoomAuthorityCoordinator(
    initialized.snapshot,
    store,
    {
      commandContext: cryptoSource,
      opaqueIds: cryptoSource,
      policy: DEFAULT_AUTHORITY_POLICY,
    }
  );
  const hub = new RoomSessionHub(coordinator, 'server-build', {
    store,
    admission: {
      crypto: cryptoSource,
      opaqueIds: cryptoSource,
      persistence: store,
    },
  });
  return { ...initialized, store, hub };
};

const connectClient = async (input: {
  readonly hub: RoomSessionHub;
  readonly name: string;
  readonly role: 'player' | 'spectator';
  readonly capability: string;
  readonly scheduler?: ManualScheduler;
}) => {
  const factory = new InMemorySocketFactory(input.hub, input.name);
  let nextCommandId = 0;
  const session = new RemoteGameSession({
    socketFactory: factory,
    scheduler: input.scheduler,
    random: () => 0.5,
    createCommandId: () => `${input.name}-command-${++nextCommandId}`,
  });
  session.connect({
    url: 'ws://in-memory.test/room',
    buildId: 'client-build',
    roomCode: 'ROOM',
    displayName: input.name,
    requestedRole: input.role,
    admissionTicket: input.capability,
  });
  factory.latest().open();
  await factory.flush();
  return { factory, session };
};

describe('client/server multiplayer contract', () => {
  it('carries a renderer drop through the client queue and room authority', async () => {
    const room = await fixture();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
    });
    const playerId = player.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing admitted player identity');

    expect(
      player.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `integration-definition-${index}`,
            name: `Integration card ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `/integration-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(player.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await player.factory.flush();

    const before = player.session.getSnapshot().view;
    if (!before) throw new Error('Missing authoritative player view');
    const hand = Object.values(before.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    const card = hand?.cards[0];
    if (!hand || !card) throw new Error('Setup did not publish a hand card');
    const scene = createBoardScene(before, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });

    let submitted = false;
    const resolution = submitBoardDrop(
      before,
      scene,
      {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: `slot:${playerId}:bench`,
      },
      (command) => {
        submitted = player.session.submit(command).queued;
      }
    );
    expect(resolution).toMatchObject({
      ok: true,
      command: {
        type: 'MoveCardToPlay',
        cardId: card.id,
        expectedSourceZoneId: hand.id,
        boardPlayerId: playerId,
        slot: 'bench',
      },
    });
    if (!resolution.ok) throw new Error('Drop did not resolve');
    expect(submitted).toBe(true);
    await player.factory.flush();

    const after = player.session.getSnapshot().view;
    const stackId = after?.boards[playerId]?.benchStackIds[0];
    expect(after?.revision).toBe(3);
    expect(stackId).toBeDefined();
    expect(after?.stacks[stackId!]?.evolutionCards).toContainEqual(
      expect.objectContaining({ id: card.id })
    );
    expect(after?.zones[hand.id]?.cards).not.toContainEqual(
      expect.objectContaining({ id: card.id })
    );
    expect(player.session.getSnapshot().pendingCommands).toEqual([]);
    if (!after || !stackId) throw new Error('Missing published bench stack');
    const movementScene = createBoardScene(after, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    submitted = false;
    const movement = submitBoardDrop(
      after,
      movementScene,
      {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: `slot:${playerId}:active`,
      },
      (command) => {
        submitted = player.session.submit(command).queued;
      }
    );
    expect(movement).toMatchObject({
      ok: true,
      command: {
        type: 'MovePlayStack',
        stackId,
        expectedSourceSlot: 'bench',
        destinationSlot: 'active',
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const moved = player.session.getSnapshot().view;
    expect(moved?.revision).toBe(4);
    expect(moved?.boards[playerId]?.activeStackId).toBe(stackId);
    expect(moved?.stacks[stackId]?.slot).toBe('active');
    if (!moved) throw new Error('Missing published active stack');
    const departureScene = createBoardScene(moved, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    submitted = false;
    const departure = submitBoardDrop(
      moved,
      departureScene,
      {
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: `zone:${playerId}:discard`,
      },
      (command) => {
        submitted = player.session.submit(command).queued;
      }
    );
    expect(departure).toMatchObject({
      ok: true,
      command: {
        type: 'MoveCardFromStack',
        expectedStackId: stackId,
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const departed = player.session.getSnapshot().view;
    expect(departed?.revision).toBe(5);
    expect(departed?.stacks[stackId]).toBeUndefined();
    expect(departed?.zones[`zone:${playerId}:discard`]?.cards).toContainEqual(
      expect.objectContaining({ id: card.id })
    );
    expect(room.store.commandCommits).toHaveLength(5);
  });

  it('persists dependent cards across reconnect and restores them through the renderer contract', async () => {
    const room = await fixture();
    const scheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
      scheduler,
    });
    const playerId = player.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing admitted player identity');
    expect(
      player.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `staging-definition-${index}`,
            name: `Staging Pokémon ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `/staging-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(player.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await player.factory.flush();

    let view = player.session.getSnapshot().view;
    const hand = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    const [baseCard, topCard] = hand?.cards ?? [];
    if (!view || !hand || !baseCard || !topCard) {
      throw new Error('Setup did not publish two hand cards');
    }
    expect(
      player.session.submit({
        type: 'MoveCardToPlay',
        cardId: baseCard.id,
        expectedSourceZoneId: hand.id,
        boardPlayerId: playerId,
        slot: 'active',
      }).queued
    ).toBe(true);
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    const oldStackId = view?.boards[playerId]?.activeStackId;
    if (!view || !oldStackId) throw new Error('Base stack was not published');
    expect(
      player.session.submit({
        type: 'MoveCardToPlay',
        cardId: topCard.id,
        expectedSourceZoneId: hand.id,
        boardPlayerId: playerId,
        slot: 'active',
        targetStackId: oldStackId,
      }).queued
    ).toBe(true);
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    const publishedTop = view?.stacks[oldStackId]?.evolutionCards.at(-1);
    if (!view || !publishedTop) throw new Error('Evolution was not published');
    expect(
      player.session.submit({
        type: 'MoveCardFromStack',
        cardId: publishedTop.id,
        expectedStackId: oldStackId,
        destinationZoneId: `zone:${playerId}:discard`,
      }).queued
    ).toBe(true);
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    const stagedBeforeReconnect =
      view?.workAreas[playerId]?.attachmentResolution;
    expect(view?.stacks[oldStackId]).toBeUndefined();
    expect(stagedBeforeReconnect).toMatchObject({
      sourceStackId: oldStackId,
      suggestedSlot: 'active',
      attachmentCards: [],
    });
    expect(stagedBeforeReconnect?.evolutionCards).toHaveLength(1);

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    const staged = view?.workAreas[playerId]?.attachmentResolution;
    const representative = staged?.evolutionCards.at(-1);
    if (!view || !staged || !representative) {
      throw new Error('Staged stack did not survive session resume');
    }
    expect(staged.id).toBe(stagedBeforeReconnect?.id);
    const scene = createBoardScene(view, {
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
      bottomPlayerId: playerId,
      splitRatio: 0.5,
      geometryVersion: 1,
    });
    let submitted = false;
    const restore = submitBoardDrop(
      view,
      scene,
      {
        kind: 'CardDropRequested',
        cardId: representative.id,
        targetId: `slot:${playerId}:active`,
      },
      (command) => {
        submitted = player.session.submit(command).queued;
      }
    );
    expect(restore).toMatchObject({
      ok: true,
      command: {
        type: 'RestoreStagedStack',
        expectedWorkAreaId: staged.id,
        destinationSlot: 'active',
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const restored = player.session.getSnapshot().view;
    const restoredStackId = restored?.boards[playerId]?.activeStackId;
    expect(restoredStackId).toBeDefined();
    expect(restoredStackId).not.toBe(oldStackId);
    expect(restored?.stacks[restoredStackId!]?.evolutionCards).toHaveLength(1);
    expect(restored?.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(room.store.commandCommits).toHaveLength(6);
  });

  it('publishes one authoritative revision to a player and spectator', async () => {
    const room = await fixture();
    const spectatorCapability = room.credentials.spectatorCapability;
    if (!spectatorCapability) throw new Error('Missing spectator capability');
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
    });
    const spectator = await connectClient({
      hub: room.hub,
      name: 'Observer',
      role: 'spectator',
      capability: spectatorCapability,
    });

    expect(player.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      role: 'player',
      view: { revision: 0 },
    });
    expect(spectator.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      role: 'spectator',
      view: { revision: 0 },
    });
    expect(spectator.session.submit({ type: 'FlipCoin' })).toEqual({
      queued: false,
      reason: 'spectator',
    });

    expect(player.session.submit({ type: 'FlipCoin' }).queued).toBe(true);
    await player.factory.flush();

    expect(player.session.getSnapshot()).toMatchObject({
      view: { revision: 1 },
      pendingCommands: [],
      completedCommands: [{ accepted: true, revision: 1 }],
    });
    expect(spectator.session.getSnapshot()).toMatchObject({
      view: { revision: 1 },
    });
    expect(room.store.commandCommits).toHaveLength(1);
  });

  it('recovers a committed-but-undelivered command through exact replay', async () => {
    const room = await fixture();
    const scheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
      scheduler,
    });
    const firstLink = player.factory.latest();
    firstLink.dropServerFrames = true;

    player.session.submit({ type: 'FlipCoin' });
    await player.factory.flush();
    const originalCommand = firstLink.clientFrames[1];
    expect(room.store.snapshot?.state.revision).toBe(1);
    expect(player.session.getSnapshot()).toMatchObject({
      view: { revision: 0 },
      pendingCommands: [{ state: 'in_flight' }],
    });

    firstLink.networkDrop();
    expect(player.session.getSnapshot().phase).toBe('reconnecting');
    scheduler.runNext();
    const secondLink = player.factory.latest();
    secondLink.open();
    await player.factory.flush();

    expect(secondLink.clientFrames[1]).toBe(originalCommand);
    expect(player.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      view: { revision: 1 },
      pendingCommands: [],
      completedCommands: [{ accepted: true, revision: 1 }],
    });
    expect(room.store.commandCommits).toHaveLength(1);
  });

  it('replaces equal-revision metadata from an authoritative reconnect Welcome', async () => {
    const room = await fixture();
    const spectatorCapability = room.credentials.spectatorCapability;
    if (!spectatorCapability) throw new Error('Missing spectator capability');
    const scheduler = new ManualScheduler();
    const spectator = await connectClient({
      hub: room.hub,
      name: 'Observer',
      role: 'spectator',
      capability: spectatorCapability,
      scheduler,
    });
    const firstPlayerId = spectator.session.getSnapshot().view?.playerOrder[0];
    if (!firstPlayerId) throw new Error('Missing player in spectator view');
    expect(
      spectator.session.getSnapshot().view?.players[firstPlayerId]?.displayName
    ).toBe('Player 1');

    await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
    });
    const firstLink = spectator.factory.latest();
    firstLink.networkDrop();
    scheduler.runNext();
    spectator.factory.latest().open();
    await spectator.factory.flush();

    expect(spectator.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      view: { revision: 0 },
    });
    expect(
      spectator.session.getSnapshot().view?.players[firstPlayerId]?.displayName
    ).toBe('Blue');
  });
});
