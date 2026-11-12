import { useSyncExternalStore } from 'react';

import { useAccount } from '../account/account-state.js';
import { refreshFriends } from './friends-state.js';

/**
 * Whether Friends (ADR-055) is open, and at which page: the bar's button,
 * a command, a request's notice and an invite link open it; the sheet
 * (FriendsSheet.tsx) draws it.
 */

export type FriendsPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'add'; readonly id?: string }
  | { readonly kind: 'player'; readonly id: string };

export interface FriendsSheetState {
  readonly open: boolean;
  readonly stack: readonly FriendsPage[];
  readonly motion: 'push' | 'pop' | undefined;
}

const CLOSED: FriendsSheetState = {
  open: false,
  stack: [{ kind: 'home' }],
  motion: undefined,
};
let sheet: FriendsSheetState = CLOSED;
const listeners = new Set<() => void>();

const setSheet = (next: FriendsSheetState): void => {
  sheet = next;
  for (const listener of listeners) listener();
};

/** Opens Friends, at a page if given (on top of the first). */
export const openFriends = (page?: FriendsPage): void => {
  void refreshFriends();
  setSheet({
    open: true,
    stack:
      page && page.kind !== 'home'
        ? [{ kind: 'home' }, page]
        : [{ kind: 'home' }],
    motion: undefined,
  });
};

export const closeFriends = (): void => setSheet({ ...sheet, open: false });

export const pushFriendsPage = (page: FriendsPage): void =>
  setSheet({ ...sheet, stack: [...sheet.stack, page], motion: 'push' });

/** Back a page; false on the first. */
export const backFriendsPage = (): boolean => {
  if (sheet.stack.length < 2) return false;
  setSheet({ ...sheet, stack: sheet.stack.slice(0, -1), motion: 'pop' });
  return true;
};

export const friendsSheetState = (): FriendsSheetState => sheet;

export const useFriendsSheet = (): FriendsSheetState =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => sheet,
    () => sheet
  );

/** Friends is offered to a signed-in player (ADR-055). */
export const useFriendsAvailable = (): boolean => {
  const { status, account } = useAccount();
  return status === 'ready' && account !== null;
};
