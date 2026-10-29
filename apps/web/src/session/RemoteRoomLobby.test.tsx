// @vitest-environment happy-dom

import {
  TABLE_SPLIT,
  createRendererSpikeView,
  type BoardLayoutSnapshot,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import type { DeckCard } from '@ptcgsim/deck-core';
import { StrictMode, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
import { PreferenceStore } from '../preferences/preference-store.js';
import { TABLE_PREFERENCES } from './table-preferences.js';
import { DeckBuilderStore } from '../features/deck/deck-builder-store.js';
import {
  RemoteRoomInvitationError,
  type RemoteRoomCreationResult,
} from './RemoteRoomCreation.js';
import {
  RemoteRoomLobby,
  type RemoteRoomLobbyDependencies,
} from './RemoteRoomLobby.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import type { BoardRailModel } from './RemoteSessionBoard.js';
import type { RoomBackground } from './browser-room-background.js';
import type { RoomInvitations } from './room-invites.js';
import { boardViewSettings } from '../board/view/board-view-settings.js';
import { serializeRoomInvitationHandoffText } from '@ptcgsim/protocol';
import {
  pendingTutorialRequest,
  startTutorial,
} from '../tutorial/tutorial-state.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lobbyBoardHarness = vi.hoisted(() => ({
  preferences: undefined as BoardPreferences | undefined,
  viewMatchId: undefined as string | undefined,
  table: undefined as { readonly lowerShare: number } | undefined,
  parkedSession: undefined as unknown,
  parkedRoomMode: undefined as string | undefined,
  parkedRail: undefined as BoardRailModel | undefined,
  parkedKeysSuspended: undefined as boolean | undefined,
  parkedInitialFlipped: undefined as boolean | undefined,
  parkedPerspective: undefined as
    ((perspective: { readonly flipped: boolean }) => void) | undefined,
  onEmptySettledChange: undefined as ((settled: boolean) => void) | undefined,
  onParkedSettledChange: undefined as ((settled: boolean) => void) | undefined,
}));
const roomRouteHarness = vi.hoisted(() => ({
  onDeckCustodyChange: undefined as
    | ((custody: {
        readonly store: DeckBuilderStore;
        readonly cardBackStore: CardBackCustodyStore;
      }) => void)
    | undefined,
  preferences: undefined as BoardPreferences | undefined,
  onPreferencesChange: undefined as
    ((preferences: BoardPreferences) => void) | undefined,
  background: undefined as RoomBackground | undefined,
  onBackgroundChange: undefined as
    ((background: RoomBackground) => void) | undefined,
  roomMode: undefined as 'solo' | 'multiplayer' | undefined,
  onMultiplayerNavigate: undefined as (() => void) | undefined,
  onMultiplayerPanelOpen: undefined as (() => void) | undefined,
  deckStore: undefined as DeckBuilderStore | undefined,
  cardBackStore: undefined as CardBackCustodyStore | undefined,
  invitations: undefined as RoomInvitations | undefined,
  continuationAvailable: undefined as boolean | undefined,
  installDeckOnSessionAttach: undefined as boolean | undefined,
  onResumeSavedGame: undefined as
    ((contents: string, signal: AbortSignal) => Promise<void>) | undefined,
  onTableSettledChange: undefined as ((settled: boolean) => void) | undefined,
  tutorial: undefined as { readonly onExit: () => void } | undefined,
  onlineRequest: undefined as number | undefined,
  initialSheet: undefined as 'online' | undefined,
  initialFlipped: undefined as boolean | undefined,
  onFlippedChange: undefined as ((flipped: boolean) => void) | undefined,
}));

/** The invitation link the page was opened with, as the capture holds it. */
const linkHarness = vi.hoisted(() => ({
  link: undefined as string | undefined,
  listeners: new Set<() => void>(),
}));
vi.mock('./invitation-link-capture.js', () => ({
  takeInvitationLink: () => {
    const link = linkHarness.link;
    linkHarness.link = undefined;
    return link;
  },
  onInvitationLink: (listener: () => void) => {
    linkHarness.listeners.add(listener);
    return () => linkHarness.listeners.delete(listener);
  },
}));

/** Enough of a table layout for the empty table's app bar to place itself. */
const EMPTY_TABLE_LAYOUT = {
  viewport: { width: 1200, height: 800, devicePixelRatio: 1 },
  playAreaBounds: { x: 0, y: 0, width: 1200, height: 800 },
  shared: { boardControlsAnchor: { x: 120, y: 384, height: 32 } },
} as unknown as BoardLayoutSnapshot;

vi.mock('../RendererSpikeBoard.js', () => ({
  RendererSpikeBoard: (props: {
    readonly preferences?: BoardPreferences;
    readonly view: { readonly matchId: string };
    readonly table?: { readonly lowerShare: number };
    readonly chrome?: (layout: BoardLayoutSnapshot) => ReactNode;
    readonly onSettledChange?: (settled: boolean) => void;
  }) => {
    lobbyBoardHarness.onEmptySettledChange = props.onSettledChange;
    lobbyBoardHarness.preferences = props.preferences;
    lobbyBoardHarness.viewMatchId = props.view.matchId;
    lobbyBoardHarness.table = props.table;
    return (
      <div data-testid="lobby-board">{props.chrome?.(EMPTY_TABLE_LAYOUT)}</div>
    );
  },
}));

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

vi.mock('./RemoteSessionBoard.js', () => ({
  RemoteSessionBoard: (props: {
    readonly session: unknown;
    readonly roomMode?: string;
    readonly rail?: BoardRailModel;
    readonly keysSuspended?: boolean;
    readonly onSettledChange?: (settled: boolean) => void;
    readonly initialFlipped?: boolean;
    readonly onPerspectiveChange?: (perspective: {
      readonly flipped: boolean;
    }) => void;
  }) => {
    lobbyBoardHarness.onParkedSettledChange = props.onSettledChange;
    lobbyBoardHarness.parkedInitialFlipped = props.initialFlipped;
    lobbyBoardHarness.parkedPerspective = props.onPerspectiveChange;
    lobbyBoardHarness.parkedSession = props.session;
    lobbyBoardHarness.parkedRoomMode = props.roomMode;
    lobbyBoardHarness.parkedRail = props.rail;
    lobbyBoardHarness.parkedKeysSuspended = props.keysSuspended;
    return <div data-testid="parked-solo-board">{props.rail?.bar}</div>;
  },
}));

vi.mock('./RemoteRoomRoute.js', () => ({
  RemoteRoomRoute: ({
    runtime,
    onLeave,
    onNewSoloTable,
    preferences,
    onPreferencesChange,
    background,
    onBackgroundChange,
    roomMode,
    onMultiplayerNavigate,
    multiplayerPanel,
    onMultiplayerPanelOpen,
    deckStore,
    cardBackStore,
    invitations,
    continuationAvailable,
    installDeckOnSessionAttach,
    onResumeSavedGame,
    onTableSettledChange,
    tutorial,
    onlineRequest,
    initialSheet,
    initialFlipped,
    onFlippedChange,
    onDeckCustodyChange,
  }: {
    readonly runtime: { readonly label?: string };
    readonly onLeave?: () => void;
    readonly onNewSoloTable?: () => void;
    readonly preferences?: BoardPreferences;
    readonly onPreferencesChange?: (preferences: BoardPreferences) => void;
    readonly background?: RoomBackground;
    readonly onBackgroundChange?: (background: RoomBackground) => void;
    readonly roomMode?: 'solo' | 'multiplayer';
    readonly onMultiplayerNavigate?: () => void;
    readonly multiplayerPanel?: (hidden: boolean) => ReactNode;
    readonly onMultiplayerPanelOpen?: () => void;
    readonly deckStore?: DeckBuilderStore;
    readonly cardBackStore?: CardBackCustodyStore;
    readonly invitations?: RoomInvitations;
    readonly continuationAvailable?: boolean;
    readonly installDeckOnSessionAttach?: boolean;
    readonly onResumeSavedGame?: (
      contents: string,
      signal: AbortSignal
    ) => Promise<void>;
    readonly onTableSettledChange?: (settled: boolean) => void;
    readonly tutorial?: { readonly onExit: () => void };
    readonly onlineRequest?: number;
    readonly initialSheet?: 'online';
    readonly initialFlipped?: boolean;
    readonly onFlippedChange?: (flipped: boolean) => void;
    readonly onDeckCustodyChange?: (custody: {
      readonly store: DeckBuilderStore;
      readonly cardBackStore: CardBackCustodyStore;
    }) => void;
  }) => {
    roomRouteHarness.onTableSettledChange = onTableSettledChange;
    roomRouteHarness.onDeckCustodyChange = onDeckCustodyChange;
    roomRouteHarness.tutorial = tutorial;
    roomRouteHarness.onlineRequest = onlineRequest;
    // Opened with Play online at least once since the test began (the
    // lobby stops asking once the route has it).
    if (initialSheet) roomRouteHarness.initialSheet = initialSheet;
    roomRouteHarness.initialFlipped = initialFlipped;
    roomRouteHarness.onFlippedChange = onFlippedChange;
    roomRouteHarness.preferences = preferences;
    roomRouteHarness.onPreferencesChange = onPreferencesChange;
    roomRouteHarness.background = background;
    roomRouteHarness.onBackgroundChange = onBackgroundChange;
    roomRouteHarness.roomMode = roomMode;
    roomRouteHarness.onMultiplayerNavigate = onMultiplayerNavigate;
    roomRouteHarness.onMultiplayerPanelOpen = onMultiplayerPanelOpen;
    roomRouteHarness.deckStore = deckStore;
    roomRouteHarness.cardBackStore = cardBackStore;
    roomRouteHarness.invitations = invitations;
    roomRouteHarness.continuationAvailable = continuationAvailable;
    roomRouteHarness.installDeckOnSessionAttach = installDeckOnSessionAttach;
    roomRouteHarness.onResumeSavedGame = onResumeSavedGame;
    return (
      <main
        data-app-route="test-remote-room"
        data-tutorial={tutorial ? 'true' : undefined}
      >
        {runtime.label}
        {onMultiplayerNavigate && (
          <button
            id="testOpenMultiplayer"
            type="button"
            onClick={onMultiplayerNavigate}
          >
            Multiplayer
          </button>
        )}
        {onLeave && (
          <button id="testLeaveRoom" type="button" onClick={onLeave}>
            Leave
          </button>
        )}
        {onNewSoloTable && (
          <button id="testNewSoloTable" type="button" onClick={onNewSoloTable}>
            New table
          </button>
        )}
        {multiplayerPanel?.(false)}
      </main>
    );
  },
}));

