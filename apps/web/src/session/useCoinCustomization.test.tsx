// @vitest-environment happy-dom
import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COIN_PREFERENCES } from '../card-backs/coin-preferences.js';
import { preferences } from '../preferences/preference-store.js';
import { setDeckCoinSelection } from './deck-coin-selection.js';
import { useCoinCustomization } from './useCoinCustomization.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = createRendererSpikeView();
const own =
  base.viewer.kind === 'player' ? base.viewer.playerId : base.playerOrder[0]!;
class Session {
  state: ClientSessionState = {
    phase: 'ready',
    role: 'player',
    playerId: own,
    view: base,
    nextClientSequence: 1,
    pendingCommands: [],
    completedCommands: [],
    presentationEvents: [],
    chatMessages: [],
    presence: [],
    notices: [],
    replayLoading: false,
    reconnectAttempt: 0,
  };
  listeners = new Set<() => void>();
  commands: WireGameCommand[] = [];
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish = (patch: Partial<ClientSessionState>) => {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  };
  submit = (command: WireGameCommand): SubmitCommandResult => {
    this.commands.push(command);
    const id = String(this.commands.length);
    this.publish({
      pendingCommands: [
        ...this.state.pendingCommands,
        {
          commandId: id,
          clientSequence: this.commands.length,
          commandType: command.type,
          command,
          state: 'in_flight',
        },
      ],
    });
    return {
      queued: true,
      commandId: id,
      clientSequence: this.commands.length,
    };
  };
  reject(code: 'stale_reference' | 'unauthorized' = 'stale_reference') {
    const pending = this.state.pendingCommands.at(-1)!;
    this.publish({
      view: { ...base, revision: base.revision + 1 },
      pendingCommands: [],
      completedCommands: [
        {
          commandId: pending.commandId,
          clientSequence: pending.clientSequence,
          accepted: false,
          revision: base.revision + 1,
          code,
        },
      ],
    });
  }
}
let root: Root;
let host: HTMLDivElement;
const Harness = ({ session }: { session: Session }) => {
  useCoinCustomization(session);
  return null;
};
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  preferences().set(COIN_PREFERENCES, { coin: 'preset:crimson' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  preferences().reset(COIN_PREFERENCES);
  vi.useRealTimers();
});
const mount = async (session: Session) => {
  await act(async () => root.render(<Harness session={session} />));
};
it('retries a refused coin sync and never submits twice while its retry is pending', async () => {
  const session = new Session();
  await mount(session);
  expect(session.commands).toHaveLength(1);
  await act(async () => session.reject());
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(session.commands).toHaveLength(2);
  await act(async () => session.publish({ latencyMs: 50 }));
  expect(session.commands).toHaveLength(2);
});
it('keeps the latest preference last when earlier coin commands are still pending', async () => {
  const session = new Session();
  await mount(session);
  await act(async () =>
    preferences().set(COIN_PREFERENCES, { coin: 'preset:azure' })
  );
  await act(async () =>
    preferences().set(COIN_PREFERENCES, { coin: 'preset:crimson' })
  );
  expect(session.commands).toEqual([
    { type: 'SetCoin', targetPlayerId: own, coin: 'preset:crimson' },
    { type: 'SetCoin', targetPlayerId: own, coin: 'preset:azure' },
    { type: 'SetCoin', targetPlayerId: own, coin: 'preset:crimson' },
  ]);
});
it('does not loop on a permanent refusal', async () => {
  const session = new Session();
  await mount(session);
  await act(async () => session.reject('unauthorized'));
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(session.commands).toHaveLength(1);
});

it('cancels a refused retry when its board leaves', async () => {
  const session = new Session();
  await mount(session);
  await act(async () => session.reject());
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(session.commands).toHaveLength(1);
});
it('synchronizes a newly attached ready session even if it resumes the same match', async () => {
  const first = new Session();
  await mount(first);
  const resumed = new Session();
  await mount(resumed);
  expect(resumed.commands).toHaveLength(1);
});

it.each([
  'already present',
  'accepted during this mount',
  'reconnected',
] as const)('respects Undo when the coin was %s', async (how) => {
  const session = new Session();
  const matching = {
    ...base,
    players: {
      ...base.players,
      [own]: { ...base.players[own]!, coin: 'preset:crimson' },
    },
  };
  if (how === 'already present')
    session.state = { ...session.state, view: matching };
  if (how === 'reconnected')
    session.state = { ...session.state, phase: 'reconnecting' };
  await mount(session);
  if (how === 'accepted during this mount') {
    const pending = session.state.pendingCommands[0]!;
    await act(async () =>
      session.publish({
        view: matching,
        pendingCommands: [],
        completedCommands: [
          {
            commandId: pending.commandId,
            clientSequence: pending.clientSequence,
            accepted: true,
            revision: base.revision,
          },
        ],
      })
    );
  } else if (how === 'reconnected') {
    await act(async () => session.publish({ phase: 'ready', view: matching }));
  }
  const count = session.commands.length;
  await act(async () =>
    session.publish({ view: { ...base, revision: base.revision + 1 } })
  );
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(session.commands).toHaveLength(count);
  await act(async () =>
    preferences().set(COIN_PREFERENCES, { coin: 'preset:azure' })
  );
  expect(session.commands).toHaveLength(count + 1);
  expect(session.commands.at(-1)).toMatchObject({
    type: 'SetCoin',
    coin: 'preset:azure',
  });
});

it('reapplies an unchanged deck coin explicitly after Undo, without duplicating an already worn choice', async () => {
  const session = new Session();
  const matching = {
    ...base,
    players: {
      ...base.players,
      [own]: { ...base.players[own]!, coin: 'preset:violet' },
    },
  };
  session.state = { ...session.state, view: matching };
  setDeckCoinSelection(session, 'preset:violet');
  await mount(session);
  expect(session.commands).toHaveLength(0);
  await act(async () => session.publish({ view: base }));
  expect(session.commands).toHaveLength(0);
  await act(async () => setDeckCoinSelection(session, 'preset:violet', true));
  expect(session.commands).toHaveLength(1);
  expect(session.commands[0]).toMatchObject({ coin: 'preset:violet' });
  await act(async () =>
    session.publish({ view: matching, pendingCommands: [] })
  );
  await act(async () => setDeckCoinSelection(session, 'preset:violet', true));
  expect(session.commands).toHaveLength(1);
});

it('keeps an accepted deck coin through Undo and a board remount, but honors an explicit repeat choice', async () => {
  const session = new Session();
  setDeckCoinSelection(session, 'preset:violet');
  await mount(session);
  const pending = session.state.pendingCommands.at(-1)!;
  await act(async () =>
    session.publish({
      pendingCommands: [],
      completedCommands: [
        {
          commandId: pending.commandId,
          clientSequence: pending.clientSequence,
          accepted: true,
          revision: base.revision + 1,
        },
      ],
      view: { ...base, revision: base.revision + 1 },
    })
  );
  await act(async () => session.publish({ phase: 'connecting' }));
  await act(async () => session.publish({ phase: 'ready' }));
  expect(session.commands).toHaveLength(1);
  await act(async () => root.render(null));
  await mount(session);
  expect(session.commands).toHaveLength(1);
  await act(async () => setDeckCoinSelection(session, 'preset:violet', true));
  expect(session.commands).toHaveLength(2);
});
