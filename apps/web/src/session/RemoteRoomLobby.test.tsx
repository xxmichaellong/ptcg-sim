// @vitest-environment happy-dom

import {
  createRendererSpikeView,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteRoomCreationResult } from './RemoteRoomCreation.js';
import {
  RemoteRoomLobby,
  type RemoteRoomLobbyDependencies,
} from './RemoteRoomLobby.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import type { RoomBackground } from './browser-room-background.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lobbyBoardHarness = vi.hoisted(() => ({
  preferences: undefined as BoardPreferences | undefined,
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
}));

vi.mock('../RendererSpikeBoard.js', () => ({
  RendererSpikeBoard: (props: { readonly preferences?: BoardPreferences }) => {
    lobbyBoardHarness.preferences = props.preferences;
    return <div data-testid="lobby-board" />;
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
  }: {
    readonly runtime: { readonly label?: string };
    readonly onLeave?: () => void;
    readonly preferences?: BoardPreferences;
    readonly onPreferencesChange?: (preferences: BoardPreferences) => void;
    readonly hideOpponentHand?: boolean;
    readonly onHideOpponentHandChange?: (hidden: boolean) => void;
    readonly background?: RoomBackground;
    readonly onBackgroundChange?: (background: RoomBackground) => void;
  }) => {
    roomRouteHarness.preferences = preferences;
    roomRouteHarness.onPreferencesChange = onPreferencesChange;
    roomRouteHarness.hideOpponentHand = hideOpponentHand ?? false;
    roomRouteHarness.onHideOpponentHandChange = onHideOpponentHandChange;
    roomRouteHarness.background = background;
    roomRouteHarness.onBackgroundChange = onBackgroundChange;
    return (
      <main data-app-route="test-remote-room">
        {runtime.label}
        {onLeave && (
          <button id="testLeaveRoom" type="button" onClick={onLeave}>
            Leave
          </button>
        )}
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

const creationResult = (roomRuntime = runtime({ label: 'creator' })) => {
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
    mode: 'multiplayer',
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
  requestBackground?: RemoteRoomLobbyDependencies['requestBackground']
): RemoteRoomLobbyDependencies => ({
  createRoom:
    createRoom as unknown as RemoteRoomLobbyDependencies['createRoom'],
  createInvitationJoinCustody: () => invitationCustody,
  fallbackDisplayName: () => 'Froakie',
  ...(requestBackground ? { requestBackground } : {}),
});

const mount = async (
  dependencies: RemoteRoomLobbyDependencies,
  strict = false
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const lobby = (
    <RemoteRoomLobby
      buildId="test-build"
      rendererKind="dom"
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
    expect(lobbyBoardHarness.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: true,
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
    ).toBe('true');
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
      darkMode: true,
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
    expect(host.textContent).toContain('Spectator invitation copied.');
    expect(host.innerHTML).not.toContain('secret-bearer');

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
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
    const { host, root } = await mount(
      lobbyDependencies(invitation, createRoom)
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

    await act(async () => root.unmount());
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(created.roomRuntime.listeners.size).toBe(0);
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

    await act(async () =>
      element<HTMLButtonElement>(host, '#testLeaveRoom').click()
    );
    expect(
      host.querySelector('[data-app-route="remote-room-lobby"]')
    ).not.toBeNull();
    expect(element<HTMLInputElement>(host, '#roomIdInput').value).toBe('');
    expect(host.textContent).toContain('Left room.');
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
