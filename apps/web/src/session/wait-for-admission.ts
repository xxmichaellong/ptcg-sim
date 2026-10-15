import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

/**
 * Resolves once a new room's session has been admitted (`ready`, in the
 * role asked for); rejects if it fails, closes or is superseded first, or
 * the wait is cancelled. A runtime returned by a bootstrap is still only
 * connecting: nothing should be given up for it before this resolves.
 */
export const waitForAdmission = (
  runtime: RemoteRoomRuntime,
  signal: AbortSignal,
  role?: 'player' | 'spectator'
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = (): void => {
      const state = runtime.session.getSnapshot();
      if (state.phase === 'ready') {
        settle(
          role === undefined || state.role === role
            ? undefined
            : new Error('The room admitted this session in the wrong role')
        );
      } else if (
        state.phase === 'failed' ||
        state.phase === 'closed' ||
        state.phase === 'superseded'
      ) {
        settle(new Error('The room did not admit this session'));
      }
    };
    const onAbort = (): void => settle(new Error('Joining was cancelled'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    unsubscribe = runtime.session.subscribe(inspect);
    inspect();
  });
