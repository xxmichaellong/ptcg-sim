import { useSyncExternalStore } from 'react';

/**
 * Whether the command palette is open. The key, Ctrl+K and the toolbar's
 * Commands button all open the one palette mounted for the page.
 */
let open = false;
const listeners = new Set<() => void>();

const publish = (next: boolean): void => {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
};

export const openCommandPalette = (): void => publish(true);
export const closeCommandPalette = (): void => publish(false);
export const toggleCommandPalette = (): void => publish(!open);
export const isCommandPaletteOpen = (): boolean => open;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useCommandPaletteOpen = (): boolean =>
  useSyncExternalStore(subscribe, () => open);
