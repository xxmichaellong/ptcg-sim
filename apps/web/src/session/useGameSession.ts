import type {
  ClientSessionState,
  RemoteGameSession,
} from '@ptcgsim/client-session';
import { useSyncExternalStore } from 'react';

export type GameSessionStore = Pick<
  RemoteGameSession,
  'getSnapshot' | 'subscribe'
>;

/** React owns only the subscription; the transport-neutral session owns state. */
export const useGameSession = (session: GameSessionStore): ClientSessionState =>
  useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
