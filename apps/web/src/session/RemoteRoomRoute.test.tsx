// @vitest-environment happy-dom

import type {
  ClientSessionScheduler,
  SessionSocket,
  SessionSocketFactory,
  SessionSocketHandlers,
} from '@ptcgsim/client-session';
import {
  parseProjectedReplayFile,
  serializeProjectedReplayFile,
} from '@ptcgsim/client-session';
import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardIntent,
} from '@ptcgsim/renderer-contract';
import type { Icon } from '@phosphor-icons/react';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LegacyAnnouncementScheduler } from '../presentation/LegacyGamePresentationRuntime.js';
import { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
import { DeckBuilderStore } from '../features/deck/deck-builder-store.js';
import { preferences } from '../preferences/preference-store.js';
import { cancelAllDialogRequests } from '../ui/dialog-requests.js';
import { OverlayHost } from '../ui/OverlayHost.js';
import { dismissToast, toast } from '../ui/toast.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import type { RemoteSessionBoard as RealRemoteSessionBoard } from './RemoteSessionBoard.js';
import { DEFAULT_TABLE_DEPTH } from '../motion/depth-settings.js';
import { boardViewSettings } from '../board/view/board-view-settings.js';
import { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import { SHELL_PREFERENCES } from './shell/shell-preferences.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type BoardProps = ComponentProps<typeof RealRemoteSessionBoard>;

const boardHarness = vi.hoisted(() => ({
  props: undefined as BoardProps | undefined,
  revision: undefined as number | undefined,
  replaying: false,
  refreshImages: 0,
  /** Whether the board would offer Flip (Solo, spectators, coaching). */
  switchSide: false,
  pressed: [] as string[],
}));

vi.mock('../ui/toast.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../ui/toast.js')>();
  return { ...original, toast: vi.fn(original.toast) };
});

/**
 * The board, reduced to what the route gives it: the rail's two ends and
 * the actions the route composes around the board's own (painted here as
 * plain buttons with the rail's ids), its commands, and its props.
 */
/** The card catalog stays idle here: these tests never search cards. */
vi.mock('../features/deck/card-catalog-client.js', () => {
  const idle = { status: 'idle' } as const;
  const source = {
    getSnapshot: () => idle,
    subscribe: () => () => undefined,
    load: () => undefined,
    retry: () => undefined,
  };
  return { cardCatalog: () => source };
});

/** Nor do they need the tournament-deck feed. */
vi.mock('../features/deck/current-decklists.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../features/deck/current-decklists.js')
  >()),
  fetchCurrentDecklists: async () => {
    throw new Error('No feed in unit tests.');
  },
}));

vi.mock('./RemoteSessionBoard.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./RemoteSessionBoard.js')>();
  const React = await import('react');
  const icon = (() => null) as unknown as Icon;
  const own = (id: string, label: string) => ({
    id,
    label,
    icon,
    onSelect: () => {
      boardHarness.pressed.push(id);
    },
  });
  return {
    ...original,
    RemoteSessionBoard: (props: BoardProps) => {
      const state = React.useSyncExternalStore(
        props.replay.subscribe,
        props.replay.getSnapshot,
        props.replay.getSnapshot
      );
      React.useImperativeHandle(
        props.commandsRef,
        () => ({
          refreshImages: () => {
            boardHarness.refreshImages += 1;
          },
          flipBoard: () => undefined,
          canFlipBoard: () => boardHarness.switchSide,
        }),
        []
      );
      boardHarness.props = props;
      boardHarness.revision = state.view?.revision;
      boardHarness.replaying = state.mode === 'replay';
      const seated =
        state.mode === 'live' && state.view?.viewer.kind === 'player';
      const composed = props.rail?.compose({
        ...(seated
          ? {
              turn: own('turnButton', 'Turn'),
              coin: own('flipCoinButton', 'Coin'),
              mulligan: own('mulliganButton', 'Announce mulligan'),
            }
          : {}),
        ...(boardHarness.switchSide
          ? { switchSide: own('flipBoardButton', 'Flip') }
          : {}),
      });
      return (
        <>
          {state.view ? (
            <output id="room-board">{state.view.revision}</output>
          ) : null}
          <div data-test-rail="true">
            {props.rail?.start}
            <div id="boardButtonContainer">
              {composed?.actions.map((action) => (
                <button
                  key={action.id}
                  id={action.id}
                  type="button"
                  data-primary={action.primary ? 'true' : undefined}
                  aria-label={action.title ?? action.label}
                  onClick={action.onSelect}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div data-test-more="true">
              {composed?.more?.flatMap((entry, index) =>
                entry.kind === 'separator' || entry.kind === 'label'
                  ? []
                  : [
                      <button
                        key={entry.id ?? index}
                        id={entry.id}
                        type="button"
                        onClick={entry.onSelect}
                      >
                        {entry.label}
                      </button>,
                    ]
              )}
            </div>
            {props.rail?.end}
          </div>
        </>
      );
    },
  };
});

const admissionTicket = 'route-screen-admission-capability-private-000001';
const resumeToken = 'route-screen-resume-capability-private-000000001';
const view = createRendererSpikeView();
const bluePlayer = asPlayerId('spike-blue');

/** The same table with nothing of Blue's on it yet. */
const emptySeatView = (): MatchViewState => ({
  ...view,
  zones: Object.fromEntries(
    Object.entries(view.zones).map(([id, zone]) => [
      id,
      zone.ownerId === bluePlayer ? { ...zone, cards: [] } : zone,
    ])
  ),
  boards: {
    ...view.boards,
    [bluePlayer]: { activeStackId: null, benchStackIds: [] },
  },
});

/** Nobody has a card yet: the table as it opens. */
const emptyTableView = (): MatchViewState => ({
  ...view,
  zones: Object.fromEntries(
    Object.entries(view.zones).map(([id, zone]) => [
      id,
      zone.ownerId === null ? zone : { ...zone, cards: [] },
    ])
  ),
  boards: Object.fromEntries(
    Object.keys(view.boards).map((playerId) => [
      playerId,
      { activeStackId: null, benchStackIds: [] },
    ])
  ),
});

/** Blue's whole deck loaded, nothing set up. */
const loadedSeatView = (): MatchViewState => {
  const owned = Object.values(view.zones)
    .filter((zone) => zone.ownerId === bluePlayer)
    .flatMap((zone) => zone.cards);
  return {
    ...view,
    zones: Object.fromEntries(
      Object.entries(view.zones).map(([id, zone]) => [
        id,
        zone.ownerId !== bluePlayer
          ? zone
          : { ...zone, cards: zone.kind === 'deck' ? owned : [] },
      ])
    ),
    boards: {
      ...view.boards,
      [bluePlayer]: { activeStackId: null, benchStackIds: [] },
    },
  };
};

class FakeSocket implements SessionSocket {
  readonly sent: string[] = [];
  readonly close = vi.fn<(code?: number, reason?: string) => void>();

  constructor(private readonly handlers: SessionSocketHandlers) {}

  send = (frame: string): void => {
    this.sent.push(frame);
  };

  serverOpen(): void {
    this.handlers.open();
  }

  serverMessage(message: ServerMessage): void {
    this.handlers.message(JSON.stringify(message));
  }

  serverFrame(frame: string): void {
    this.handlers.message(frame);
  }

  commands(): readonly WireGameCommand[] {
    return this.sent
      .map((frame) => JSON.parse(frame) as { readonly type: string })
      .filter(
        (
          frame
        ): frame is { readonly type: 'Command'; command: WireGameCommand } =>
          frame.type === 'Command'
      )
      .map((frame) => frame.command);
  }
}

class FakeSocketFactory implements SessionSocketFactory {
  socket: FakeSocket | undefined;

  open = (_url: string, handlers: SessionSocketHandlers): FakeSocket => {
    this.socket = new FakeSocket(handlers);
    return this.socket;
  };
}

class FakeSessionScheduler implements ClientSessionScheduler {
  readonly schedule = vi.fn(() => 1);
  readonly cancel = vi.fn();
}

class ControlledAnnouncementScheduler {
  private readonly jobs: Array<{
    readonly complete: () => void;
    cancelled: boolean;
  }> = [];

  readonly schedule: LegacyAnnouncementScheduler = (complete) => {
    const job = { complete, cancelled: false };
    this.jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };

  get pendingCount(): number {
    return this.jobs.filter((job) => !job.cancelled).length;
  }
}

const welcome = (snapshot: MatchViewState = view): ServerMessage => ({
  type: 'Welcome',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'route-screen-server',
  role: 'player',
  playerId: bluePlayer,
  sessionId: 'route-screen-session',
  resumeToken,
  nextClientSequence: 1,
  snapshot,
});

const createRuntime = (
  socketFactory: FakeSocketFactory,
  announcements?: ControlledAnnouncementScheduler
): RemoteRoomRuntime =>
  new RemoteRoomRuntime({
    connection: {
      url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
      buildId: 'route-screen-client',
      roomCode: 'ABCDEFGH2345',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket,
      resumeToken,
    },
    session: {
      socketFactory,
      scheduler: new FakeSessionScheduler(),
    },
    ...(announcements
      ? {
          presentation: {
            scheduleAnnouncementClear: announcements.schedule,
          },
        }
      : {}),
  });

const connect = async (
  socketFactory: FakeSocketFactory,
  snapshot: MatchViewState = view
): Promise<FakeSocket> => {
  const socket = socketFactory.socket!;
  await act(async () => {
    socket.serverOpen();
    socket.serverMessage(welcome(snapshot));
  });
  return socket;
};

const flushConsumers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** Lets Base UI's portals, transitions and focus moves settle. */
const settle = async (rounds = 3): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

const find = <ElementType extends Element = HTMLElement>(
  selector: string
): ElementType | null => document.querySelector<ElementType>(selector);

const get = <ElementType extends Element = HTMLElement>(
  selector: string
): ElementType => {
  const found = find<ElementType>(selector);
  if (!found) throw new Error(`Missing test element: ${selector}`);
  return found;
};

const click = async (selector: string): Promise<void> => {
  const element = get(selector);
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flushConsumers();
  });
};

