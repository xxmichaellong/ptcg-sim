import { useSyncExternalStore } from 'react';

import { definePreference } from '../preferences/preference-store.js';

/**
 * The tutorial's state (ADR-038): which lessons the player has finished,
 * kept on this device, and the requests to start or leave tutorial mode
 * that the menu, the welcome card and the palette send to the page that
 * owns the practice table (the lobby).
 */

/**
 * Each finished lesson by its id, at the version it was finished at. A
 * lesson rewritten later carries a higher version and reads as new again,
 * without ever being pushed at the player.
 */
export interface TutorialPreferences {
  readonly completed: Readonly<Record<string, number>>;
}

export const TUTORIAL_PREFERENCES = definePreference<TutorialPreferences>({
  key: 'ptcgsim.tutorial.v1',
  defaults: Object.freeze({ completed: Object.freeze({}) }),
  parse: (value) => {
    const completed: Record<string, number> = {};
    const stored =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, 'completed')
        : undefined;
    if (typeof stored === 'object' && stored !== null) {
      for (const [lesson, version] of Object.entries(stored)) {
        if (
          /^[a-z-]{1,40}$/u.test(lesson) &&
          Number.isSafeInteger(version) &&
          (version as number) > 0
        ) {
          completed[lesson] = version as number;
        }
      }
    }
    return { completed };
  },
});

/** A request for the tutorial: open it, at a lesson or at its list. */
export interface TutorialRequest {
  /** A lesson to start at once; absent, the list of lessons. */
  readonly lesson?: string;
  /** Distinguishes two requests for the same lesson. */
  readonly serial: number;
}

let request: TutorialRequest | null = null;
let active = false;
let serial = 0;
const listeners = new Set<() => void>();
const publish = (): void => {
  for (const listener of [...listeners]) listener();
};
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Asks for tutorial mode, at a lesson or at the list of lessons. */
export const startTutorial = (lesson?: string): void => {
  serial += 1;
  request = lesson === undefined ? { serial } : { lesson, serial };
  publish();
};

/** The request not yet taken up, if any. */
export const pendingTutorialRequest = (): TutorialRequest | null => request;

/** Takes up a request: it is not answered twice. */
export const takeTutorialRequest = (taken: TutorialRequest): void => {
  if (request === taken) {
    request = null;
    publish();
  }
};

export const useTutorialRequest = (): TutorialRequest | null =>
  useSyncExternalStore(subscribe, pendingTutorialRequest, () => null);

/** Whether the practice table is on screen (set by its host). */
export const setTutorialActive = (value: boolean): void => {
  if (active === value) return;
  active = value;
  publish();
};

export const isTutorialActive = (): boolean => active;

export const useTutorialActive = (): boolean =>
  useSyncExternalStore(subscribe, isTutorialActive, () => false);

let exitHandler: (() => void) | null = null;

/** The page that owns the practice table says how to leave it. */
export const setTutorialExit = (handler: (() => void) | null): void => {
  exitHandler = handler;
};

/** Leaves tutorial mode for the player's own table. */
export const exitTutorial = (): void => {
  exitHandler?.();
};

/**
 * A lesson named in the page's address (`?tutorial=damage`), so a lesson
 * can be shared; `?tutorial` alone opens the list.
 */
export const tutorialRequestFromUrl = (search: string): string | undefined => {
  const params = new URLSearchParams(search);
  if (!params.has('tutorial')) return undefined;
  return params.get('tutorial') ?? '';
};
