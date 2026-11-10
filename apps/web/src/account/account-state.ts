import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import { preferences } from '../preferences/preference-store.js';
import { PLAYER_PREFERENCES } from '../session/player-preferences.js';
import { toast } from '../ui/toast.js';
import {
  ACCOUNT_CHANNEL,
  fetchAccount,
  isSignInResult,
  signInStartUrl,
  type Account,
  type AccountProvider,
  type SignInResult,
} from './account-api.js';

/**
 * Who is signed in (ADR-052), for every screen: read once as the app
 * starts, again when a sign-in finishes in any tab, and when the page comes
 * back into view after a while. Signing in never reloads the table: the
 * provider opens in a popup, and only where popups are blocked does the
 * page itself go there and come back.
 */

export interface AccountSnapshot {
  /** `unavailable`: the account couldn't be read (offline, or no server). */
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly account: Account | null;
  readonly providers: readonly AccountProvider[];
}

const LOADING: AccountSnapshot = Object.freeze({
  status: 'loading',
  account: null,
  providers: [],
});

/** A page back in view reads the account again after this long. */
const REFRESH_AFTER_MS = 5 * 60 * 1000;

let snapshot: AccountSnapshot = LOADING;
let readAt = 0;
let reading: Promise<void> | undefined;
const listeners = new Set<() => void>();

const publish = (next: AccountSnapshot): void => {
  const before = snapshot.account;
  snapshot = next;
  // A first sign-in names the player, where no name was given yet.
  if (!before && next.account) {
    const store = preferences();
    if (store.get(PLAYER_PREFERENCES).displayName === '') {
      store.set(PLAYER_PREFERENCES, { displayName: next.account.name });
    }
  }
  for (const listener of listeners) listener();
};

export const accountSnapshot = (): AccountSnapshot => snapshot;

export const subscribeAccount = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Reads the account again; calls already in flight are shared. */
export const refreshAccount = (): Promise<void> => {
  reading ??= fetchAccount()
    .then(
      (answer) => {
        readAt = Date.now();
        publish({ status: 'ready', ...answer });
      },
      () => {
        publish({ ...snapshot, status: 'unavailable' });
      }
    )
    .finally(() => {
      reading = undefined;
    });
  return reading;
};

/** Puts a changed account in place (after a rename, say). */
export const replaceAccount = (account: Account | null): void => {
  publish({ ...snapshot, status: 'ready', account });
};

export const useAccount = (): AccountSnapshot =>
  useSyncExternalStore(subscribeAccount, accountSnapshot, accountSnapshot);

export const providerName = (provider: AccountProvider): string => {
  switch (provider) {
    case 'google':
      return 'Google';
    case 'discord':
      return 'Discord';
    case 'test':
      return t({ message: 'Test', context: 'stand-in sign-in method' });
  }
};

/** The provider of the sign-in this tab started, until it ends. */
let awaiting: AccountProvider | undefined;

/** Says how a sign-in ended; cancelling says nothing. */
const announce = (result: SignInResult, provider?: AccountProvider): void => {
  switch (result) {
    case 'signed_in': {
      const name = snapshot.account?.name;
      toast({
        title: name ? t`Signed in as ${name}` : t`Signed in`,
        tone: 'success',
        id: 'account-sign-in',
      });
      return;
    }
    case 'linked':
      toast({
        title: t`Sign-in method added`,
        tone: 'success',
        id: 'account-sign-in',
      });
      return;
    case 'cancelled':
      return;
    case 'already_linked':
      toast({
        title: t`That account already has its own PTCG Sim account`,
        tone: 'warning',
        id: 'account-sign-in',
      });
      return;
    case 'provider_taken': {
      const name = provider ? providerName(provider) : undefined;
      toast({
        title: name
          ? t`Your account already has a ${name} sign-in`
          : t`Your account already has that sign-in`,
        tone: 'warning',
        id: 'account-sign-in',
      });
      return;
    }
    case 'rate_limited':
      toast({
        title: t`Too many tries. Wait a minute.`,
        tone: 'warning',
        id: 'account-sign-in',
      });
      return;
    case 'expired':
    case 'failed':
    case 'unavailable':
    case 'signed_out':
      toast({
        title: t`Couldn't sign in. Try again.`,
        tone: 'danger',
        id: 'account-sign-in',
      });
  }
};

/**
 * A sign-in ended in a popup: every tab reads the account again, and the
 * tab that started it says how it went.
 */
const finished = (result: SignInResult): void => {
  const provider = awaiting;
  awaiting = undefined;
  void refreshAccount().then(() => {
    if (provider) announce(result, provider);
  });
};

/** The `account` mark a page sign-in came back with, taken off the address. */
const takeReturnedResult = (): SignInResult | undefined => {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('account');
  if (result === null) return undefined;
  url.searchParams.delete('account');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`
  );
  return isSignInResult(result) ? result : undefined;
};

let started = false;

/** Starts following the account; the app calls it once. */
export const startAccount = (): void => {
  if (started || typeof window === 'undefined') return;
  started = true;
  const returned = takeReturnedResult();
  void refreshAccount().then(() => {
    if (returned) announce(returned);
  });
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(ACCOUNT_CHANNEL);
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (Reflect.get(Object(data), 'kind') === 'sign-in') {
        const result: unknown = Reflect.get(Object(data), 'result');
        if (isSignInResult(result)) finished(result);
      } else if (Reflect.get(Object(data), 'kind') === 'changed') {
        void refreshAccount();
      }
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      Date.now() - readAt > REFRESH_AFTER_MS
    ) {
      void refreshAccount();
    }
  });
};

/** Tells the other tabs the account changed (signed out, renamed…). */
export const announceAccountChange = (): void => {
  if (typeof BroadcastChannel !== 'function') return;
  const channel = new BroadcastChannel(ACCOUNT_CHANNEL);
  channel.postMessage({ kind: 'changed' });
  channel.close();
};

const POPUP_FEATURES = 'popup,width=480,height=680';

/**
 * Signs in (or adds a method) with a provider: in a popup opened in the
 * same press, so blockers let it through, or else as the page itself.
 */
export const startSignIn = (
  provider: AccountProvider,
  intent: 'sign-in' | 'link' = 'sign-in'
): void => {
  awaiting = provider;
  const here = `${window.location.pathname}${window.location.search}`;
  const popup = window.open(
    signInStartUrl(provider, intent, 'popup', here),
    'ptcgsim-sign-in',
    POPUP_FEATURES
  );
  if (!popup) {
    window.location.assign(signInStartUrl(provider, intent, 'page', here));
    return;
  }
  // Where the channel can't carry the result, the popup closing still says
  // the sign-in is over.
  const watch = window.setInterval(() => {
    if (!popup.closed) return;
    window.clearInterval(watch);
    void refreshAccount();
  }, 500);
};
