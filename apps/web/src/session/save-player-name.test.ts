import type {
  ClientSessionState,
  SubmitCommandResult,
  CommandFailureCode,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { beforeEach, expect, it, vi } from 'vitest';
import { toast } from '../ui/toast.js';
import { savePlayerName } from './save-player-name.js';
vi.mock('../ui/toast.js', () => ({ toast: vi.fn() }));
const base = createRendererSpikeView(),
  own = base.playerOrder[0]!;
class Session {
  state: ClientSessionState = {
    phase: 'ready',
    role: 'player',
    playerId: own,
    roomMode: 'multiplayer',
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
  full = false;
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
    if (this.full) return { queued: false, reason: 'queue_full' };
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
  complete = (accepted: boolean, code?: CommandFailureCode) => {
    const pending = this.state.pendingCommands[0]!;
    const view = this.state.view!;
    const target =
      pending.command.type === 'SetPlayerProfile'
        ? (pending.command.targetPlayerId ?? own)
        : own;
    this.publish({
      view: {
        ...view,
        revision: view.revision + 1,
        players:
          accepted && pending.command.type === 'SetPlayerProfile'
            ? {
                ...view.players,
                [target]: {
                  ...view.players[target]!,
                  displayName: pending.command.displayName!,
                },
              }
            : view.players,
      },
      pendingCommands: this.state.pendingCommands.slice(1),
      completedCommands: [
        ...this.state.completedCommands,
        {
          commandId: pending.commandId,
          clientSequence: pending.clientSequence,
          accepted,
          revision: view.revision + 1,
          ...(code ? { code } : {}),
        },
      ],
    });
  };
}
beforeEach(() => vi.clearAllMocks());
it('waits for acceptance and shares the same in-flight name request', async () => {
  const session = new Session();
  const result = savePlayerName(session, own, 'Wanted');
  expect(savePlayerName(session, own, 'Wanted')).toBe(result);
  expect(session.commands).toHaveLength(1);
  session.complete(true);
  expect(await result).toBe(true);
  expect(session.listeners.size).toBe(0);
  expect(toast).not.toHaveBeenCalled();
});
it('retries a stale name against the updated publication', async () => {
  const session = new Session(),
    result = savePlayerName(session, own, 'Wanted');
  session.complete(false, 'stale_reference');
  await Promise.resolve();
  expect(session.commands).toHaveLength(2);
  session.complete(true);
  expect(await result).toBe(true);
  expect(session.listeners.size).toBe(0);
  expect(toast).not.toHaveBeenCalled();
});
it('bounds stale retries, reports failure and allows a fresh retry of the same name', async () => {
  const session = new Session(),
    result = savePlayerName(session, own, 'Wanted');
  for (let index = 0; index < 3; index += 1) {
    session.complete(false, 'stale_reference');
    await Promise.resolve();
  }
  expect(await result).toBe(false);
  expect(session.commands).toHaveLength(3);
  expect(toast).toHaveBeenCalledTimes(1);
  const retry = savePlayerName(session, own, 'Wanted');
  session.complete(true);
  expect(await retry).toBe(true);
  expect(session.listeners.size).toBe(0);
});
it('does not retry a permanent refusal and leaves later saves available', async () => {
  const session = new Session(),
    result = savePlayerName(session, own, 'Wanted');
  session.complete(false, 'unauthorized');
  expect(await result).toBe(false);
  expect(session.commands).toHaveLength(1);
  expect(toast).toHaveBeenCalledTimes(1);
  const retry = savePlayerName(session, own, 'Wanted');
  session.complete(true);
  expect(await retry).toBe(true);
});
it('does not let a superseded name retry over a newer name', async () => {
  const session = new Session(),
    old = savePlayerName(session, own, 'Old'),
    latest = savePlayerName(session, own, 'Latest');
  session.complete(false, 'stale_reference');
  await Promise.resolve();
  expect(await old).toBe(false);
  expect(session.commands).toHaveLength(2);
  session.complete(true);
  expect(await latest).toBe(true);
  expect(session.state.view!.players[own]!.displayName).toBe('Latest');
  expect(toast).not.toHaveBeenCalled();
  expect(session.listeners.size).toBe(0);
});
it('reports unqueued saves and does not block retrying them', async () => {
  const session = new Session();
  session.full = true;
  expect(await savePlayerName(session, own, 'Wanted')).toBe(false);
  expect(toast).toHaveBeenCalledTimes(1);
  session.full = false;
  const retry = savePlayerName(session, own, 'Wanted');
  session.complete(true);
  expect(await retry).toBe(true);
});
it('skips unchanged names but queues a revert behind a different pending change', async () => {
  const session = new Session(),
    original = base.players[own]!.displayName;
  expect(await savePlayerName(session, own, original)).toBe(true);
  expect(session.commands).toHaveLength(0);
  session.submit({
    type: 'SetPlayerProfile',
    targetPlayerId: own,
    displayName: 'Older pending',
  });
  const revert = savePlayerName(session, own, original);
  expect(session.commands).toHaveLength(2);
  session.complete(true);
  session.complete(true);
  expect(await revert).toBe(true);
  expect(session.state.view!.players[own]!.displayName).toBe(original);
});
it('keeps a command through reconnect and releases its listener on completion', async () => {
  const session = new Session(),
    result = savePlayerName(session, own, 'Wanted');
  session.publish({ phase: 'reconnecting' });
  expect(session.listeners.size).toBe(1);
  session.publish({ phase: 'ready' });
  session.complete(true);
  expect(await result).toBe(true);
  expect(session.listeners.size).toBe(0);
});
it('cancels an old room or closed session without a stray failure notice', async () => {
  for (const close of [false, true]) {
    const session = new Session(),
      result = savePlayerName(session, own, 'Wanted');
    session.publish(
      close
        ? { phase: 'closed' }
        : { view: { ...base, matchId: 'another-match' as typeof base.matchId } }
    );
    const fresh = close ? undefined : savePlayerName(session, own, 'Wanted');
    expect(await result).toBe(false);
    if (fresh) {
      expect(session.commands).toHaveLength(2);
      session.complete(false, 'stale_reference');
      session.complete(true);
      expect(await fresh).toBe(true);
    }
    expect(session.listeners.size).toBe(0);
  }
  expect(toast).not.toHaveBeenCalled();
});
it('checks current seat permissions and allows both Solo names', async () => {
  const session = new Session(),
    other = base.playerOrder[1]!;
  expect(await savePlayerName(session, other, 'Other')).toBe(false);
  expect(session.commands).toHaveLength(0);
  session.publish({ roomMode: 'solo' });
  const result = savePlayerName(session, other, 'Other');
  session.complete(true);
  expect(await result).toBe(true);
});
