// @vitest-environment happy-dom

import {
  createRendererSpikeView,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import type { DeckCard } from '@ptcgsim/deck-core';
import { StrictMode, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
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
import type { RoomBackground } from './browser-room-background.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lobbyBoardHarness = vi.hoisted(() => ({
  preferences: undefined as BoardPreferences | undefined,
  viewMatchId: undefined as string | undefined,
  parkedSession: undefined as unknown,
  parkedRoomMode: undefined as string | undefined,
}));
const roomRouteHarness = vi.hoisted(() => ({
  preferences: undefined as BoardPreferences | undefined,
  onPreferencesChange: undefined as
    ((preferences: BoardPreferences) => void) | undefined,
  hideOpponentHand: false,
  onHideOpponentHandChange: undefined as
    ((hidden: boolean) => void) | undefined,
  background: undefined as RoomBackground | undefined,
  onBackgroundChange: undefined as
    ((background: RoomBackground) => void) | undefined,
  roomMode: undefined as 'solo' | 'multiplayer' | undefined,
  onMultiplayerNavigate: undefined as (() => void) | undefined,
  deckStore: undefined as DeckBuilderStore | undefined,
  cardBackStore: undefined as CardBackCustodyStore | undefined,
  onCopyInvitation: undefined as
    ((role: 'player' | 'spectator') => Promise<boolean>) | undefined,
  continuationAvailable: undefined as boolean | undefined,
  onResumeSavedGame: undefined as
    | ((
        contents: string,
        deliverOpponentInvitation: (text: string) => Promise<void>,
        signal: AbortSignal
      ) => Promise<void>)
    | undefined,
}));

vi.mock('../RendererSpikeBoard.js', () => ({
  RendererSpikeBoard: (props: {
    readonly preferences?: BoardPreferences;
    readonly view: { readonly matchId: string };
  }) => {
    lobbyBoardHarness.preferences = props.preferences;
    lobbyBoardHarness.viewMatchId = props.view.matchId;
    return <div data-testid="lobby-board" />;
  },
}));

vi.mock('./RemoteSessionBoard.js', () => ({
  RemoteSessionBoard: (props: {
    readonly session: unknown;
    readonly roomMode?: string;
  }) => {
    lobbyBoardHarness.parkedSession = props.session;
    lobbyBoardHarness.parkedRoomMode = props.roomMode;
    return <div data-testid="parked-solo-board" />;
  },
}));

vi.mock('./RemoteRoomRoute.js', () => ({
  RemoteRoomRoute: ({
    runtime,
    onLeave,
    preferences,
    onPreferencesChange,
    hideOpponentHand,
    onHideOpponentHandChange,
    background,
    onBackgroundChange,
    roomMode,
    onMultiplayerNavigate,
    multiplayerPanel,
    deckStore,
    cardBackStore,
    onCopyInvitation,
    continuationAvailable,
    onResumeSavedGame,
  }: {
    readonly runtime: { readonly label?: string };
    readonly onLeave?: () => void;
    readonly preferences?: BoardPreferences;
    readonly onPreferencesChange?: (preferences: BoardPreferences) => void;
    readonly hideOpponentHand?: boolean;
    readonly onHideOpponentHandChange?: (hidden: boolean) => void;
    readonly background?: RoomBackground;
    readonly onBackgroundChange?: (background: RoomBackground) => void;
    readonly roomMode?: 'solo' | 'multiplayer';
    readonly onMultiplayerNavigate?: () => void;
    readonly multiplayerPanel?: (hidden: boolean) => ReactNode;
    readonly deckStore?: DeckBuilderStore;
    readonly cardBackStore?: CardBackCustodyStore;
    readonly onCopyInvitation?: (
      role: 'player' | 'spectator'
    ) => Promise<boolean>;
    readonly continuationAvailable?: boolean;
    readonly onResumeSavedGame?: (
      contents: string,
      deliverOpponentInvitation: (text: string) => Promise<void>,
      signal: AbortSignal
    ) => Promise<void>;
  }) => {
    roomRouteHarness.preferences = preferences;
    roomRouteHarness.onPreferencesChange = onPreferencesChange;
    roomRouteHarness.hideOpponentHand = hideOpponentHand ?? false;
    roomRouteHarness.onHideOpponentHandChange = onHideOpponentHandChange;
    roomRouteHarness.background = background;
    roomRouteHarness.onBackgroundChange = onBackgroundChange;
    roomRouteHarness.roomMode = roomMode;
    roomRouteHarness.onMultiplayerNavigate = onMultiplayerNavigate;
    roomRouteHarness.deckStore = deckStore;
    roomRouteHarness.cardBackStore = cardBackStore;
    roomRouteHarness.onCopyInvitation = onCopyInvitation;
    roomRouteHarness.continuationAvailable = continuationAvailable;
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
      getSnapshot: () => ({ phase: 'ready' as const, view: projected }),
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
    },
    dispose,
  } as unknown as RemoteRoomCreationResult;
  return {
    value,
    dispose,
    copyPlayerInvitation,
    copySpectatorInvitation,
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
      dependencies={dependencies}
    />
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{lobby}</StrictMode> : lobby);
    await flush();
  });
  return { host, root };
};

