// @vitest-environment happy-dom

import type { ReplayPlaybackState } from '@ptcgsim/client-session';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplaySessionCoordinatorState } from './ReplaySessionCoordinator.js';
import {
  LEGACY_REPLAY_PRIVATE_MUTATION_ACTION_IDS,
  ReplayModeShell,
  selectReplayModeChrome,
  type ReplayModeShellCoordinator,
} from './ReplayModeShell.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const emptyPlayback: ReplayPlaybackState = { phase: 'empty', generation: 0 };

const coordinatorState = (
  generation: number,
  mode: ReplaySessionCoordinatorState['mode'] = 'live',
  requestPhase: ReplaySessionCoordinatorState['requestPhase'] = 'idle'
): ReplaySessionCoordinatorState => {
  if (mode === 'live') {
    return {
      generation,
      mode,
      requestPhase,
      sessionPhase: 'ready',
      canRequest: requestPhase === 'idle',
      canExit: requestPhase === 'loading',
      playback: emptyPlayback,
    };
  }

  const view = createRendererSpikeView();
  return {
    generation,
    mode,
    requestPhase,
    sessionPhase: 'ready',
    canRequest: true,
    canExit: true,
    liveRevision: view.revision + 10,
    view,
    playback: {
      phase: 'ready',
      generation,
      replayId: 'shell-replay',
      frameIndex: 0,
      frameCount: 1,
      startRevision: view.revision,
      endRevision: view.revision,
      truncated: view.revision > 0,
      view,
      atStart: true,
      atEnd: true,
      timelinePresentationEvents: [],
      enteredPresentationEvents: [],
    },
  };
};

class FakeShellCoordinator implements ReplayModeShellCoordinator {
  private state = coordinatorState(0);
  private readonly listeners = new Set<() => void>();
  readonly restart = vi.fn(() => true);
  readonly stepPrevious = vi.fn(() => true);
  readonly stepNext = vi.fn(() => true);
  readonly fastForward = vi.fn(() => true);
  readonly exitReplay = vi.fn(() => true);