const pressEscape = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await settle();
};

/** The app menu's entries by id, while it is open. */
const menuIds = (): string[] =>
  [...document.querySelectorAll('[role="menu"] [role="menuitem"][id]')].map(
    (item) => item.id
  );

/**
 * Opens the app menu: the open toolbar's More, or on a narrow rail its one
 * menu button.
 */
const openMenu = async (): Promise<void> => {
  await click(find('#appMoreButton') ? '#appMoreButton' : '#appMenuButton');
  await settle();
  expect(
    find('[role="menu"]:is([aria-label="Menu"], [aria-label="More"])')
  ).not.toBeNull();
};

const closeMenu = async (): Promise<void> => {
  const menu = find(
    '[role="menu"]:is([aria-label="Menu"], [aria-label="More"])'
  );
  if (menu) await pressEscape(menu);
};

/**
 * Chooses an app entry by its id: a toolbar button directly, anything else
 * from the menu behind the toolbar's last button.
 */
const chooseMenuItem = async (id: string): Promise<void> => {
  if (!find(`.ptcgsim-app-toolbar #${id}`)) await openMenu();
  await click(`#${id}`);
  await settle();
};

const railIds = (): string[] =>
  [...document.querySelectorAll('#boardButtonContainer > button')].map(
    (button) => button.id
  );

const moreIds = (): string[] =>
  [...document.querySelectorAll('[data-test-more] > button')].map(
    (button) => button.id
  );

const openActivity = async (): Promise<void> => {
  if (get('#activityButton').getAttribute('aria-expanded') !== 'true') {
    await click('#activityButton');
    await settle();
  }
  expect(find('#activitySheet')).not.toBeNull();
};

const chooseLogAction = async (id: string): Promise<void> => {
  await openActivity();
  await click('#activityLogMenuButton');
  await settle();
  await click(`#${id}`);
  await settle();
};

const openDeckFromMenu = async (): Promise<void> => {
  await chooseMenuItem('deckImportButton');
  await act(async () => {
    await import('../features/deck/DeckBuilderSession.js');
    await flushConsumers();
  });
  await settle();
};

/** The application's overlay host, as main.tsx mounts it. */
const mountOverlayHost = async (): Promise<() => Promise<void>> => {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  await act(async () => root.render(<OverlayHost />));
  return async () => {
    await act(async () => {
      cancelAllDialogRequests();
      dismissToast();
      root.unmount();
    });
    element.remove();
  };
};

const mountRoute = async (
  element: React.ReactElement
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  await settle(1);
  return { host, root };
};

