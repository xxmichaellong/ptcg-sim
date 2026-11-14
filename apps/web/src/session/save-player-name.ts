import type {
  ClientSessionState,
  RemoteGameSession,
} from '@ptcgsim/client-session';
import { refusalNotice, unsentNotice } from '../board/refusal-notice.js';
import { toast } from '../ui/toast.js';

type NameSession = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe' | 'submit'
>;
type Completion = ClientSessionState['completedCommands'][number];
interface Attempt {
  readonly name: string;
  readonly matchId: string | undefined;
  readonly controller: AbortController;
  readonly result: Promise<boolean>;
}
const attempts = new WeakMap<object, Map<string, Attempt>>();
const terminal = (state: ClientSessionState): boolean =>
  state.phase === 'closed' ||
  state.phase === 'failed' ||
  state.phase === 'superseded';

const waitForOutcome = (
  session: NameSession,
  commandId: string,
  matchId: string,
  signal: AbortSignal
): Promise<Completion | undefined> =>
  new Promise((resolve) => {
    let unsubscribe = () => {},
      settled = false;
    const finish = (result?: Completion) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      unsubscribe();
      resolve(result);
    };
    const aborted = () => finish();
    const inspect = () => {
      const state = session.getSnapshot();
      if (
        signal.aborted ||
        terminal(state) ||
        (state.view && state.view.matchId !== matchId)
      ) {
        finish();
        return;
      }
      const result = state.completedCommands.find(
        (entry) => entry.commandId === commandId
      );
      if (result) finish(result);
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    unsubscribe = session.subscribe(inspect);
    if (settled) unsubscribe();
    else inspect();
  });

/** A committed edit follows its outcome, and only the newest edit may retry. */
export const savePlayerName = (
  session: NameSession,
  playerId: string,
  name: string
): Promise<boolean> => {
  let seats = attempts.get(session);
  if (!seats) {
    seats = new Map();
    attempts.set(session, seats);
  }
  const matchId = session.getSnapshot().view?.matchId;
  const previous = seats.get(playerId);
  if (previous?.name === name && previous.matchId === matchId)
    return previous.result;
  previous?.controller.abort();
  const controller = new AbortController();
  let resolve!: (accepted: boolean) => void;
  const result = new Promise<boolean>((done) => {
    resolve = done;
  });
  const attempt = { name, matchId, controller, result };
  seats.set(playerId, attempt);
  const run = async (): Promise<boolean> => {
    for (let index = 0; index < 3; index += 1) {
      const state = session.getSnapshot(),
        view = state.view;
      if (
        controller.signal.aborted ||
        terminal(state) ||
        !view ||
        view.matchId !== matchId ||
        !view.players[playerId]
      )
        return false;
      if (state.phase !== 'ready') {
        const notice = unsentNotice('not_ready', 'SetPlayerProfile');
        if (notice) toast(notice);
        return false;
      }
      if (
        view.viewer.kind !== 'player' ||
        (view.viewer.playerId !== playerId && state.roomMode !== 'solo')
      ) {
        toast(refusalNotice('unauthorized', 'SetPlayerProfile'));
        return false;
      }
      const viewerId = view.viewer.playerId;
      const changing = state.pendingCommands.some(
        ({ command }) =>
          command.type === 'SetPlayerProfile' &&
          (command.targetPlayerId ?? viewerId) === playerId &&
          command.displayName !== undefined &&
          command.displayName !== name
      );
      if (view.players[playerId]!.displayName === name && !changing)
        return true;
      const submitted = session.submit({
        type: 'SetPlayerProfile',
        targetPlayerId: playerId,
        displayName: name,
      });
      if (!submitted.queued) {
        const notice = unsentNotice(submitted.reason, 'SetPlayerProfile');
        if (notice) toast(notice);
        return false;
      }
      const completed = await waitForOutcome(
        session,
        submitted.commandId,
        view.matchId,
        controller.signal
      );
      if (!completed || controller.signal.aborted) return false;
      if (completed.accepted) return true;
      if (completed.code === 'stale_reference' && index < 2) continue;
      toast(refusalNotice(completed.code, 'SetPlayerProfile'));
      return false;
    }
    return false;
  };
  void run()
    .catch(() => {
      if (!controller.signal.aborted)
        toast(refusalNotice(undefined, 'SetPlayerProfile'));
      return false;
    })
    .then((accepted) => {
      if (seats.get(playerId) === attempt) seats.delete(playerId);
      resolve(accepted);
    });
  return result;
};
