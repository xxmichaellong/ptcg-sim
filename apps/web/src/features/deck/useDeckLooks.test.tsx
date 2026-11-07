// @vitest-environment happy-dom
import type {
  ClientSessionState,
  CompletedCommandSummary,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeckBuilderStore } from './deck-builder-store.js';
import { DeckLibrary } from './deck-library.js';
import type { DeckInstallSession } from './deck-install-adapter.js';
import { useDeckLooks } from './useDeckLooks.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Session implements DeckInstallSession {
  readonly commands: WireGameCommand[] = [];
  readonly listeners = new Set<() => void>();
  state: ClientSessionState = {
    phase: 'ready',
    role: 'player',
    view: createRendererSpikeView(),
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
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  emit = () => {
    for (const listener of [...this.listeners]) listener();
  };
  submit = (command: WireGameCommand): SubmitCommandResult => {
    const clientSequence = this.commands.length + 1,
      commandId = `look-${clientSequence}`;
    this.commands.push(command);
    this.state = {
      ...this.state,
      pendingCommands: [
        ...this.state.pendingCommands,
        {
          commandId,
          clientSequence,
          commandType: command.type,
          command,
          state: 'in_flight',
        },
      ],
    };
    this.emit();
    return { queued: true, commandId, clientSequence };
  };
  complete(type: WireGameCommand['type'], accepted: boolean) {
    const pending = this.state.pendingCommands.findLast(
      (entry) => entry.command.type === type
    )!;
    if (!pending) throw new Error('No matching pending command');
    const result: CompletedCommandSummary = {
      commandId: pending.commandId,
      clientSequence: pending.clientSequence,
      accepted,
      revision: this.state.view!.revision,
      ...(accepted ? {} : { code: 'rate_limited' as const }),
    };
    this.state = {
      ...this.state,
      pendingCommands: this.state.pendingCommands.filter(
        (entry) => entry.commandId !== pending.commandId
      ),
      completedCommands: [...this.state.completedCommands, result],
    };
    this.emit();
  }
}

const installInitially = () => true;
const fixture = async (target: 'main' | 'alternate' = 'main') => {
  const session = new Session(),
    store = new DeckBuilderStore();
  const library = new DeckLibrary({ backend: null, channel: null });
  const deck = library.create({
    name: 'Looks',
    format: 'standard',
    cards: [],
    playmat: 'style:ocean',
    coin: 'preset:crimson',
  });
  store.replaceDeck(target, [], { deckId: deck.id, name: deck.name });
  const host = document.createElement('div');
  document.body.append(host);
  let root = createRoot(host),
    force: ReturnType<typeof useDeckLooks>;
  const Harness = () => {
    force = useDeckLooks(
      session,
      store,
      library,
      target === 'alternate',
      installInitially
    );
    return null;
  };
  await act(async () => root.render(<Harness />));
  return {
    session,
    library,
    deck,
    force: (fields: readonly ('coin' | 'playmat')[]) => force!(target, fields),
    remount: async () => {
      await act(async () => root.unmount());
      root = createRoot(host);
      await act(async () => root.render(<Harness />));
    },
    dispose: async () => {
      await act(async () => root.unmount());
      library.dispose();
      host.remove();
    },
  };
};

it.each(['main', 'alternate'] as const)(
  'backs off repeated %s appearance refusals up to 30 seconds',
  async (target) => {
    vi.useFakeTimers();
    const f = await fixture(target),
      type = target === 'main' ? 'SetPlayerProfile' : 'SetCoin';
    const count = () =>
      f.session.commands.filter((command) => command.type === type).length;
    try {
      expect(count()).toBe(1);
      for (const delay of [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const before = count();
        await act(async () => f.session.complete(type, false));
        await act(async () => vi.advanceTimersByTimeAsync(delay - 1));
        expect(count()).toBe(before);
        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(count()).toBe(before + 1);
      }
    } finally {
      await f.dispose();
      vi.useRealTimers();
    }
  }
);

it('starts a changed look at 500ms and cancels the obsolete choice timer', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const count = () => f.session.commands.length;
  try {
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () =>
      f.library.update(f.deck.id, { playmat: 'style:frost' })
    );
    expect(count()).toBe(3);
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(count()).toBe(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(count()).toBe(4);
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(count()).toBe(4);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(count()).toBe(5);
  } finally {
    await f.dispose();
    vi.useRealTimers();
  }
});

it('preserves the same failed choice delay when its editor remounts', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  try {
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await f.remount();
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(f.session.commands).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(f.session.commands).toHaveLength(3);
  } finally {
    await f.dispose();
    vi.useRealTimers();
  }
});

it('resets backoff after success and an explicit reapplication', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  try {
    for (const delay of [500, 1000]) {
      await act(async () => f.session.complete('SetPlayerProfile', false));
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    }
    await act(async () => f.session.complete('SetPlayerProfile', true));
    await act(async () => f.force(['playmat']));
    const before = f.session.commands.length;
    await act(async () => f.session.complete('SetPlayerProfile', false));
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(f.session.commands).toHaveLength(before);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(f.session.commands).toHaveLength(before + 1);
  } finally {
    await f.dispose();
    vi.useRealTimers();
  }
});