const element = <ElementType extends Element>(
  host: ParentNode,
  selector: string
): ElementType => {
  const found = host.querySelector<ElementType>(selector);
  if (!found) throw new Error(`Missing test element: ${selector}`);
  return found;
};

const openDeck = async (host: ParentNode): Promise<void> => {
  await act(async () => {
    element<HTMLButtonElement>(host, '#deckImportButton').click();
    await import('../features/deck/LegacyDeckBuilderSession.js');
    await flush();
  });
};

describe('remote room lobby wiring', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    lobbyBoardHarness.preferences = undefined;
    roomRouteHarness.preferences = undefined;
    roomRouteHarness.onPreferencesChange = undefined;
    roomRouteHarness.hideOpponentHand = false;
    roomRouteHarness.onHideOpponentHandChange = undefined;
    roomRouteHarness.background = undefined;
    roomRouteHarness.onBackgroundChange = undefined;
    roomRouteHarness.roomMode = undefined;
    roomRouteHarness.onMultiplayerNavigate = undefined;
    roomRouteHarness.deckStore = undefined;
    roomRouteHarness.cardBackStore = undefined;
    roomRouteHarness.onResumeSavedGame = undefined;
  });

  it('preserves the legacy multiplayer control shape without creating a room on mount', async () => {
    const invitation = custody();
    const createRoom = vi.fn();
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/lobby.png',
    }));
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom, requestBackground)
    );

    expect(
      host.querySelector('[data-app-route="remote-room-lobby"]')
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="lobby-board"]')).not.toBeNull();
    // A visitor with no game sees an empty table, not the parity fixture.
    expect(lobbyBoardHarness.viewMatchId).toBe('lobby-empty-board');
    expect(host.querySelector('[data-testid="parked-solo-board"]')).toBeNull();
    expect(element(host, '#p2Button').getAttribute('aria-current')).toBe(
      'page'
    );
    expect(element<HTMLElement>(host, '#p2Box').hidden).toBe(false);
    expect(element<HTMLElement>(host, '#settings').hidden).toBe(true);
    expect(lobbyBoardHarness.preferences).toBeUndefined();
    for (const id of [
      'nameInput',
      'roomIdInput',
      'copyButton',
      'generateIdButton',
      'coachingModeCheckbox',
      'spectatorModeCheckbox',
      'joinRoomButton',
    ]) {
      expect(host.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(element(host, '#joinRoomButton').tagName).toBe('BUTTON');
    expect(createRoom).not.toHaveBeenCalled();
    expect(host.innerHTML).not.toContain('PTCGSIM2-INVITE:');

    await openDeck(host);
    expect(element(host, '#deckImportButton').className).toBe('selected-page');
    expect(element<HTMLElement>(host, '#deckImport').hidden).toBe(false);
    expect(element<HTMLElement>(host, '#p2Box').hidden).toBe(true);
    expect(element<HTMLElement>(host, '#settings').hidden).toBe(true);
    expect(
      element(host, '#altImportHeaderButton').getAttribute('aria-disabled')
    ).toBe('true');

    await act(async () =>
      element<HTMLButtonElement>(host, '#p2Button').click()
    );
    expect(element<HTMLElement>(host, '#deckImport').hidden).toBe(true);
    expect(element<HTMLElement>(host, '#p2Box').hidden).toBe(false);

    await act(async () =>
      element<HTMLButtonElement>(host, '#settingsButton').click()
    );
    expect(element(host, '#settingsButton').className).toBe('selected-page');
    expect(element(host, '#p2Button').className).toBe('not-selected-page');
    expect(element<HTMLElement>(host, '#settings').hidden).toBe(false);
    expect(element<HTMLElement>(host, '#p2Box').hidden).toBe(true);
    await act(async () =>
      element<HTMLInputElement>(host, '#darkModeCheckbox').click()
    );
    await act(async () =>
      element<HTMLInputElement>(host, '#showZonesCheckbox').click()
    );
    // The room starts on the Night table; the checkbox turns it to Day.
    expect(lobbyBoardHarness.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: false,
      showZoneOutlines: false,
    });
    const preferencesBeforeHideHand = lobbyBoardHarness.preferences;
    await act(async () =>
      element<HTMLInputElement>(host, '#hideHandCheckbox').click()
    );
    expect(element<HTMLInputElement>(host, '#hideHandCheckbox').checked).toBe(
      true
    );
    expect(lobbyBoardHarness.preferences).toBe(preferencesBeforeHideHand);
    expect(host.textContent).toContain('Hold (shift) to view keybinds');
    expect(element(host, '#changeBackgroundButton').textContent).toBe(
      'Change background'
    );
    expect(element<HTMLAnchorElement>(host, '#twitterDescription a').href).toBe(
      'https://twitter.com/xxmichaellong'
    );
    expect(
      element<HTMLElement>(host, '[data-app-route="remote-room-lobby"]').dataset
        .darkMode
    ).toBe('false');
    await act(async () => {
      element<HTMLButtonElement>(host, '#changeBackgroundButton').click();
      await flush();
    });
    expect(requestBackground).toHaveBeenCalledOnce();
    expect(
      element<HTMLElement>(host, '[data-app-route="remote-room-lobby"]').style
        .backgroundImage
    ).toBe('url("https://images.example.test/lobby.png")');
    expect(lobbyBoardHarness.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: false,
      showZoneOutlines: false,
    });
    expect(createRoom).not.toHaveBeenCalled();
    await act(async () =>
      element<HTMLButtonElement>(host, '#p2Button').click()
    );
    expect(element<HTMLElement>(host, '#settings').hidden).toBe(true);
    expect(element<HTMLElement>(host, '#p2Box').hidden).toBe(false);

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
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom),
      true,
      'solo'
    );
    // While the room is still being created the page already shows the
    // Solo panel -- welcome text, Solo tab selected -- never Multiplayer.
    expect(element<HTMLButtonElement>(host, '#p1Button').className).toBe(
      'selected-page'
    );
    expect(element<HTMLElement>(host, '#p1Box').hidden).toBe(false);
    expect(element<HTMLElement>(host, '#p2Box').hidden).toBe(true);
    expect(host.querySelector('#p1Box #chatbox')?.textContent).toContain(
      'Welcome to PTCG-sim!'
    );
    expect(element<HTMLButtonElement>(host, '#setupButton').disabled).toBe(
      true
    );
    await act(async () => {
      releaseCreation?.();
      await flush();
    });

    // v1 opens on Solo; nobody has to press a tab to get a table. StrictMode
    // replays the mount with a fresh owner: the first owner's creation is
    // aborted with it and the live owner's creation is the one mounted.
    expect(createRoom).toHaveBeenCalledTimes(2);
    // Solo is always v1's Blue, never the Multiplayer fallback name.
    for (const call of createRoom.mock.calls) {
      expect(call[0]).toMatchObject({ displayName: 'Blue', mode: 'solo' });
    }
    expect(createRoom.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(createRoom.mock.calls[1]?.[0].signal.aborted).toBe(false);
    expect(
      host.querySelector('[data-app-route="test-remote-room"]')
    ).not.toBeNull();
    expect(roomRouteHarness.roomMode).toBe('solo');
    // The generated stand-in name stays out of the Multiplayer Name box.
    await act(async () =>
      element<HTMLButtonElement>(host, '#testOpenMultiplayer').click()
    );
    expect(element<HTMLInputElement>(host, '#nameInput').value).toBe('');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('starts one-player authority from Solo and parks it across source tab navigation', async () => {
    const invitation = custody();
    const created = creationResult(runtime({ label: 'solo' }), 'solo');
    const createRoom = vi.fn(async () => created.value);
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom)
    );

    await act(async () => {
      element<HTMLButtonElement>(host, '#p1Button').click();
      await flush();
    });

    expect(createRoom).toHaveBeenCalledOnce();
    expect(createRoom.mock.calls[0]?.[0]).toMatchObject({
      buildId: 'test-build',
      displayName: 'Blue',
      mode: 'solo',
      rendererKind: 'dom',
    });
    expect(createRoom.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(
      host.querySelector('[data-app-route="test-remote-room"]')
    ).not.toBeNull();
    expect(host.textContent).toContain('solo');
    expect(roomRouteHarness.roomMode).toBe('solo');
    expect(roomRouteHarness.onMultiplayerNavigate).toBeTypeOf('function');
    expect(created.roomRuntime.submit).not.toHaveBeenCalled();
    expect(invitation.clear).toHaveBeenCalledOnce();

    await act(async () =>
      element<HTMLButtonElement>(host, '#testOpenMultiplayer').click()
    );
    expect(
      host.querySelector('[data-app-route="remote-room-lobby"]')
    ).not.toBeNull();
    expect(host.querySelector('.lobby-status')).toBeNull();
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe('');
    expect(created.dispose).not.toHaveBeenCalled();
    // The parked game keeps its table on screen behind the Multiplayer panel
    // instead of the lobby's empty board.
    expect(
      host.querySelector('[data-testid="parked-solo-board"]')
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="lobby-board"]')).toBeNull();
    expect(lobbyBoardHarness.parkedSession).toBe(
      created.roomRuntime.value.session
    );
    expect(lobbyBoardHarness.parkedRoomMode).toBe('solo');

    await openDeck(host);
    expect(
      element(host, '#altImportHeaderButton').getAttribute('aria-disabled')
    ).toBe('false');

    await act(async () => {
      element<HTMLButtonElement>(host, '#p1Button').click();
      await flush();
    });
    expect(createRoom).toHaveBeenCalledOnce();
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
    const { host, root } = await mount(
      lobbyDependencies(
        invitation,
        vi.fn(async () => created.value)
      )
    );
    await act(async () => {
      element<HTMLButtonElement>(host, '#p1Button').click();
      await flush();
    });
    expect(invitation.clear).toHaveBeenCalledOnce();

    // The Multiplayer panel is read over the live table; pasting into it and
    // pressing Join is the first thing that could move the table.
    await act(async () => {
      paste(element(host, '#roomIdInput'), RAW_HANDOFF);
    });
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe(
      ROOM_CODE
    );
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });

    expect(invitation.bootstrap).toHaveBeenCalledOnce();
    expect(
      host.querySelector('[data-app-route="test-remote-room"]')
    ).not.toBeNull();
    expect(roomRouteHarness.roomMode).toBe('solo');
    expect(created.dispose).not.toHaveBeenCalled();
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe(
      ROOM_CODE
    );
    expect(invitation.clear).toHaveBeenCalledOnce();
    expect(element(host, '.lobby-status').textContent).not.toContain(
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
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom)
    );
    const roomInput = element<HTMLInputElement>(host, '#roomIdInput');
    await act(async () => {
      paste(roomInput, RAW_HANDOFF);
      await flush();
    });
    const spectator = element<HTMLInputElement>(host, '#spectatorModeCheckbox');
    // A player invitation neither forces nor forbids watching.
    expect(spectator.checked).toBe(false);
    expect(spectator.disabled).toBe(false);
    await act(async () => {
      spectator.click();
      await flush();
    });
    expect(spectator.checked).toBe(true);
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });
    expect(invitation.bootstrap.mock.calls[0]?.[0]).toMatchObject({
      asSpectator: true,
    });
    await act(async () => root.unmount());
  });

  it('generates with the chosen identity and copies role-bound invitations directly from the button gesture', async () => {
    const invitation = custody();
    const created = creationResult();
    const createRoom = vi.fn(async () => created.value);
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom)
    );
    const name = element<HTMLInputElement>(host, '#nameInput');

    await act(async () => {
      inputValue(name, '  Blue  ');
      element<HTMLButtonElement>(host, '#generateIdButton').click();
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
    expect(element<HTMLInputElement>(host, '#nameInput').value).toBe('Blue');
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe(
      ROOM_CODE
    );

    await act(async () => {
      element<HTMLButtonElement>(host, '#copyButton').click();
      await flush();
    });
    expect(created.copyPlayerInvitation).toHaveBeenCalledOnce();
    expect(created.copyPlayerInvitation.mock.calls[0]?.[0]).toBeUndefined();
    expect(created.copyPlayerInvitation.mock.calls[0]?.[1]).toBeInstanceOf(
      AbortSignal
    );

    await act(async () => {
      element<HTMLInputElement>(host, '#spectatorModeCheckbox').click();
      element<HTMLButtonElement>(host, '#copyButton').click();
      await flush();
    });
    expect(created.copySpectatorInvitation).toHaveBeenCalledOnce();
    // The button confirms the copy; the lobby narrates nothing, as in v1.
    expect(element(host, '#copyButton').className).toBe('copied');
    expect(host.querySelector('.lobby-status')).toBeNull();
    expect(host.innerHTML).not.toContain('secret-bearer');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
  });

  it('retires a failure message once the retried generate and copy succeed', async () => {
    const created = creationResult();
    const createRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(created.value);
    const { host, root } = await mount(
      lobbyDependencies(custody(), createRoom)
    );
    const generate = async () =>
      act(async () => {
        element<HTMLButtonElement>(host, '#generateIdButton').click();
        await flush();
      });

    await generate();
    expect(host.querySelector('.lobby-status')).not.toBeNull();
    await generate();
    expect(host.querySelector('.lobby-status')).toBeNull();

    created.copyPlayerInvitation.mockRejectedValueOnce(new Error('denied'));
    const copy = async () =>
      act(async () => {
        element<HTMLButtonElement>(host, '#copyButton').click();
        await flush();
      });
    await copy();
    expect(host.querySelector('.lobby-status')).not.toBeNull();
    await copy();
    expect(host.querySelector('.lobby-status')).toBeNull();

    await act(async () => root.unmount());
  });

  it('offers online save and resume only once the Worker reports them enabled', async () => {
    for (const reported of [false, true]) {
      const created = creationResult();
      const continuationAvailability = vi.fn(async () => reported);
      const { host, root } = await mount({
        ...lobbyDependencies(
          custody(),
          vi.fn(async () => created.value)
        ),
        continuationAvailability,
      });
      await act(async () => {
        element<HTMLButtonElement>(host, '#generateIdButton').click();
        await flush();
      });
      // The lobby itself makes no authority request.
      expect(continuationAvailability).not.toHaveBeenCalled();
      await act(async () => {
        element<HTMLButtonElement>(host, '#joinRoomButton').click();
        await flush();
      });
      expect(continuationAvailability).toHaveBeenCalledOnce();
      expect(roomRouteHarness.continuationAvailable).toBe(reported);
      await act(async () => root.unmount());
    }
  });

  it('copies a spectator invitation from the room only once the player seat is taken', async () => {
    const invitation = custody();
    const created = creationResult();
    const createRoom = vi.fn(async () => created.value);
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom)
    );
    await act(async () => {
      element<HTMLButtonElement>(host, '#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });

    // A transient failure is reported, never swapped for a spectator link
    // the recipient could not take the seat with.
    const copy = roomRouteHarness.onCopyInvitation!;
    created.copyPlayerInvitation.mockRejectedValueOnce(
      new RemoteRoomInvitationError('issue_failed')
    );
    await expect(copy('player')).rejects.toMatchObject({
      code: 'issue_failed',
    });
    expect(created.copySpectatorInvitation).not.toHaveBeenCalled();

    created.copyPlayerInvitation.mockRejectedValueOnce(
      new RemoteRoomInvitationError('seat_unavailable')
    );
    await expect(copy('player')).resolves.toBe(true);
    expect(created.copySpectatorInvitation).toHaveBeenCalledOnce();

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
    const { host, root } = await mount(lobbyDependencies(invitation, vi.fn()));
    const roomInput = element<HTMLInputElement>(host, '#roomIdInput');

    let pasteEvent!: Event;
    await act(async () => {
      pasteEvent = paste(roomInput, RAW_HANDOFF);
      await flush();
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(invitation.acceptPaste).toHaveBeenCalledOnce();
    expect(roomInput.value).toBe(ROOM_CODE);
    const spectator = element<HTMLInputElement>(host, '#spectatorModeCheckbox');
    expect(spectator.checked).toBe(true);
    expect(spectator.disabled).toBe(true);
    expect(host.innerHTML).not.toContain(RAW_HANDOFF);
    expect(host.innerHTML).not.toContain('secret-bearer-never-rendered');

    await act(async () => {
      paste(roomInput, 'malformed replacement');
      await flush();
    });
    expect(host.textContent).toContain(
      'Paste a valid invitation into Room ID before joining.'
    );
    expect(spectator.disabled).toBe(false);

    await act(async () => {
      paste(roomInput, RAW_HANDOFF);
      await flush();
    });

    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
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
    expect(
      host.querySelector('[data-app-route="test-remote-room"]')
    ).not.toBeNull();
    expect(host.innerHTML).not.toContain('secret-bearer-never-rendered');

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
    const { host, root } = await mount(lobbyDependencies(invitation, vi.fn()));
    await act(async () => {
      inputValue(element(host, '#roomIdInput'), RAW_HANDOFF);
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });

    expect(invitation.bootstrap).toHaveBeenCalledOnce();
    expect(host.textContent).toContain(
      'Paste a valid invitation into Room ID before joining.'
    );
    const safeInput = element<HTMLInputElement>(host, '#roomIdInput').value;
    expect(safeInput).toMatch(/^[A-HJ-NP-Z2-9]{0,12}$/u);
    expect(safeInput).not.toContain('secret-bearer-never-rendered');
    expect(host.innerHTML).not.toContain(RAW_HANDOFF);
    expect(element(host, '.lobby-status').textContent).not.toContain(
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
    const { host, root } = await mount(dependencies, true);
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).not.toHaveBeenCalled();

    await act(async () => {
      element<HTMLButtonElement>(host, '#generateIdButton').click();
      element<HTMLButtonElement>(host, '#generateIdButton').click();
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
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom)
    );

    await act(async () => {
      element<HTMLButtonElement>(host, '#generateIdButton').click();
      await flush();
    });
    expect(first.dispose).not.toHaveBeenCalled();
    await act(async () => {
      element<HTMLButtonElement>(host, '#generateIdButton').click();
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
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom, undefined, requestCardBack)
    );

    await openDeck(host);
    await act(async () => {
      element<HTMLButtonElement>(host, '#changeCardBackButton').click();
      await flush();
    });
    expect(requestCardBack).toHaveBeenCalledOnce();
    await act(async () =>
      element<HTMLButtonElement>(host, '#p2Button').click()
    );
    await act(async () => {
      inputValue(element(host, '#nameInput'), 'Blue');
      element<HTMLInputElement>(host, '#coachingModeCheckbox').click();
      element<HTMLButtonElement>(host, '#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });

    expect(
      host.querySelector('[data-app-route="test-remote-room"]')
    ).not.toBeNull();
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
    const restored = runtime({ label: 'restored' });
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
    const { host, root } = await mount(dependencies);
    await act(async () => {
      element<HTMLButtonElement>(host, '#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });
    expect(host.textContent).toContain('source');
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
    expect(host.textContent).toContain('source');
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
    expect(host.textContent).toContain('restored');
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
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/retained.png',
    }));
    const dependencies: RemoteRoomLobbyDependencies = {
      createRoom: vi.fn(
        async () => created.value
      ) as unknown as RemoteRoomLobbyDependencies['createRoom'],
      createInvitationJoinCustody: () => invitations.shift()!,
      fallbackDisplayName: () => 'Froakie',
      requestBackground,
    };
    const { host, root } = await mount(dependencies);

    await openDeck(host);
    await act(async () =>
      element<HTMLButtonElement>(host, '#p2Button').click()
    );

    await act(async () =>
      element<HTMLButtonElement>(host, '#settingsButton').click()
    );
    await act(async () =>
      element<HTMLInputElement>(host, '#hideHandCheckbox').click()
    );
    await act(async () => {
      element<HTMLButtonElement>(host, '#changeBackgroundButton').click();
      await flush();
    });
    await act(async () =>
      element<HTMLButtonElement>(host, '#p2Button').click()
    );
    await act(async () => {
      element<HTMLButtonElement>(host, '#generateIdButton').click();
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });
    expect(host.querySelector('#testLeaveRoom')).not.toBeNull();

    const retainedPreferences: BoardPreferences = {
      reducedMotion: false,
      highContrast: false,
      darkMode: true,
      showZoneOutlines: false,
    };
    await act(async () =>
      roomRouteHarness.onPreferencesChange?.(retainedPreferences)
    );
    expect(roomRouteHarness.preferences).toEqual(retainedPreferences);
    expect(roomRouteHarness.hideOpponentHand).toBe(true);
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

    await act(async () =>
      element<HTMLButtonElement>(host, '#testLeaveRoom').click()
    );
    expect(
      host.querySelector('[data-app-route="remote-room-lobby"]')
    ).not.toBeNull();
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe('');
    expect(host.querySelector('.lobby-status')).toBeNull();
    expect(lobbyBoardHarness.preferences).toEqual(retainedPreferences);
    expect(element<HTMLInputElement>(host, '#darkModeCheckbox').checked).toBe(
      true
    );
    expect(element<HTMLInputElement>(host, '#showZonesCheckbox').checked).toBe(
      true
    );
    expect(element<HTMLInputElement>(host, '#hideHandCheckbox').checked).toBe(
      true
    );
    expect(
      element<HTMLElement>(host, '[data-app-route="remote-room-lobby"]').style
        .backgroundImage
    ).toBe('url("https://images.example.test/retained.png")');
    await openDeck(host);
    expect(
      element(host, '#nativeDeckBuilderSummaryPanel').textContent
    ).toContain('Total: 1');
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
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
    const { host, root } = await mount(dependencies);

    await act(async () => {
      paste(element(host, '#roomIdInput'), RAW_HANDOFF);
      await flush();
    });
    await act(async () => {
      element<HTMLButtonElement>(host, '#joinRoomButton').click();
      await flush();
    });
    await act(async () =>
      element<HTMLButtonElement>(host, '#testLeaveRoom').click()
    );

    expect(guest.dispose).toHaveBeenCalledOnce();
    expect(firstInvitation.dispose).toHaveBeenCalledOnce();
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe('');
    expect(
      element<HTMLInputElement>(host, '#spectatorModeCheckbox').disabled
    ).toBe(false);

    await act(async () => root.unmount());
    expect(guest.dispose).toHaveBeenCalledOnce();
    expect(secondInvitation.dispose).toHaveBeenCalledOnce();
  });
});
