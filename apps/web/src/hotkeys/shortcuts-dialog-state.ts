import { useEffect, useState, useSyncExternalStore } from 'react';

import type { HotkeyMode } from './keymap.js';

/**
 * Whether the keyboard shortcuts dialog is open. The board's `?` key, the
 * sidebar's keyboard button, Settings and the welcome card all open the one
 * dialog mounted for the page.
 */
export interface ShortcutsDialogState {
  readonly open: boolean;
  /** The list it opens on: what the keys do right now. */
  readonly mode: HotkeyMode;
}

let state: ShortcutsDialogState = { open: false, mode: 'table' };
const listeners = new Set<() => void>();

const publish = (next: ShortcutsDialogState): void => {
  if (next.open === state.open && next.mode === state.mode) return;
  state = next;
  for (const listener of listeners) listener();
};

export const openShortcutsDialog = (mode: HotkeyMode = 'table'): void =>
  publish({ open: true, mode });

export const closeShortcutsDialog = (): void =>
  publish({ ...state, open: false });

export const toggleShortcutsDialog = (mode: HotkeyMode = 'table'): void =>
  state.open ? closeShortcutsDialog() : openShortcutsDialog(mode);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useShortcutsDialogState = (): ShortcutsDialogState =>
  useSyncExternalStore(subscribe, () => state);

export const shortcutsDialogState = (): ShortcutsDialogState => state;

/*
 * One dialog per page. A host mounted later (a harness over the app) takes
 * over from the earlier one until it unmounts; two open modal dialogs would
 * each hide the other from assistive technology.
 */
const hosts: symbol[] = [];
const hostListeners = new Set<() => void>();

const subscribeHosts = (listener: () => void): (() => void) => {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
};

/** Whether this host is the one that draws the dialog. */
export const useIsShortcutsDialogHost = (): boolean => {
  const [token] = useState(() => Symbol('shortcuts-dialog-host'));
  useEffect(() => {
    hosts.push(token);
    for (const listener of hostListeners) listener();
    return () => {
      hosts.splice(hosts.indexOf(token), 1);
      for (const listener of hostListeners) listener();
    };
  }, [token]);
  return useSyncExternalStore(subscribeHosts, () => hosts.at(-1) === token);
};
