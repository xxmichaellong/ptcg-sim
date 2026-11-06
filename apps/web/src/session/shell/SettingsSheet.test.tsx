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
import { CARD_IMAGE_PREFERENCES } from '../../i18n/card-image-language.js';
import { LANGUAGE_PREFERENCES } from '../../i18n/language-preference.js';
import { preferences } from '../../preferences/preference-store.js';
import type { AppMenuModel } from './AppMenu.js';
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

const press = async (id: string): Promise<void> => {
  await act(async () => document.querySelector<HTMLElement>(`#${id}`)!.click());
  await settle(1);
};

/** The page Settings shows, by its element id. */
const page = (): string | undefined =>
  document.querySelector('#settings .settings-page')?.id;

/** The rows and controls on the page shown, by id. */
const ids = (
  selector = '.settings-row[id], [id] > input[id], input[id], button[id]'
): string[] => [
  ...new Set(
    [
      ...document.querySelectorAll(`#settings .settings-page :is(${selector})`),
    ].map((element) => element.id)
  ),
];

const pressEscape = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await settle(1);
};

let media: (query: string) => boolean = () => false;

beforeEach(() => {
  media = () => false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: media(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  boardViewSettings().reset();
  motionSettings().update(DEFAULT_MOTION_SETTINGS);
  preferences().reset(LANGUAGE_PREFERENCES);
  preferences().reset(CARD_IMAGE_PREFERENCES);
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
  preferences().reset(LANGUAGE_PREFERENCES);
  preferences().reset(CARD_IMAGE_PREFERENCES);
  vi.unstubAllGlobals();
});

describe('SettingsSheet', () => {
  it('opens on its first page: the pages, the keys, help and About; each page holds its own', async () => {
    await render();
    const sheet = document.querySelector<HTMLElement>('#settings')!;
    expect(sheet.dataset.variant).toBe('side');
    expect(page()).toBe('settingsHome');
    expect(sheet.querySelector('.ptcgsim-sheet__title')?.textContent).toBe(
      'Settings'
    );
    // No way back from the first page.
    expect(sheet.querySelector('#settingsBackButton')).toBeNull();
    expect(ids('.settings-row[id]')).toEqual([
      'settingsTableRow',
      'settingsCardsRow',
      'settingsMotionRow',
      'settingsLanguageRow',
      'editShortcutsButton',
      'settingsReportBugRow',
      'settingsAboutRow',
    ]);
    // Each page row says what it is set to where that is a name.
    expect(
      sheet.querySelector('#settingsTableRow .settings-row__value')?.textContent
    ).toBe('Cream');
    expect(
      sheet.querySelector('#settingsLanguageRow .settings-row__value')
        ?.textContent
    ).toBe('English');

    await press('settingsTableRow');
    expect(page()).toBe('settingsTable');
    expect(ids()).toEqual(
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
    await press('settingsBackButton');

    await press('settingsCardsRow');
    expect(page()).toBe('settingsCards');
    expect(ids('input[id], .settings-row[id]')).toEqual([
      'opponentUprightCheckbox',
      'hoverPreviewCheckbox',
      'tableScatterCheckbox',
      'opponentCardBacksCheckbox',
      'cardImageLanguageRow',
    ]);
    await press('settingsBackButton');

    await press('settingsMotionRow');
    expect(page()).toBe('settingsMotion');
    expect(ids('input[id]')).toEqual(
      expect.arrayContaining([
        'reduceMotionSystem',
        'animationSpeedNormal',
        'tableLiftCheckbox',
        'tableHeightMotionCheckbox',
        'tableParallaxCheckbox',
      ])
    );
    await press('settingsBackButton');

    // The table's pieces live on the mat's + and the palette; the Solo
    // cover on the far hand's pill; nowhere here.
    for (const pageRow of [
      'settingsTableRow',
      'settingsCardsRow',
      'settingsMotionRow',
    ]) {
      await press(pageRow);
      for (const id of [
        'lostZoneCheckbox',
        'vstarMarkerCheckbox',
        'gxMarkerCheckbox',
        'hideHandCheckbox',
      ]) {
        expect(sheet.querySelector(`#${id}`), id).toBeNull();
      }
      await press('settingsBackButton');
    }
  });

  it('goes into a page and back to the row it came from, Esc going back first, and opens at a page asked for', async () => {
    const { onOpenChange } = await render();
    const sheet = document.querySelector<HTMLElement>('#settings')!;
    await press('settingsCardsRow');
    expect(sheet.querySelector('.ptcgsim-sheet__title')?.textContent).toBe(
      'Cards'
    );
    // The page's title takes the focus, to be read out.
    expect(document.activeElement?.closest('.ptcgsim-sheet__title')).not.toBe(
      null
    );
    expect(
      sheet.querySelector('.settings-page')?.getAttribute('data-enter')
    ).toBe('push');
    // A page within a page.
    await press('cardImageLanguageRow');
    expect(page()).toBe('settingsCardImages');
    await press('settingsBackButton');
    expect(page()).toBe('settingsCards');
    expect(document.activeElement?.id).toBe('cardImageLanguageRow');
    expect(
      sheet.querySelector('.settings-page')?.getAttribute('data-enter')
    ).toBe('pop');
    // Esc goes back a page, to the row it came from; on the first page it
    // puts Settings away.
    await pressEscape(document.activeElement!);
    expect(page()).toBe('settingsHome');
    expect(document.activeElement?.id).toBe('settingsCardsRow');
    expect(onOpenChange).not.toHaveBeenCalled();
    await pressEscape(document.activeElement!);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Asked for a page (the palette's "Settings: Motion"): there, with the
    // way back to the first.
    await render({ request: { page: 'motion', serial: 1 } });
    expect(page()).toBe('settingsMotion');
    expect(document.querySelector('#settingsBackButton')).not.toBeNull();
    // Asked again, again.
    await press('settingsBackButton');
    await render({ request: { page: 'language', serial: 2 } });
    expect(page()).toBe('settingsLanguage');
  });

  it('lists what the room lets the player do, gives way as each is done, and leaves from its foot', async () => {
    const onInvite = vi.fn();
    const onSaveOnline = vi.fn();
    const onLeave = vi.fn();
    const menu: AppMenuModel = {
      heading: 'Room K7PQ',
      onSettings: vi.fn(),
      invites: { code: 'K7PQ', onInvite, onCopyCode: vi.fn() },
      game: { onSaveOnline, onExportState: vi.fn() },
      onLeave,
    };
    const { onOpenChange } = await render({
      menu,
      boardFlip: { allowed: false, onChange: vi.fn() },
    });
    const sheet = document.querySelector<HTMLElement>('#settings')!;
    // The room first, under its name, its board flip with its invites.
    const groups = [...sheet.querySelectorAll('.settings-group')];
    expect(
      groups[0]?.querySelector('.settings-group__heading')?.textContent
    ).toBe('Room K7PQ');
    expect(
      [...groups[0]!.querySelectorAll('[id]')]
        .map((row) => row.id)
        .filter((id) => !id.startsWith('«'))
    ).toEqual(
      expect.arrayContaining([
        'roomCodeMenuItem',
        'inviteMenuItem',
        'coachingModeCheckbox',
      ])
    );
    // The room's code beside it; one invite link for everyone (ADR-047).
    expect(sheet.querySelector('#roomCodeMenuItem')?.textContent).toContain(
      'K7PQ'
    );
    await press('inviteMenuItem');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onInvite).toHaveBeenCalledOnce();
    // The saves and replays are a page of their own.
    expect(sheet.querySelector('#saveOnlineGame')).toBeNull();
    await press('settingsSavesRow');
    expect(page()).toBe('settingsSaves');
    expect(ids('.settings-row[id]')).toEqual(['saveOnlineGame', 'exportState']);
    await press('saveOnlineGame');
    expect(onSaveOnline).toHaveBeenCalledOnce();
    await press('settingsBackButton');
    // The way out, at the foot, in red, turned round in a right-to-left
    // language.
    const leave = sheet.querySelector<HTMLElement>(
      '.settings-footer #leaveRoomButton'
    )!;
    expect(leave.dataset.danger).toBe('true');
    expect(leave.querySelector('svg.ds-mirror-rtl')).not.toBeNull();
    await press('leaveRoomButton');
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("keeps a Solo table's replays on a page of their own, the tutorial with the help, and a replay's way out at the foot", async () => {
    const onImportReplay = vi.fn();
    const onTutorial = vi.fn();
    const { onOpenChange } = await render({
      menu: {
        mode: { kind: 'solo' },
        onSettings: vi.fn(),
        onTutorial,
        game: { onImportReplay, onExportState: vi.fn() },
      },
    });
    expect(ids('.settings-row[id]')).toEqual([
      'settingsTableRow',
      'settingsCardsRow',
      'settingsMotionRow',
      'settingsLanguageRow',
      'editShortcutsButton',
      'settingsSavesRow',
      'tutorialButton',
      'settingsReportBugRow',
      'settingsAboutRow',
    ]);
    expect(
      document.querySelector('#settingsSavesRow .settings-row__label')
        ?.textContent
    ).toBe('Saves & replays');
    await press('settingsSavesRow');
    expect(ids('.settings-row[id]')).toEqual(['importReplay', 'exportState']);
    await press('importReplay');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onImportReplay).toHaveBeenCalledOnce();
    await press('settingsBackButton');
    await press('tutorialButton');
    expect(onTutorial).toHaveBeenCalledOnce();

    // A replay: Exit replay at the foot, the download on the page.
    await render({
      menu: {
        mode: { kind: 'replay' },
        onSettings: vi.fn(),
        game: { onExitReplay: vi.fn(), onExportState: vi.fn() },
      },
      request: { page: 'home', serial: 9 },
    });
    expect(
      document.querySelector('.settings-footer #exitReplayMenuItem')
    ).not.toBeNull();
    expect(document.querySelector('#settingsSavesRow')).not.toBeNull();
    // With nothing to save or replay, no row for it.
    await render({
      menu: { mode: { kind: 'tutorial' }, onSettings: vi.fn(), game: {} },
      request: { page: 'home', serial: 10 },
    });
    expect(document.querySelector('#settingsSavesRow')).toBeNull();
  });

  it('leads with what the app bar has no room for on a phone', async () => {
    const onDeck = vi.fn();
    const onPlayOnline = vi.fn();
    media = (query) => query.includes('max-width');
    const { onOpenChange } = await render({
      menu: {
        mode: { kind: 'solo' },
        onDeck,
        onPlayOnline,
        onSettings: vi.fn(),
      },
    });
    const first = document.querySelector('#settings .settings-group')!;
    expect(
      [...first.querySelectorAll('.settings-row[id]')].map((row) => row.id)
    ).toEqual(['deckImportButton', 'p2Button']);
    await press('deckImportButton');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDeck).toHaveBeenCalledOnce();
    // With room on the bar, Settings doesn't list them again.
    media = () => false;
    await act(async () => root.unmount());
    root = createRoot(host);
    await render({
      menu: {
        mode: { kind: 'solo' },
        onDeck,
        onPlayOnline,
        onSettings: vi.fn(),
      },
    });
    expect(document.querySelector('#settings #deckImportButton')).toBeNull();
  });

  it('has About: the release notes and the sponsors give way, Discord and the source open outside', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { onOpenChange } = await render();
    await press('settingsAboutRow');
    expect(page()).toBe('settingsAbout');
    expect(ids('.settings-row[id]')).toEqual([
      'changelogButton',
      'donationsButton',
      'discordButton',
      'sourceCodeButton',
    ]);
    expect(
      document.querySelector('#changelogButton .settings-row__value')
        ?.textContent
    ).toBe(RELEASE_NAME);
    await press('discordButton');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('discord.gg'),
      '_blank',
      'noopener,noreferrer'
    );
    await press('sourceCodeButton');
    expect(open).toHaveBeenLastCalledWith(
      expect.stringContaining('github.com'),
      '_blank',
      'noopener,noreferrer'
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    await press('changelogButton');
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('#changelog')).not.toBeNull();
  });

  it('reports a bug on Discord with details to paste, and nothing private in them', async () => {
    const open = vi.fn();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('open', open);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ buildId: 'preview-abc123' }))
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    window.history.replaceState(null, '', '/#invite=secret-token');
    await render({
      menu: {
        mode: { kind: 'online', detail: 'Room K7PQ2M' },
        heading: 'Room K7PQ2M',
        onSettings: vi.fn(),
      },
    });
    await press('settingsReportBugRow');
    expect(page()).toBe('settingsReportBug');
    await press('reportOnDiscordButton');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('discord.gg'),
      '_blank',
      'noopener,noreferrer'
    );
    await press('copyDiagnosticsButton');
    await settle();
    expect(writeText).toHaveBeenCalledOnce();
    const text = writeText.mock.calls[0]![0] as unknown as string;
    expect(text).toContain(RELEASE_NAME);
    expect(text).toContain('preview-abc123');
    expect(text).toContain('Room K7PQ2M');
    expect(text).not.toContain('secret-token');
    expect(
      document.querySelector('#copyDiagnosticsButton .settings-row__value')
        ?.textContent
    ).toBe('Copied');
    window.history.replaceState(null, '', '/');
  });

  it('starts copying the details within the press, before the build is known', async () => {
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          })
      )
    );
    const written: Promise<Blob>[] = [];
    const write = vi.fn(async (items: { blob: Promise<Blob> }[]) => {
      written.push(items[0]!.blob);
    });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        readonly blob: Promise<Blob>;
        constructor(parts: Record<string, Promise<Blob>>) {
          this.blob = parts['text/plain']!;
        }
      }
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { write, writeText: vi.fn() },
      configurable: true,
    });
    await render();
    await press('settingsReportBugRow');
    await act(async () =>
      document.querySelector<HTMLElement>('#copyDiagnosticsButton')!.click()
    );
    // Asked for in the press itself, though the build is still on its way.
    expect(write).toHaveBeenCalledOnce();
    answer(Response.json({ buildId: 'preview-late' }));
    expect(await (await written[0]!).text()).toContain('preview-late');
  });

  it('gives way to the keyboard shortcuts, and has no keys on a touch screen', async () => {
    const { onOpenChange } = await render();
    // No key beside it: a lone "?" read as a help mark.
    expect(
      document.querySelector('#editShortcutsButton .settings-row__value')
    ).toBeNull();
    await press('editShortcutsButton');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(shortcutsDialogState().open).toBe(true);

    media = (query) => query === '(pointer: coarse) and (hover: none)';
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(document.querySelector('#editShortcutsButton')).toBeNull();
  });

  it('lets a player in a room allow board flip at any time, and only there', async () => {
    await render();
    // A Solo table has no other player to agree with.
    expect(input('coachingModeCheckbox')).toBeNull();
    const onChange = vi.fn();
    await render({ boardFlip: { allowed: false, onChange } });
    const allow = input('coachingModeCheckbox');
    expect(allow.checked).toBe(false);
    expect(allow.closest('.settings-row')?.textContent).toContain(
      'Both players must allow it.'
    );
    await act(async () => allow.click());
    expect(onChange).toHaveBeenCalledWith(true);
    await render({ boardFlip: { allowed: true, onChange } });
    expect(input('coachingModeCheckbox').checked).toBe(true);
  });

  it("sits in the log's column beside the table when docked: Esc goes back, then it and its close put it away", async () => {
    const onOpenChange = vi.fn();
    await render({ docked: true, onOpenChange });
    const panel = document.querySelector<HTMLElement>('aside#settings')!;
    expect(panel).not.toBeNull();
    // Not a window over the table: no dialog, nothing made inert.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(panel.querySelector('#settingsDockTitle')?.textContent).toBe(
      'Settings'
    );
    // It takes the focus as it opens.
    expect(panel.contains(document.activeElement)).toBe(true);
    await press('settingsTableRow');
    expect(panel.querySelector('#darkModeCheckbox')).not.toBeNull();
    expect(panel.querySelector('#settingsDockTitle')?.textContent).toBe(
      'Table'
    );
    await pressEscape(panel);
    expect(page()).toBe('settingsHome');
    expect(onOpenChange).not.toHaveBeenCalled();
    await pressEscape(panel);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await act(async () =>
      panel.querySelector<HTMLButtonElement>('.ptcgsim-sheet__close')!.click()
    );
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    // Closed, it is gone.
    await render({ docked: true, open: false });
    expect(document.querySelector('#settings')).toBeNull();
  });

  it('is not on the page while closed', async () => {
    await render({ open: false });
    expect(document.querySelector('#settings')).toBeNull();
  });

  it('applies how the table shows as each choice is made', async () => {
    await render();
    await press('settingsTableRow');
    // Outlines on empty zones only by default; the switch keeps them all.
    expect(input('zoneOutlinesCheckbox').checked).toBe(false);
    await act(async () => input('zoneOutlinesCheckbox').click());
    expect(boardViewSettings().getSnapshot().zoneOutlines).toBe('always');
    // The opponent's half mirrors ours by default (ADR-046).
    expect(input('mirrorOpponentCheckbox').checked).toBe(true);
    await act(async () => input('mirrorOpponentCheckbox').click());
    expect(boardViewSettings().getSnapshot().mirrorOpponentSide).toBe(false);
    await press('settingsBackButton');
    await press('settingsCardsRow');
    await act(async () => input('opponentUprightCheckbox').click());
    expect(boardViewSettings().getSnapshot().opponentCardsUpright).toBe(true);
  });

  it('chooses the language and the card images by name, each named in itself', async () => {
    await render();
    await press('settingsLanguageRow');
    expect(input('language-auto').checked).toBe(true);
    expect(
      input('language-auto').closest('.settings-row')?.textContent
    ).toContain('English');
    expect(
      document
        .querySelector('#language-de')
        ?.closest('.settings-row')
        ?.querySelector('[lang="de"]')?.textContent
    ).toBe('Deutsch');
    await act(async () => input('language-de').click());
    expect(preferences().get(LANGUAGE_PREFERENCES).language).toBe('de');
    await act(async () => input('language-auto').click());
    expect(preferences().get(LANGUAGE_PREFERENCES).language).toBe('auto');
    await press('settingsBackButton');

    await press('settingsCardsRow');
    await press('cardImageLanguageRow');
    expect(input('cardImageLanguage-app').checked).toBe(true);
    expect(document.querySelector('#settings')?.textContent).toContain(
      'Only you see this.'
    );
    await act(async () => input('cardImageLanguage-fr').click());
    expect(preferences().get(CARD_IMAGE_PREFERENCES).cardImages).toBe('fr');
    await press('settingsBackButton');
    expect(
      document.querySelector('#cardImageLanguageRow .settings-row__value')
        ?.textContent
    ).toBe('Français');
  });

  it('changes the theme and the background through the room, by tiles, with no words to type', async () => {
    const onDarkModeChange = vi.fn();
    const onChange = vi.fn();
    const onRequestLink = vi.fn();
    await render({
      onDarkModeChange,
      background: { current: undefined, onChange, onRequestLink },
    });
    await press('settingsTableRow');
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
    ).toContain("Couldn't use that image.");
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
    ).not.toContain('Preparing image…');

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

  it('lets go of a picture still being prepared when Settings closes', async () => {
    const onChange = vi.fn();
    let finish: (blob: Blob) => void = () => undefined;
    const encode = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        })
    );
    const save = vi.fn(async () => true);
    await act(async () =>
      root.render(
        <BackgroundChooser
          choice={{ current: undefined, onChange, onRequestLink: vi.fn() }}
          encode={encode}
          save={save}
        />
      )
    );
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [new File(['big'], 'table.png', { type: 'image/png' })],
      },
    });
    await act(async () => {
      document.body.dispatchEvent(paste);
    });
    expect(encode).toHaveBeenCalledOnce();
    await act(async () => root.render(<></>));
    await act(async () => {
      finish(new Blob(['small'], { type: 'image/webp' }));
    });
    await settle(1);
    expect(save).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps motion choices with the player', async () => {
    await render();
    await press('settingsMotionRow');
    expect(input('reduceMotionSystem').checked).toBe(true);
    expect(input('animationSpeedNormal').checked).toBe(true);
    await act(async () => input('animationSpeedFast').click());
    expect(motionSettings().getSnapshot().animationSpeed).toBe('fast');
    await act(async () => input('reduceMotionOn').click());
    expect(motionSettings().getSnapshot().reduceMotion).toBe('reduce');
  });
});
