import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Settings' pages (ADR-045), each under the one it is reached from: the
 * first page lists what can be done here and leads to the rest, as Magic
 * Garden's system menu does.
 */
export const SETTINGS_PAGE_PARENTS = {
  home: null,
  table: 'home',
  cards: 'home',
  cardImages: 'cards',
  motion: 'home',
  language: 'home',
  reportBug: 'home',
  about: 'home',
} as const;

export type SettingsPage = keyof typeof SETTINGS_PAGE_PARENTS;

/** The pages the palette opens Settings at ("Settings: Cards"). */
export const SETTINGS_PALETTE_PAGES = [
  'table',
  'cards',
  'motion',
  'language',
  'about',
] as const satisfies readonly SettingsPage[];

/** Each page's element id in the drawer. */
export const SETTINGS_PAGE_IDS: Readonly<Record<SettingsPage, string>> = {
  home: 'settingsHome',
  table: 'settingsTable',
  cards: 'settingsCards',
  cardImages: 'settingsCardImages',
  motion: 'settingsMotion',
  language: 'settingsLanguage',
  reportBug: 'settingsReportBug',
  about: 'settingsAbout',
};

/** The way to a page from the first: `['home', 'cards', 'cardImages']`. */
export const settingsPageStack = (page: SettingsPage): SettingsPage[] => {
  const stack: SettingsPage[] = [];
  let next: SettingsPage | null = page;
  while (next !== null) {
    stack.unshift(next);
    next = SETTINGS_PAGE_PARENTS[next];
  }
  return stack;
};

/**
 * How the drawer moves from one stack to the next: in (a page opened from
 * this one), back out, or across (anything else, which slides no way).
 */
export const settingsNavigation = (
  current: readonly SettingsPage[],
  next: readonly SettingsPage[]
): 'push' | 'pop' | 'replace' => {
  const shared = Math.min(current.length, next.length);
  if (!current.slice(0, shared).every((page, i) => page === next[i])) {
    return 'replace';
  }
  return next.length > current.length
    ? 'push'
    : next.length < current.length
      ? 'pop'
      : 'replace';
};

type Opener = (page?: SettingsPage) => void;

/*
 * Settings is one drawer, drawn by the screen holding the table (the room,
 * or the lobby before one). The palette opens it from anywhere through the
 * screen mounted last, as the shortcuts dialog's hosts do.
 */
const openers: Opener[] = [];

/**
 * Opens Settings, at `page` if given. False where no screen draws it.
 */
export const openSettingsSheet = (page?: SettingsPage): boolean => {
  const opener = openers.at(-1);
  if (!opener) return false;
  opener(page);
  return true;
};

/** Whether a screen draws Settings now. */
export const canOpenSettingsSheet = (): boolean => openers.length > 0;

/** Makes this screen's drawer the one `openSettingsSheet` opens. */
const useSettingsSheetOpener = (open: Opener, enabled: boolean): void => {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!enabled) return;
    const opener: Opener = (page) => latest.current(page);
    openers.push(opener);
    return () => {
      openers.splice(openers.indexOf(opener), 1);
    };
  }, [enabled]);
};

/** A page Settings was asked to open at; each ask opens it again. */
export interface SettingsPageRequest {
  readonly page: SettingsPage;
  readonly serial: number;
}

let serial = 0;

/**
 * A screen's Settings, opened from the app bar or the palette: `show`
 * opens the screen's drawer, and `request` is the page to show. Not
 * `enabled` while another screen holds the table (the lobby's room).
 */
export const useSettingsSheetHost = (
  show: () => void,
  enabled = true
): {
  readonly open: (page?: SettingsPage) => void;
  readonly request: SettingsPageRequest;
} => {
  const [request, setRequest] = useState<SettingsPageRequest>(() => ({
    page: 'home',
    serial: 0,
  }));
  const latest = useRef(show);
  latest.current = show;
  const open = useCallback((page?: SettingsPage) => {
    serial += 1;
    setRequest({ page: page ?? 'home', serial });
    latest.current();
  }, []);
  useSettingsSheetOpener(open, enabled);
  return { open, request };
};
