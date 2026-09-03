import {
  RemoteGameSession,
  type ClientSessionScheduler,
  type SessionSocket,
  type SessionSocketFactory,
  type SessionSocketHandlers,
} from '../../packages/client-session/src/index.js';
import { submitBoardDrop } from '../../apps/web/src/board/resolveBoardDrop.js';
import {
  submitDeckRelativeCardAction,
  submitPrizeDeckBottomAction,
} from '../../apps/web/src/board/resolveDeckRelativeAction.js';
import { submitCardAnnotationAction } from '../../apps/web/src/board/resolveCardAnnotationAction.js';
import { submitInspectionCardsAction } from '../../apps/web/src/board/resolveInspectionCardsAction.js';
import { submitLooseBoardAction } from '../../apps/web/src/board/resolveLooseBoardAction.js';
import { submitLifecycleAction } from '../../apps/web/src/board/resolveLifecycleAction.js';
import { submitOncePerGameAction } from '../../apps/web/src/board/resolveOncePerGameAction.js';
import {
  resolveZoneInspectionAction,
  submitPrivateInspectionAction,
} from '../../apps/web/src/board/resolvePrivateInspectionAction.js';
import { submitRandomFaceDownAction } from '../../apps/web/src/board/resolveRandomFaceDownAction.js';
import { submitSoloUndoAction } from '../../apps/web/src/board/resolveSoloUndoAction.js';
import {
  resolvePrizeVisibilityAction,
  submitPublicVisibilityAction,
} from '../../apps/web/src/board/resolvePublicVisibilityAction.js';
import { submitStackStateAction } from '../../apps/web/src/board/resolveStackStateAction.js';
import { submitStagedCardsAction } from '../../apps/web/src/board/resolveStagedCardsAction.js';
import { submitTableAction } from '../../apps/web/src/board/resolveTableAction.js';
import {
  RoomSessionHub,
  WebCryptoAuthoritySource,
  initializeNewRoom,
  NOOP_SERVER_TELEMETRY,
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

const allowRoomOperations = {
  attempt: async () => ({ allowed: true, remaining: 1 }) as const,
};

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

const fixture = async (mode: 'solo' | 'multiplayer' = 'multiplayer') => {
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
    cryptoSource,
    10_000
  );
  const authoritySnapshot = { ...initialized.snapshot, mode };
  store.snapshot = authoritySnapshot;
  const coordinator = new RoomAuthorityCoordinator(authoritySnapshot, store, {
    commandContext: cryptoSource,
    opaqueIds: cryptoSource,
    policy: DEFAULT_AUTHORITY_POLICY,
  });
  const hub = new RoomSessionHub(coordinator, 'server-build', {
    store,
    rateLimits: allowRoomOperations,
    telemetry: NOOP_SERVER_TELEMETRY,
    monotonicNow: () => 0,
    admission: {
      crypto: cryptoSource,
      opaqueIds: cryptoSource,
      persistence: store,
      now: () => 10_000,
    },
  });
  return { ...initialized, snapshot: authoritySnapshot, store, hub };
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
  const issued = await input.hub.issueAdmissionTicket({
    capability: input.capability,
    displayName: input.name,
    requestedRole: input.role,
  });
  if (!issued.accepted) throw new Error(issued.code);
  session.connect({
    url: 'ws://in-memory.test/room',
    buildId: 'client-build',
    roomCode: 'ROOM',
    displayName: input.name,
    requestedRole: input.role,
    admissionTicket: issued.admissionTicket,
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

  it('resolves a resumed staged work area to the deck bottom atomically', async () => {
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
        entries: Array.from({ length: 3 }, (_, index) => ({
          definition: {
            id: `bulk-integration-definition-${index}`,
            name: `Bulk integration Pokémon ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `/bulk-integration-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();

    let view = player.session.getSnapshot().view;
    const deckId = `zone:${playerId}:deck`;
    const firstDeckCard = view?.zones[deckId]?.cards[0];
    if (!view || !firstDeckCard) throw new Error('Deck was not published');
    expect(
      player.session.submit({
        type: 'MoveCardToPlay',
        cardId: firstDeckCard.id,
        expectedSourceZoneId: deckId,
        boardPlayerId: playerId,
        slot: 'active',
      }).queued
    ).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    const stackId = view?.boards[playerId]?.activeStackId;
    const secondDeckCard = view?.zones[deckId]?.cards[0];
    if (!view || !stackId || !secondDeckCard) {
      throw new Error('Base stack was not published');
    }
    expect(
      player.session.submit({
        type: 'MoveCardToPlay',
        cardId: secondDeckCard.id,
        expectedSourceZoneId: deckId,
        boardPlayerId: playerId,
        slot: 'active',
        targetStackId: stackId,
      }).queued
    ).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    const topCard = view?.stacks[stackId]?.evolutionCards.at(-1);
    if (!view || !topCard) throw new Error('Evolution was not published');
    expect(
      player.session.submit({
        type: 'MoveCardFromStack',
        cardId: topCard.id,
        expectedStackId: stackId,
        destinationZoneId: `zone:${playerId}:discard`,
      }).queued
    ).toBe(true);
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    const stagedBeforeReconnect =
      view?.workAreas[playerId]?.attachmentResolution;
    const oldDeckTopId = view?.zones[deckId]?.cards[0]?.id;
    if (!stagedBeforeReconnect || !oldDeckTopId) {
      throw new Error('Dependent cards were not staged');
    }
    expect(stagedBeforeReconnect?.evolutionCards).toHaveLength(1);
    expect(view?.zones[deckId]?.cards).toHaveLength(1);

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Authoritative view did not resume');
    let submitted = false;
    const resolution = submitStagedCardsAction(
      view,
      'shuffleToDeckBottom',
      (command) => {
        submitted = player.session.submit(command).queued;
      }
    );
    expect(resolution).toMatchObject({
      ok: true,
      command: {
        type: 'ResolveStagedCards',
        expectedWorkAreaId: stagedBeforeReconnect.id,
        destination: 'shuffleToDeckBottom',
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const resolved = player.session.getSnapshot().view;
    expect(resolved?.revision).toBe(5);
    expect(resolved?.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(resolved?.zones[deckId]?.cards).toHaveLength(2);
    expect(resolved?.zones[deckId]?.cards[0]?.id).toBe(oldDeckTopId);
    expect(room.store.commandCommits).toHaveLength(5);
  });

  it('resolves inspected cards to hand after reconnect without retaining grants', async () => {
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
        entries: Array.from({ length: 4 }, (_, index) => ({
          definition: {
            id: `inspection-integration-definition-${index}`,
            name: `Inspection integration card ${index}`,
            category: 'Trainer' as const,
            imageUrl: `/inspection-integration-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(
      player.session.submit({
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: playerId,
        count: 2,
        edge: 'top',
        visibility: 'private',
      }).queued
    ).toBe(true);
    await player.factory.flush();

    let view = player.session.getSnapshot().view;
    const inspectionBeforeReconnect = view?.workAreas[playerId]?.inspection;
    expect(inspectionBeforeReconnect?.cards).toHaveLength(2);
    expect(
      inspectionBeforeReconnect?.cards.every((card) => card.kind === 'known')
    ).toBe(true);
    if (!inspectionBeforeReconnect) {
      throw new Error('Inspection work area was not published');
    }

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Authoritative view did not resume');
    let submitted = false;
    const resolution = submitInspectionCardsAction(view, 'hand', (command) => {
      submitted = player.session.submit(command).queued;
    });
    expect(resolution).toMatchObject({
      ok: true,
      command: {
        type: 'ResolveInspectionCards',
        expectedWorkAreaId: inspectionBeforeReconnect.id,
        destination: 'hand',
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const resolved = player.session.getSnapshot().view;
    const hand = resolved?.zones[`zone:${playerId}:hand`];
    expect(resolved?.revision).toBe(3);
    expect(resolved?.workAreas[playerId]?.inspection).toBeNull();
    expect(hand?.cards).toHaveLength(2);
    expect(hand?.cards.every((card) => card.kind === 'known')).toBe(true);
    expect(resolved?.zones[`zone:${playerId}:deck`]?.cards).toHaveLength(2);
    expect(room.store.commandCommits).toHaveLength(3);
  });

  it('resolves deck-relative intents atomically after reconnect', async () => {
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
        entries: Array.from({ length: 15 }, (_, index) => ({
          definition: {
            id: `deck-relative-integration-definition-${index}`,
            name: `Deck relative integration card ${index}`,
            category: 'Trainer' as const,
            imageUrl: `/deck-relative-integration-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(player.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await player.factory.flush();

    let view = player.session.getSnapshot().view;
    if (!view) throw new Error('Setup view was not published');
    const handId = `zone:${playerId}:hand`;
    const discardId = `zone:${playerId}:discard`;
    const handCard = view.zones[handId]!.cards[0]!;
    expect(
      player.session.submit({
        type: 'MoveCard',
        cardId: handCard.id,
        expectedSourceZoneId: handId,
        destinationZoneId: discardId,
      }).queued
    ).toBe(true);
    await player.factory.flush();

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Authoritative view did not resume');
    const discardCard = view.zones[discardId]!.cards[0]!;
    let submitted = false;
    const swap = submitDeckRelativeCardAction(
      view,
      discardCard.id,
      'swapWithTop',
      (command) => {
        submitted = player.session.submit(command).queued;
      }
    );
    expect(swap).toMatchObject({
      ok: true,
      command: {
        type: 'SwapCardWithDeckTop',
        cardId: discardCard.id,
        expectedSourceId: discardId,
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Swap view was not published');
    const nextHandCard = view.zones[handId]!.cards[0]!;
    submitted = false;
    expect(
      submitDeckRelativeCardAction(
        view,
        nextHandCard.id,
        'moveToTop',
        (command) => {
          submitted = player.session.submit(command).queued;
        }
      )
    ).toMatchObject({
      ok: true,
      command: { type: 'MoveCardToDeckTop', cardId: nextHandCard.id },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Move-to-top view was not published');
    submitted = false;
    expect(
      submitPrizeDeckBottomAction(view, (command) => {
        submitted = player.session.submit(command).queued;
      })
    ).toEqual({
      ok: true,
      command: { type: 'MovePrizesToDeckBottom' },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Prize-bottom view was not published');
    const returnedDeckTop = view.zones[discardId]!.cards[0]!;
    submitted = false;
    expect(
      submitDeckRelativeCardAction(
        view,
        returnedDeckTop.id,
        'moveToBottom',
        (command) => {
          submitted = player.session.submit(command).queued;
        }
      )
    ).toMatchObject({
      ok: true,
      command: { type: 'MoveCardToDeckBottom', cardId: returnedDeckTop.id },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    if (!view) throw new Error('Move-to-bottom view was not published');
    const shuffledHandCard = view.zones[handId]!.cards[0]!;
    submitted = false;
    expect(
      submitDeckRelativeCardAction(
        view,
        shuffledHandCard.id,
        'shuffleIntoDeck',
        (command) => {
          submitted = player.session.submit(command).queued;
        }
      )
    ).toMatchObject({
      ok: true,
      command: { type: 'ShuffleCardIntoDeck', cardId: shuffledHandCard.id },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const resolved = player.session.getSnapshot().view;
    expect(resolved?.revision).toBe(8);
    expect(resolved?.zones[`zone:${playerId}:prizes`]?.cards).toEqual([]);
    expect(resolved?.zones[`zone:${playerId}:deck`]?.cards).toHaveLength(11);
    expect(resolved?.zones[discardId]?.cards).toHaveLength(0);
    expect(resolved?.zones[handId]?.cards).toHaveLength(4);
    expect(room.store.commandCommits).toHaveLength(8);
    expect(room.store.commandCommits[3]?.eventBatch?.events).toHaveLength(2);
    expect(room.store.commandCommits[7]?.eventBatch?.events).toHaveLength(2);
  });

  it('persists semantic stack-state controls across reconnect and evolution', async () => {
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
            id: `stack-state-integration-definition-${index}`,
            name: `Stack state integration Pokémon ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `/stack-state-integration-${index}.png`,
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
    const [baseCard, evolutionCard] = hand?.cards ?? [];
    if (!view || !hand || !baseCard || !evolutionCard) {
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

    for (const action of [
      { type: 'setDamage', damage: 40 },
      { type: 'setSpecialCondition', condition: 'P' },
      { type: 'toggleAbilityUsed' },
      { type: 'rotateClockwise' },
    ] as const) {
      view = player.session.getSnapshot().view;
      const stackId = view?.boards[playerId]?.activeStackId;
      const topCard = stackId
        ? view?.stacks[stackId]?.evolutionCards.at(-1)
        : undefined;
      if (!view || !topCard) throw new Error('Active stack was not published');
      let submitted = false;
      expect(
        submitStackStateAction(view, topCard.id, action, (command) => {
          submitted = player.session.submit(command).queued;
        }).ok
      ).toBe(true);
      expect(submitted).toBe(true);
      await player.factory.flush();
    }

    view = player.session.getSnapshot().view;
    let stackId = view?.boards[playerId]?.activeStackId;
    if (!view || !stackId) throw new Error('Marked stack was not published');
    expect(view.stacks[stackId]).toMatchObject({
      damage: 40,
      specialCondition: 'P',
      abilityUsed: true,
      rotationQuarterTurns: 1,
    });
    expect(
      createBoardScene(view, {
        viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
        bottomPlayerId: playerId,
        splitRatio: 0.5,
        geometryVersion: 1,
      }).markers.map((marker) => [marker.kind, marker.value])
    ).toEqual(
      expect.arrayContaining([
        ['damage', '40'],
        ['specialCondition', 'P'],
        ['abilityUsed', 'used'],
      ])
    );

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    stackId = view?.boards[playerId]?.activeStackId;
    expect(view?.stacks[stackId!]).toMatchObject({
      damage: 40,
      specialCondition: 'P',
      abilityUsed: true,
      rotationQuarterTurns: 1,
    });

    if (!view || !stackId) throw new Error('Marked stack did not resume');
    expect(
      player.session.submit({
        type: 'MoveCardToPlay',
        cardId: evolutionCard.id,
        expectedSourceZoneId: hand.id,
        boardPlayerId: playerId,
        slot: 'active',
        targetStackId: stackId,
      }).queued
    ).toBe(true);
    await player.factory.flush();
    const evolved = player.session.getSnapshot().view;
    expect(evolved?.revision).toBe(8);
    expect(evolved?.stacks[stackId]).toMatchObject({
      damage: 40,
      specialCondition: null,
      abilityUsed: false,
      rotationQuarterTurns: 0,
    });
    expect(room.store.commandCommits).toHaveLength(8);
  });

  it('persists card annotations and changes category with one atomic board move', async () => {
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
            id: `annotation-integration-definition-${index}`,
            name: `Annotation integration card ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `/annotation-integration-${index}.png`,
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
    const card = hand?.cards[0];
    if (!view || !hand || !card) {
      throw new Error('Setup did not publish an annotation card');
    }
    expect(
      player.session.submit({
        type: 'MoveCard',
        cardId: card.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: 'zone:shared:stadium',
      }).queued
    ).toBe(true);
    await player.factory.flush();

    for (const action of [
      { type: 'rotate', single: false },
      { type: 'toggleAbilityUsed' },
    ] as const) {
      view = player.session.getSnapshot().view;
      const stadiumCard = view?.zones['zone:shared:stadium']?.cards[0];
      if (!view || !stadiumCard) {
        throw new Error('Stadium annotation card was not published');
      }
      let submitted = false;
      expect(
        submitCardAnnotationAction(view, stadiumCard.id, action, (command) => {
          submitted = player.session.submit(command).queued;
        }).ok
      ).toBe(true);
      expect(submitted).toBe(true);
      await player.factory.flush();
    }

    view = player.session.getSnapshot().view;
    let stadiumCard = view?.zones['zone:shared:stadium']?.cards[0];
    if (!view || !stadiumCard || stadiumCard.kind !== 'known') {
      throw new Error('Annotated stadium card was not published');
    }
    expect(stadiumCard).toMatchObject({
      orientationQuarterTurns: 1,
      abilityUsed: true,
    });
    expect(
      createBoardScene(view, {
        viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
        bottomPlayerId: playerId,
        splitRatio: 0.5,
        geometryVersion: 1,
      }).markers
    ).toContainEqual(
      expect.objectContaining({
        id: `${stadiumCard.id}:abilityUsed`,
        parentCardId: stadiumCard.id,
      })
    );

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    stadiumCard = view?.zones['zone:shared:stadium']?.cards[0];
    if (!view || !stadiumCard || stadiumCard.kind !== 'known') {
      throw new Error('Annotated stadium card did not survive reconnect');
    }
    expect(stadiumCard).toMatchObject({
      orientationQuarterTurns: 1,
      abilityUsed: true,
    });

    let submitted = false;
    expect(
      submitCardAnnotationAction(
        view,
        stadiumCard.id,
        { type: 'changeCategory', category: 'Energy' },
        (command) => {
          submitted = player.session.submit(command).queued;
        }
      )
    ).toMatchObject({
      ok: true,
      command: {
        type: 'ChangeCardCategory',
        expectedSourceId: 'zone:shared:stadium',
        category: 'Energy',
      },
    });
    expect(submitted).toBe(true);
    await player.factory.flush();

    const changed = player.session.getSnapshot().view;
    const boardCard = changed?.zones[`zone:${playerId}:board`]?.cards.at(-1);
    expect(changed?.revision).toBe(6);
    expect(changed?.zones['zone:shared:stadium']?.cards).toEqual([]);
    expect(boardCard).toMatchObject({
      category: 'Energy',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    expect(room.store.commandCommits).toHaveLength(6);
    expect(room.store.commandCommits[5]?.eventBatch?.events).toHaveLength(3);
  });

  it('persists independent GX/VSTAR targets across reconnect and player reset', async () => {
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
    let view = player.session.getSnapshot().view;
    const opponentId = view?.playerOrder.find((id) => id !== playerId);
    if (!view || !playerId || !opponentId) {
      throw new Error('Missing once-per-game player identities');
    }

    for (const [targetPlayerId, marker] of [
      [playerId, 'gx'],
      [opponentId, 'vstar'],
    ] as const) {
      view = player.session.getSnapshot().view;
      if (!view) throw new Error('Missing once-per-game view');
      let submitted = false;
      expect(
        submitOncePerGameAction(
          view,
          targetPlayerId,
          { type: 'toggle', marker },
          (command) => {
            submitted = player.session.submit(command).queued;
          }
        ).ok
      ).toBe(true);
      expect(submitted).toBe(true);
      await player.factory.flush();
    }

    view = player.session.getSnapshot().view;
    expect(view?.players[playerId]?.oncePerGame).toEqual({
      gxUsed: true,
      vstarUsed: false,
    });
    expect(view?.players[opponentId]?.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: true,
    });
    if (!view) throw new Error('Missing marked once-per-game view');
    expect(
      submitOncePerGameAction(
        view,
        playerId,
        { type: 'set', marker: 'gx', used: true },
        () => {
          throw new Error('No-op marker command must not submit');
        }
      )
    ).toEqual({ ok: false, reason: 'no_op' });

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    expect(view?.players[playerId]?.oncePerGame.gxUsed).toBe(true);
    expect(view?.players[opponentId]?.oncePerGame.vstarUsed).toBe(true);

    expect(player.session.submit({ type: 'ResetPlayer' }).queued).toBe(true);
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    expect(view?.revision).toBe(3);
    expect(view?.players[playerId]?.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: false,
    });
    expect(view?.players[opponentId]?.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: true,
    });
    expect(room.store.commandCommits).toHaveLength(3);
  });

  it('shuffles the exact loose board into deck in one reconnect-safe revision', async () => {
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
            id: `loose-integration-definition-${index}`,
            name: `Loose integration card ${index}`,
            category:
              index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
            imageUrl: `/loose-integration-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(player.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await player.factory.flush();

    let view = player.session.getSnapshot().view;
    let hand = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    const first = hand?.cards[0];
    if (!view || !hand || !first) throw new Error('Missing setup hand');
    let submitted = false;
    expect(
      submitCardAnnotationAction(
        view,
        first.id,
        { type: 'changeCategory', category: 'Energy' },
        (command) => {
          submitted = player.session.submit(command).queued;
        }
      ).ok
    ).toBe(true);
    expect(submitted).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    hand = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    const second = hand?.cards[0];
    const board = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'board'
    );
    if (!view || !hand || !second || !board) {
      throw new Error('Missing loose-board setup state');
    }
    expect(
      player.session.submit({
        type: 'MoveCard',
        cardId: second.id,
        expectedSourceZoneId: hand.id,
        destinationZoneId: board.id,
      }).queued
    ).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    const preparedBoard = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'board'
    );
    if (!view || !preparedBoard || preparedBoard.cards.length !== 2) {
      throw new Error('Loose board was not published');
    }
    const priorBoardAliases = preparedBoard.cards.map((card) => card.id);
    submitted = false;
    expect(
      submitLooseBoardAction(view, playerId, 'shuffleIntoDeck', (command) => {
        submitted = player.session.submit(command).queued;
      }).ok
    ).toBe(true);
    expect(submitted).toBe(true);
    await player.factory.flush();

    view = player.session.getSnapshot().view;
    const nextBoard = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'board'
    );
    const deck = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'deck'
    );
    if (!view || !nextBoard || !deck) throw new Error('Missing resolved board');
    expect(view.revision).toBe(5);
    expect(nextBoard.cards).toEqual([]);
    expect(deck.cards).toHaveLength(3);
    expect(
      deck.cards.every((card) => !priorBoardAliases.includes(card.id))
    ).toBe(true);
    expect(room.store.commandCommits).toHaveLength(5);
    expect(room.store.commandCommits[4]?.eventBatch?.events).toEqual([
      expect.objectContaining({
        type: 'LooseBoardCardsResolved',
        destination: 'shuffleIntoDeck',
      }),
    ]);

    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    view = player.session.getSnapshot().view;
    const resumedDeck = Object.values(view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'deck'
    );
    expect(view?.revision).toBe(5);
    expect(resumedDeck?.cards).toHaveLength(3);
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
    const playerId = player.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing admitted player identity');

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
    expect(player.session.getSnapshot().presentationEvents).toEqual([
      {
        type: 'CoinFlipped',
        revision: 1,
        playerId,
        result: expect.stringMatching(/^(heads|tails)$/),
      },
    ]);
    expect(spectator.session.getSnapshot().presentationEvents).toEqual(
      player.session.getSnapshot().presentationEvents
    );
    expect(room.store.commandCommits).toHaveLength(1);
  });

  it('runs a turn atomically through projection and does not replay its signal on reconnect', async () => {
    const room = await fixture();
    const opponentScheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
    });
    const opponent = await connectClient({
      hub: room.hub,
      name: 'Red',
      role: 'player',
      capability: room.credentials.playerTwoSeatCapability,
      scheduler: opponentScheduler,
    });
    const playerId = player.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing admitted player identity');

    expect(
      player.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 3 }, (_, index) => ({
          definition: {
            id: `turn-definition-${index}`,
            name: `Turn card ${index}`,
            category: 'Pokémon' as const,
            imageUrl: `/turn-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();

    const before = player.session.getSnapshot().view;
    if (!before) throw new Error('Missing view before turn');
    let queued = false;
    expect(
      submitTableAction(before, playerId, 'startTurn', (wire) => {
        queued = player.session.submit(wire).queued;
      }).ok
    ).toBe(true);
    expect(queued).toBe(true);
    await player.factory.flush();

    const playerState = player.session.getSnapshot();
    const opponentState = opponent.session.getSnapshot();
    const playerHand = Object.values(playerState.view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    const opponentHand = Object.values(opponentState.view?.zones ?? {}).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    expect(playerState.view?.turn).toEqual({
      number: 1,
      currentPlayerId: playerId,
    });
    expect(playerHand?.cards).toHaveLength(1);
    expect(playerHand?.cards[0]?.kind).toBe('known');
    expect(opponentHand?.cards).toHaveLength(1);
    expect(opponentHand?.cards[0]?.kind).toBe('concealed');
    expect(playerState.presentationEvents).toEqual([
      {
        type: 'DeckLoaded',
        revision: 1,
        playerId,
        cardCount: 3,
      },
      {
        type: 'TurnStarted',
        revision: 2,
        playerId,
        turnNumber: 1,
      },
    ]);
    expect(opponentState.presentationEvents).toEqual(
      playerState.presentationEvents
    );
    expect(
      room.store.commandCommits[1]?.eventBatch?.events.map(
        (event) => event.type
      )
    ).toEqual(['CardsDrawn', 'TurnAdvanced', 'TableActionDeclared']);

    opponent.factory.latest().networkDrop();
    opponentScheduler.runNext();
    opponent.factory.latest().open();
    await opponent.factory.flush();
    expect(opponent.session.getSnapshot().presentationEvents).toEqual([
      {
        type: 'DeckLoaded',
        revision: 1,
        playerId,
        cardCount: 3,
      },
      {
        type: 'TurnStarted',
        revision: 2,
        playerId,
        turnNumber: 1,
      },
    ]);
  });

  it('sets up and resets either seat with private projections and reconnect-safe facts', async () => {
    const room = await fixture();
    const opponentScheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
    });
    const opponent = await connectClient({
      hub: room.hub,
      name: 'Red',
      role: 'player',
      capability: room.credentials.playerTwoSeatCapability,
      scheduler: opponentScheduler,
    });
    const opponentId = opponent.session.getSnapshot().playerId;
    if (!opponentId) throw new Error('Missing opponent player identity');

    expect(
      opponent.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `lifecycle-definition-${index}`,
            name: `Lifecycle card ${index}`,
            category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
            imageUrl: `/lifecycle-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await opponent.factory.flush();

    let playerView = player.session.getSnapshot().view;
    if (!playerView) throw new Error('Missing lifecycle actor view');
    let queued = false;
    expect(
      submitLifecycleAction(playerView, opponentId, 'setup', (wire) => {
        queued = player.session.submit(wire).queued;
      }).ok
    ).toBe(true);
    expect(queued).toBe(true);
    await player.factory.flush();

    playerView = player.session.getSnapshot().view;
    let opponentView = opponent.session.getSnapshot().view;
    const actorHand = Object.values(playerView?.zones ?? {}).find(
      (zone) => zone.ownerId === opponentId && zone.kind === 'hand'
    );
    const ownerHand = Object.values(opponentView?.zones ?? {}).find(
      (zone) => zone.ownerId === opponentId && zone.kind === 'hand'
    );
    expect(actorHand?.cards).toHaveLength(7);
    expect(actorHand?.cards.every((card) => card.kind === 'concealed')).toBe(
      true
    );
    expect(ownerHand?.cards).toHaveLength(7);
    expect(ownerHand?.cards.every((card) => card.kind === 'known')).toBe(true);
    expect(player.session.getSnapshot().presentationEvents).toEqual([
      {
        type: 'DeckLoaded',
        revision: 1,
        playerId: opponentId,
        cardCount: 14,
      },
      {
        type: 'PlayerSetup',
        revision: 2,
        playerId: opponentId,
        handCount: 7,
        prizeCount: 6,
      },
    ]);

    if (!playerView) throw new Error('Missing post-setup actor view');
    queued = false;
    expect(
      submitLifecycleAction(playerView, opponentId, 'reset', (wire) => {
        queued = player.session.submit(wire).queued;
      }).ok
    ).toBe(true);
    expect(queued).toBe(true);
    await player.factory.flush();

    opponentView = opponent.session.getSnapshot().view;
    const resetHand = Object.values(opponentView?.zones ?? {}).find(
      (zone) => zone.ownerId === opponentId && zone.kind === 'hand'
    );
    const resetDeck = Object.values(opponentView?.zones ?? {}).find(
      (zone) => zone.ownerId === opponentId && zone.kind === 'deck'
    );
    expect(opponentView?.lifecycle).toBe('lobby');
    expect(opponentView?.turn).toEqual({ number: 0, currentPlayerId: null });
    expect(resetHand?.cards).toEqual([]);
    expect(resetDeck?.cards).toHaveLength(14);
    expect(opponent.session.getSnapshot().presentationEvents).toEqual([
      {
        type: 'DeckLoaded',
        revision: 1,
        playerId: opponentId,
        cardCount: 14,
      },
      {
        type: 'PlayerSetup',
        revision: 2,
        playerId: opponentId,
        handCount: 7,
        prizeCount: 6,
      },
      { type: 'PlayerReset', revision: 3, playerId: opponentId },
    ]);
    expect(room.store.commandCommits).toHaveLength(3);

    opponent.factory.latest().networkDrop();
    opponentScheduler.runNext();
    opponent.factory.latest().open();
    await opponent.factory.flush();
    expect(opponent.session.getSnapshot().presentationEvents).toHaveLength(3);
    expect(opponent.session.getSnapshot().view?.revision).toBe(3);
  });

  it('reveals and re-conceals an opponent prize zone without leaking stable identities', async () => {
    const room = await fixture();
    const opponentScheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
    });
    const opponent = await connectClient({
      hub: room.hub,
      name: 'Red',
      role: 'player',
      capability: room.credentials.playerTwoSeatCapability,
      scheduler: opponentScheduler,
    });
    const playerId = player.session.getSnapshot().playerId;
    const opponentPlayerId = opponent.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing visibility player identity');
    if (!opponentPlayerId) {
      throw new Error('Missing visibility opponent identity');
    }

    expect(
      player.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `visibility-session-definition-${index}`,
            name: `Visibility session card ${index}`,
            category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
            imageUrl: `/visibility-session-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    const loadedView = player.session.getSnapshot().view;
    if (!loadedView) throw new Error('Missing loaded visibility view');
    let queued = false;
    expect(
      submitLifecycleAction(loadedView, playerId, 'setup', (wire) => {
        queued = player.session.submit(wire).queued;
      }).ok
    ).toBe(true);
    expect(queued).toBe(true);
    await player.factory.flush();

    let opponentView = opponent.session.getSnapshot().view;
    if (!opponentView) throw new Error('Missing opponent visibility view');
    const prizeId = Object.values(opponentView.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'prizes'
    )!.id;
    const concealedAliases = opponentView.zones[prizeId]!.cards.map(
      (card) => card.id
    );
    expect(
      opponentView.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed' && !card.publiclyRevealed
      )
    ).toBe(true);

    queued = false;
    submitPublicVisibilityAction(
      resolvePrizeVisibilityAction(opponentView, playerId, true),
      (wire) => {
        queued = opponent.session.submit(wire).queued;
      }
    );
    expect(queued).toBe(true);
    await opponent.factory.flush();

    opponentView = opponent.session.getSnapshot().view;
    const playerView = player.session.getSnapshot().view;
    expect(
      opponentView?.zones[prizeId]!.cards.every(
        (card) => card.kind === 'known' && card.publiclyRevealed
      )
    ).toBe(true);
    expect(
      playerView?.zones[prizeId]!.cards.every(
        (card) => card.kind === 'known' && card.publiclyRevealed
      )
    ).toBe(true);
    const publicAliases = opponentView!.zones[prizeId]!.cards.map(
      (card) => card.id
    );
    expect(publicAliases).not.toEqual(concealedAliases);
    expect(opponent.session.getSnapshot().presentationEvents.at(-1)).toEqual({
      type: 'PublicCardsRevealed',
      revision: 3,
      actorPlayerId: opponentPlayerId,
      playerId,
      scope: 'zone',
      source: 'prizes',
      cardCount: 6,
    });

    queued = false;
    submitPublicVisibilityAction(
      resolvePrizeVisibilityAction(opponentView!, playerId, false),
      (wire) => {
        queued = opponent.session.submit(wire).queued;
      }
    );
    expect(queued).toBe(true);
    await opponent.factory.flush();

    opponentView = opponent.session.getSnapshot().view;
    expect(
      opponentView?.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed' && !card.publiclyRevealed
      )
    ).toBe(true);
    expect(
      opponentView?.zones[prizeId]!.cards.map((card) => card.id)
    ).not.toEqual(publicAliases);
    expect(opponent.session.getSnapshot().presentationEvents.at(-1)).toEqual({
      type: 'PublicCardsHidden',
      revision: 4,
      actorPlayerId: opponentPlayerId,
      playerId,
      scope: 'zone',
      source: 'prizes',
      cardCount: 6,
    });
    expect(room.store.commandCommits).toHaveLength(4);
    expect(room.store.commandCommits[3]?.eventBatch?.events[0]).toMatchObject({
      type: 'PublicRevealSet',
      playerId,
      revealed: false,
    });

    opponent.factory.latest().networkDrop();
    opponentScheduler.runNext();
    opponent.factory.latest().open();
    await opponent.factory.flush();
    expect(opponent.session.getSnapshot().view?.revision).toBe(4);
    expect(opponent.session.getSnapshot().presentationEvents).toHaveLength(4);
    expect(
      opponent.session
        .getSnapshot()
        .view?.zones[prizeId]!.cards.every((card) => card.kind === 'concealed')
    ).toBe(true);
  });

  it('persists a private prize look across reconnect without leaking it to other views', async () => {
    const room = await fixture();
    const playerScheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
      scheduler: playerScheduler,
    });
    const opponent = await connectClient({
      hub: room.hub,
      name: 'Red',
      role: 'player',
      capability: room.credentials.playerTwoSeatCapability,
    });
    const spectatorCapability = room.credentials.spectatorCapability;
    if (!spectatorCapability) throw new Error('Missing spectator capability');
    const spectator = await connectClient({
      hub: room.hub,
      name: 'Observer',
      role: 'spectator',
      capability: spectatorCapability,
    });
    const playerId = player.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing private-look player identity');

    expect(
      player.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `private-look-definition-${index}`,
            name: `Private look card ${index}`,
            category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
            imageUrl: `/private-look-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(player.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await player.factory.flush();

    let playerView = player.session.getSnapshot().view;
    if (!playerView) throw new Error('Missing private-look setup view');
    const prizeId = Object.values(playerView.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'prizes'
    )!.id;
    const concealedAliases = playerView.zones[prizeId]!.cards.map(
      (card) => card.id
    );
    expect(
      playerView.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);

    let queued = false;
    submitPrivateInspectionAction(
      resolveZoneInspectionAction(playerView, playerId, 'prizes', true),
      (wire) => {
        queued = player.session.submit(wire).queued;
      }
    );
    expect(queued).toBe(true);
    await player.factory.flush();

    playerView = player.session.getSnapshot().view;
    const opponentView = opponent.session.getSnapshot().view;
    const spectatorView = spectator.session.getSnapshot().view;
    if (!playerView || !opponentView || !spectatorView) {
      throw new Error('Missing private-look recipient view');
    }
    const knownAliases = playerView.zones[prizeId]!.cards.map(
      (card) => card.id
    );
    expect(
      playerView.zones[prizeId]!.cards.every((card) => card.kind === 'known')
    ).toBe(true);
    expect(knownAliases).not.toEqual(concealedAliases);
    expect(playerView.privateInspections).toEqual([
      expect.objectContaining({
        sourcePlayerId: playerId,
        sourceId: prizeId,
        cardIds: knownAliases,
      }),
    ]);
    for (const privateView of [opponentView, spectatorView]) {
      expect(
        privateView.zones[prizeId]!.cards.every(
          (card) => card.kind === 'concealed'
        )
      ).toBe(true);
      expect(privateView.privateInspections).toEqual([]);
      expect(JSON.stringify(privateView)).not.toContain(
        'private-look-definition-'
      );
      expect(JSON.stringify(privateView)).not.toContain(
        playerView.privateInspections[0]!.id
      );
    }
    expect(player.session.getSnapshot().presentationEvents.at(-1)).toEqual({
      type: 'PrivateInspectionStarted',
      revision: 3,
      sourcePlayerId: playerId,
      viewerPlayerId: playerId,
      scope: 'zone',
      source: 'prizes',
      cardCount: 6,
    });
    expect(opponent.session.getSnapshot().presentationEvents.at(-1)).toEqual(
      player.session.getSnapshot().presentationEvents.at(-1)
    );
    expect(spectator.session.getSnapshot().presentationEvents.at(-1)).toEqual(
      player.session.getSnapshot().presentationEvents.at(-1)
    );
    expect(room.store.commandCommits[2]?.eventBatch?.events[0]).toMatchObject({
      type: 'InspectionGrantOpened',
      sourcePlayerId: playerId,
      sourceId: prizeId,
    });

    player.factory.latest().networkDrop();
    playerScheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    playerView = player.session.getSnapshot().view;
    if (!playerView) throw new Error('Missing reconnected private-look view');
    expect(playerView.revision).toBe(3);
    expect(
      playerView.zones[prizeId]!.cards.every((card) => card.kind === 'known')
    ).toBe(true);
    expect(playerView.privateInspections).toHaveLength(1);
    expect(player.session.getSnapshot().presentationEvents).toHaveLength(3);

    queued = false;
    submitPrivateInspectionAction(
      resolveZoneInspectionAction(playerView, playerId, 'prizes', false),
      (wire) => {
        queued = player.session.submit(wire).queued;
      }
    );
    expect(queued).toBe(true);
    await player.factory.flush();

    playerView = player.session.getSnapshot().view;
    if (!playerView) throw new Error('Missing closed private-look view');
    expect(playerView.revision).toBe(4);
    expect(playerView.privateInspections).toEqual([]);
    expect(
      playerView.zones[prizeId]!.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(playerView.zones[prizeId]!.cards.map((card) => card.id)).not.toEqual(
      concealedAliases
    );
    expect(playerView.zones[prizeId]!.cards.map((card) => card.id)).not.toEqual(
      knownAliases
    );
    expect(player.session.getSnapshot().presentationEvents.at(-1)).toEqual({
      type: 'PrivateInspectionEnded',
      revision: 4,
      sourcePlayerId: playerId,
      viewerPlayerId: playerId,
      scope: 'zone',
      source: 'prizes',
      cardCount: 6,
    });
    expect(room.store.commandCommits).toHaveLength(4);
    expect(room.store.snapshot?.state.visibility.inspectionGrants).toEqual({});
  });

  it('plays from an opponent hand with authority randomness and reconnect-safe secrecy', async () => {
    const room = await fixture();
    const actorScheduler = new ManualScheduler();
    const actor = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
      scheduler: actorScheduler,
    });
    const owner = await connectClient({
      hub: room.hub,
      name: 'Red',
      role: 'player',
      capability: room.credentials.playerTwoSeatCapability,
    });
    const spectatorCapability = room.credentials.spectatorCapability;
    if (!spectatorCapability) throw new Error('Missing spectator capability');
    const spectator = await connectClient({
      hub: room.hub,
      name: 'Observer',
      role: 'spectator',
      capability: spectatorCapability,
    });
    const ownerId = owner.session.getSnapshot().playerId;
    const actorId = actor.session.getSnapshot().playerId;
    if (!ownerId || !actorId) {
      throw new Error('Missing random-play player identity');
    }

    expect(
      owner.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `random-session-definition-${index}`,
            name: `Random session card ${index}`,
            category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
            imageUrl: `/random-session-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await owner.factory.flush();
    expect(owner.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await owner.factory.flush();

    let actorView = actor.session.getSnapshot().view;
    const spectatorBefore = spectator.session.getSnapshot().view;
    if (!actorView || !spectatorBefore) {
      throw new Error('Missing random-play setup views');
    }
    const handId = Object.values(actorView.zones).find(
      (zone) => zone.ownerId === ownerId && zone.kind === 'hand'
    )!.id;
    const boardId = Object.values(actorView.zones).find(
      (zone) => zone.ownerId === ownerId && zone.kind === 'board'
    )!.id;
    const oldActorAliases = actorView.zones[handId]!.cards.map(
      (card) => card.id
    );
    const oldSpectatorAliases = spectatorBefore.zones[handId]!.cards.map(
      (card) => card.id
    );
    let queued = false;
    expect(
      submitRandomFaceDownAction(actorView, ownerId, (wire) => {
        queued = actor.session.submit(wire).queued;
      }).ok
    ).toBe(true);
    expect(queued).toBe(true);
    await actor.factory.flush();

    actorView = actor.session.getSnapshot().view;
    const ownerView = owner.session.getSnapshot().view;
    const spectatorView = spectator.session.getSnapshot().view;
    if (!actorView || !ownerView || !spectatorView) {
      throw new Error('Missing random-play recipient views');
    }
    const actorBoardCard = actorView.zones[boardId]!.cards[0]!;
    const spectatorBoardCard = spectatorView.zones[boardId]!.cards[0]!;
    expect(actorView.zones[handId]!.cards).toHaveLength(6);
    expect(actorBoardCard.kind).toBe('concealed');
    expect(oldActorAliases).not.toContain(actorBoardCard.id);
    expect(spectatorBoardCard.kind).toBe('concealed');
    expect(oldSpectatorAliases).not.toContain(spectatorBoardCard.id);
    expect(ownerView.zones[boardId]!.cards).toEqual([
      expect.objectContaining({ kind: 'known', face: 'down' }),
    ]);
    for (const privateView of [actorView, spectatorView]) {
      expect(JSON.stringify(privateView)).not.toContain(
        'random-session-definition-'
      );
      expect(JSON.stringify(privateView)).not.toContain('Random session card');
      expect(JSON.stringify(privateView)).not.toContain(
        '/random-session-card-'
      );
    }
    const presentation = {
      type: 'RandomCardPlayedFaceDown' as const,
      revision: 3,
      actorPlayerId: actorId,
      targetPlayerId: ownerId,
    };
    expect(actor.session.getSnapshot().presentationEvents.at(-1)).toEqual(
      presentation
    );
    expect(owner.session.getSnapshot().presentationEvents.at(-1)).toEqual(
      presentation
    );
    expect(spectator.session.getSnapshot().presentationEvents.at(-1)).toEqual(
      presentation
    );
    expect(room.store.commandCommits[2]?.eventBatch?.events[0]).toMatchObject({
      type: 'RandomHandCardPlayedFaceDown',
      actorPlayerId: actorId,
      targetPlayerId: ownerId,
      cardId: expect.any(String),
    });

    const boardAlias = actorBoardCard.id;
    actor.factory.latest().networkDrop();
    actorScheduler.runNext();
    actor.factory.latest().open();
    await actor.factory.flush();
    actorView = actor.session.getSnapshot().view;
    expect(actorView?.revision).toBe(3);
    expect(actorView?.zones[boardId]!.cards[0]?.id).toBe(boardAlias);
    expect(actorView?.zones[boardId]!.cards[0]?.kind).toBe('concealed');
    expect(actor.session.getSnapshot().presentationEvents).toHaveLength(3);
    expect(room.store.commandCommits).toHaveLength(3);
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

  it('restores a solo checkpoint through the client queue and reconnects to the same branch', async () => {
    const room = await fixture('solo');
    const scheduler = new ManualScheduler();
    const player = await connectClient({
      hub: room.hub,
      name: 'Blue',
      role: 'player',
      capability: room.credentials.playerOneSeatCapability,
      scheduler,
    });
    const playerId = player.session.getSnapshot().playerId;
    if (!playerId) throw new Error('Missing solo player identity');

    expect(
      player.session.submit({
        type: 'LoadDeck',
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: `solo-undo-definition-${index}`,
            name: `Solo undo card ${index}`,
            category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
            imageUrl: `/solo-undo-card-${index}.png`,
          },
          count: 1,
        })),
      }).queued
    ).toBe(true);
    await player.factory.flush();
    expect(player.session.submit({ type: 'SetupPlayer' }).queued).toBe(true);
    await player.factory.flush();
    const setup = player.session.getSnapshot().view;
    if (!setup) throw new Error('Missing solo setup view');
    const hand = Object.values(setup.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'hand'
    );
    const deck = Object.values(setup.zones).find(
      (zone) => zone.ownerId === playerId && zone.kind === 'deck'
    );
    if (!hand || !deck) throw new Error('Missing solo deck zones');
    const setupAliases = hand.cards.map((card) => card.id);

    expect(player.session.submit({ type: 'DrawCards', count: 1 }).queued).toBe(
      true
    );
    await player.factory.flush();
    const drawn = player.session.getSnapshot().view;
    expect(drawn?.zones[hand.id]?.cards).toHaveLength(8);
    expect(drawn?.revision).toBe(3);

    let queued = false;
    if (!drawn) throw new Error('Missing solo drawn view');
    expect(
      submitSoloUndoAction(drawn, playerId, (wire) => {
        queued = player.session.submit(wire).queued;
      }).ok
    ).toBe(true);
    expect(queued).toBe(true);
    await player.factory.flush();

    const undone = player.session.getSnapshot().view;
    if (!undone) throw new Error('Missing solo undo view');
    expect(undone.revision).toBe(4);
    expect(undone.zones[hand.id]?.cards).toHaveLength(7);
    expect(undone.zones[deck.id]?.cards).toHaveLength(1);
    const undoAliases = undone.zones[hand.id]!.cards.map((card) => card.id);
    expect(undoAliases.every((alias) => !setupAliases.includes(alias))).toBe(
      true
    );
    expect(player.session.getSnapshot().presentationEvents.at(-1)).toEqual({
      type: 'UndoApplied',
      revision: 4,
      actorPlayerId: playerId,
      targetPlayerId: playerId,
      revertedRevision: 3,
    });
    expect(room.store.snapshot?.soloUndoHistory.entries).toHaveLength(1);
    expect(
      room.store.commandCommits.at(-1)?.eventBatch?.events[0]
    ).toMatchObject({
      type: 'UndoApplied',
      revertedCommandId: 'Blue-command-3',
      checkpointRevision: 2,
    });

    const presentationCount =
      player.session.getSnapshot().presentationEvents.length;
    player.factory.latest().networkDrop();
    scheduler.runNext();
    player.factory.latest().open();
    await player.factory.flush();
    expect(player.session.getSnapshot().view?.revision).toBe(4);
    expect(
      player.session
        .getSnapshot()
        .view?.zones[hand.id]?.cards.map((card) => card.id)
    ).toEqual(undoAliases);
    expect(player.session.getSnapshot().presentationEvents).toHaveLength(
      presentationCount
    );
    expect(room.store.commandCommits).toHaveLength(4);
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
