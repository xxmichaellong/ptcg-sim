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
  type BrowserContinuationFileReader,
  type BrowserReplayFileReader,
  type RemoteRoomLivePresentation,
  type RemoteRoomLiveSession,
} from './RemoteRoomLiveControls.js';
import type { DeferredTextClipboardWriter } from './browser-invitation-clipboard.js';

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
    readonly onImportReplayFile?: (contents: Uint8Array) => Promise<boolean>;
    readonly onSaveOnlineGame?: (signal: AbortSignal) => Promise<void>;
    readonly onResumeSavedGame?: (
      contents: string,
      deliverOpponentInvitation: (text: string) => Promise<void>,
      signal: AbortSignal
    ) => Promise<void>;
    readonly confirmLeave?: () => boolean;
    readonly downloadTextFile?: (filename: string, contents: string) => boolean;
    readonly requestFullscreen?: () => boolean;
    readonly readReplayFile?: BrowserReplayFileReader;
    readonly readContinuationFile?: BrowserContinuationFileReader;
    readonly getInvitationClipboard?: () =>
      DeferredTextClipboardWriter | undefined;
    readonly reportReplayImportFailure?: () => void;
    readonly reportOnlineSaveFailure?: () => void;
    readonly reportSavedGameResumeFailure?: () => void;
    readonly reportSavedGameResumeSuccess?: () => void;
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
        {...(options.onImportReplayFile
          ? { onImportReplayFile: options.onImportReplayFile }
          : {})}
        {...(options.onSaveOnlineGame
          ? { onSaveOnlineGame: options.onSaveOnlineGame }
          : {})}
        {...(options.onResumeSavedGame
          ? { onResumeSavedGame: options.onResumeSavedGame }
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
        {...(options.readReplayFile
          ? { readReplayFile: options.readReplayFile }
          : {})}
        {...(options.readContinuationFile
          ? { readContinuationFile: options.readContinuationFile }
          : {})}
        {...(options.getInvitationClipboard
          ? { getInvitationClipboard: options.getInvitationClipboard }
          : {})}
        {...(options.reportReplayImportFailure
          ? { reportReplayImportFailure: options.reportReplayImportFailure }
          : {})}
        {...(options.reportOnlineSaveFailure
          ? { reportOnlineSaveFailure: options.reportOnlineSaveFailure }
          : {})}
        {...(options.reportSavedGameResumeFailure
          ? {
              reportSavedGameResumeFailure:
                options.reportSavedGameResumeFailure,
            }
          : {})}
        {...(options.reportSavedGameResumeSuccess
          ? {
              reportSavedGameResumeSuccess:
                options.reportSavedGameResumeSuccess,
            }
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
    // The line is attributed to the seat the sidebar is acting for.
    expect(session.sendChat).toHaveBeenCalledWith('hello room', 'spike-blue');
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
    expect(session.sendChat).toHaveBeenCalledWith('🌺', 'spike-blue');
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
    // A spectator has no seat to act for, so attribution stays theirs.
    expect(session.sendChat).toHaveBeenCalledWith(
      'spectator message',
      undefined
    );
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

  it('runs online save as one abortable player-only menu operation', async () => {
    const pending = Promise.withResolvers<void>();
    const onSaveOnlineGame = vi.fn(() => pending.promise);
    const reportOnlineSaveFailure = vi.fn();
    const { host, root } = await mount(new FakeLiveSession(), {
      onSaveOnlineGame,
      reportOnlineSaveFailure,
    });
    const options = element<HTMLButtonElement>(host, '#p2OptionsButton');
    await act(async () => options.click());
    const save = element<HTMLButtonElement>(host, '#saveOnlineGame');
    expect(save.textContent).toBe('Save online game');

    await act(async () => save.click());
    expect(onSaveOnlineGame).toHaveBeenCalledOnce();
    expect(onSaveOnlineGame.mock.calls[0]?.[0].aborted).toBe(false);
    expect(save.disabled).toBe(true);
    expect(element<HTMLElement>(host, '#optionsContextMenu').hidden).toBe(true);
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(reportOnlineSaveFailure).not.toHaveBeenCalled();

    await act(async () => options.click());
    onSaveOnlineGame.mockRejectedValueOnce(new Error('private failure'));
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    expect(reportOnlineSaveFailure).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it('reads a saved-game file and starts opponent clipboard custody synchronously', async () => {
    const order: string[] = [];
    let clipboardText: Promise<string> | undefined;
    const clipboard: DeferredTextClipboardWriter = {
      writeText: vi.fn((text) => {
        order.push('clipboard');
        clipboardText = text;
        return Promise.resolve();
      }),
    };
    const readContinuationFile = vi.fn(async () => {
      order.push('read');
      return { ok: true as const, text: 'opaque-save-file' };
    });
    const onResumeSavedGame = vi.fn(
      async (
        _contents: string,
        deliverOpponentInvitation: (text: string) => Promise<void>
      ) => deliverOpponentInvitation('opaque-opponent-invitation')
    );
    const reportSavedGameResumeFailure = vi.fn();
    const reportSavedGameResumeSuccess = vi.fn();
    const { host, root } = await mount(new FakeLiveSession(), {
      onResumeSavedGame,
      readContinuationFile,
      getInvitationClipboard: () => clipboard,
      reportSavedGameResumeFailure,
      reportSavedGameResumeSuccess,
    });
    const input = element<HTMLInputElement>(host, '#continuationSaveFile');
    expect(element(host, '#resumeSavedGame').textContent).toBe(
      'Resume saved game'
    );
    expect(input.accept).toBe('.ptcgsave');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['ignored'], 'game.ptcgsave')],
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(reportSavedGameResumeSuccess).toHaveBeenCalledOnce()
      );
    });
    expect(order).toEqual(['clipboard', 'read']);
    expect(readContinuationFile.mock.calls[0]?.[1]?.signal.aborted).toBe(false);
    expect(onResumeSavedGame).toHaveBeenCalledWith(
      'opaque-save-file',
      expect.any(Function),
      expect.any(AbortSignal)
    );
    await expect(clipboardText).resolves.toBe('opaque-opponent-invitation');
    expect(reportSavedGameResumeFailure).not.toHaveBeenCalled();
    expect(input.value).toBe('');

    await act(async () => root.unmount());
  });

  it('withholds continuation actions from solo players and spectators', async () => {
    const callbacks = {
      onSaveOnlineGame: vi.fn(async () => undefined),
      onResumeSavedGame: vi.fn(async () => undefined),
    };
    const solo = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
      ...callbacks,
    });
    expect(solo.host.querySelector('#saveOnlineGame')).toBeNull();
    expect(solo.host.querySelector('#resumeSavedGame')).toBeNull();
    await act(async () => solo.root.unmount());

    const spectatorState: ClientSessionState = {
      ...baseState(),
      role: 'spectator',
      playerId: undefined,
      view: { ...playerView, viewer: { kind: 'spectator' } },
    };
    const spectator = await mount(
      new FakeLiveSession(spectatorState),
      callbacks
    );
    expect(spectator.host.querySelector('#saveOnlineGame')).toBeNull();
    expect(spectator.host.querySelector('#resumeSavedGame')).toBeNull();
    await act(async () => spectator.root.unmount());
  });

  it('aborts a pending continuation read without restoring or reporting after teardown', async () => {
    const pending = Promise.withResolvers<{
      readonly ok: true;
      readonly text: string;
    }>();
    const readContinuationFile = vi.fn(() => pending.promise);
    const onResumeSavedGame = vi.fn(async () => undefined);
    const reportSavedGameResumeFailure = vi.fn();
    const clipboard: DeferredTextClipboardWriter = {
      writeText: vi.fn(async (text) => {
        await text.catch(() => undefined);
      }),
    };
    const { host, root } = await mount(new FakeLiveSession(), {
      onResumeSavedGame,
      readContinuationFile,
      getInvitationClipboard: () => clipboard,
      reportSavedGameResumeFailure,
    });
    const input = element<HTMLInputElement>(host, '#continuationSaveFile');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['ignored'], 'game.ptcgsave')],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true }))
    );
    const signal = readContinuationFile.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    pending.resolve({ ok: true, text: 'opaque-save-file' });
    await pending.promise;
    await Promise.resolve();
    expect(onResumeSavedGame).not.toHaveBeenCalled();
    expect(reportSavedGameResumeFailure).not.toHaveBeenCalled();
  });

  it('imports a bounded replay file only from the live Solo options row', async () => {
    const session = new FakeLiveSession();
    const bytes = Uint8Array.from([1, 2, 3]);
    const readPending = Promise.withResolvers<{
      readonly ok: true;
      readonly bytes: Uint8Array;
    }>();
    const importPending = Promise.withResolvers<boolean>();
    const readReplayFile = vi.fn(() => readPending.promise);
    const onImportReplayFile = vi.fn(() => importPending.promise);
    const reportReplayImportFailure = vi.fn();
    const { host, root } = await mount(session, {
      roomMode: 'solo',
      onImportReplayFile,
      readReplayFile,
      reportReplayImportFailure,
    });
    const options = element<HTMLButtonElement>(host, '#optionsButton');
    const menu = element<HTMLElement>(host, '#optionsContextMenu');
    const input = element<HTMLInputElement>(host, '#jsonReplay');
    const importButton = element<HTMLButtonElement>(host, '#importReplay');
    expect(importButton.textContent).toBe('Enter replay mode');
    expect(input.accept).toBe('.json');
    expect(input.hidden).toBe(true);

    await act(async () => options.click());
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['ignored'], 'replay.json')],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true }))
    );
    expect(readReplayFile).toHaveBeenCalledOnce();
    expect(readReplayFile.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(importButton.disabled).toBe(true);
    expect(menu.hidden).toBe(false);
    expect(input.value).toBe('');

    await act(async () => {
      readPending.resolve({ ok: true, bytes });
      await readPending.promise;
      await Promise.resolve();
    });
    expect(onImportReplayFile).toHaveBeenCalledWith(bytes);
    expect(importButton.disabled).toBe(true);
    await act(async () => {
      importPending.resolve(true);
      await importPending.promise;
      await Promise.resolve();
    });
    expect(menu.hidden).toBe(true);
    expect(reportReplayImportFailure).not.toHaveBeenCalled();

    await act(async () => options.click());
    readReplayFile.mockRejectedValueOnce(new Error('browser read failed'));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['ignored'], 'replay.json')],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onImportReplayFile).toHaveBeenCalledOnce();
    expect(reportReplayImportFailure).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(true);

    await act(async () => root.unmount());

    const multiplayer = await mount(new FakeLiveSession(), {
      onImportReplayFile,
    });
    expect(multiplayer.host.querySelector('#importReplay')).toBeNull();
    expect(multiplayer.host.querySelector('#jsonReplay')).toBeNull();
    await act(async () => multiplayer.root.unmount());
  });

  it('aborts a pending replay-file read on teardown', async () => {
    const pending = Promise.withResolvers<{
      readonly ok: true;
      readonly bytes: Uint8Array;
    }>();
    const readReplayFile = vi.fn(() => pending.promise);
    const onImportReplayFile = vi.fn(async () => true);
    const reportReplayImportFailure = vi.fn();
    const { host, root } = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
      onImportReplayFile,
      readReplayFile,
      reportReplayImportFailure,
    });
    const input = element<HTMLInputElement>(host, '#jsonReplay');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['ignored'], 'replay.json')],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true }))
    );
    const signal = readReplayFile.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    pending.resolve({ ok: true, bytes: Uint8Array.from([1]) });
    await pending.promise;
    await Promise.resolve();
    expect(onImportReplayFile).not.toHaveBeenCalled();
    expect(reportReplayImportFailure).not.toHaveBeenCalled();
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
