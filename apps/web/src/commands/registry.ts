import { useEffect, useRef } from 'react';

import type { PaletteCommand } from './types.js';

/**
 * Where the palette's commands come from (ADR-035 §2): each screen lists
 * the actions it owns while it is mounted. A source is asked again whenever
 * the palette opens and whenever its screen changes while it is open, so
 * nothing listed is stale.
 */
export interface CommandSource {
  readonly commands: () => readonly PaletteCommand[];
}

const sources = new Map<symbol, CommandSource>();
const listeners = new Set<() => void>();
let version = 0;

const changed = (): void => {
  version += 1;
  for (const listener of listeners) listener();
};

export const registerCommandSource = (source: CommandSource): (() => void) => {
  const key = Symbol('command source');
  sources.set(key, source);
  changed();
  return () => {
    sources.delete(key);
    changed();
  };
};

/** Tells the palette a source's list may have changed. */
export const commandSourcesChanged = changed;

export const subscribeCommandSources = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Bumps whenever a source comes, goes or changes. */
export const commandSourcesVersion = (): number => version;

/**
 * Every command now. A source that throws lists nothing rather than taking
 * the palette down with it.
 */
export const collectCommands = (): PaletteCommand[] =>
  [...sources.values()].flatMap((source) => {
    try {
      return [...source.commands()];
    } catch (error) {
      console.error('[commands] a command source failed', error);
      return [];
    }
  });

/**
 * Lists a component's commands while it is mounted. `list` is read when the
 * palette asks, so it may close over the latest props and state; every
 * render tells the palette to ask again.
 */
export const useCommandSource = (
  list: () => readonly PaletteCommand[]
): void => {
  const latest = useRef(list);
  latest.current = list;
  useEffect(
    () => registerCommandSource({ commands: () => latest.current() }),
    []
  );
  useEffect(() => {
    changed();
  });
};

/**
 * Lists commands while it is rendered, for a screen that builds them where
 * a hook can't run (inside a render callback).
 */
export const CommandSourceRegistration = ({
  list,
}: {
  readonly list: () => readonly PaletteCommand[];
}): null => {
  useCommandSource(list);
  return null;
};
