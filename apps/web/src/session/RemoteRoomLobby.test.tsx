// @vitest-environment happy-dom

import {
  createRendererSpikeView,
  type BoardLayoutSnapshot,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import type { DeckCard } from '@ptcgsim/deck-core';
import { StrictMode, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
import { PreferenceStore } from '../preferences/preference-store.js';
import type { DeckBuilderStore } from '../features/deck/deck-builder-store.js';
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
import { boardViewSettings } from '../board/view/board-view-settings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lobbyBoardHarness = vi.hoisted(() => ({
  preferences: undefined as BoardPreferences | undefined,
  viewMatchId: undefined as string | undefined,
  table: undefined as { readonly lowerShare: number } | undefined,
  parkedSession: undefined as unknown,
  parkedRoomMode: undefined as string | undefined,
  parkedRail: undefined as BoardRailModel | undefined,
  parkedKeysSuspended: undefined as boolean | undefined,
}));
const roomRouteHarness = vi.hoisted(() => ({
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
  onCopyInvitation: undefined as
    ((role: 'player' | 'spectator') => Promise<boolean>) | undefined,
  continuationAvailable: undefined as boolean | undefined,
  installDeckOnSessionAttach: undefined as boolean | undefined,
  onResumeSavedGame: undefined as
    | ((
        contents: string,
        deliverOpponentInvitation: (text: string) => Promise<void>,
        signal: AbortSignal
      ) => Promise<void>)
    | undefined,
}));

/** Enough of a table layout for the empty table's rail to place itself. */
const EMPTY_TABLE_LAYOUT = {
  playAreaBounds: { x: 0, y: 0, width: 1200, height: 800 },
  shared: { boardControlsAnchor: { x: 120, y: 384, height: 32 } },
} as unknown as BoardLayoutSnapshot;

vi.mock('../RendererSpikeBoard.js', () => ({
  RendererSpikeBoard: (props: {
    readonly preferences?: BoardPreferences;
    readonly view: { readonly matchId: string };
    readonly table?: { readonly lowerShare: number };
    readonly chrome?: (layout: BoardLayoutSnapshot) => ReactNode;
  }) => {
    lobbyBoardHarness.preferences = props.preferences;
    lobbyBoardHarness.viewMatchId = props.view.matchId;
    lobbyBoardHarness.table = props.table;
    return (
      <div data-testid="lobby-board">{props.chrome?.(EMPTY_TABLE_LAYOUT)}</div>
    );
  },
}));

vi.mock('./RemoteSessionBoard.js', () => ({
  RemoteSessionBoard: (props: {
    readonly session: unknown;
    readonly roomMode?: string;
    readonly rail?: BoardRailModel;
    readonly keysSuspended?: boolean;
  }) => {
    lobbyBoardHarness.parkedSession = props.session;
    lobbyBoardHarness.parkedRoomMode = props.roomMode;
    lobbyBoardHarness.parkedRail = props.rail;
    lobbyBoardHarness.parkedKeysSuspended = props.keysSuspended;
    return <div data-testid="parked-solo-board">{props.rail?.start}</div>;
  },
}));

vi.mock('./RemoteRoomRoute.js', () => ({
  RemoteRoomRoute: ({
    runtime,
    onLeave,
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
    onCopyInvitation,
    continuationAvailable,
    installDeckOnSessionAttach,
    onResumeSavedGame,
  }: {
    readonly runtime: { readonly label?: string };
    readonly onLeave?: () => void;
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
    readonly onCopyInvitation?: (
      role: 'player' | 'spectator'
    ) => Promise<boolean>;
    readonly continuationAvailable?: boolean;
    readonly installDeckOnSessionAttach?: boolean;
    readonly onResumeSavedGame?: (
      contents: string,
      deliverOpponentInvitation: (text: string) => Promise<void>,
      signal: AbortSignal
    ) => Promise<void>;
  }) => {
    roomRouteHarness.preferences = preferences;
    roomRouteHarness.onPreferencesChange = onPreferencesChange;
    roomRouteHarness.background = background;
    roomRouteHarness.onBackgroundChange = onBackgroundChange;
    roomRouteHarness.roomMode = roomMode;
    roomRouteHarness.onMultiplayerNavigate = onMultiplayerNavigate;
    roomRouteHarness.onMultiplayerPanelOpen = onMultiplayerPanelOpen;
    roomRouteHarness.deckStore = deckStore;
    roomRouteHarness.cardBackStore = cardBackStore;
    roomRouteHarness.onCopyInvitation = onCopyInvitation;
    roomRouteHarness.continuationAvailable = continuationAvailable;
    roomRouteHarness.installDeckOnSessionAttach = installDeckOnSessionAttach;
    roomRouteHarness.onResumeSavedGame = onResumeSavedGame;
    return (
      <main data-app-route="test-remote-room">
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
        {multiplayerPanel?.(false)}
      </main>
    );
  },
}));

