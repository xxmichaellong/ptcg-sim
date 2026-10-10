import { createContext } from 'react';

/**
 * Several React roots can each mount an `OverlayHost` (the application, and
 * a development harness laid over it). Only the most recently mounted one
 * renders the shared dialog queue and toasts, so nothing is ever painted
 * twice; when it unmounts, the previous host takes over again.
 */

let hosts: readonly symbol[] = [];
const listeners = new Set<() => void>();

const publish = (): void => {
  for (const listener of [...listeners]) listener();
};

export const subscribeOverlayHosts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const activeOverlayHost = (): symbol | undefined => hosts.at(-1);

export const registerOverlayHost = (token: symbol): (() => void) => {
  hosts = [...hosts.filter((candidate) => candidate !== token), token];
  publish();
  return () => {
    hosts = hosts.filter((candidate) => candidate !== token);
    publish();
  };
};

/**
 * Where overlay portals mount. `undefined` means `document.body`; a harness
 * that paints in its own top-level layer passes its element so dialogs stay
 * above it.
 */
export const OverlayContainerContext = createContext<HTMLElement | undefined>(
  undefined
);