describe('RemoteRoomRoute', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    boardHarness.props = undefined;
    boardHarness.revision = undefined;
    boardHarness.replaying = false;
    boardHarness.refreshImages = 0;
    boardHarness.switchSide = false;
    boardHarness.pressed = [];
    boardViewSettings().reset();
    preferences().reset(SHELL_PREFERENCES);
    vi.mocked(toast).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts a live Solo table on the whole window, its menu and log on the rail', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const onMultiplayerNavigate = vi.fn();
    boardHarness.switchSide = true;
    const { root } = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        roomMode="solo"
        onLeave={vi.fn()}
        onMultiplayerNavigate={onMultiplayerNavigate}
      />
    );
    const main = get('main');
    expect(main.dataset.appRoute).toBe('remote-room');
    expect(main.dataset.sessionPhase).toBe('connecting');
    expect(get('.board-column').dataset.boardShell).toBe('table');
    // No sidebar, tabs or header: the table is the page.
    expect(find('.legacy-room-sidebar')).toBeNull();
    expect(find('#topButtonContainer')).toBeNull();
    expect(find('#roomHeader')).toBeNull();
    expect(find('#appMenuButton')).not.toBeNull();
    expect(find('#activityButton')).not.toBeNull();
    // Not yet seated: only the board's own Flip.
    expect(railIds()).toEqual(['flipBoardButton']);

    const socket = await connect(socketFactory);
    expect(main.dataset.sessionPhase).toBe('ready');
    expect(get('#room-board').textContent).toBe('1');
    expect(boardHarness.props?.sidePanel).toBe(false);
    expect(boardHarness.props?.keysSuspended).toBe(false);

    // The toolbar opens from its first button onto the deck, where to play,
    // the keys and Settings; the rest is behind its last button, More.
    expect(
      [
        ...document.querySelectorAll(
          '.ptcgsim-app-toolbar .ptcgsim-rail-button[id]'
        ),
      ].map((button) => button.id)
    ).toEqual([
      'appMenuButton',
      'deckImportButton',
      'p2Button',
      'shortcutsButton',
      'settingsButton',
      'appMoreButton',
    ]);
    await openMenu();
    expect(get('.ptcgsim-app-menu-heading').textContent).toBe('Solo table');
    expect(menuIds()).toEqual(
      expect.arrayContaining([
        'importReplay',
        'exportState',
        'fullscreenButton',
        'reloadImagesButton',
      ])
    );
    // Solo has no room to leave and nothing to save online.
    for (const id of [
      'leaveRoomButton',
      'copyInvitationMenuItem',
      'saveOnlineGame',
      'resumeSavedGame',
      'exitReplayMenuItem',
    ]) {
      expect(menuIds(), id).not.toContain(id);
    }
    await closeMenu();
    await click('#p2Button');
    expect(onMultiplayerNavigate).toHaveBeenCalledOnce();

    // The menu reaches the table's own commands.
    await chooseMenuItem('reloadImagesButton');
    expect(boardHarness.refreshImages).toBe(1);
    expect(socket.commands()).toEqual([]);

    await act(async () => root.unmount());
    runtime.dispose();
  });
  it('composes the rail from where the seat stands, around the board’s own actions', async () => {
    const stages: Array<{
      readonly name: string;
      readonly roomMode: 'solo' | 'multiplayer';
      readonly snapshot: MatchViewState;
      readonly switchSide?: boolean;
      readonly rail: readonly string[];
      readonly primary: string | undefined;
      readonly more: readonly string[];
    }> = [
      {
        name: 'multiplayer, no deck yet',
        roomMode: 'multiplayer',
        snapshot: emptySeatView(),
        rail: ['loadDeckButton', 'flipCoinButton'],
        primary: 'loadDeckButton',
        more: [],
      },
      {
        name: 'multiplayer, deck loaded',
        roomMode: 'multiplayer',
        snapshot: loadedSeatView(),
        rail: ['p2SetupButton', 'flipCoinButton', 'p2UndoButton'],
        primary: 'p2SetupButton',
        more: ['p2ResetButton'],
      },
      {
        name: 'multiplayer, playing',
        roomMode: 'multiplayer',
        snapshot: view,
        rail: [
          'turnButton',
          'p2AttackButton',
          'p2PassButton',
          'flipCoinButton',
          'p2UndoButton',
        ],
        primary: undefined,
        more: ['p2SetupButton', 'mulliganButton', 'p2ResetButton'],
      },
      {
        name: 'Solo, playing',
        roomMode: 'solo',
        snapshot: view,
        switchSide: true,
        rail: [
          'turnButton',
          'attackButton',
          'passButton',
          'flipCoinButton',
          'undoButton',
          'flipBoardButton',
        ],
        primary: undefined,
        more: [
          'setupButton',
          'mulliganButton',
          'resetButton',
          'setupBothButton',
          'resetBothButton',
        ],
      },
      {
        name: 'Solo, no deck yet',
        roomMode: 'solo',
        snapshot: emptySeatView(),
        switchSide: true,
        rail: ['loadDeckButton', 'flipCoinButton', 'flipBoardButton'],
        primary: 'loadDeckButton',
        // The other side has a deck, so both sides can be set up.
        more: ['setupBothButton', 'resetBothButton'],
      },
      {
        name: 'Solo, nobody has a deck',
        roomMode: 'solo',
        snapshot: emptyTableView(),
        switchSide: true,
        rail: ['loadDeckButton', 'flipCoinButton', 'flipBoardButton'],
        primary: 'loadDeckButton',
        // Nothing to set up or reset on either side yet.
        more: [],
      },
      {
        name: 'Solo, deck loaded',
        roomMode: 'solo',
        snapshot: loadedSeatView(),
        switchSide: true,
        rail: [
          'setupButton',
          'flipCoinButton',
          'undoButton',
          'flipBoardButton',
        ],
        primary: 'setupButton',
        more: ['resetButton', 'setupBothButton', 'resetBothButton'],
      },
    ];
    for (const stage of stages) {
      document.body.replaceChildren();
      boardHarness.switchSide = stage.switchSide ?? false;
      const socketFactory = new FakeSocketFactory();
      const runtime = createRuntime(socketFactory);
      const { root } = await mountRoute(
        <RemoteRoomRoute
          runtime={runtime}
          rendererKind="dom"
          roomMode={stage.roomMode}
        />
      );
      await connect(socketFactory, stage.snapshot);
      expect(railIds(), stage.name).toEqual(stage.rail);
      expect(
        find('#boardButtonContainer > [data-primary="true"]')?.id,
        stage.name
      ).toBe(stage.primary);
      expect(moreIds(), stage.name).toEqual(stage.more);
      await act(async () => root.unmount());
      runtime.dispose();
    }
  });

  it('sends the rail’s game actions as commands for the seat, and leaves the rest to the board', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute runtime={runtime} rendererKind="dom" roomMode="solo" />
    );
    const socket = await connect(socketFactory);
    const otherPlayer = view.playerOrder.find(
      (candidate) => candidate !== bluePlayer
    )!;
    for (const id of [
      'turnButton',
      'attackButton',
      'passButton',
      'flipCoinButton',
      'undoButton',
      'setupButton',
      'mulliganButton',
      'resetButton',
      'setupBothButton',
    ]) {
      await click(`#${id}`);
    }
    expect(boardHarness.pressed).toEqual([
      'turnButton',
      'flipCoinButton',
      'mulliganButton',
    ]);
    // The session sends the queue's head and holds the rest until the room
    // answers it; the queue is what the rail asked for, in order.
    expect(socket.commands()).toHaveLength(1);
    expect(
      runtime.session
        .getSnapshot()
        .pendingCommands.map((pending) => pending.command)
    ).toEqual([
      { type: 'DeclareAttack', targetPlayerId: bluePlayer },
      { type: 'PassTurn', targetPlayerId: bluePlayer },
      { type: 'ApplySoloUndo', targetPlayerId: bluePlayer },
      { type: 'SetupPlayer', targetPlayerId: bluePlayer },
      { type: 'ResetPlayer', targetPlayerId: bluePlayer },
      { type: 'SetupPlayer', targetPlayerId: bluePlayer },
      { type: 'SetupPlayer', targetPlayerId: otherPlayer },
    ]);

    // The toolbar's Deck opens the deck screen, which owns the keys.
    await click('#deckImportButton');
    await act(async () => {
      await import('../features/deck/DeckBuilderSession.js');
      await flushConsumers();
    });
    await settle();
    expect(find('.ptcgsim-deck-layer[data-open="true"]')).not.toBeNull();
    expect(boardHarness.props?.keysSuspended).toBe(true);
    await click('#deckBackButton');
    expect(find('.ptcgsim-deck-layer[data-open="false"]')).not.toBeNull();
    expect(boardHarness.props?.keysSuspended).toBe(false);

    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('shows a spectator only the board’s view controls', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    boardHarness.switchSide = true;
    const { root } = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        onLeave={vi.fn()}
        onCopyInvitation={vi.fn(async () => true)}
        continuationAvailable
        onResumeSavedGame={vi.fn(async () => undefined)}
      />
    );
    const socket = socketFactory.socket!;
    await act(async () => {
      socket.serverOpen();
      socket.serverMessage({
        ...welcome({ ...view, viewer: { kind: 'spectator' } }),
        role: 'spectator',
        playerId: undefined,
      } as ServerMessage);
    });
    expect(railIds()).toEqual(['flipBoardButton']);
    expect(moreIds()).toEqual([]);
    expect(boardHarness.props?.loadDeck).toBeUndefined();
    await openMenu();
    expect(menuIds()).toContain('leaveRoomButton');
    expect(menuIds()).not.toContain('saveOnlineGame');
    expect(menuIds()).not.toContain('resumeSavedGame');
    await closeMenu();
    await openActivity();
    expect(find('#p2MessageInput')).not.toBeNull();
    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('composes a multiplayer room: menu, activity, settings, replay and leaving', async () => {
    const unmountOverlays = await mountOverlayHost();
    const socketFactory = new FakeSocketFactory();
    const announcements = new ControlledAnnouncementScheduler();
    const runtime = createRuntime(socketFactory, announcements);
    const onIntent = vi.fn();
    const onSubmission = vi.fn();
    const onLeave = vi.fn();
    const onResumeSavedGame = vi.fn(async () => undefined);
    const downloadTextFile = vi.fn(
      (_filename: string, _contents: string) => true
    );
    const requestFullscreen = vi.fn(() => true);
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/table.png',
    }));
    const onCopyInvitation = vi.fn(async () => true);
    const route = (continuationAvailable: boolean) => (
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        onIntent={onIntent}
        onSubmission={onSubmission}
        onLeave={onLeave}
        onCopyInvitation={onCopyInvitation}
        onResumeSavedGame={onResumeSavedGame}
        continuationAvailable={continuationAvailable}
        downloadTextFile={downloadTextFile}
        requestFullscreen={requestFullscreen}
        requestBackground={requestBackground}
      />
    );
    try {
      const { root } = await mountRoute(route(false));
      const main = get('main');
      expect(main.dataset.appRoute).toBe('remote-room');
      // Every room says where its session stands, for specs to wait on.
      expect(main.dataset.sessionPhase).toBe('connecting');
      expect(document.body.textContent).not.toContain(admissionTicket);
      // Nothing to press before the room seats us.
      expect(railIds()).toEqual([]);

      // The log opens beside or over the table; its chat waits for the room.
      await openActivity();
      expect(find('#p2Chatbox')).not.toBeNull();
      expect(find('#chatbox')).toBeNull();
      expect(get<HTMLInputElement>('#p2MessageInput').disabled).toBe(true);
      expect(get('#activitySheet').textContent).toContain('Connecting…');
      // No copying before the room is live.
      expect(find('#roomHeaderCopyButton')).toBeNull();

      // The deck screen opens over the table; a room has no second seat.
      await openDeckFromMenu();
      expect(find('.ptcgsim-deck-layer[data-open="true"]')).not.toBeNull();
      expect(find('#deckPasteInput')).not.toBeNull();
      expect(find('#nativeDeckBuilderTargetAlt')).toBeNull();
      await click('#deckBackButton');
      expect(find('.ptcgsim-deck-layer[data-open="false"]')).not.toBeNull();

      const socket = await connect(socketFactory);
      expect(socket.sent).toHaveLength(1);
      expect(get('#room-board').textContent).toBe('1');
      expect(main.dataset.sessionPhase).toBe('ready');
      await openActivity();
      expect(get('#activitySheet').textContent).toContain('Room ABCDEFGH2345');
      expect(get<HTMLInputElement>('#p2MessageInput').disabled).toBe(false);
      // One key, as in v1: an invitation whose holder may choose to watch.
      await click('#roomHeaderCopyButton');
      expect(onCopyInvitation).toHaveBeenCalledWith('player');
      expect(toast).toHaveBeenCalledWith({
        title: 'Invitation copied',
        tone: 'success',
      });

      // Online save and resume are default-off on the Worker; until it
      // reports them enabled there is nothing to press.
      await openMenu();
      expect(get('.ptcgsim-app-menu-heading').textContent).toBe(
        'Room ABCDEFGH2345'
      );
      expect(menuIds()).not.toContain('saveOnlineGame');
      expect(menuIds()).not.toContain('resumeSavedGame');
      expect(menuIds()).not.toContain('importReplay');
      // Play online is where a Solo table goes; a room is already online.
      expect(menuIds()).not.toContain('p2Button');
      expect(menuIds()).toContain('copyInvitationMenuItem');
      await click('#copyInvitationMenuItem');
      expect(onCopyInvitation).toHaveBeenCalledTimes(2);
      await settle();
      await act(async () => root.render(route(true)));
      await openMenu();
      expect(get('#saveOnlineGame').textContent).toBe('Save online game');
      expect(get('#resumeSavedGame').textContent).toBe('Resume a saved game…');
      await closeMenu();

      // The board always gets preferences: reduced motion follows the
      // player's motion settings, the room starts on the Night table, and
      // Auto gives this wide landscape window the tabletop.
      expect(boardHarness.props?.preferences).toEqual({
        reducedMotion: false,
        highContrast: false,
        darkMode: true,
        showZoneOutlines: true,
        depth: { ...DEFAULT_TABLE_DEPTH, mode: 'table' },
      });

      await chooseMenuItem('exportState');
      expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
        type: 'RequestReplay',
        protocolVersion: PROTOCOL_VERSION,
      });
      await act(async () => {
        socket.serverMessage({
          type: 'ReplayStarted',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'live-route-export',
          viewer: view.viewer,
          startRevision: 1,
          endRevision: 1,
          truncated: true,
          frameCount: 1,
        });
        socket.serverMessage({
          type: 'ReplayFrame',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'live-route-export',
          index: 0,
          snapshot: view,
        });
        socket.serverMessage({
          type: 'ReplayCompleted',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'live-route-export',
          frameCount: 1,
        });
        await vi.waitFor(() =>
          expect(downloadTextFile).toHaveBeenCalledTimes(1)
        );
      });
      const [liveExportFilename, liveExportContents] =
        downloadTextFile.mock.calls[0]!;
      expect(liveExportFilename).toBe('ptcgsim-perspective-replay.json');
      await expect(
        parseProjectedReplayFile(liveExportContents)
      ).resolves.toMatchObject({ replayId: 'live-route-export' });
      expect(runtime.replay.getSnapshot()).toMatchObject({
        mode: 'live',
        requestPhase: 'idle',
        view: { revision: 1 },
        playback: { phase: 'empty' },
      });

      const sentBeforeSettings = socket.sent.length;
      await chooseMenuItem('settingsButton');
      expect(find('#settings')).not.toBeNull();
      expect(find('#darkModeCheckbox')).not.toBeNull();
      // How the table is shown is part of Settings now.
      expect(find('#boardShowBoth')).not.toBeNull();
      // Only Solo offers to cover the opponent's hand.
      expect(find('#hideHandCheckbox')).toBeNull();
      expect(get('#changeBackgroundButton').textContent).toBe(
        'Change background'
      );
      // Settings holds settings only: the keys are on the toolbar, the help
      // and community links in its menu.
      expect(get('#settings').textContent).not.toContain('Keyboard shortcuts');

      await click('#changeBackgroundButton');
      await act(async () => flushConsumers());
      expect(requestBackground).toHaveBeenCalledOnce();
      expect(requestBackground.mock.calls[0]?.[0]?.signal).toBeInstanceOf(
        AbortSignal
      );
      expect(main.dataset.roomBackground).toBe('image');
      expect(main.style.backgroundImage).toBe(
        'url("https://images.example.test/table.png")'
      );
      expect(main.dataset.darkMode).toBe('true');
      // Turning dark mode off turns the table to Day.
      await click('#darkModeCheckbox');
      expect(boardHarness.props?.preferences).toEqual({
        reducedMotion: false,
        highContrast: false,
        darkMode: false,
        showZoneOutlines: true,
        depth: { ...DEFAULT_TABLE_DEPTH, mode: 'table' },
      });
      expect(main.dataset.darkMode).toBe('false');
      expect(main.classList).not.toContain('remote-room-route--dark');
      expect(document.documentElement.dataset.theme).toBe('day');
      // The table settings reach the board without a command.
      await act(async () =>
        boardViewSettings().update({ zoneOutlines: false })
      );
      expect(boardHarness.props?.preferences?.showZoneOutlines).toBe(false);
      const preferencesBeforeHideHand = boardHarness.props?.preferences;
      await act(async () =>
        boardViewSettings().update({ hideOpponentHand: true })
      );
      expect(boardHarness.props?.hideOpponentHand).toBe(true);
      expect(boardHarness.props?.preferences).toBe(preferencesBeforeHideHand);
      expect(socket.sent).toHaveLength(sentBeforeSettings);
      expect(onSubmission).not.toHaveBeenCalled();
      await pressEscape(get('#settings'));
      expect(find('#settings')).toBeNull();

      // Leaving asks first, once at a time.
      await chooseMenuItem('leaveRoomButton');
      await settle();
      const alert = get('[role="alertdialog"]');
      expect(alert.textContent).toContain(
        'Are you sure you want to leave the room? Current game state will be lost.'
      );
      await click('[data-dialog-action="cancel"]');
      await settle();
      expect(onLeave).not.toHaveBeenCalled();
      await chooseMenuItem('leaveRoomButton');
      await settle();
      await click('[data-dialog-action="confirm"]');
      await settle();
      expect(onLeave).toHaveBeenCalledOnce();

      await act(async () => {
        socket.serverMessage({
          type: 'StatePublication',
          protocolVersion: PROTOCOL_VERSION,
          executedClientSequence: 0,
          snapshot: { ...view, revision: 2 },
          presentationEvents: [
            {
              type: 'CoinFlipped',
              revision: 2,
              playerId: bluePlayer,
              result: 'heads',
            },
          ],
        });
        await flushConsumers();
      });
      await openActivity();
      expect(get('#p2Chatbox').textContent).toBe('Blue flipped heads');
      expect(announcements.pendingCount).toBe(1);

      await act(async () => runtime.replay.requestReplay());
      await act(async () => {
        socket.serverMessage({
          type: 'ReplayStarted',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'route-screen-replay',
          viewer: view.viewer,
          startRevision: 1,
          endRevision: 2,
          truncated: true,
          frameCount: 2,
        });
        socket.serverMessage({
          type: 'ReplayFrame',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'route-screen-replay',
          index: 0,
          snapshot: view,
        });
        socket.serverMessage({
          type: 'ReplayFrame',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'route-screen-replay',
          index: 1,
          snapshot: { ...view, revision: 2 },
          presentationEvents: [
            {
              type: 'CoinFlipped',
              revision: 2,
              playerId: bluePlayer,
              result: 'heads',
            },
          ],
        });
        socket.serverMessage({
          type: 'ReplayCompleted',
          protocolVersion: PROTOCOL_VERSION,
          replayId: 'route-screen-replay',
          frameCount: 2,
        });
        await flushConsumers();
      });

      // Replay: the rail is its transport, the log is v1's replay feed.
      expect(boardHarness.replaying).toBe(true);
      expect(railIds()).toEqual([
        'setupButton',
        'resetButton',
        'setupBothButton',
        'resetBothButton',
        'exitReplay',
      ]);
      expect(get('#setupBothButton').getAttribute('aria-label')).toBe(
        'Next replay action'
      );
      expect(moreIds()).toEqual([]);
      expect(get('#chatbox').textContent).toBe('');
      expect(find('#p2Chatbox')).toBeNull();
      expect(find('#p2MessageInput')).toBeNull();
      expect(get('#room-board').textContent).toBe('1');
      expect(announcements.pendingCount).toBe(0);
      expect(get('#activitySheet').textContent).toContain('Replay');
      await openMenu();
      expect(menuIds()).toContain('exitReplayMenuItem');
      for (const id of [
        'deckImportButton',
        'p2Button',
        'leaveRoomButton',
        'copyInvitationMenuItem',
        'saveOnlineGame',
      ]) {
        expect(menuIds(), id).not.toContain(id);
      }
      await closeMenu();

      const dropIntent = {
        kind: 'CardDropRequested',
        cardId: 'route-card',
        targetId: 'slot:spike-blue:bench',
      } as BoardIntent;
      const selectionIntent = {
        kind: 'CardSelected',
        cardId: 'route-card',
      } as BoardIntent;
      boardHarness.props?.onIntent(dropIntent);
      boardHarness.props?.onIntent(selectionIntent);
      expect(onIntent).toHaveBeenNthCalledWith(1, dropIntent);
      expect(onIntent).toHaveBeenNthCalledWith(2, selectionIntent);
      // The route observer sees raw renderer intent. The board controller
      // owns replay rejection before any session submission.
      expect(onSubmission).not.toHaveBeenCalled();

      await click('#setupBothButton');
      expect(get('#room-board').textContent).toBe('2');
      expect(get('#chatbox').textContent).toBe('Blue flipped heads');
      expect(announcements.pendingCount).toBe(1);

      await chooseMenuItem('exportState');
      await act(async () => {
        await vi.waitFor(() =>
          expect(downloadTextFile).toHaveBeenCalledTimes(2)
        );
      });
      const [replayFilename, replayContents] = downloadTextFile.mock.calls[1]!;
      expect(replayFilename).toBe('ptcgsim-perspective-replay.json');
      expect(JSON.parse(replayContents)).toMatchObject({
        format: 'ptcgsim-perspective-replay',
        privacy: {
          kind: 'viewer-projection',
          canonicalState: false,
          resumable: false,
        },
      });
      await expect(
        parseProjectedReplayFile(replayContents)
      ).resolves.toMatchObject({
        replayId: 'route-screen-replay',
        viewer: view.viewer,
        startRevision: 1,
        endRevision: 2,
      });
      expect(runtime.replay.getSnapshot().mode).toBe('replay');

      // The log's own actions: a replay's log can be saved, not cleared.
      await openActivity();
      await click('#activityLogMenuButton');
      await settle();
      expect(find('#clearLog')).toBeNull();
      await click('#exportLog');
      await settle();
      expect(downloadTextFile).toHaveBeenCalledWith(
        'battle-log.txt',
        '1: Blue flipped heads\n\n'
      );

      await chooseMenuItem('fullscreenButton');
      expect(requestFullscreen).toHaveBeenCalledOnce();
      // Once full screen, the same entry takes the page back out.
      const exitFullscreen = vi.fn();
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: document.documentElement,
      });
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen,
      });
      await act(async () => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      await openMenu();
      expect(get('#fullscreenButton').textContent).toBe('Exit full screen');
      await click('#fullscreenButton');
      await settle();
      expect(exitFullscreen).toHaveBeenCalledOnce();
      expect(requestFullscreen).toHaveBeenCalledOnce();
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
      await act(async () => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });

      await click('#exitReplay');
      expect(boardHarness.replaying).toBe(false);
      await openActivity();
      expect(get('#p2Chatbox').textContent).toBe('Blue flipped heads');
      expect(find('#p2MessageInput')).not.toBeNull();
      expect(get('#room-board').textContent).toBe('2');
      expect(announcements.pendingCount).toBe(0);

      // A live log can be cleared from its own menu.
      await chooseLogAction('clearLog');
      expect(get('#p2Chatbox').textContent).toBe('');

      await act(async () => root.unmount());
      expect(runtime.session.getSnapshot().phase).toBe('ready');
      runtime.dispose();
      expect(runtime.session.getSnapshot().phase).toBe('closed');
      expect(socket.close).toHaveBeenCalledWith(1000, 'Client left room');
    } finally {
      await unmountOverlays();
    }
  });

  it('imports a replay into a Solo table and leaves it again from the rail', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute runtime={runtime} rendererKind="dom" roomMode="solo" />
    );
    const socket = await connect(socketFactory);
    await openMenu();
    expect(get('#importReplay').textContent).toBe('Watch a replay…');
    await closeMenu();

    const replayContents = await serializeProjectedReplayFile({
      replayId: 'route-file-replay',
      viewer: view.viewer,
      startRevision: view.revision,
      endRevision: view.revision,
      truncated: view.revision > 0,
      frames: [{ snapshot: view, presentationEvents: [] }],
    });
    const replayBytes = new TextEncoder().encode(replayContents);
    const replayFile = new File([replayBytes], 'route-replay.json', {
      type: 'application/json',
    });
    Object.defineProperty(replayFile, 'arrayBuffer', {
      value: async () => replayBytes.buffer.slice(0),
    });
    const replayInput = get<HTMLInputElement>('#jsonReplay');
    Object.defineProperty(replayInput, 'files', {
      configurable: true,
      value: [replayFile],
    });
    const sentBeforeImport = socket.sent.length;
    await act(async () => {
      replayInput.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(runtime.replay.getSnapshot().mode).toBe('replay')
      );
    });
    expect(railIds()).toContain('exitReplay');
    expect(find('#jsonReplay')).not.toBeNull();
    await openMenu();
    expect(get('.ptcgsim-app-menu-heading').textContent).toBe('Replay');
    expect(menuIds()).not.toContain('importReplay');
    await closeMenu();
    expect(socket.sent).toHaveLength(sentBeforeImport);

    await click('#exitReplay');
    expect(runtime.replay.getSnapshot().mode).toBe('live');
    expect(railIds()).toContain('attackButton');

    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('opens Play online over a live Solo table and parks nothing until asked', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const onMultiplayerPanelOpen = vi.fn();
    const onMultiplayerNavigate = vi.fn();
    const multiplayerPanel = vi.fn((hidden: boolean) => (
      <section id="p2Box" hidden={hidden}>
        Online Multiplayer Mode
      </section>
    ));
    const { root } = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        roomMode="solo"
        multiplayerPanel={multiplayerPanel}
        onMultiplayerPanelOpen={onMultiplayerPanelOpen}
        onMultiplayerNavigate={onMultiplayerNavigate}
      />
    );
    await connect(socketFactory);
    expect(find('#playOnlineSheet')).toBeNull();
    await chooseMenuItem('p2Button');
    expect(onMultiplayerPanelOpen).toHaveBeenCalledOnce();
    expect(onMultiplayerNavigate).not.toHaveBeenCalled();
    expect(find('#playOnlineSheet')).not.toBeNull();
    expect(get('#p2Box').hidden).toBe(false);
    expect(multiplayerPanel).toHaveBeenCalledWith(false);
    // The table stays where it is underneath.
    expect(get('#room-board').textContent).toBe('1');
    await pressEscape(get('#playOnlineSheet'));
    expect(find('#playOnlineSheet')).toBeNull();

    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('welcomes a player to an empty Solo table until they put it away', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        roomMode="solo"
        multiplayerPanel={() => <section id="p2Box" />}
      />
    );
    // Not before the table is ready.
    expect(find('[data-table-welcome]')).toBeNull();
    await connect(socketFactory, emptyTableView());
    expect(find('[data-table-welcome]')).not.toBeNull();
    expect(find('#tutorialButton')).not.toBeNull();

    await click('#welcomeLoadDeckButton');
    await act(async () => {
      await import('../features/deck/DeckBuilderSession.js');
      await flushConsumers();
    });
    await settle();
    expect(find('.ptcgsim-deck-layer[data-open="true"]')).not.toBeNull();
    // It steps aside while something is open over the table.
    expect(find('[data-table-welcome]')).toBeNull();
    await click('#deckBackButton');
    expect(find('[data-table-welcome]')).not.toBeNull();

    await click('[aria-label="Hide welcome"]');
    expect(find('[data-table-welcome]')).toBeNull();
    expect(preferences().get(SHELL_PREFERENCES).welcomeDismissed).toBe(true);

    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('leaves the welcome out once a deck is on the table', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute runtime={runtime} rendererKind="dom" roomMode="solo" />
    );
    await connect(socketFactory, loadedSeatView());
    expect(find('[data-table-welcome]')).toBeNull();
    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('keeps the welcome away when one seat is empty and the other is not', async () => {
    // Turning a Solo table round to the empty seat must not bring it back.
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute runtime={runtime} rendererKind="dom" roomMode="solo" />
    );
    await connect(socketFactory, emptySeatView());
    expect(find('[data-table-welcome]')).toBeNull();
    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('offers the deck pile’s + for both Solo seats and only your own in a room', async () => {
    const deckStore = new DeckBuilderStore({ alternateEnabled: true });
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const solo = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        roomMode="solo"
        deckStore={deckStore}
      />
    );
    expect(boardHarness.props?.loadDeck).toBeUndefined();
    await connect(socketFactory, emptySeatView());
    const otherPlayer = view.playerOrder.find(
      (candidate) => candidate !== bluePlayer
    )!;
    expect(boardHarness.props?.loadDeck?.playerIds).toEqual(view.playerOrder);
    await act(async () => {
      boardHarness.props?.loadDeck?.onLoad(otherPlayer);
      await import('../features/deck/DeckBuilderSession.js');
      await flushConsumers();
    });
    await settle();
    expect(find('.ptcgsim-deck-layer[data-open="true"]')).not.toBeNull();
    expect(deckStore.getSnapshot().target).toBe('alternate');
    await click('#deckBackButton');
    await act(async () => {
      boardHarness.props?.loadDeck?.onLoad(bluePlayer);
      await flushConsumers();
    });
    await settle();
    expect(deckStore.getSnapshot().target).toBe('main');
    await act(async () => solo.root.unmount());
    runtime.dispose();

    document.body.replaceChildren();
    const roomSockets = new FakeSocketFactory();
    const roomRuntime = createRuntime(roomSockets);
    const room = await mountRoute(
      <RemoteRoomRoute runtime={roomRuntime} rendererKind="dom" />
    );
    await connect(roomSockets, emptySeatView());
    expect(boardHarness.props?.loadDeck?.playerIds).toEqual([bluePlayer]);
    await act(async () => room.root.unmount());
    roomRuntime.dispose();
  });

  it('docks the log beside the table on a wide screen, and the table makes room', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string): MediaQueryList =>
        ({
          matches: query.includes('min-width: 1025px'),
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList
    );
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute runtime={runtime} rendererKind="dom" />
    );
    await connect(socketFactory);
    expect(boardHarness.props?.sidePanel).toBe(false);
    await click('#activityButton');
    expect(get('#activitySheet').tagName).toBe('ASIDE');
    expect(boardHarness.props?.sidePanel).toBe(true);
    expect(get('main').dataset.activityDocked).toBe('true');
    // Kept open for the next visit on this device.
    expect(preferences().get(SHELL_PREFERENCES).activityDocked).toBe(true);
    await click('[aria-label="Close activity"]');
    expect(find('#activitySheet')).toBeNull();
    expect(boardHarness.props?.sidePanel).toBe(false);
    expect(get('main').dataset.activityDocked).toBeUndefined();
    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('installs a pre-ready arbitrary card back and a local deck through the live route', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = new RemoteRoomRuntime({
      connection: {
        url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
        buildId: 'route-deck-client',
        roomCode: 'ABCDEFGH2345',
        displayName: 'Blue',
        requestedRole: 'player',
        admissionTicket,
        resumeToken,
      },
      session: {
        socketFactory,
        scheduler: new FakeSessionScheduler(),
      },
    });
    const deckStore = new DeckBuilderStore();
    const cardBackStore = new CardBackCustodyStore();
    const exactCardBack = 'custom+unsafe://route-card-back?exact=yes';
    const requestCardBack = vi.fn(async () => exactCardBack);
    const { root } = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        deckStore={deckStore}
        cardBackStore={cardBackStore}
        requestCardBack={requestCardBack}
      />
    );
    await openDeckFromMenu();
    await click('#changeCardBackButton');
    await act(async () => flushConsumers());
    expect(requestCardBack).toHaveBeenCalledOnce();
    expect(cardBackStore.getSnapshot().slots.main).toMatchObject({
      url: exactCardBack,
      dirty: true,
      installingRevision: 1,
    });

    const socket = socketFactory.socket!;
    expect(socket.sent).toHaveLength(0);
    await act(async () => {
      socket.serverOpen();
      socket.serverMessage(welcome());
    });
    expect(socket.sent).toHaveLength(2);
    const cardBackFrame = JSON.parse(socket.sent[1]!) as {
      readonly commandId: string;
      readonly clientSequence: number;
      readonly command: WireGameCommand;
    };
    expect(cardBackFrame).toMatchObject({
      type: 'Command',
      command: { type: 'SetCardBack', cardBackUrl: exactCardBack },
    });

    const installedBack = {
      ...view,
      revision: view.revision + 1,
      players: {
        ...view.players,
        [bluePlayer]: {
          ...view.players[bluePlayer]!,
          cardBackUrl: exactCardBack,
        },
      },
    };
    await act(async () => {
      socket.serverMessage({
        type: 'CommandResult',
        protocolVersion: PROTOCOL_VERSION,
        commandId: cardBackFrame.commandId,
        clientSequence: cardBackFrame.clientSequence,
        accepted: true,
        revision: installedBack.revision,
      });
      socket.serverMessage({
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        coveringCommandId: cardBackFrame.commandId,
        executedClientSequence: cardBackFrame.clientSequence,
        snapshot: installedBack,
      });
    });
    expect(cardBackStore.getSnapshot().hasDirtyCardBacks).toBe(false);

    act(() =>
      deckStore.addCard({
        id: 'custom:route-pikachu',
        name: 'Route Pikachu',
        category: 'Pokémon',
        image: 'data:image/not-filtered',
      })
    );
    // Back to the table: the deck screen closes and its draft goes in.
    await click('#deckBackButton');
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    const deckFrame = JSON.parse(socket.sent[2]!) as {
      readonly commandId: string;
      readonly clientSequence: number;
      readonly command: WireGameCommand;
    };
    expect(deckFrame).toMatchObject({
      type: 'Command',
      command: {
        type: 'LoadDeck',
        targetPlayerId: bluePlayer,
        entries: [
          {
            count: 1,
            definition: {
              name: 'Route Pikachu',
              imageUrl: 'data:image/not-filtered',
            },
          },
        ],
      },
    });
    const installedDeck = {
      ...installedBack,
      revision: installedBack.revision + 1,
    };
    await act(async () => {
      socket.serverMessage({
        type: 'CommandResult',
        protocolVersion: PROTOCOL_VERSION,
        commandId: deckFrame.commandId,
        clientSequence: deckFrame.clientSequence,
        accepted: true,
        revision: installedDeck.revision,
      });
      socket.serverMessage({
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        coveringCommandId: deckFrame.commandId,
        executedClientSequence: deckFrame.clientSequence,
        snapshot: installedDeck,
      });
    });
    expect(deckStore.getSnapshot().hasDirtyDecks).toBe(false);

    await act(async () => root.unmount());
    runtime.dispose();
  });

  it('says a terminal session failure on the table without exposing admission data', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const { root } = await mountRoute(
      <RemoteRoomRoute runtime={runtime} rendererKind="dom" roomMode="solo" />
    );
    await openDeckFromMenu();
    // Solo: a seat tab for P2.
    await vi.waitFor(() =>
      expect(find('#nativeDeckBuilderTargetAlt')).not.toBeNull()
    );
    await click('#deckBackButton');

    const socket = socketFactory.socket!;
    await act(async () => {
      socket.serverOpen();
      socket.serverFrame('{');
    });

    expect(runtime.session.getSnapshot().phase).toBe('failed');
    expect(get('#roomHeaderText').textContent).toBe(
      'Server frame rejected: invalid_json'
    );
    expect(get('#roomHeader').getAttribute('role')).toBe('status');
    expect(document.body.innerHTML).not.toContain(admissionTicket);
    expect(socket.close).toHaveBeenCalledWith(4400, 'invalid_server_frame');

    await act(async () => root.unmount());
    runtime.dispose();
    expect(runtime.session.getSnapshot().phase).toBe('closed');
  });

  it('tells its owner when the table is ready to be seen: the board painted, or a failure to say', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = createRuntime(socketFactory);
    const onTableSettledChange = vi.fn();
    const { root } = await mountRoute(
      <RemoteRoomRoute
        runtime={runtime}
        rendererKind="dom"
        roomMode="solo"
        onTableSettledChange={onTableSettledChange}
      />
    );
    // The board reports its own paint straight to the owner.
    expect(boardHarness.props?.onSettledChange).toBe(onTableSettledChange);
    expect(onTableSettledChange).not.toHaveBeenCalled();

    const socket = socketFactory.socket!;
    await act(async () => {
      socket.serverOpen();
      socket.serverFrame('{');
    });
    // A room that failed has something to say over its table.
    expect(find('#roomHeaderText')).not.toBeNull();
    expect(onTableSettledChange).toHaveBeenCalledWith(true);

    await act(async () => root.unmount());
    runtime.dispose();
  });
});