const ROOM_CODE = 'ABCDEFGH2345';
const RAW_HANDOFF =
  'PTCGSIM2-INVITE:{"roomCode":"ABCDEFGH2345","requestedRole":"spectator","invitation":"secret-bearer-never-rendered","expiresAt":9999999999999}';

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
  const copyPlayerOrSpectatorInvitation = vi.fn(async () => ({
    roomCode: ROOM_CODE,
    requestedRole: 'player' as const,
    expiresAt: 40_000,
  }));
  const dispose = vi.fn();
  const value = {
    runtime: roomRuntime.value,
    route: {
      kind: 'remote-room',
      runtime: roomRuntime.value,
      rendererKind: 'dom',
    },
    mode,
    invitations: {
      roomCode: ROOM_CODE,
      copyPlayerInvitation,
      copySpectatorInvitation,
      copyPlayerOrSpectatorInvitation,
    },
    dispose,
  } as unknown as RemoteRoomCreationResult;
  return {
    value,
    dispose,
    copyPlayerInvitation,
    copySpectatorInvitation,
    copyPlayerOrSpectatorInvitation,
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
      rendererKind="dom"
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

/**
 * The button that opens the app menu: the open toolbar's More, or on a
 * narrow rail its one menu button.
 */
const menuButton = (): string =>
  present('#appMoreButton') ? '#appMoreButton' : '#appMenuButton';

/** Opens the app menu at the rail's left end. */
const openMenu = async (): Promise<void> => {
  await click(menuButton());
  expect(
    present('[role="menu"]:is([aria-label="Menu"], [aria-label="More"])')
  ).toBe(true);
};

/**
 * Chooses an app entry by its id: a toolbar button directly, anything else
 * from the menu behind the toolbar's last button.
 */
const chooseMenuItem = async (id: string): Promise<void> => {
  if (!present(`.ptcgsim-app-toolbar #${id}`)) await openMenu();
  await click(`#${id}`);
};

/**
 * The ids the app toolbar and its menu offer right now; the menu is closed
 * again after.
 */
const menuEntryIds = async (): Promise<string[]> => {
  const toolbar = [
    ...document.querySelectorAll(
      '.ptcgsim-app-toolbar .ptcgsim-rail-button[id]'
    ),
  ].map((entry) => entry.id);
  const opener = menuButton();
  await openMenu();
  const ids = [
    ...toolbar.filter((id) => id !== 'appMenuButton' && id !== 'appMoreButton'),
    ...[
      ...document.querySelectorAll(
        '[role="menu"]:is([aria-label="Menu"], [aria-label="More"]) [id]'
      ),
    ].map((entry) => entry.id),
  ];
  // Closed from its own button: an Escape would also reach the sheet below.
  await click(opener);
  expect(
    present('[role="menu"]:is([aria-label="Menu"], [aria-label="More"])')
  ).toBe(false);
  return ids;
};

const openDeck = async (): Promise<void> => {
  await chooseMenuItem('deckImportButton');
  await act(async () => {
    await import('../features/deck/LegacyDeckBuilderSession.js');
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

describe('remote room lobby wiring', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
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
    // Laid out like the room's, the optional pieces off as there by default.
    expect(lobbyBoardHarness.table).toEqual({
      lowerShare: 0.5,
      seamBandPx: 42,
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
      'copyButton',
      'generateIdButton',
      'coachingModeCheckbox',
      'spectatorModeCheckbox',
      'joinRoomButton',
    ]) {
      expect(present(`#playOnlineSheet #${id}`), id).toBe(true);
    }
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
        'shortcutsButton',
        'fullscreenButton',
      ])
    );
    expect(entries).not.toContain('p2Button');
    expect(entries).not.toContain('leaveRoomButton');

    await openDeck();
    expect(element<HTMLElement>('#deckImport').hidden).toBe(false);
    // Play online gives way to the deck screen and comes back after it.
    expect(playOnlineOpen()).toBe(false);
    expect(
      element('#altImportHeaderButton').getAttribute('aria-disabled')
    ).toBe('true');
    await closeDeck();
    expect(element<HTMLElement>('#deckImport').hidden).toBe(true);
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
    // How the table shows is in Settings too; covering the opponent's hand
    // is a Solo choice, offered only with a Solo table.
    expect(present('#zoneOutlinesCheckbox')).toBe(true);
    expect(present('#lostZoneCheckbox')).toBe(true);
    expect(present('#hideHandCheckbox')).toBe(false);
    await act(async () => boardViewSettings().update({ zoneOutlines: false }));
    expect(lobbyBoardHarness.preferences?.showZoneOutlines).toBe(false);
    // Settings holds settings only: the keys and the help pages live on
    // the toolbar and in its menu.
    expect(present('#settings #keyboardShortcutsButton')).toBe(false);
    expect(element('#changeBackgroundButton').textContent).toBe(
      'Change background'
    );
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
      'Could not start Solo mode. Please try again.'
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
      rendererKind: 'dom',
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
    expect(
      element('#altImportHeaderButton').getAttribute('aria-disabled')
    ).toBe('false');
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
    // A table of this player's own is ready to join...
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    // ...when they paste someone's invitation and join that instead.
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
    expect(present('#defaultBackgroundButton')).toBe(false);
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
    await click('#defaultBackgroundButton');
    expect(lobbyRoute().style.backgroundImage).toBe('');
    expect(present('#defaultBackgroundButton')).toBe(false);
    await act(async () => root.unmount());
  });

  it('generates with the chosen identity and copies role-bound invitations directly from the button gesture', async () => {
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
      rendererKind: 'dom',
    });
    expect(createRoom.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(element<HTMLInputElement>('#nameInput').value).toBe('Blue');
    expect(element<HTMLInputElement>('#roomIdInput').value).toBe(ROOM_CODE);

    await act(async () => {
      element<HTMLButtonElement>('#copyButton').click();
      await flush();
    });
    expect(created.copyPlayerInvitation).toHaveBeenCalledOnce();
    expect(created.copyPlayerInvitation.mock.calls[0]?.[0]).toBeUndefined();
    expect(created.copyPlayerInvitation.mock.calls[0]?.[1]).toBeInstanceOf(
      AbortSignal
    );

    await act(async () => {
      element<HTMLInputElement>('#spectatorModeCheckbox').click();
      element<HTMLButtonElement>('#copyButton').click();
      await flush();
    });
    expect(created.copySpectatorInvitation).toHaveBeenCalledOnce();
    // The button confirms the copy; the lobby narrates nothing, as in v1.
    expect(element('#copyButton').classList.contains('copied')).toBe(true);
    expect(present('.lobby-status')).toBe(false);
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
    expect(playOnlineOpen()).toBe(true);
    expect(await menuEntryIds()).toContain('p1Button');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('retires a failure message once the retried generate and copy succeed', async () => {
    const created = creationResult();
    const createRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(created.value);
    const { root } = await mount(lobbyDependencies(custody(), createRoom));
    await settle();
    const generate = async () =>
      act(async () => {
        element<HTMLButtonElement>('#generateIdButton').click();
        await flush();
      });

    await generate();
    expect(present('.lobby-status')).toBe(true);
    await generate();
    expect(present('.lobby-status')).toBe(false);

    created.copyPlayerInvitation.mockRejectedValueOnce(new Error('denied'));
    const copy = async () =>
      act(async () => {
        element<HTMLButtonElement>('#copyButton').click();
        await flush();
      });
    await copy();
    expect(present('.lobby-status')).toBe(true);
    await copy();
    expect(present('.lobby-status')).toBe(false);

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
      await act(async () => {
        element<HTMLButtonElement>('#generateIdButton').click();
        await flush();
      });
      // The lobby itself makes no authority request.
      expect(continuationAvailability).not.toHaveBeenCalled();
      await act(async () => {
        element<HTMLButtonElement>('#joinRoomButton').click();
        await flush();
      });
      expect(continuationAvailability).toHaveBeenCalledOnce();
      expect(roomRouteHarness.continuationAvailable).toBe(reported);
      await act(async () => root.unmount());
      document.body.replaceChildren();
    }
  });

  it('copies a spectator invitation from the room only once the player seat is taken', async () => {
    const invitation = custody();
    const created = creationResult();
    const createRoom = vi.fn(async () => created.value);
    const { root } = await mount(lobbyDependencies(invitation, createRoom));
    await settle();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });

    // The one copy key asks custody for whichever invitation the room has
    // room for, in a single clipboard write (RemoteRoomCreation.test.ts),
    // and reports a failure as it is.
    const copy = roomRouteHarness.onCopyInvitation!;
    created.copyPlayerOrSpectatorInvitation.mockRejectedValueOnce(
      new RemoteRoomInvitationError('issue_failed')
    );
    await expect(copy('player')).rejects.toMatchObject({
      code: 'issue_failed',
    });
    await expect(copy('player')).resolves.toBe(true);
    expect(created.copyPlayerOrSpectatorInvitation).toHaveBeenCalledTimes(2);
    expect(created.copyPlayerInvitation).not.toHaveBeenCalled();
    expect(created.copySpectatorInvitation).not.toHaveBeenCalled();

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
        rendererKind: 'dom',
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
    const spectator = element<HTMLInputElement>('#spectatorModeCheckbox');
    expect(spectator.checked).toBe(true);
    expect(spectator.disabled).toBe(true);
    expect(document.body.innerHTML).not.toContain(RAW_HANDOFF);
    expect(document.body.innerHTML).not.toContain(
      'secret-bearer-never-rendered'
    );

    await act(async () => {
      paste(roomInput, 'malformed replacement');
      await flush();
    });
    expect(document.body.textContent).toContain(
      'Paste a valid invitation into Room ID before joining.'
    );
    expect(spectator.disabled).toBe(false);

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
      rendererKind: 'dom',
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
      'Paste a valid invitation into Room ID before joining.'
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

  it('keeps the current room until replacement succeeds and then disposes only the superseded owner', async () => {
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

  it('transfers creator ownership into the room route and submits initial coaching consent once ready', async () => {
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
      element<HTMLInputElement>('#coachingModeCheckbox').click();
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });

    expect(present('[data-app-route="test-remote-room"]')).toBe(true);
    expect(created.roomRuntime.submit).toHaveBeenCalledOnce();
    expect(created.roomRuntime.submit).toHaveBeenCalledWith({
      type: 'SetCoachingConsent',
      consent: true,
    });
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
    const restore = vi
      .fn()
      .mockRejectedValueOnce(new Error('redacted restore failure'))
      .mockImplementationOnce(async (input) => {
        await input.deliverOpponentInvitation('private opponent invitation');
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
    const { root } = await mount(dependencies);
    await settle();
    await act(async () => {
      element<HTMLButtonElement>('#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
      await flush();
    });
    expect(document.body.textContent).toContain('source');
    const resume = roomRouteHarness.onResumeSavedGame!;
    const deliverOpponentInvitation = vi.fn(async () => undefined);

    await expect(
      act(async () =>
        resume(
          'opaque continuation file',
          deliverOpponentInvitation,
          new AbortController().signal
        )
      )
    ).rejects.toThrow('redacted restore failure');
    expect(document.body.textContent).toContain('source');
    expect(created.dispose).not.toHaveBeenCalled();
    expect(restored.dispose).not.toHaveBeenCalled();

    await act(async () =>
      resume(
        'opaque continuation file',
        deliverOpponentInvitation,
        new AbortController().signal
      )
    );
    expect(createRestorationCustody).toHaveBeenCalledOnce();
    expect(restoration.matchesHandoff).toHaveBeenCalledWith(
      'opaque continuation file'
    );
    expect(restore).toHaveBeenCalledTimes(2);
    expect(deliverOpponentInvitation).toHaveBeenCalledWith(
      'private opponent invitation'
    );
    expect(document.body.textContent).toContain('restored');
    // The save keeps the coaching consent it was made with.
    expect(restored.submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SetCoachingConsent' })
    );
    expect(roomRouteHarness.installDeckOnSessionAttach).toBe(false);
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(restored.dispose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(restored.dispose).toHaveBeenCalledOnce();
    expect(restoration.dispose).not.toHaveBeenCalled();
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
    await act(async () => {
      element<HTMLButtonElement>('#joinRoomButton').click();
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
      name: 'Retained Through Leave',
      supertype: 'Pokémon',
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
    expect(element('#nativeDeckBuilderSummaryPanel').textContent).toContain(
      'Total: 1'
    );
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
        rendererKind: 'dom',
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
    expect(element<HTMLInputElement>('#spectatorModeCheckbox').disabled).toBe(
      false
    );

    await act(async () => root.unmount());
    expect(guest.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).toHaveBeenCalledOnce();
  });
});