const ROOM_CODE = 'ABCDEFGH2345';
const RAW_HANDOFF =
  'PTCGSIM2-INVITE:{"roomCode":"ABCDEFGH2345","requestedRole":"spectator","invitation":"secret-bearer-never-rendered","expiresAt":9999999999999}';

/** The same invitation as a link's fragment (`#invite=…`). */
const RAW_LINK = '#invite=c2VjcmV0LWJlYXJlci1uZXZlci1yZW5kZXJlZA';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

const inputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const paste = (input: HTMLInputElement, text: string): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  input.dispatchEvent(event);
  return event;
};

const custody = () => ({
  acceptPaste: vi.fn(
    (event: {
      readonly clipboardData: Pick<DataTransfer, 'getData'> | null;
      readonly preventDefault: () => void;
    }) => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain');
      if (text !== RAW_HANDOFF) {
        throw Object.assign(new Error('redacted'), {
          code: 'invalid_handoff',
        });
      }
      return {
        roomCode: ROOM_CODE,
        requestedRole: 'spectator' as const,
        expiresAt: 40_000,
      };
    }
  ),
  // A link, dropped text or the Paste button's read: the same check.
  acceptText: vi.fn((text: unknown) => {
    if (
      typeof text !== 'string' ||
      (text !== RAW_HANDOFF && !text.endsWith(RAW_LINK))
    ) {
      throw Object.assign(new Error('redacted'), {
        code: 'invalid_handoff',
      });
    }
    return {
      roomCode: ROOM_CODE,
      requestedRole: 'spectator' as const,
      expiresAt: 40_000,
    };
  }),
  bootstrap: vi.fn(),
  clear: vi.fn(),
  dispose: vi.fn(),
});

const runtime = (
  options: {
    readonly label?: string;
    readonly coachingConsent?: boolean;
    /** Where its session has got to: admitted (`ready`) unless said. */
    readonly phase?: 'ready' | 'connecting' | 'failed';
  } = {}
) => {
  const view = createRendererSpikeView();
  const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
  const projected = playerId
    ? {
        ...view,
        players: {
          ...view.players,
          [playerId]: {
            ...view.players[playerId]!,
            coachingConsent: options.coachingConsent ?? false,
          },
        },
      }
    : view;
  const submit = vi.fn(() => ({
    queued: true as const,
    commandId: 'command-1',
    clientSequence: 1,
  }));
  const listeners = new Set<() => void>();
  const dispose = vi.fn();
  const value = {
    label: options.label,
    roomCode: ROOM_CODE,
    session: {
      getSnapshot: () => ({
        phase: options.phase ?? ('ready' as const),
        view: projected,
        pendingCommands: [],
        completedCommands: [],
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      submit,
    },
    dispose,
  } as unknown as RemoteRoomRuntime;
  return { value, submit, dispose, listeners };
};

const creationResult = (
  roomRuntime = runtime({ label: 'creator' }),
  mode: 'solo' | 'multiplayer' = 'multiplayer'
) => {
  const copyPlayerInvitation = vi.fn(async () => ({
    roomCode: ROOM_CODE,
    requestedRole: 'player' as const,
    expiresAt: 40_000,
  }));
  const copySpectatorInvitation = vi.fn(async () => ({
    roomCode: ROOM_CODE,
    requestedRole: 'spectator' as const,
    expiresAt: 40_000,
  }));
  const invite = vi.fn(async (role: 'player' | 'spectator') => ({
    roomCode: ROOM_CODE,
    requestedRole: role,
    expiresAt: 40_000,
    outcome: 'copied' as const,
  }));
  const dispose = vi.fn();
  const value = {
    runtime: roomRuntime.value,
    route: {
      kind: 'remote-room',
      runtime: roomRuntime.value,
    },
    mode,
    invitations: {
      roomCode: ROOM_CODE,
      copyPlayerInvitation,
      copySpectatorInvitation,
      invite,
    },
    dispose,
  } as unknown as RemoteRoomCreationResult;
  return {
    value,
    dispose,
    copyPlayerInvitation,
    copySpectatorInvitation,
    invite,
    roomRuntime,
  };
};

const lobbyDependencies = (
  invitationCustody: ReturnType<typeof custody>,
  createRoom: ReturnType<typeof vi.fn>,
  requestBackground?: RemoteRoomLobbyDependencies['requestBackground'],
  requestCardBack?: RemoteRoomLobbyDependencies['requestCardBack']
): RemoteRoomLobbyDependencies => ({
  createRoom:
    createRoom as unknown as RemoteRoomLobbyDependencies['createRoom'],
  createInvitationJoinCustody: () => invitationCustody,
  fallbackDisplayName: () => 'Froakie',
  ...(requestBackground ? { requestBackground } : {}),
  ...(requestCardBack ? { requestCardBack } : {}),
});

const mount = async (
  dependencies: RemoteRoomLobbyDependencies,
  strict = false,
  landing: 'solo' | 'lobby' = 'lobby'
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const lobby = (
    <RemoteRoomLobby
      buildId="test-build"
      landing={landing}
      dependencies={{
        // Each lobby remembers into its own store, never the next test's.
        preferences: new PreferenceStore(),
        ...dependencies,
      }}
    />
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{lobby}</StrictMode> : lobby);
    await flush();
  });
  return { host, root };
};

/** Sheets and menus portal into the page, so the whole document is searched. */
const element = <ElementType extends Element>(
  selector: string
): ElementType => {
  const found = document.querySelector<ElementType>(selector);
  if (!found) throw new Error(`Missing test element: ${selector}`);
  return found;
};

const present = (selector: string): boolean =>
  document.querySelector(selector) !== null;

/** Lets Base UI's menus and drawers open, close and move focus. */
const settle = async (rounds = 3): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

const click = async (selector: string): Promise<void> => {
  await act(async () => {
    element<HTMLElement>(selector).click();
    await flush();
  });
  await settle();
};

/** Opens the app menu: the app bar's last button. */
const openMenu = async (): Promise<void> => {
  await click('#appMenuButton');
  expect(present('[role="menu"][aria-label="Menu"]')).toBe(true);
};

/**
 * Chooses an app entry by its id: a button on the app bar directly,
 * anything else from its menu.
 */
const chooseMenuItem = async (id: string): Promise<void> => {
  if (!present(`.ptcgsim-app-bar #${id}`)) await openMenu();
  await click(`#${id}`);
};

/**
 * The ids the app bar and its menu offer right now; the menu is closed
 * again after.
 */
const menuEntryIds = async (): Promise<string[]> => {
  const bar = [...document.querySelectorAll('.ptcgsim-app-bar button[id]')].map(
    (entry) => entry.id
  );
  await openMenu();
  const ids = [
    ...bar.filter((id) => id !== 'appMenuButton'),
    ...[
      ...document.querySelectorAll('[role="menu"][aria-label="Menu"] [id]'),
    ].map((entry) => entry.id),
  ];
  // Closed from its own button: an Escape would also reach the sheet below.
  await click('#appMenuButton');
  expect(present('[role="menu"][aria-label="Menu"]')).toBe(false);
  return ids;
};

const openDeck = async (): Promise<void> => {
  await chooseMenuItem('deckImportButton');
  await act(async () => {
    await import('../features/deck/DeckBuilderSession.js');
    await flush();
  });
  await settle();
  expect(element<HTMLElement>('.ptcgsim-deck-layer').dataset.open).toBe('true');
};

const closeDeck = async (): Promise<void> => {
  await click('#deckBackButton');
  expect(element<HTMLElement>('.ptcgsim-deck-layer').dataset.open).toBe(
    'false'
  );
};

const openSettings = async (): Promise<void> => {
  await chooseMenuItem('settingsButton');
  expect(present('#settings')).toBe(true);
};

/** Closes a sheet from its own close button. */
const closeSheet = async (sheetId: string): Promise<void> => {
  await click(`#${sheetId} .ptcgsim-sheet__close`);
};

const playOnlineOpen = (): boolean => present('#playOnlineSheet');

const lobbyRoute = (): HTMLElement =>
  element<HTMLElement>('[data-app-route="remote-room-lobby"]');

/**
 * The loading screen, as the lobby drives it: already down over a loading
 * page (`covering`, where a swap happens at once), or gone, where a swap
 * waits until `cover` says the old table is covered.
 */
