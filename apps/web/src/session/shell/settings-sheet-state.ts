import { useCallback, useEffect, useRef, useState } from 'react';

/** Settings' headed sections, in the sheet's order. */
export const SETTINGS_SECTIONS = [
  'room',
  'table',
  'cards',
  'motion',
  'keys',
  'language',
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

/** Each section's element id in the sheet. */
export const SETTINGS_SECTION_IDS: Readonly<Record<SettingsSectionId, string>> =
  {
    room: 'settingsRoom',
    table: 'settingsTable',
    cards: 'settingsCards',
    motion: 'motionSettings',
    keys: 'settingsKeys',
    language: 'languageSettings',
  };

type Opener = (section?: SettingsSectionId) => void;

/*
 * Settings is one sheet, drawn by the screen holding the table (the room,
 * or the lobby before one). Its key and the palette open it from anywhere
 * through the screen mounted last, as the shortcuts dialog's hosts do.
 */
const openers: Opener[] = [];

/**
 * Opens Settings, scrolled to `section` if given. False where no screen
 * draws it.
 */
export const openSettingsSheet = (section?: SettingsSectionId): boolean => {
  const opener = openers.at(-1);
  if (!opener) return false;
  opener(section);
  return true;
};

/** Whether a screen draws Settings now. */
export const canOpenSettingsSheet = (): boolean => openers.length > 0;

/** Makes this screen's sheet the one `openSettingsSheet` opens. */
const useSettingsSheetOpener = (open: Opener, enabled: boolean): void => {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    if (!enabled) return;
    const opener: Opener = (section) => latest.current(section);
    openers.push(opener);
    return () => {
      openers.splice(openers.indexOf(opener), 1);
    };
  }, [enabled]);
};

/** A section Settings was asked to open at; each ask scrolls again. */
export interface SettingsSectionRequest {
  readonly section: SettingsSectionId;
  readonly serial: number;
}

let serial = 0;

/**
 * A screen's Settings, opened from its menu, the key or the palette:
 * `show` opens the screen's sheet, and `section` is where to scroll it.
 * Not `enabled` while another screen holds the table (the lobby's room).
 */
export const useSettingsSheetHost = (
  show: () => void,
  enabled = true
): {
  readonly open: (section?: SettingsSectionId) => void;
  readonly section: SettingsSectionRequest | undefined;
} => {
  const [section, setSection] = useState<SettingsSectionRequest>();
  const latest = useRef(show);
  latest.current = show;
  const open = useCallback((at?: SettingsSectionId) => {
    serial += 1;
    setSection(at ? { section: at, serial } : undefined);
    latest.current();
  }, []);
  useSettingsSheetOpener(open, enabled);
  return { open, section };
};
