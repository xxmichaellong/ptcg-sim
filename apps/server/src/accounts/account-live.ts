import { ROOM_ALIAS_PATTERN } from '@ptcgsim/protocol';

import type { PresenceState } from './presence-hub.js';

/**
 * An account's live tabs (ADR-055 presence): each signed-in tab holds one
 * hibernatable WebSocket to the account's object, and says on it where it
 * is. What a tab said is kept on its socket (its attachment), so the
 * object knows it after waking; the account's state is its most present
 * tab's.
 */

export type LiveWhere =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'room';
      readonly role: 'player' | 'spectator';
      readonly room: string;
    };

export interface LiveAttachment {
  readonly tab: string;
  /** Digest of the account session that authorized this connection. */
  readonly sessionHash: string;
  /** Orders room checks that finish after a newer message. */
  readonly version: number;
  readonly where: LiveWhere;
  /** Said hello: only then does the tab count as the account online. */
  readonly greeted: boolean;
}

export const LIVE_TAG = 'live';
/** The most tabs one account keeps open; the oldest gives way. */
export const MAX_LIVE_TABS = 16;

export const readLiveWhere = (value: unknown): LiveWhere | undefined => {
  const kind: unknown = Reflect.get(Object(value), 'kind');
  if (kind === 'none') return { kind: 'none' };
  const role: unknown = Reflect.get(Object(value), 'role');
  const room: unknown = Reflect.get(Object(value), 'room');
  return kind === 'room' &&
    (role === 'player' || role === 'spectator') &&
    typeof room === 'string' &&
    ROOM_ALIAS_PATTERN.test(room)
    ? { kind: 'room', role, room }
    : undefined;
};

export const readLiveAttachment = (
  value: unknown
): LiveAttachment | undefined => {
  const tab: unknown = Reflect.get(Object(value), 'tab');
  const sessionHash: unknown = Reflect.get(Object(value), 'sessionHash');
  const where = readLiveWhere(Reflect.get(Object(value), 'where'));
  return typeof tab === 'string' &&
    typeof sessionHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(sessionHash) &&
    where
    ? {
        tab,
        sessionHash,
        version: Number.isSafeInteger(Reflect.get(Object(value), 'version'))
          ? Number(Reflect.get(Object(value), 'version'))
          : 0,
        where,
        greeted: Reflect.get(Object(value), 'greeted') === true,
      }
    : undefined;
};

/** The account's state from its tabs: in a game over watching over online. */
export const tabsPresence = (
  all: readonly LiveAttachment[]
): { readonly state: PresenceState; readonly room?: string } => {
  const tabs = all.filter((tab) => tab.greeted);
  if (tabs.length === 0) return { state: 'offline' };
  const playing = tabs.find(
    (tab) => tab.where.kind === 'room' && tab.where.role === 'player'
  );
  if (playing?.where.kind === 'room') {
    return { state: 'playing', room: playing.where.room };
  }
  const watching = tabs.find(
    (tab) => tab.where.kind === 'room' && tab.where.role === 'spectator'
  );
  if (watching?.where.kind === 'room') {
    return { state: 'watching', room: watching.where.room };
  }
  return { state: 'online' };
};

export const samePresence = (
  left: { readonly state: PresenceState; readonly room?: string },
  right: { readonly state: PresenceState; readonly room?: string }
): boolean => left.state === right.state && left.room === right.room;