  getSnapshot = (): ReplaySessionCoordinatorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(state: ReplaySessionCoordinatorState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe('ReplayModeShell', () => {
  beforeEach(() => document.body.replaceChildren());

  it('maps the exact legacy chrome states', () => {
    expect(selectReplayModeChrome(coordinatorState(0))).toEqual({
      active: false,
      primaryTabLabel: 'Solo',
      primaryTabWidth: '',
      settingsTabWidth: '',
      replayControls: false,
      visibility: {
        multiplayerTab: true,
        deckImport: true,
        chatActions: true,
        messageInput: true,
        exitReplay: false,
        replayImport: true,
        stateImport: true,
        stateExport: true,
        logExport: true,
        clearLog: true,
        turnAction: true,
        coinAction: true,
        privateMutationActions: true,
        optionsAction: true,
      },
      hiddenPrivateMutationActionIds: [],
    });

    const replayChrome = selectReplayModeChrome(coordinatorState(1, 'replay'));
    expect(replayChrome).toEqual({
      active: true,
      primaryTabLabel: 'Replay',
      primaryTabWidth: '50%',
      settingsTabWidth: '50%',
      replayControls: true,
      visibility: {
        multiplayerTab: false,
        deckImport: false,
        chatActions: false,
        messageInput: false,
        exitReplay: true,
        replayImport: false,
        stateImport: false,
        stateExport: true,
        logExport: true,
        clearLog: false,
        turnAction: false,
        coinAction: false,
        privateMutationActions: false,
        optionsAction: true,
      },
      hiddenPrivateMutationActionIds: LEGACY_REPLAY_PRIVATE_MUTATION_ACTION_IDS,
    });
    expect(
      selectReplayModeChrome(coordinatorState(2, 'live', 'loading'))
    ).toEqual(selectReplayModeChrome(coordinatorState(0)));
    expect(
      selectReplayModeChrome(coordinatorState(3, 'live', 'discarding'))
    ).toEqual(selectReplayModeChrome(coordinatorState(0)));
  });

  it('binds replay controls and exit without adding a DOM wrapper', async () => {
    const coordinator = new FakeShellCoordinator();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <ReplayModeShell coordinator={coordinator}>
          {({ chrome, controls, exitReplay }) => (
            <section
              data-active={String(chrome.active)}
              data-private-actions={String(
                chrome.visibility.privateMutationActions
              )}
            >
              <span id="primary-tab" style={{ width: chrome.primaryTabWidth }}>
                {chrome.primaryTabLabel}
              </span>
              <span
                id="settings-tab"
                style={{ width: chrome.settingsTabWidth }}
              />
              {chrome.visibility.multiplayerTab && <span id="multiplayer" />}
              {chrome.visibility.deckImport && <span id="deck-import" />}
              {chrome.visibility.chatActions && <span id="chat-actions" />}
              {chrome.visibility.messageInput && <span id="message-input" />}
              {chrome.visibility.replayImport && <span id="replay-import" />}
              {chrome.visibility.stateImport && <span id="state-import" />}
              {chrome.visibility.stateExport && <span id="state-export" />}
              {chrome.visibility.logExport && <span id="log-export" />}
              {chrome.visibility.clearLog && <span id="clear-log" />}
              {chrome.visibility.turnAction && <span id="turn-action" />}
              {chrome.visibility.coinAction && <span id="coin-action" />}
              {chrome.visibility.optionsAction && <span id="options-action" />}
              {chrome.visibility.exitReplay && (
                <button id="exit-replay" type="button" onClick={exitReplay} />
              )}
              {controls}
            </section>
          )}
        </ReplayModeShell>
      )
    );

    expect(coordinator.listenerCount()).toBe(1);
    expect(host.childElementCount).toBe(1);
    expect(host.querySelector('section')?.dataset.active).toBe('false');
    expect(host.querySelector('#primary-tab')?.textContent).toBe('Solo');
    expect(host.querySelector('#setupButton')).toBeNull();
    expect(host.querySelector('#exit-replay')).toBeNull();

    await act(async () =>
      coordinator.publish(coordinatorState(1, 'live', 'loading'))
    );
    expect(host.querySelector('#primary-tab')?.textContent).toBe('Solo');
    expect(host.querySelector('#setupButton')).toBeNull();

    await act(async () => coordinator.publish(coordinatorState(2, 'replay')));
    expect(host.querySelector('section')?.dataset.active).toBe('true');
    expect(host.querySelector('section')?.dataset.privateActions).toBe('false');
    expect(host.querySelector('#primary-tab')?.textContent).toBe('Replay');
    expect(
      (host.querySelector('#primary-tab') as HTMLElement).style.width
    ).toBe('50%');
    expect(
      (host.querySelector('#settings-tab') as HTMLElement).style.width
    ).toBe('50%');
    expect(host.querySelector('#multiplayer')).toBeNull();
    expect(host.querySelector('#deck-import')).toBeNull();
    expect(host.querySelector('#chat-actions')).toBeNull();
    expect(host.querySelector('#message-input')).toBeNull();
    expect(host.querySelector('#replay-import')).toBeNull();
    expect(host.querySelector('#state-import')).toBeNull();
    expect(host.querySelector('#state-export')).not.toBeNull();
    expect(host.querySelector('#log-export')).not.toBeNull();
    expect(host.querySelector('#clear-log')).toBeNull();
    expect(host.querySelector('#turn-action')).toBeNull();
    expect(host.querySelector('#coin-action')).toBeNull();
    expect(host.querySelector('#options-action')).not.toBeNull();

    for (const id of [
      'setupButton',
      'resetButton',
      'setupBothButton',
      'resetBothButton',
      'exit-replay',
    ]) {
      await act(async () =>
        (host.querySelector(`#${id}`) as HTMLButtonElement).click()
      );
    }
    expect(coordinator.restart).toHaveBeenCalledTimes(1);
    expect(coordinator.stepPrevious).toHaveBeenCalledTimes(1);
    expect(coordinator.stepNext).toHaveBeenCalledTimes(1);
    expect(coordinator.fastForward).toHaveBeenCalledTimes(1);
    expect(coordinator.exitReplay).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    expect(coordinator.listenerCount()).toBe(0);
  });
});
