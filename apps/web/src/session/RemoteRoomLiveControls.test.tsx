// @vitest-environment happy-dom

import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RemoteRoomLiveControls,
  type RemoteRoomLivePresentation,
  type RemoteRoomLiveSession,
} from './RemoteRoomLiveControls.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const playerView = createRendererSpikeView();
const playerId =
  playerView.viewer.kind === 'player' ? playerView.viewer.playerId : '';

const baseState = (): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId,
  view: playerView,
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents: [],
  chatMessages: [],
  presence: [],
  notices: [],
  replayLoading: false,
  reconnectAttempt: 0,
});

class FakeLiveSession implements RemoteRoomLiveSession {
  private state: ClientSessionState;
  private readonly listeners = new Set<() => void>();
  private nextCommand = 1;
  readonly sendChat = vi.fn((_message: string) => true);
  readonly submit = vi.fn((_command: WireGameCommand): SubmitCommandResult => {
    const ordinal = this.nextCommand++;
    return {
      queued: true,
      commandId: `live-command-${ordinal}`,
      clientSequence: ordinal,
    };
  });

  constructor(state: ClientSessionState = baseState()) {
    this.state = state;
  }

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  listenerCount(): number {
    return this.listeners.size;
  }

  setState(state: ClientSessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const livePresentation = (messages: readonly string[] = []) => {
  const items = messages.map((message, index) => ({
    id: index + 1,
    revision: 1,
    eventType: 'ChatMessage' as const,
    category: 'message' as const,
    message,
  }));
  const clearActivity = vi.fn(() => items.length > 0);
  const value: RemoteRoomLivePresentation = {
    activityFeed: {
      subscribe: () => () => undefined,
      getSnapshot: () => ({
        items,
        newestItemId: items.at(-1)?.id ?? null,
      }),
    },
    clearActivity,
  };
  return { value, clearActivity };
};

const mount = async (
  session: FakeLiveSession,
  options: {
    readonly presentation?: RemoteRoomLivePresentation;
    readonly roomMode?: 'solo' | 'multiplayer';
    readonly onLeave?: () => void;
    readonly onExportState?: () => void;
    readonly confirmLeave?: () => boolean;
    readonly downloadTextFile?: (filename: string, contents: string) => boolean;
    readonly requestFullscreen?: () => boolean;
  } = {}
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <RemoteRoomLiveControls
        session={session}
        presentation={options.presentation ?? livePresentation().value}
        {...(options.roomMode ? { roomMode: options.roomMode } : {})}
        {...(options.onLeave ? { onLeave: options.onLeave } : {})}
        {...(options.onExportState
          ? { onExportState: options.onExportState }
          : {})}
        {...(options.confirmLeave
          ? { confirmLeave: options.confirmLeave }
          : {})}
        {...(options.downloadTextFile
          ? { downloadTextFile: options.downloadTextFile }
          : {})}
        {...(options.requestFullscreen
          ? { requestFullscreen: options.requestFullscreen }
          : {})}
      />
    )
  );
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

const inputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressEnter = (
  input: HTMLInputElement,
  composing = false
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  if (composing) {
    Object.defineProperty(event, 'isComposing', { value: true });
  }
  input.dispatchEvent(event);
  return event;
};

describe('RemoteRoomLiveControls', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('maps the legacy player controls to authenticated chat and atomic commands', async () => {
    const session = new FakeLiveSession();
    const { host, root } = await mount(session);

    for (const id of [
      'p2AttackButton',
      'p2PassButton',
      'p2FREEBUTTON',
      'p2MessageInput',
      'p2SetupButton',
      'p2ResetButton',
    ]) {
      expect(host.querySelector(`#${id}`), id).not.toBeNull();
    }

    const message = element<HTMLInputElement>(host, '#p2MessageInput');
    let enter!: KeyboardEvent;
    await act(async () => {
      inputValue(message, '  hello room  ');
      enter = pressEnter(message);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(session.sendChat).toHaveBeenCalledWith('hello room');
    expect(message.value).toBe('');

    await act(async () => {
      inputValue(message, 'still composing');
      pressEnter(message, true);
    });
    expect(session.sendChat).not.toHaveBeenCalledWith('still composing');
    expect(message.value).toBe('still composing');

    session.sendChat.mockReturnValueOnce(false);
    await act(async () => {
      inputValue(message, 'retry me');
      pressEnter(message);
    });
    expect(message.value).toBe('retry me');

    await act(async () => {
      element<HTMLButtonElement>(host, '#p2FREEBUTTON').click();
      element<HTMLButtonElement>(host, '#p2AttackButton').click();
      element<HTMLButtonElement>(host, '#p2PassButton').click();
      element<HTMLButtonElement>(host, '#p2SetupButton').click();
      element<HTMLButtonElement>(host, '#p2ResetButton').click();
    });
    expect(session.sendChat).toHaveBeenCalledWith('🌺');
    expect(session.submit.mock.calls.map(([command]) => command)).toEqual([
      { type: 'DeclareAttack', targetPlayerId: playerId },
      { type: 'PassTurn', targetPlayerId: playerId },
      { type: 'SetupPlayer', targetPlayerId: playerId },
      { type: 'ResetPlayer', targetPlayerId: playerId },
    ]);

    await act(async () => root.unmount());
    expect(session.listenerCount()).toBe(0);
  });

  it('preserves the solo control IDs and targets both authority players explicitly', async () => {
    const session = new FakeLiveSession();
    const onLeave = vi.fn();
    const { host, root } = await mount(session, {
      roomMode: 'solo',
      onLeave,
    });
    const otherPlayerId = playerView.playerOrder.find(
      (candidate) => candidate !== playerId
    )!;

    for (const id of [
      'chatboxButtonContainer',
      'attackButton',
      'passButton',
      'undoButton',
      'FREEBUTTON',
      'messageInput',
      'bottomP1ButtonContainer',
      'setupButton',
      'resetButton',
      'setupBothButton',
      'resetBothButton',
      'optionsButton',
    ]) {
      expect(host.querySelector(`#${id}`), id).not.toBeNull();
    }
    for (const id of [
      'p2ChatboxButtonContainer',
      'p2AttackButton',
      'p2MessageInput',
      'p2BottomButtonContainer',
      'leaveRoomButton',
    ]) {
      expect(host.querySelector(`#${id}`), id).toBeNull();
    }

    await act(async () => {
      element<HTMLButtonElement>(host, '#attackButton').click();
      element<HTMLButtonElement>(host, '#passButton').click();
      element<HTMLButtonElement>(host, '#undoButton').click();
      element<HTMLButtonElement>(host, '#setupButton').click();
      element<HTMLButtonElement>(host, '#resetButton').click();
      element<HTMLButtonElement>(host, '#setupBothButton').click();
    });
    expect(element<HTMLButtonElement>(host, '#setupBothButton').disabled).toBe(
      true
    );
    expect(element<HTMLButtonElement>(host, '#resetBothButton').disabled).toBe(
      true
    );
    const setupBothSubmission = session.submit.mock.results.at(-1)!
      .value as Extract<SubmitCommandResult, { readonly queued: true }>;
    await act(async () => {
      const current = session.getSnapshot();
      session.setState({
        ...current,
        view: { ...current.view!, revision: current.view!.revision + 1 },
        completedCommands: [
          ...current.completedCommands,
          {
            commandId: setupBothSubmission.commandId,
            clientSequence: setupBothSubmission.clientSequence,
            accepted: true,
            revision: current.view!.revision + 1,
          },
        ],
      });
    });
    expect(element<HTMLButtonElement>(host, '#setupBothButton').disabled).toBe(
      false
    );
    await act(async () =>
      element<HTMLButtonElement>(host, '#resetBothButton').click()
    );
    const resetBothSubmission = session.submit.mock.results.at(-1)!
      .value as Extract<SubmitCommandResult, { readonly queued: true }>;
    await act(async () => {
      const current = session.getSnapshot();
      session.setState({
        ...current,
        view: { ...current.view!, revision: current.view!.revision + 1 },
        completedCommands: [
          ...current.completedCommands,
          {
            commandId: resetBothSubmission.commandId,
            clientSequence: resetBothSubmission.clientSequence,
            accepted: true,
            revision: current.view!.revision + 1,
          },
        ],
      });
    });

    expect(session.submit.mock.calls.map(([command]) => command)).toEqual([
      { type: 'DeclareAttack', targetPlayerId: playerId },
      { type: 'PassTurn', targetPlayerId: playerId },
      { type: 'ApplySoloUndo', targetPlayerId: playerId },
      { type: 'SetupPlayer', targetPlayerId: playerId },
      { type: 'ResetPlayer', targetPlayerId: playerId },
      { type: 'SetupPlayer', targetPlayerId: playerId },
      { type: 'SetupPlayer', targetPlayerId: otherPlayerId },
      { type: 'ResetPlayer', targetPlayerId: playerId },
      { type: 'ResetPlayer', targetPlayerId: otherPlayerId },
    ]);
    expect(onLeave).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(session.listenerCount()).toBe(0);
  });

  it('does not submit the second solo lifecycle command when the first is rejected', async () => {
    const session = new FakeLiveSession();
    const { host, root } = await mount(session, { roomMode: 'solo' });

    await act(async () =>
      element<HTMLButtonElement>(host, '#setupBothButton').click()
    );
    const firstSubmission = session.submit.mock.results[0]!.value as Extract<
      SubmitCommandResult,
      { readonly queued: true }
    >;
    await act(async () => {
      const current = session.getSnapshot();
      session.setState({
        ...current,
        completedCommands: [
          {
            commandId: firstSubmission.commandId,
            clientSequence: firstSubmission.clientSequence,
            accepted: false,
            revision: current.view!.revision,
            code: 'precondition_failed',
          },
        ],
      });
    });

    expect(session.submit).toHaveBeenCalledOnce();
    expect(element<HTMLButtonElement>(host, '#setupBothButton').disabled).toBe(
      false
    );
    await act(async () => root.unmount());
  });

  it('retains chat for spectators while withholding player-only mutations', async () => {
    const session = new FakeLiveSession({
      ...baseState(),
      role: 'spectator',
      playerId: undefined,
      view: { ...playerView, viewer: { kind: 'spectator' } },
    });
    const onLeave = vi.fn();
    const confirmLeave = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { host, root } = await mount(session, { onLeave, confirmLeave });

    for (const id of [
      'p2AttackButton',
      'p2PassButton',
      'p2SetupButton',
      'p2ResetButton',
    ]) {
      expect(host.querySelector(`#${id}`), id).toBeNull();
    }
    expect(element(host, '#p2FREEBUTTON').className).toBe('spectator-color');

    await act(async () => {
      const message = element<HTMLInputElement>(host, '#p2MessageInput');
      inputValue(message, 'spectator message');
      pressEnter(message);
      element<HTMLButtonElement>(host, '#leaveRoomButton').click();
    });
    expect(session.sendChat).toHaveBeenCalledWith('spectator message');
    expect(onLeave).not.toHaveBeenCalled();

    await act(async () =>
      element<HTMLButtonElement>(host, '#leaveRoomButton').click()
    );
    expect(confirmLeave).toHaveBeenCalledTimes(2);
    expect(onLeave).toHaveBeenCalledOnce();
    expect(session.submit).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('provides local battle-log and fullscreen options without canonical commands', async () => {
    const session = new FakeLiveSession();
    const presentation = livePresentation(['  Blue attacked  ', 'Red: hi']);
    const downloadTextFile = vi.fn(() => true);
    const requestFullscreen = vi.fn(() => true);
    const onExportState = vi.fn();
    const { host, root } = await mount(session, {
      presentation: presentation.value,
      onExportState,
      downloadTextFile,
      requestFullscreen,
    });
    const options = element<HTMLButtonElement>(host, '#p2OptionsButton');
    const menu = element<HTMLElement>(host, '#optionsContextMenu');

    await act(async () => options.click());
    expect(menu.hidden).toBe(false);
    expect(options.getAttribute('aria-expanded')).toBe('true');
    await act(async () =>
      element<HTMLButtonElement>(host, '#exportState').click()
    );
    expect(onExportState).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(true);

    await act(async () => options.click());
    await act(async () =>
      element<HTMLButtonElement>(host, '#exportLog').click()
    );
    expect(downloadTextFile).toHaveBeenCalledWith(
      'battle-log.txt',
      '1: Blue attacked\n\n2: Red: hi\n\n'
    );
    expect(menu.hidden).toBe(true);

    await act(async () => {
      options.click();
      element<HTMLButtonElement>(host, '#clearLog').click();
    });
    expect(presentation.clearActivity).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(true);

    await act(async () => {
      options.click();
      element<HTMLButtonElement>(host, '#fullscreenButton').click();
    });
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.sendChat).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('dismisses an open options menu outside and releases its document listener', async () => {
    const session = new FakeLiveSession();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { host, root } = await mount(session);

    await act(async () =>
      element<HTMLButtonElement>(host, '#p2OptionsButton').click()
    );
    expect(element<HTMLElement>(host, '#optionsContextMenu').hidden).toBe(
      false
    );
    await act(async () =>
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      )
    );
    expect(element<HTMLElement>(host, '#optionsContextMenu').hidden).toBe(true);
    expect(add.mock.calls.some(([type]) => type === 'mousedown')).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === 'mousedown')).toBe(true);

    await act(async () => root.unmount());
    add.mockRestore();
    remove.mockRestore();
  });

  it('disables all shared send controls until the session is ready', async () => {
    const session = new FakeLiveSession({
      ...baseState(),
      phase: 'connecting',
      role: undefined,
      playerId: undefined,
      view: undefined,
    });
    const { host, root } = await mount(session, {
      onExportState: vi.fn(),
    });

    expect(element<HTMLButtonElement>(host, '#p2FREEBUTTON').disabled).toBe(
      true
    );
    expect(element<HTMLInputElement>(host, '#p2MessageInput').disabled).toBe(
      true
    );
    expect(element<HTMLButtonElement>(host, '#exportState').disabled).toBe(
      true
    );
    expect(host.querySelector('#p2AttackButton')).toBeNull();
    expect(host.querySelector('#p2SetupButton')).toBeNull();

    await act(async () => root.unmount());
  });
});