const testCurtain = (state: 'covering' | 'gone') => {
  const swaps: (() => void)[] = [];
  const value = {
    state: () => state,
    reveal: vi.fn(),
    drop: vi.fn(),
    handOff: vi.fn((swap: () => void) => {
      if (state === 'covering') swap();
      else swaps.push(swap);
    }),
  };
  const cover = async (): Promise<void> => {
    await act(async () => {
      for (const swap of swaps.splice(0)) swap();
      await flush();
    });
  };
  return { value, cover };
};

/** A board (or the room) says whether its table has painted. */
const reportSettled = async (
  report: ((settled: boolean) => void) | undefined,
  settled: boolean
): Promise<void> => {
  expect(report).toBeDefined();
  await act(async () => {
    report?.(settled);
    await flush();
  });
};

describe('remote room lobby wiring', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    linkHarness.link = undefined;
    lobbyBoardHarness.preferences = undefined;
    lobbyBoardHarness.table = undefined;
    lobbyBoardHarness.parkedRail = undefined;
    roomRouteHarness.preferences = undefined;
    roomRouteHarness.onPreferencesChange = undefined;
    boardViewSettings().reset();
    roomRouteHarness.background = undefined;
    roomRouteHarness.onBackgroundChange = undefined;
    roomRouteHarness.roomMode = undefined;
    roomRouteHarness.onMultiplayerNavigate = undefined;
    roomRouteHarness.onMultiplayerPanelOpen = undefined;
    roomRouteHarness.initialSheet = undefined;
    roomRouteHarness.deckStore = undefined;
    roomRouteHarness.cardBackStore = undefined;
    roomRouteHarness.onResumeSavedGame = undefined;
  });

  it('opens Play online over an empty table without creating a room', async () => {
    const invitation = custody();
    const createRoom = vi.fn();
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/lobby.png',
    }));
    const { root } = await mount(
      lobbyDependencies(invitation, createRoom, requestBackground)
    );
    await settle();

    expect(lobbyRoute().classList.contains('table-shell')).toBe(true);
    expect(present('[data-testid="lobby-board"]')).toBe(true);
    // A visitor with no game sees an empty table, laid out like the room's.
    expect(lobbyBoardHarness.viewMatchId).toBe('lobby-empty-board');
    // Laid out like the room's, the optional pieces off as there by default,
    // the app bar's corner kept clear.
    expect(lobbyBoardHarness.table).toEqual({
      lowerShare: TABLE_SPLIT.defaultLowerShare,
      seamBandPx: 42,
      appBarPx: { width: 202, height: 42 },
      hideEmptyLostZone: true,
    });
    expect(present('[data-testid="parked-solo-board"]')).toBe(false);
    expect(playOnlineOpen()).toBe(true);
    expect(present('#settings')).toBe(false);
    // The empty table wears the room's look from the first frame (the tilted
    // table where Auto picks it), so nothing changes when the room takes over.
    expect(lobbyBoardHarness.preferences).toMatchObject({
      showZoneOutlines: true,
      depth: { mode: 'table' },
    });
    for (const id of [
      'nameInput',
      'roomIdInput',
      'generateIdButton',
      'joinRoomButton',
    ]) {
      expect(present(`#playOnlineSheet #${id}`), id).toBe(true);
    }
    // Copying waits for a room, from inside it; board flip is the room's
    // to set; watching is a choice only an invitation to play offers.
    for (const id of [
      'copyButton',
      'coachingModeCheckbox',
      'spectatorModeCheckbox',
    ]) {
      expect(present(`#${id}`), id).toBe(false);
    }
    expect(element('#generateIdButton').textContent).toBe('Create room');
    expect(element('label[for="roomIdInput"]').textContent).toBe('Invitation');
    expect(element('#joinRoomButton').tagName).toBe('BUTTON');
    expect(createRoom).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('PTCGSIM2-INVITE:');

    // The menu sits on the empty table's rail. From Play online it offers
    // the Solo table; it never offers Play online itself.
    expect(present('[data-testid="lobby-board"] #appMenuButton')).toBe(true);
    const entries = await menuEntryIds();
    expect(entries).toEqual(
      expect.arrayContaining([
        'p1Button',
        'deckImportButton',
        'settingsButton',
        'fullscreenButton',
      ])
    );
    expect(entries).not.toContain('p2Button');
    // The keys are in Settings, and Settings is not on the Play online sheet.
    expect(entries).not.toContain('shortcutsButton');
    expect(present('#onlineSettingsButton')).toBe(false);
    expect(entries).not.toContain('leaveRoomButton');

    await openDeck();
    expect(document.querySelector('#deckPasteInput')).not.toBeNull();
    // Play online gives way to the deck screen and comes back after it.
    expect(playOnlineOpen()).toBe(false);
    // Before a Solo room there is only the player's own seat.
    expect(document.querySelector('#nativeDeckBuilderTargetAlt')).toBeNull();
    await closeDeck();
    expect(element<HTMLElement>('.ptcgsim-deck-layer').dataset.open).toBe(
      'false'
    );
    expect(playOnlineOpen()).toBe(true);

    await openSettings();
    expect(playOnlineOpen()).toBe(false);
    await act(async () =>
      element<HTMLInputElement>('#darkModeCheckbox').click()
    );
    // The room starts on the Night table; the switch turns it to Day.
    expect(lobbyBoardHarness.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: false,
      showZoneOutlines: true,
      depth: expect.objectContaining({ mode: 'table' }),
    });
    // How the table shows is in Settings too; the table's pieces are on
    // the mat's +, and the Solo cover on the far hand's pill.
    expect(present('#zoneOutlinesCheckbox')).toBe(true);
    expect(present('#lostZoneCheckbox')).toBe(false);
    expect(present('#hideHandCheckbox')).toBe(false);
    await act(async () => boardViewSettings().update({ zoneOutlines: false }));
    expect(lobbyBoardHarness.preferences?.showZoneOutlines).toBe(false);
    // The keys open from Settings in their own dialog.
    expect(present('#settings #editShortcutsButton')).toBe(true);
    // The background is chosen by tiles; a link is asked for only on
    // From a link….
    expect(element('#changeBackgroundButton').textContent).toBe('From a link…');
    expect(element<HTMLInputElement>('#background-desk').checked).toBe(true);
    expect(lobbyRoute().dataset.darkMode).toBe('false');
    await click('#changeBackgroundButton');
    expect(requestBackground).toHaveBeenCalledOnce();
    expect(lobbyRoute().style.backgroundImage).toBe(
      'url("https://images.example.test/lobby.png")'
    );
    expect(lobbyBoardHarness.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: false,
      showZoneOutlines: false,
      depth: expect.objectContaining({ mode: 'table' }),
    });
    expect(createRoom).not.toHaveBeenCalled();
    await closeSheet('settings');
    expect(present('#settings')).toBe(false);
    expect(playOnlineOpen()).toBe(true);

    await act(async () => root.unmount());
    expect(invitation.dispose).toHaveBeenCalledOnce();
  });

  it('opens on the Solo table when the page lands there, once even under StrictMode', async () => {
    const invitation = custody();
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    let releaseCreation: (() => void) | undefined;
    const createRoom = vi.fn(
      (input: { readonly signal: AbortSignal }) =>
        new Promise<typeof created.value>((resolve) => {
          // The aborted first creation never resolves; only the live
          // owner's does.
          if (!input.signal.aborted) {
            releaseCreation = () => resolve(created.value);
          }
        })
    );
    const { root } = await mount(
      lobbyDependencies(invitation, createRoom),
      true,
      'solo'
    );
    await settle();
    // While the room is still being created the page already shows the
    // Solo table -- never Play online, and no failure.
    expect(present('[data-testid="lobby-board"]')).toBe(true);
    expect(playOnlineOpen()).toBe(false);
    expect(present('#roomHeader')).toBe(false);
    const entries = await menuEntryIds();
    expect(entries).toContain('p2Button');
    expect(entries).not.toContain('p1Button');
    await act(async () => {
      releaseCreation?.();
      await flush();
    });

    // v1 opens on Solo; nobody has to press anything to get a table.
    // StrictMode replays the mount with a fresh owner: the first owner's
    // creation is aborted with it and the live owner's creation is mounted.
    expect(createRoom).toHaveBeenCalledTimes(2);
    // Solo is always v1's Blue, never the Multiplayer fallback name.
    for (const call of createRoom.mock.calls) {
      expect(call[0]).toMatchObject({ displayName: 'Blue', mode: 'solo' });
    }
    expect(createRoom.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(createRoom.mock.calls[1]?.[0].signal.aborted).toBe(false);
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(roomRouteHarness.roomMode).toBe('solo');
    // The generated stand-in name stays out of the Multiplayer Name box.
    await click('#testOpenMultiplayer');
    expect(element<HTMLInputElement>('#nameInput').value).toBe('');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('says when the Solo table could not be made, and tries again on request', async () => {
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const createRoom = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('internal detail'), { code: 'offline' })
      )
      .mockResolvedValueOnce(created.value);
    const { root } = await mount(
      lobbyDependencies(custody(), createRoom),
      false,
      'solo'
    );
    await settle();

    expect(element('#roomHeaderText').textContent).toBe(
      "Couldn't start Solo mode. Try again."
    );
    expect(document.body.textContent).not.toContain('internal detail');
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('#roomHeader button')]
        .find((button) => button.textContent === 'Try again')!
        .click();
      await flush();
    });
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(createRoom.mock.calls[1]?.[0]).toMatchObject({ mode: 'solo' });
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(present('#roomHeader')).toBe(false);

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('lifts the loading screen once, over the Solo room, never over its stand-in', async () => {
    const curtain = testCurtain('covering');
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const creation = deferred<typeof created.value>();
    const createRoom = vi.fn(() => creation.promise);
    const { root } = await mount(
      { ...lobbyDependencies(custody(), createRoom), curtain: curtain.value },
      false,
      'solo'
    );
    await settle();

    // The empty table painted while the room is still being made: it only
    // stands in for that room, and the page never shows it.
    await reportSettled(lobbyBoardHarness.onEmptySettledChange, true);
    expect(curtain.value.reveal).not.toHaveBeenCalled();

    await act(async () => {
      creation.resolve(created.value);
      await flush();
    });
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(curtain.value.handOff).toHaveBeenCalledOnce();
    expect(curtain.value.reveal).not.toHaveBeenCalled();
    // The stand-in leaving says nothing; the room's table painting lifts it.
    await reportSettled(roomRouteHarness.onTableSettledChange, false);
    expect(curtain.value.reveal).not.toHaveBeenCalled();
    await reportSettled(roomRouteHarness.onTableSettledChange, true);
    expect(curtain.value.reveal).toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('keeps the loading screen down when the stand-in reports settling after the swap, before the room is drawn', async () => {
    const curtain = testCurtain('covering');
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const creation = deferred<typeof created.value>();
    const createRoom = vi.fn(() => creation.promise);
    const { root } = await mount(
      { ...lobbyDependencies(custody(), createRoom), curtain: curtain.value },
      false,
      'solo'
    );
    await settle();
    const standIn = lobbyBoardHarness.onEmptySettledChange;
    await act(async () => {
      creation.resolve(created.value);
      // The room is swapped in and the Solo operation is over; the stand-in's
      // own paint lands before the lobby draws the room.
      for (let step = 0; step < 10; step += 1) await Promise.resolve();
      expect(curtain.value.handOff).toHaveBeenCalledOnce();
      expect(present('[data-app-route="test-remote-room"]')).toBe(false);
      standIn?.(true);
    });
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(curtain.value.reveal).not.toHaveBeenCalled();
    await reportSettled(roomRouteHarness.onTableSettledChange, true);
    expect(curtain.value.reveal).toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('lifts the loading screen over the empty table when no Solo room could be made', async () => {
    const curtain = testCurtain('covering');
    let fail: ((error: unknown) => void) | undefined;
    const createRoom = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          fail = reject;
        })
    );
    const { root } = await mount(
      { ...lobbyDependencies(custody(), createRoom), curtain: curtain.value },
      false,
      'solo'
    );
    await settle();
    await reportSettled(lobbyBoardHarness.onEmptySettledChange, true);
    expect(curtain.value.reveal).not.toHaveBeenCalled();

    await act(async () => {
      fail?.(Object.assign(new Error('internal detail'), { code: 'offline' }));
      await flush();
    });
    await settle();
    // What went wrong is said over the empty table, which is now the page.
    expect(element('#roomHeaderText').textContent).toBe(
      "Couldn't start Solo mode. Try again."
    );
    expect(curtain.value.reveal).toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('lifts the loading screen over the empty table when Play online is the landing', async () => {
    const curtain = testCurtain('covering');
    const { root } = await mount({
      ...lobbyDependencies(custody(), vi.fn()),
      curtain: curtain.value,
    });
    await settle();
    expect(curtain.value.reveal).not.toHaveBeenCalled();
    await reportSettled(lobbyBoardHarness.onEmptySettledChange, true);
    expect(curtain.value.reveal).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('trades the table under the curtain: the room arrives only once the old table is covered', async () => {
    const curtain = testCurtain('gone');
    const created = creationResult();
    const createRoom = vi.fn(async () => created.value);
    const { root } = await mount({
      ...lobbyDependencies(custody(), createRoom),
      curtain: curtain.value,
    });
    await settle();
    await reportSettled(lobbyBoardHarness.onEmptySettledChange, true);
    await act(async () => {
      inputValue(element('#nameInput'), 'Blue');
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    // Create room takes its host straight in: the table is traded once
    // the room has admitted them.
    expect(curtain.value.handOff).toHaveBeenCalledOnce();
    expect(present('[data-app-route="test-remote-room"]')).toBe(false);
    expect(present('[data-app-route="remote-room-lobby"]')).toBe(true);

    // Until the swap, the old table may still ask (the arriving curtain
    // ignores it); from the swap on, only the new table's paint counts.
    curtain.value.reveal.mockClear();
    await curtain.cover();
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    // The empty table went with the swap: only the room's table lifts it.
    expect(curtain.value.reveal).not.toHaveBeenCalled();
    await reportSettled(roomRouteHarness.onTableSettledChange, true);
    expect(curtain.value.reveal).toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("puts a card back chosen on Play online's deck screen on the parked Solo table at once", async () => {
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const createRoom = vi.fn(async () => created.value);
    const requestCardBack = vi.fn(async () => 'https://example.test/back.png');
    const { root } = await mount(
      lobbyDependencies(custody(), createRoom, undefined, requestCardBack)
    );
    await settle();
    await chooseMenuItem('p1Button');
    await click('#testOpenMultiplayer');
    expect(present('[data-testid="parked-solo-board"]')).toBe(true);

    await openDeck();
    await click('#changeCardBackButton');
    expect(created.roomRuntime.submit).toHaveBeenCalledExactlyOnceWith({
      type: 'SetCardBack',
      cardBackUrl: 'https://example.test/back.png',
    });
    await closeDeck();
    expect(created.roomRuntime.submit).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it('keeps a turned Solo table turned while it is parked, and as it was left there', async () => {
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const createRoom = vi.fn(async () => created.value);
    const { root } = await mount(lobbyDependencies(custody(), createRoom));
    await settle();
    await chooseMenuItem('p1Button');
    await act(async () => {
      roomRouteHarness.onFlippedChange?.(true);
      await flush();
    });
    // Play online: the parked table stays turned.
    await click('#testOpenMultiplayer');
    expect(present('[data-testid="parked-solo-board"]')).toBe(true);
    expect(lobbyBoardHarness.parkedInitialFlipped).toBe(true);
    // Turned back while parked: Solo comes back as it was left.
    await act(async () => {
      lobbyBoardHarness.parkedPerspective?.({ flipped: false });
      await flush();
    });
    await closeSheet('playOnlineSheet');
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(roomRouteHarness.initialFlipped).toBe(false);
    await act(async () => root.unmount());
  });

  it('starts one-player authority from Solo and parks it while Play online is open', async () => {
    const invitation = custody();
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const createRoom = vi.fn(async () => created.value);
    const { root } = await mount(lobbyDependencies(invitation, createRoom));
    await settle();

    await chooseMenuItem('p1Button');

    expect(createRoom).toHaveBeenCalledOnce();
    expect(createRoom.mock.calls[0]?.[0]).toMatchObject({
      buildId: 'test-build',
      displayName: 'Blue',
      mode: 'solo',
    });
    expect(createRoom.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(document.body.textContent).toContain('solo');
    expect(roomRouteHarness.roomMode).toBe('solo');
    expect(roomRouteHarness.onMultiplayerNavigate).toBeTypeOf('function');
    expect(roomRouteHarness.onMultiplayerPanelOpen).toBeTypeOf('function');
    expect(created.roomRuntime.submit).not.toHaveBeenCalled();
    expect(invitation.clear).toHaveBeenCalledOnce();

    await click('#testOpenMultiplayer');
    expect(present('[data-app-route="remote-room-lobby"]')).toBe(true);
    expect(playOnlineOpen()).toBe(true);
    expect(present('.lobby-status')).toBe(false);
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe('');
    expect(created.dispose).not.toHaveBeenCalled();
    // The parked game keeps its table on screen behind Play online instead
    // of the lobby's empty table, with the menu on its rail and only the
    // table's own actions.
    expect(present('[data-testid="parked-solo-board"]')).toBe(true);
    expect(present('[data-testid="lobby-board"]')).toBe(false);
    expect(lobbyBoardHarness.parkedSession).toBe(
      created.roomRuntime.value.session
    );
    expect(lobbyBoardHarness.parkedRoomMode).toBe('solo');
    expect(present('[data-testid="parked-solo-board"] #appMenuButton')).toBe(
      true
    );
    const turn = { id: 'turnButton' } as never;
    const switchSide = { id: 'flipBoardButton' } as never;
    expect(
      lobbyBoardHarness.parkedRail?.compose({ turn, switchSide }).actions
    ).toEqual([turn, switchSide]);
    expect(lobbyBoardHarness.parkedKeysSuspended).toBe(false);

    await openDeck();
    // Keys pressed on the deck screen never reach the parked table.
    expect(lobbyBoardHarness.parkedKeysSuspended).toBe(true);
    // The parked table is Solo: the deck screen offers P2's seat.
    expect(present('#nativeDeckBuilderTargetAlt')).toBe(true);
    await closeDeck();
    expect(playOnlineOpen()).toBe(true);

    // Putting Play online away is going back to the Solo table: the parked
    // game, not a new one.
    await closeSheet('playOnlineSheet');
    expect(createRoom).toHaveBeenCalledOnce();
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(roomRouteHarness.roomMode).toBe('solo');
    expect(roomRouteHarness.deckStore).toBeDefined();
    expect(created.dispose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(invitation.dispose).toHaveBeenCalledOnce();
  });

  it('leaves a live Solo table and its pasted invitation alone when a join is refused', async () => {
    const invitation = custody();
    invitation.bootstrap.mockRejectedValueOnce(
      Object.assign(new Error('internal detail'), { code: 'room_not_found' })
    );
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const { root } = await mount(
      lobbyDependencies(
        invitation,
        vi.fn(async () => created.value)
      )
    );
    await settle();
    await chooseMenuItem('p1Button');
    expect(invitation.clear).toHaveBeenCalledOnce();

    // Play online is read over the live table; pasting into it and pressing
    // Join is the first thing that could move the table.
    await act(async () => {
      paste(element('#roomIdInput'), RAW_HANDOFF);
    });
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe(ROOM_CODE);
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });

    expect(invitation.bootstrap).toHaveBeenCalledOnce();
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(roomRouteHarness.roomMode).toBe('solo');
    expect(created.dispose).not.toHaveBeenCalled();
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe(ROOM_CODE);
    expect(invitation.clear).toHaveBeenCalledOnce();
    expect(element('.lobby-status').textContent).not.toContain(
      'internal detail'
    );

    await act(async () => root.unmount());
  });

  it('lets the holder of a player invitation choose to watch, as v1 room keys did', async () => {
    const invitation = custody();
    invitation.acceptPaste.mockImplementation((event) => {
      event.preventDefault();
      return {
        roomCode: ROOM_CODE,
        requestedRole: 'player' as const,
        expiresAt: 40_000,
      };
    });
    const guest = runtime({ label: 'guest' });
    invitation.bootstrap.mockResolvedValueOnce({
      runtime: guest.value,
      mode: 'multiplayer',
      requestedRole: 'spectator',
    });
    const createRoom = vi.fn();
    const { root } = await mount(lobbyDependencies(invitation, createRoom));
    await settle();
    const roomInput = element<HTMLInputElement>('#roomIdInput');
    await act(async () => {
      paste(roomInput, RAW_HANDOFF);
      await flush();
    });
    const spectator = element<HTMLInputElement>('#spectatorModeCheckbox');
    // A player invitation neither forces nor forbids watching.
    expect(spectator.checked).toBe(false);
    expect(spectator.disabled).toBe(false);
    await act(async () => {
      spectator.click();
      await flush();
    });
    expect(spectator.checked).toBe(true);
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });
    expect(invitation.bootstrap.mock.calls[0]?.[0]).toMatchObject({
      asSpectator: true,
    });
    await act(async () => root.unmount());
  });

  it('keeps the table when a new room never admits its host', async () => {
    const never = creationResult(
      runtime({ label: 'never admitted', phase: 'failed' })
    );
    const createRoom = vi.fn().mockResolvedValueOnce(never.value);
    const { root } = await mount(lobbyDependencies(custody(), createRoom));
    await settle();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    expect(createRoom).toHaveBeenCalledOnce();
    // The new room's handshake failed: it goes, and Play online says so.
    expect(never.dispose).toHaveBeenCalledOnce();
    expect(present('[data-app-route="test-remote-room"]')).toBe(false);
    expect(playOnlineOpen()).toBe(true);
    expect(element('.lobby-status').textContent).toContain(
      "Couldn't create a room. Try again."
    );
    await act(async () => root.unmount());
  });

  it('keeps a created room when the Solo table that would replace it never admits', async () => {
    const room = creationResult(runtime({ label: 'created room' }));
    const solo = creationResult(
      runtime({ label: 'solo never admitted', phase: 'failed' }),
      'solo'
    );
    const createRoom = vi
      .fn()
      .mockResolvedValueOnce(room.value)
      .mockResolvedValueOnce(solo.value);
    const { root } = await mount(lobbyDependencies(custody(), createRoom));
    await settle();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    // Created, the host is in their room at once.
    expect(
      element('[data-app-route="test-remote-room"]').textContent
    ).toContain('created room');
    // A new Solo table from there; its handshake fails.
    await click('#testNewSoloTable');
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(createRoom.mock.calls[1]?.[0]).toMatchObject({ mode: 'solo' });
    expect(solo.dispose).toHaveBeenCalledOnce();
    expect(room.dispose).not.toHaveBeenCalled();
    expect(
      element('[data-app-route="test-remote-room"]').textContent
    ).toContain('created room');
    await act(async () => root.unmount());
    expect(room.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the table when the room an invitation leads to never admits this session', async () => {
    const invitation = custody();
    invitation.acceptPaste.mockImplementation((event) => {
      event.preventDefault();
      return {
        roomCode: ROOM_CODE,
        requestedRole: 'player' as const,
        expiresAt: 40_000,
      };
    });
    const refused = runtime({ label: 'refused guest', phase: 'failed' });
    invitation.bootstrap.mockResolvedValueOnce({
      runtime: refused.value,
      mode: 'multiplayer',
      requestedRole: 'player',
    });
    const created = creationResult(runtime({ label: 'current table' }));
    const { root } = await mount(
      lobbyDependencies(
        invitation,
        vi.fn(async () => created.value)
      )
    );
    await settle();
    // They paste someone's invitation and join.
    await act(async () => {
      paste(element<HTMLInputElement>('#roomIdInput'), RAW_HANDOFF);
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });
    // That room never admitted the session: it goes, the table stays.
    expect(refused.dispose).toHaveBeenCalledOnce();
    expect(created.dispose).not.toHaveBeenCalled();
    expect(present('[data-app-route="test-remote-room"]')).toBe(false);
    await act(async () => root.unmount());
  });

  it('remembers the table settings and the name a room was hosted with', async () => {
    const store = new PreferenceStore();
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/remembered.png',
    }));
    const dependencies = {
      ...lobbyDependencies(
        custody(),
        vi.fn(async () => creationResult().value),
        requestBackground
      ),
      preferences: store,
    };
    const first = await mount(dependencies);
    await settle();
    await openSettings();
    expect(element<HTMLInputElement>('#background-desk').checked).toBe(true);
    await act(async () => {
      element<HTMLInputElement>('#darkModeCheckbox').click();
      element<HTMLButtonElement>('#changeBackgroundButton').click();
      await flush();
    });
    await settle();
    await closeSheet('settings');
    await act(async () => {
      inputValue(element('#nameInput'), '  Misty ');
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    await act(async () => first.root.unmount());
    document.body.replaceChildren();

    // A later visit on this device starts where the player left off.
    const { root } = await mount(dependencies);
    await settle();
    expect(element<HTMLInputElement>('#nameInput').value).toBe('Misty');
    expect(lobbyRoute().dataset.darkMode).toBe('false');
    expect(lobbyRoute().style.backgroundImage).toBe(
      'url("https://images.example.test/remembered.png")'
    );
    await openSettings();
    expect(element<HTMLInputElement>('#darkModeCheckbox').checked).toBe(false);
    expect(element<HTMLInputElement>('#background-custom').checked).toBe(true);
    // A wallpaper, then None, then back to the desk: each kept as chosen.
    await click('#background-wallpaper1');
    expect(lobbyRoute().style.backgroundImage).toBe(
      'url("/v2/assets/background1.jpg")'
    );
    expect(store.get(TABLE_PREFERENCES).background).toEqual({
      kind: 'image',
      url: '/v2/assets/background1.jpg',
    });
    await click('#background-none');
    expect(lobbyRoute().dataset.roomBackground).toBe('blank');
    await click('#background-desk');
    expect(lobbyRoute().style.backgroundImage).toBe('');
    expect(store.get(TABLE_PREFERENCES).background).toBeNull();
    await act(async () => root.unmount());
  });

  it('creates a room with the chosen identity, enters it, and invites with links from inside it', async () => {
    const invitation = custody();
    const created = creationResult();
    const createRoom = vi.fn(async () => created.value);
    const { root } = await mount(lobbyDependencies(invitation, createRoom));
    await settle();
    const name = element<HTMLInputElement>('#nameInput');

    await act(async () => {
      inputValue(name, '  Blue  ');
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });

    expect(createRoom).toHaveBeenCalledOnce();
    expect(createRoom.mock.calls[0]?.[0]).toMatchObject({
      buildId: 'test-build',
      displayName: 'Blue',
      mode: 'multiplayer',
    });
    expect(createRoom.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    // Straight into the room: no Generate, Copy, then join-your-own.
    expect(
      element('[data-app-route="test-remote-room"]').textContent
    ).toContain('creator');
    expect(playOnlineOpen()).toBe(false);

    // The room invites either role with a link, each press its own.
    const invitations = roomRouteHarness.invitations!;
    expect(invitations.roles).toEqual(['player', 'spectator']);
    await expect(invitations.invite('player')).resolves.toBe('copied');
    await expect(invitations.invite('spectator')).resolves.toBe('copied');
    expect(created.invite.mock.calls.map(([role]) => role)).toEqual([
      'player',
      'spectator',
    ]);
    // A taken seat is the room's answer, not a failure.
    created.invite.mockRejectedValueOnce(
      new RemoteRoomInvitationError('seat_unavailable')
    );
    await expect(invitations.invite('player')).resolves.toBe(
      'seat_unavailable'
    );
    created.invite.mockRejectedValueOnce(
      new RemoteRoomInvitationError('clipboard_failed')
    );
    await expect(invitations.invite('player')).resolves.toBe('failed');
    expect(created.copyPlayerInvitation).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('secret-bearer');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('keeps Play online and its menu steady while a room is being made', async () => {
    const pending = deferred<RemoteRoomCreationResult>();
    const created = creationResult();
    const createRoom = vi.fn(() => pending.promise);
    const { root } = await mount(lobbyDependencies(custody(), createRoom));
    await settle();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });

    // Neither the sheet's close button nor the menu can leave for Solo
    // in the middle of making a room.
    await closeSheet('playOnlineSheet');
    expect(createRoom).toHaveBeenCalledOnce();
    expect(createRoom.mock.calls[0]?.[0]).toMatchObject({
      mode: 'multiplayer',
    });
    expect(await menuEntryIds()).not.toContain('p1Button');

    await act(async () => {
      pending.resolve(created.value);
      await flush();
    });
    await settle();
    // Made, the room takes the screen.
    expect(playOnlineOpen()).toBe(false);
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('retires a failure message once the retried create succeeds', async () => {
    const created = creationResult();
    const createRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(created.value);
    const { root } = await mount(lobbyDependencies(custody(), createRoom));
    await settle();
    const create = async () =>
      act(async () => {
        element<HTMLButtonElement>('#generateIdButton').click();
        await flush();
      });

    await create();
    expect(element('.lobby-status').textContent).toContain(
      "Couldn't create a room. Try again."
    );
    await create();
    expect(present('.lobby-status')).toBe(false);
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);

    await act(async () => root.unmount());
  });

  it('offers online save and resume only once the Worker reports them enabled', async () => {
    for (const reported of [false, true]) {
      const created = creationResult();
      const continuationAvailability = vi.fn(async () => reported);
      const { root } = await mount({
        ...lobbyDependencies(
          custody(),
          vi.fn(async () => created.value)
        ),
        continuationAvailability,
      });
      await settle();
      // The lobby itself makes no authority request.
      expect(continuationAvailability).not.toHaveBeenCalled();
      await act(async () => {
        element<HTMLButtonElement>('#generateIdButton').click();
        await flush();
      });
      expect(continuationAvailability).toHaveBeenCalledOnce();
      expect(roomRouteHarness.continuationAvailable).toBe(reported);
      await act(async () => root.unmount());
      document.body.replaceChildren();
    }
  });

  it('opens the room an invitation link names at once, instead of a Solo table', async () => {
    const invitation = custody();
    const guest = runtime({ label: 'guest by link' });
    invitation.bootstrap.mockResolvedValueOnce({
      runtime: guest.value,
      route: { kind: 'remote-room', runtime: guest.value },
    });
    invitation.bootstrap.mockResolvedValueOnce({
      runtime: guest.value,
      route: { kind: 'remote-room', runtime: guest.value },
    });
    const createRoom = vi.fn();
    linkHarness.link = RAW_LINK;
    // StrictMode replays the lobby's owner: the replaced owner's join is
    // called off before any admission (an exchange alone never spends the
    // claim), and the owner that stays joins with the link it kept.
    const { root } = await mount(
      lobbyDependencies(invitation, createRoom),
      true,
      'solo'
    );
    await settle();
    expect(createRoom).not.toHaveBeenCalled();
    expect(invitation.acceptText).toHaveBeenCalledWith(RAW_LINK);
    const joins = invitation.bootstrap.mock.calls.map(([input]) => input);
    expect(joins.length).toBeGreaterThanOrEqual(1);
    expect(joins.slice(0, -1).every((input) => input.signal.aborted)).toBe(
      true
    );
    expect(joins.at(-1)?.signal.aborted).toBe(false);
    expect(joins.at(-1)).toMatchObject({
      displayName: 'Froakie',
      // The invitation's own role: this one is to watch.
      asSpectator: true,
    });
    expect(
      element('[data-app-route="test-remote-room"]').textContent
    ).toContain('guest by link');
    expect(document.body.innerHTML).not.toContain('invite=');
    expect(document.body.innerHTML).not.toContain('secret-bearer');
    await act(async () => root.unmount());
  });

  it('says on Play online that a used or expired link was refused, making no Solo room', async () => {
    const invitation = custody();
    invitation.bootstrap.mockRejectedValueOnce(
      new RemoteRoomInvitationError('invitation_refused')
    );
    const createRoom = vi.fn();
    linkHarness.link = RAW_LINK;
    const { root } = await mount(
      lobbyDependencies(invitation, createRoom),
      false,
      'solo'
    );
    await settle();
    expect(createRoom).not.toHaveBeenCalled();
    expect(playOnlineOpen()).toBe(true);
    expect(element('.lobby-status').textContent).toContain(
      'This invitation was used or has expired. Ask for a new one.'
    );
    // Play online is the way on: a room of their own, or another link.
    expect(element<HTMLButtonElement>('#generateIdButton').disabled).toBe(
      false
    );
    await act(async () => root.unmount());
  });

  it('opens Play online over a Solo table to say a link given since was refused', async () => {
    const invitation = custody();
    const solo = creationResult(runtime({ label: 'solo' }), 'solo');
    const createRoom = vi.fn(async () => solo.value);
    const { root } = await mount(
      lobbyDependencies(invitation, createRoom),
      false,
      'solo'
    );
    await settle();
    expect(roomRouteHarness.roomMode).toBe('solo');
    const before = roomRouteHarness.onlineRequest;
    invitation.acceptText.mockImplementationOnce(() => {
      throw new RemoteRoomInvitationError('invalid_handoff');
    });
    linkHarness.link = RAW_LINK;
    await act(async () => {
      for (const listener of linkHarness.listeners) listener();
      await flush();
    });
    await settle();
    // The table stays; its own Play online opens, saying why.
    expect(roomRouteHarness.onlineRequest).not.toBe(before);
    expect(element('.lobby-status').textContent).toContain(
      'Paste the invitation link you were sent.'
    );
    expect(solo.dispose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('joins from a link opened while the page is up, from the lobby', async () => {
    const invitation = custody();
    const guest = runtime({ label: 'guest by later link' });
    invitation.bootstrap.mockResolvedValueOnce({
      runtime: guest.value,
      route: { kind: 'remote-room', runtime: guest.value },
    });
    const { root } = await mount(lobbyDependencies(invitation, vi.fn()));
    await settle();
    expect(invitation.bootstrap).not.toHaveBeenCalled();
    linkHarness.link = RAW_LINK;
    await act(async () => {
      for (const listener of linkHarness.listeners) listener();
      await flush();
    });
    await settle();
    expect(invitation.bootstrap).toHaveBeenCalledOnce();
    expect(
      element('[data-app-route="test-remote-room"]').textContent
    ).toContain('guest by later link');
    await act(async () => root.unmount());
  });

  it('takes an invitation dropped or pasted anywhere on Play online but the Name field', async () => {
    const invitation = custody();
    const { root } = await mount(lobbyDependencies(invitation, vi.fn()));
    await settle();
    // Pasted on the panel, not into the field: still taken in.
    let pasteEvent!: Event;
    await act(async () => {
      pasteEvent = paste(
        element<HTMLInputElement>('#generateIdButton'),
        RAW_HANDOFF
      );
      await flush();
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(invitation.acceptPaste).toHaveBeenCalledOnce();
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe(ROOM_CODE);
    // Into the Name field, a paste is the name's.
    await act(async () => {
      pasteEvent = paste(element<HTMLInputElement>('#nameInput'), 'Ash');
      await flush();
    });
    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(invitation.acceptPaste).toHaveBeenCalledOnce();
    // A link dropped on the panel.
    await act(async () => {
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', {
        value: {
          types: ['text/uri-list', 'text/plain'],
          getData: (type: string) =>
            type === 'text/uri-list'
              ? `https://ptcgsim.example/${RAW_LINK}`
              : '',
        },
      });
      element('#lobby').dispatchEvent(drop);
      await flush();
    });
    expect(invitation.acceptText).toHaveBeenCalledWith(
      `https://ptcgsim.example/${RAW_LINK}`
    );
    await act(async () => root.unmount());
  });

  it('intercepts a pasted bearer, renders only its safe receipt, and derives guest role inside custody', async () => {
    const invitation = custody();
    const guest = runtime({ label: 'guest' });
    invitation.bootstrap.mockResolvedValueOnce({
      runtime: guest.value,
      route: {
        kind: 'remote-room',
        runtime: guest.value,
      },
    });
    const { root } = await mount(lobbyDependencies(invitation, vi.fn()));
    await settle();
    const roomInput = element<HTMLInputElement>('#roomIdInput');

    let pasteEvent!: Event;
    await act(async () => {
      pasteEvent = paste(roomInput, RAW_HANDOFF);
      await flush();
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(invitation.acceptPaste).toHaveBeenCalledOnce();
    expect(roomInput.value).toBe(ROOM_CODE);
    // An invitation to watch only ever watches: no choice is offered.
    expect(element('#invitationReceipt').textContent).toBe(
      `Room ${ROOM_CODE} · to watch`
    );
    expect(present('#spectatorModeCheckbox')).toBe(false);
    expect(document.body.innerHTML).not.toContain(RAW_HANDOFF);
    expect(document.body.innerHTML).not.toContain(
      'secret-bearer-never-rendered'
    );

    await act(async () => {
      paste(roomInput, 'malformed replacement');
      await flush();
    });
    expect(document.body.textContent).toContain(
      'Paste the invitation link you were sent.'
    );
    expect(present('#invitationReceipt')).toBe(false);

    await act(async () => {
      paste(roomInput, RAW_HANDOFF);
      await flush();
    });

    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });
    expect(invitation.bootstrap).toHaveBeenCalledOnce();
    expect(invitation.bootstrap.mock.calls[0]?.[0]).toMatchObject({
      buildId: 'test-build',
      displayName: 'Froakie',
      // A spectator invitation locks the choice on; it is passed along.
      asSpectator: true,
    });
    expect(invitation.bootstrap.mock.calls[0]?.[0]).not.toHaveProperty(
      'requestedRole'
    );
    expect(invitation.bootstrap.mock.calls[0]?.[0]).not.toHaveProperty(
      'roomCode'
    );
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(document.body.innerHTML).not.toContain(
      'secret-bearer-never-rendered'
    );

    await act(async () => root.unmount());
    expect(invitation.dispose).toHaveBeenCalledOnce();
    expect(guest.dispose).toHaveBeenCalledOnce();
  });

  it('fails a room-code-only join closed and keeps errors free of supplied text', async () => {
    const invitation = custody();
    invitation.bootstrap.mockRejectedValueOnce(
      Object.assign(new Error('internal detail'), {
        code: 'missing_invitation',
      })
    );
    const { root } = await mount(lobbyDependencies(invitation, vi.fn()));
    await settle();
    await act(async () => {
      inputValue(element('#roomIdInput'), RAW_HANDOFF);
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });

    expect(invitation.bootstrap).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(
      'Paste the invitation link you were sent.'
    );
    const safeInput = element<HTMLInputElement>('#roomIdInput').value;
    expect(safeInput).toMatch(/^[A-HJ-NP-Z2-9]{0,12}$/u);
    expect(safeInput).not.toContain('secret-bearer-never-rendered');
    expect(document.body.innerHTML).not.toContain(RAW_HANDOFF);
    expect(element('.lobby-status').textContent).not.toContain(
      'internal detail'
    );

    await act(async () => root.unmount());
  });

  it('coalesces StrictMode ownership and disposes a creation that resolves after unmount', async () => {
    const firstInvitation = custody();
    const secondInvitation = custody();
    const invitations = [firstInvitation, secondInvitation];
    const pending = deferred<RemoteRoomCreationResult>();
    const created = creationResult();
    const createRoom = vi.fn(() => pending.promise);
    const dependencies: RemoteRoomLobbyDependencies = {
      createRoom:
        createRoom as unknown as RemoteRoomLobbyDependencies['createRoom'],
      createInvitationJoinCustody: () => invitations.shift()!,
      fallbackDisplayName: () => 'Froakie',
    };
    const { root } = await mount(dependencies, true);
    await settle();
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).not.toHaveBeenCalled();

    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    expect(createRoom).toHaveBeenCalledOnce();
    const signal = createRoom.mock.calls[0]?.[0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    expect(secondInvitation.dispose).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(created.value);
      await flush();
    });
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a left room once, and only the room that is left', async () => {
    const invitation = custody();
    const first = creationResult();
    const second = creationResult();
    const createRoom = vi
      .fn()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const { root } = await mount(lobbyDependencies(invitation, createRoom));
    await settle();

    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    expect(first.dispose).not.toHaveBeenCalled();
    await click('#testLeaveRoom');
    expect(first.dispose).toHaveBeenCalledOnce();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('transfers creator ownership into the room route with the card back chosen before', async () => {
    const invitation = custody();
    const created = creationResult();
    const createRoom = vi.fn(async () => created.value);
    const exactCardBack = 'custom+unsafe://pre-room/player-back?exact=yes';
    const requestCardBack = vi.fn(async () => exactCardBack);
    const { root } = await mount(
      lobbyDependencies(invitation, createRoom, undefined, requestCardBack)
    );
    await settle();

    await openDeck();
    await click('#changeCardBackButton');
    expect(requestCardBack).toHaveBeenCalledOnce();
    await closeDeck();
    await act(async () => {
      inputValue(element('#nameInput'), 'Blue');
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });

    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    // Board flip is the room's to allow, in its Settings: nothing is sent
    // on the way in.
    expect(created.roomRuntime.submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SetCoachingConsent' })
    );
    expect(roomRouteHarness.roomMode).toBe('multiplayer');
    expect(roomRouteHarness.deckStore).toBeDefined();
    expect(roomRouteHarness.cardBackStore).toBeDefined();
    expect(
      roomRouteHarness.cardBackStore?.getSnapshot().slots.main
    ).toMatchObject({ url: exactCardBack, dirty: true });

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(created.roomRuntime.listeners.size).toBe(0);
  });

  it('keeps the live room on failed restore and atomically replaces it after exact retry', async () => {
    const invitation = custody();
    const created = creationResult(runtime({ label: 'source' }));
    // Saved with coaching consent on.
    const restored = runtime({ label: 'restored', coachingConsent: true });
    const opponentInvitation = serializeRoomInvitationHandoffText({
      roomCode: ROOM_CODE,
      invitation: 'secret-opponent-bearer-never-rendered-0000',
      requestedRole: 'player',
      expiresAt: 9_999_999_999_999,
    });
    const restore = vi
      .fn()
      .mockRejectedValueOnce(new Error('redacted restore failure'))
      .mockImplementationOnce(async (input) => {
        await input.deliverOpponentInvitation(opponentInvitation);
        return { runtime: restored.value };
      });
    const restoration = {
      matchesHandoff: vi.fn(() => true),
      restore,
      dispose: vi.fn(),
    };
    const createRestorationCustody = vi.fn(() => restoration);
    const dependencies = {
      ...lobbyDependencies(
        invitation,
        vi.fn(async () => created.value)
      ),
      createRestorationCustody,
    };
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { root } = await mount(dependencies);
    await settle();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    expect(document.body.textContent).toContain('source');
    const resume = roomRouteHarness.onResumeSavedGame!;

    await expect(
      act(async () =>
        resume('opaque continuation file', new AbortController().signal)
      )
    ).rejects.toThrow('redacted restore failure');
    expect(document.body.textContent).toContain('source');
    expect(created.dispose).not.toHaveBeenCalled();
    expect(restored.dispose).not.toHaveBeenCalled();

    await act(async () =>
      resume('opaque continuation file', new AbortController().signal)
    );
    expect(createRestorationCustody).toHaveBeenCalledOnce();
    expect(restoration.matchesHandoff).toHaveBeenCalledWith(
      'opaque continuation file'
    );
    expect(restore).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('restored');
    // The save keeps the coaching consent it was made with.
    expect(restored.submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SetCoachingConsent' })
    );
    expect(roomRouteHarness.installDeckOnSessionAttach).toBe(false);
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(restored.dispose).not.toHaveBeenCalled();
    // The opponent's invitation waits for Invite opponent: nothing went to
    // the clipboard on the way in.
    expect(writeText).not.toHaveBeenCalled();
    const invitations = roomRouteHarness.invitations!;
    expect(invitations.roles).toEqual(['player']);
    await expect(invitations.invite('player')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toMatch(/#invite=[A-Za-z0-9_-]+$/u);
    expect(document.body.innerHTML).not.toContain('secret-opponent-bearer');

    await act(async () => root.unmount());
    expect(restored.dispose).toHaveBeenCalledOnce();
    expect(restoration.dispose).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('returns a creator to a fresh lobby and disposes each ownership generation once', async () => {
    const firstInvitation = custody();
    const secondInvitation = custody();
    const invitations = [firstInvitation, secondInvitation];
    const created = creationResult();
    const solo = creationResult(runtime({ label: 'solo' }), 'solo');
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/retained.png',
    }));
    const createRoom = vi
      .fn()
      .mockResolvedValueOnce(created.value)
      .mockResolvedValueOnce(solo.value);
    const dependencies: RemoteRoomLobbyDependencies = {
      createRoom:
        createRoom as unknown as RemoteRoomLobbyDependencies['createRoom'],
      createInvitationJoinCustody: () => invitations.shift()!,
      fallbackDisplayName: () => 'Froakie',
      requestBackground,
    };
    const { root } = await mount(dependencies);
    await settle();

    await openDeck();
    await closeDeck();
    await openSettings();
    await click('#changeBackgroundButton');
    await closeSheet('settings');
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    expect(present('#testLeaveRoom')).toBe(true);

    // A real change (the Day table): preferences back at the defaults are
    // simply not set.
    const retainedPreferences: BoardPreferences = {
      reducedMotion: false,
      highContrast: false,
      darkMode: false,
      showZoneOutlines: true,
    };
    await act(async () =>
      roomRouteHarness.onPreferencesChange?.(retainedPreferences)
    );
    expect(roomRouteHarness.preferences).toEqual(retainedPreferences);
    expect(roomRouteHarness.background).toEqual({
      kind: 'image',
      url: 'https://images.example.test/retained.png',
    });
    const retainedDeckStore = roomRouteHarness.deckStore!;
    const retainedCard: DeckCard = {
      id: 'custom:retained',
      name: 'Retained Through Leave',
      category: 'Pokémon',
      image: '/retained-through-leave.png',
    };
    act(() => retainedDeckStore.addCard(retainedCard));

    await click('#testLeaveRoom');
    expect(present('[data-app-route="remote-room-lobby"]')).toBe(true);
    expect(playOnlineOpen()).toBe(true);
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe('');
    expect(present('.lobby-status')).toBe(false);
    expect(lobbyBoardHarness.preferences).toEqual({
      ...retainedPreferences,
      depth: expect.objectContaining({ mode: 'table' }),
    });
    expect(lobbyRoute().style.backgroundImage).toBe(
      'url("https://images.example.test/retained.png")'
    );
    await openSettings();
    expect(element<HTMLInputElement>('#darkModeCheckbox').checked).toBe(false);
    await closeSheet('settings');
    await openDeck();
    expect(
      element('#nativeDeckBuilderSummaryPanel').getAttribute('data-card-count')
    ).toBe('1');
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).not.toHaveBeenCalled();

    // The builder's Play puts the deck screen away and sits down at a
    // Solo table with it.
    await click('#nativeDeckBuilderPlayButton');
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(createRoom.mock.calls[1]?.[0]).toMatchObject({ mode: 'solo' });
    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(roomRouteHarness.roomMode).toBe('solo');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(solo.dispose).toHaveBeenCalledOnce();
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).toHaveBeenCalledOnce();
  });

  it('releases a guest runtime and its consumed bearer custody on leave', async () => {
    const firstInvitation = custody();
    const secondInvitation = custody();
    const invitations = [firstInvitation, secondInvitation];
    const guest = runtime({ label: 'guest' });
    firstInvitation.bootstrap.mockResolvedValueOnce({
      runtime: guest.value,
      route: {
        kind: 'remote-room',
        runtime: guest.value,
      },
    });
    const dependencies: RemoteRoomLobbyDependencies = {
      createRoom:
        vi.fn() as unknown as RemoteRoomLobbyDependencies['createRoom'],
      createInvitationJoinCustody: () => invitations.shift()!,
      fallbackDisplayName: () => 'Froakie',
    };
    const { root } = await mount(dependencies);
    await settle();

    await act(async () => {
      paste(element('#roomIdInput'), RAW_HANDOFF);
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });
    await click('#testLeaveRoom');

    expect(guest.dispose).toHaveBeenCalledOnce();
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe('');
    // A fresh lobby: no invitation held, so no choice to watch on offer.
    expect(present('#invitationReceipt')).toBe(false);
    expect(present('#spectatorModeCheckbox')).toBe(false);

    await act(async () => root.unmount());
    expect(guest.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).toHaveBeenCalledOnce();
  });

  describe('the tutorial', () => {
    it('is refused while a room this page made waits for its guest', async () => {
      const created = creationResult();
      const createRoom = vi.fn(async () => created.value);
      const { root } = await mount(lobbyDependencies(custody(), createRoom));
      await settle();
      await act(async () => {
        inputValue(element('#nameInput'), 'Blue');
        element<HTMLButtonElement>('#generateIdButton').click();
        await flush();
      });
      await settle();
      expect(createRoom).toHaveBeenCalledOnce();
      await act(async () => {
        startTutorial();
        await flush();
      });
      await settle();
      // No practice table made, and the hosted room left as it was.
      expect(pendingTutorialRequest()).toBeNull();
      expect(createRoom).toHaveBeenCalledOnce();
      expect(present('[data-tutorial="true"]')).toBe(false);
      expect(created.dispose).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    });

    it("goes back to the player's table, Play online open on it, to say a link was refused", async () => {
      const invitation = custody();
      const solo = creationResult(runtime({ label: 'solo' }), 'solo');
      const practice = creationResult(runtime({ label: 'practice' }), 'solo');
      const createRoom = vi
        .fn()
        .mockResolvedValueOnce(solo.value)
        .mockResolvedValueOnce(practice.value);
      const { root } = await mount(
        lobbyDependencies(invitation, createRoom),
        false,
        'solo'
      );
      await settle();
      await act(async () => {
        startTutorial();
        await flush();
      });
      await settle();
      expect(present('[data-tutorial="true"]')).toBe(true);
      invitation.acceptText.mockImplementationOnce(() => {
        throw new RemoteRoomInvitationError('invalid_handoff');
      });
      linkHarness.link = RAW_LINK;
      await act(async () => {
        for (const listener of linkHarness.listeners) listener();
        await flush();
      });
      await settle();
      // The practice table goes, as Play online pressed there would have
      // it; the player's own table comes back with Play online saying why.
      expect(present('[data-tutorial="true"]')).toBe(false);
      expect(practice.dispose).toHaveBeenCalled();
      expect(solo.dispose).not.toHaveBeenCalled();
      expect(
        element('[data-app-route="test-remote-room"]').textContent
      ).toContain('solo');
      expect(roomRouteHarness.initialSheet).toBe('online');
      expect(element('.lobby-status').textContent).toContain(
        'Paste the invitation link you were sent.'
      );
      await act(async () => root.unmount());
    });

    it('gives way to the room an invitation link opens, its practice table put away', async () => {
      const practice = creationResult(runtime({ label: 'practice' }), 'solo');
      const createRoom = vi.fn(async () => practice.value);
      const invitation = custody();
      const guest = runtime({ label: 'guest by link' });
      invitation.bootstrap.mockResolvedValueOnce({
        runtime: guest.value,
        route: { kind: 'remote-room', runtime: guest.value },
      });
      const { root } = await mount(
        lobbyDependencies(invitation, createRoom),
        false,
        'lobby'
      );
      await settle();
      await act(async () => {
        startTutorial();
        await flush();
      });
      await settle();
      expect(present('[data-tutorial="true"]')).toBe(true);
      linkHarness.link = RAW_LINK;
      await act(async () => {
        for (const listener of linkHarness.listeners) listener();
        await flush();
      });
      await settle();
      expect(invitation.bootstrap).toHaveBeenCalledOnce();
      expect(present('[data-tutorial="true"]')).toBe(false);
      expect(practice.dispose).toHaveBeenCalled();
      expect(
        element('[data-app-route="test-remote-room"]').textContent
      ).toContain('guest by link');
      await act(async () => root.unmount());
    });

    it('takes a lesson from the address once, and leaves the address clean', async () => {
      history.replaceState(null, '', '/?tutorial=damage&ref=discord');
      const practice = creationResult(runtime({ label: 'practice' }), 'solo');
      const createRoom = vi.fn(async () => practice.value);
      const { root } = await mount(lobbyDependencies(custody(), createRoom));
      await settle();
      expect(location.search).toBe('?ref=discord');
      expect(present('[data-tutorial="true"]')).toBe(true);
      await act(async () => root.unmount());
      history.replaceState(null, '', '/');
    });

    it('keeps the loading screen down on the way back until a new table of their own is made', async () => {
      const curtain = testCurtain('gone');
      const practice = creationResult(runtime({ label: 'practice' }), 'solo');
      const solo = creationResult(runtime({ label: 'solo' }), 'solo');
      const soloCreation = deferred<typeof solo.value>();
      const createRoom = vi
        .fn()
        .mockResolvedValueOnce(practice.value)
        .mockImplementationOnce(() => soloCreation.promise);
      const { root } = await mount(
        { ...lobbyDependencies(custody(), createRoom), curtain: curtain.value },
        false,
        'lobby'
      );
      await settle();
      await act(async () => {
        startTutorial();
        await flush();
      });
      await settle();
      await curtain.cover();
      await settle();
      expect(present('[data-tutorial="true"]')).toBe(true);
      await reportSettled(roomRouteHarness.onTableSettledChange, true);
      curtain.value.reveal.mockClear();
      // No table of their own: the page makes a Solo one on the way back.
      await act(async () => {
        roomRouteHarness.tutorial?.onExit();
        await flush();
      });
      await curtain.cover();
      await settle();
      expect(createRoom).toHaveBeenCalledTimes(2);
      expect(curtain.value.reveal).not.toHaveBeenCalled();
      await act(async () => {
        soloCreation.resolve(solo.value);
        await flush();
      });
      await settle();
      await reportSettled(roomRouteHarness.onTableSettledChange, true);
      expect(curtain.value.reveal).toHaveBeenCalled();
      await act(async () => root.unmount());
    });

    it('gives the player their own table back turned as they left it', async () => {
      const own = creationResult(runtime({ label: 'own' }), 'solo');
      const practice = creationResult(runtime({ label: 'practice' }), 'solo');
      const createRoom = vi
        .fn()
        .mockResolvedValueOnce(own.value)
        .mockResolvedValueOnce(practice.value);
      const { root } = await mount(
        lobbyDependencies(custody(), createRoom),
        false,
        'solo'
      );
      await settle();
      expect(
        element('[data-app-route="test-remote-room"]').textContent
      ).toMatch(/^own/u);
      expect(roomRouteHarness.initialFlipped).toBe(false);
      await act(async () => {
        roomRouteHarness.onFlippedChange?.(true);
        await flush();
      });
      await act(async () => {
        startTutorial();
        await flush();
      });
      await settle();
      expect(present('[data-tutorial="true"]')).toBe(true);
      await act(async () => {
        roomRouteHarness.tutorial?.onExit();
        await flush();
      });
      await settle();
      expect(present('[data-tutorial="true"]')).toBe(false);
      expect(practice.dispose).toHaveBeenCalledOnce();
      expect(roomRouteHarness.initialFlipped).toBe(true);
      await act(async () => root.unmount());
    });

    it('keeps the practice table’s seats apart from the player’s own table', async () => {
      const own = creationResult(runtime({ label: 'own' }), 'solo');
      const practice = creationResult(runtime({ label: 'practice' }), 'solo');
      const createRoom = vi
        .fn()
        .mockResolvedValueOnce(own.value)
        .mockResolvedValueOnce(practice.value);
      const { root } = await mount(
        lobbyDependencies(custody(), createRoom),
        false,
        'solo'
      );
      await settle();
      // The own table's deck screen keeps its seats with the lobby.
      const store = new DeckBuilderStore();
      const cardBackStore = new CardBackCustodyStore();
      await act(async () => {
        roomRouteHarness.onDeckCustodyChange?.({ store, cardBackStore });
        await flush();
      });
      expect(roomRouteHarness.deckStore).toBe(store);
      await act(async () => {
        startTutorial();
        await flush();
      });
      await settle();
      expect(present('[data-tutorial="true"]')).toBe(true);
      // A deck put on the practice table isn't recorded as on the player's
      // own: the practice table has seats of its own.
      expect(roomRouteHarness.deckStore).toBeUndefined();
      expect(roomRouteHarness.cardBackStore).toBeUndefined();
      expect(roomRouteHarness.onDeckCustodyChange).toBeUndefined();
      await act(async () => {
        roomRouteHarness.tutorial?.onExit();
        await flush();
      });
      await settle();
      expect(roomRouteHarness.deckStore).toBe(store);
      await act(async () => root.unmount());
    });
  });
});
