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
import { BackgroundChooser } from './BackgroundChooser.js';
import type { RoomBackground } from '../browser-room-background.js';
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
    background: {
      current: undefined,
      onChange: vi.fn(),
      onRequestLink: vi.fn(),
    },
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

  it('changes the theme and the background through the room, by tiles, with no words to type', async () => {
    const onDarkModeChange = vi.fn();
    const onChange = vi.fn();
    const onRequestLink = vi.fn();
    await render({
      onDarkModeChange,
      background: { current: undefined, onChange, onRequestLink },
    });
    expect(input('darkModeCheckbox').checked).toBe(true);
    await act(async () => input('darkModeCheckbox').click());
    expect(onDarkModeChange).toHaveBeenCalledWith(false);
    const tiles = () =>
      [...document.querySelectorAll('input[name="roomBackground"]')].map(
        (tile) => tile.id
      );
    // No picture of the player's own yet: no Custom tile, only the way to
    // add one.
    expect(tiles()).toEqual([
      'background-desk',
      'background-none',
      'background-wallpaper1',
      'background-wallpaper2',
    ]);
    expect(input('background-desk').checked).toBe(true);
    await act(async () => input('background-none').click());
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'blank' });
    await act(async () => input('background-wallpaper2').click());
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'image',
      url: '/v2/assets/background2.webp',
    });
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('#changeBackgroundButton')!
        .click()
    );
    expect(onRequestLink).toHaveBeenCalledOnce();

    // A link in use is the Custom tile; the desk is one press back.
    await render({
      darkMode: false,
      background: {
        current: { kind: 'image', url: 'https://example.test/bg.png' },
        onChange,
        onRequestLink,
      },
    });
    expect(input('darkModeCheckbox').checked).toBe(false);
    expect(input('background-custom').checked).toBe(true);
    await act(async () => input('background-desk').click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('takes a picture of the player’s own, picked or pasted, and keeps it on this device', async () => {
    const onChange = vi.fn();
    const encoded = new Blob(['small'], { type: 'image/webp' });
    const encode = vi.fn(async () => encoded);
    const save = vi.fn(async () => true);
    const picture = new File(['big'], 'table.png', { type: 'image/png' });
    await act(async () =>
      root.render(
        <BackgroundChooser
          choice={{ current: undefined, onChange, onRequestLink: vi.fn() }}
          encode={encode}
          save={save}
        />
      )
    );
    const file = input('backgroundFileInput');
    const click = vi.spyOn(file, 'click');
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('#backgroundFileButton')!
        .click()
    );
    expect(click).toHaveBeenCalledOnce();
    Object.defineProperty(file, 'files', { value: [picture] });
    await act(async () => {
      file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(1);
    expect(encode).toHaveBeenCalledWith(picture);
    expect(save).toHaveBeenCalledWith(encoded);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'local' });

    // Pasted anywhere but a field.
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [picture] },
    });
    await act(async () => {
      document.body.dispatchEvent(paste);
    });
    await settle(1);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(paste.defaultPrevented).toBe(true);

    // What can't be read says so, and changes nothing.
    encode.mockResolvedValueOnce(null as unknown as Blob);
    onChange.mockClear();
    await act(async () => {
      file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      document.querySelector('.background-chooser')?.textContent
    ).toContain("Couldn't use that picture.");
  });

  it('lets a tile or a link chosen while a picture is prepared stand, and takes a picture pasted on a tile', async () => {
    const onChange = vi.fn();
    const encoded = new Blob(['small'], { type: 'image/webp' });
    let finish: (blob: Blob) => void = () => undefined;
    const encode = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        })
    );
    const save = vi.fn(async () => true);
    const picture = new File(['big'], 'table.png', { type: 'image/png' });
    const chooser = (current?: RoomBackground) => (
      <BackgroundChooser
        choice={{ current, onChange, onRequestLink: vi.fn() }}
        encode={encode}
        save={save}
      />
    );
    await act(async () => root.render(chooser()));
    // Pasted with a tile focused: the tile takes no text, so it's the
    // picture's.
    const desk = input('background-desk');
    desk.focus();
    const paste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { files: [picture] },
      });
      return event;
    };
    await act(async () => {
      desk.dispatchEvent(paste());
    });
    expect(encode).toHaveBeenCalledOnce();

    // A wallpaper chosen while it is prepared stays chosen.
    await act(async () => input('background-wallpaper1').click());
    const wallpaper = onChange.mock.lastCall?.[0] as RoomBackground;
    expect(wallpaper).toMatchObject({ kind: 'image' });
    await act(async () => {
      finish(encoded);
    });
    await settle(1);
    expect(save).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(wallpaper);
    expect(
      document.querySelector('.background-chooser')?.textContent
    ).not.toContain('Preparing picture…');

    // A link chosen meanwhile (the choice changes from outside) too.
    onChange.mockClear();
    await act(async () => {
      document.body.dispatchEvent(paste());
    });
    const link: RoomBackground = {
      kind: 'image',
      url: 'https://pictures.example/table.jpg',
    };
    await act(async () => root.render(chooser(link)));
    await act(async () => {
      finish(encoded);
    });
    await settle(1);
    expect(save).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
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
