// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardViewSettings } from '../../board/view/board-view-settings.js';
import { closeShortcutsDialog } from '../../hotkeys/shortcuts-dialog-state.js';
import {
  DEFAULT_MOTION_SETTINGS,
  motionSettings,
} from '../../motion/motion-settings.js';
import { closeHelpPage, HelpSheetHost } from './help-pages.js';
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
    solo: true,
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
  it('holds settings only, by use: the table, the page, language, motion', async () => {
    await render();
    const sheet = document.querySelector<HTMLElement>('#settings')!;
    expect(sheet.dataset.variant).toBe('side');
    expect(sheet.textContent).not.toContain('this device');
    expect(
      [...sheet.querySelectorAll('.ptcgsim-settings-section__title')].map(
        (title) => title.textContent
      )
    ).toEqual(['Table', 'Appearance', 'Language', 'Motion']);
  });

  it('is not on the page while closed', async () => {
    await render({ open: false });
    expect(document.querySelector('#settings')).toBeNull();
  });

  it('applies how the table shows as each choice is made', async () => {
    await render();
    expect(input('lostZoneCheckbox').checked).toBe(false);
    await act(async () => input('lostZoneCheckbox').click());
    expect(boardViewSettings().getSnapshot().lostZone).toBe(true);
    await act(async () => input('zoneOutlinesCheckbox').click());
    expect(boardViewSettings().getSnapshot().zoneOutlines).toBe(false);
    await act(async () => input('hideHandCheckbox').click());
    expect(boardViewSettings().getSnapshot().hideOpponentHand).toBe(true);

    // Covering the opponent's hand is a Solo choice.
    await render({ solo: false });
    expect(document.querySelector('#hideHandCheckbox')).toBeNull();
    expect(document.querySelector('#lostZoneCheckbox')).not.toBeNull();
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
