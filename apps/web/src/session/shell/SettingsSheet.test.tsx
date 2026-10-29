// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardViewSettings } from '../../board/view/board-view-settings.js';
import {
  closeShortcutsDialog,
  shortcutsDialogState,
} from '../../hotkeys/shortcuts-dialog-state.js';
import {
  DEFAULT_MOTION_SETTINGS,
  motionSettings,
} from '../../motion/motion-settings.js';
import { closeHelpPage, HelpSheetHost, RELEASE_NAME } from './help-pages.js';
import { SettingsSheet, type SettingsSheetProps } from './SettingsSheet.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Lets Base UI's sheets open, close and move focus. */
const settle = async (rounds = 3): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

let host: HTMLDivElement;
let root: Root;

const render = async (props: Partial<SettingsSheetProps> = {}) => {
  const full: SettingsSheetProps = {
    open: true,
    onOpenChange: vi.fn(),
    darkMode: true,
    onDarkModeChange: vi.fn(),
    onChangeBackground: vi.fn(),
    ...props,
  };
  await act(async () =>
    root.render(
      <>
        <SettingsSheet {...full} />
        <HelpSheetHost />
      </>
    )
  );
  await settle();
  return full;
};

const input = (id: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`#${id}`)!;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  boardViewSettings().reset();
  motionSettings().update(DEFAULT_MOTION_SETTINGS);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    closeHelpPage();
    closeShortcutsDialog();
  });
  await act(async () => root.unmount());
  document.body.replaceChildren();
  boardViewSettings().reset();
  motionSettings().update(DEFAULT_MOTION_SETTINGS);
  vi.unstubAllGlobals();
});

describe('SettingsSheet', () => {
  it('holds settings only, in sections: the table, cards, motion, keys, language', async () => {
    await render();
    const sheet = document.querySelector<HTMLElement>('#settings')!;
    expect(sheet.dataset.variant).toBe('side');
    expect(sheet.textContent).not.toContain('this device');
    expect(
      [...sheet.querySelectorAll('.ptcgsim-settings-section__title')].map(
        (title) => title.textContent
      )
    ).toEqual(['Table', 'Cards', 'Motion', 'Keys', 'Language']);
    const rows = (section: string) =>
      [
        ...sheet.querySelectorAll(
          `#${section} input[id], #${section} select[id], #${section} button[id]`
        ),
      ].map((control) => control.id);
    expect(rows('settingsTable')).toEqual(
      expect.arrayContaining([
        'tableArt-cream',
        'changeBackgroundButton',
        'darkModeCheckbox',
        'tableViewAuto',
        'tableTiltRange',
        'tableThicknessRange',
        'boardShowBoth',
        'boardSplitRange',
        'zoneOutlinesCheckbox',
        'boardViewResetButton',
      ])
    );
    expect(rows('settingsCards')).toEqual([
      'opponentUprightCheckbox',
      'hoverPreviewCheckbox',
      'tableScatterCheckbox',
      'opponentCardBacksCheckbox',
    ]);
    expect(rows('motionSettings')).toEqual(
      expect.arrayContaining([
        'reduceMotionSystem',
        'animationSpeedNormal',
        'tableLiftCheckbox',
        'tableHeightMotionCheckbox',
        'tableParallaxCheckbox',
      ])
    );
    expect(rows('languageSettings')).toEqual([
      'languageSelect',
      'cardImageLanguageSelect',
    ]);
    // The table's pieces live on the mat's + and the palette; the Solo
    // cover on the far hand's pill.
    for (const id of [
      'lostZoneCheckbox',
      'vstarMarkerCheckbox',
      'gxMarkerCheckbox',
      'hideHandCheckbox',
    ]) {
      expect(sheet.querySelector(`#${id}`), id).toBeNull();
    }
  });

  it('closes for the release notes and the sponsors at its foot, and opens Discord outside', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { onOpenChange } = await render();
    const footer = document.querySelector('.ptcgsim-settings-footer')!;
    expect(
      [...footer.querySelectorAll('button')].map((button) => button.id)
    ).toEqual(['changelogButton', 'discordButton', 'donationsButton']);
    expect(footer.querySelector('#changelogButton')?.textContent).toBe(
      RELEASE_NAME
    );
    await act(async () =>
      footer.querySelector<HTMLButtonElement>('#discordButton')!.click()
    );
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('discord.gg'),
      '_blank',
      'noopener,noreferrer'
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () =>
      footer.querySelector<HTMLButtonElement>('#changelogButton')!.click()
    );
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('#changelog')).not.toBeNull();
  });

  it('gives way to the keyboard shortcuts, and has no keys on a touch screen', async () => {
    const { onOpenChange } = await render();
    expect(document.querySelector('#settingsKeys kbd')?.textContent).toBe('?');
    await act(async () =>
      document.querySelector<HTMLButtonElement>('#editShortcutsButton')!.click()
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(shortcutsDialogState().open).toBe(true);

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse) and (hover: none)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(document.querySelector('#settingsKeys')).toBeNull();
  });

  it('lets a player in a room allow board flip at any time, and only there', async () => {
    await render();
    // A Solo table has no other player to agree with.
    expect(input('coachingModeCheckbox')).toBeNull();
    const onChange = vi.fn();
    await render({ boardFlip: { allowed: false, onChange } });
    // The room's own switch leads.
    expect(
      document.querySelector('.ptcgsim-settings-section__title')?.textContent
    ).toBe('Room');
    const allow = input('coachingModeCheckbox');
    expect(allow.checked).toBe(false);
    expect(document.querySelector('#settingsRoom')?.textContent).toContain(
      'Both players must allow it.'
    );
    await act(async () => allow.click());
    expect(onChange).toHaveBeenCalledWith(true);
    await render({ boardFlip: { allowed: true, onChange } });
    expect(input('coachingModeCheckbox').checked).toBe(true);
  });

  it('is not on the page while closed', async () => {
    await render({ open: false });
    expect(document.querySelector('#settings')).toBeNull();
  });

  it('applies how the table shows as each choice is made', async () => {
    await render();
    await act(async () => input('zoneOutlinesCheckbox').click());
    expect(boardViewSettings().getSnapshot().zoneOutlines).toBe(false);
    await act(async () => input('opponentUprightCheckbox').click());
    expect(boardViewSettings().getSnapshot().opponentCardsUpright).toBe(true);
  });

  it('scrolls to the section the palette asked for', async () => {
    const scrolled: string[] = [];
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(function (this: HTMLElement) {
        scrolled.push(this.id);
      });
    await render({ section: { section: 'motion', serial: 1 } });
    await settle();
    expect(scrolled).toEqual(['motionSettings']);
    scroll.mockRestore();
  });

  it('changes the theme and the background through the room', async () => {
    const onDarkModeChange = vi.fn();
    const onChangeBackground = vi.fn();
    await render({ onDarkModeChange, onChangeBackground });
    expect(input('darkModeCheckbox').checked).toBe(true);
    await act(async () => input('darkModeCheckbox').click());
    expect(onDarkModeChange).toHaveBeenCalledWith(false);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('#changeBackgroundButton')!
        .click()
    );
    expect(onChangeBackground).toHaveBeenCalledOnce();
    // The default background is offered only while another one shows.
    expect(document.querySelector('#defaultBackgroundButton')).toBeNull();

    const onUseDefaultBackground = vi.fn();
    await render({ darkMode: false, onUseDefaultBackground });
    expect(input('darkModeCheckbox').checked).toBe(false);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('#defaultBackgroundButton')!
        .click()
    );
    expect(onUseDefaultBackground).toHaveBeenCalledOnce();
  });

  it('keeps motion choices with the player', async () => {
    await render();
    expect(input('reduceMotionSystem').checked).toBe(true);
    expect(input('animationSpeedNormal').checked).toBe(true);
    await act(async () => input('animationSpeedFast').click());
    expect(motionSettings().getSnapshot().animationSpeed).toBe('fast');
    await act(async () => input('reduceMotionOn').click());
    expect(motionSettings().getSnapshot().reduceMotion).toBe('reduce');
  });
});
